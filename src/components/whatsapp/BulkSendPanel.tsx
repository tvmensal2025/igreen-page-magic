import { useState, useRef, useMemo } from "react";
import { Users, Send, CheckSquare, Loader2, Sparkles, Megaphone, Timer, Shield, Filter, Eye, Phone, Mail, MapPin, Zap, ChevronDown, X, CheckCircle2, Search, AlertTriangle, Clock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { sendTemplate } from "@/services/templateSender";
import type { MessageTemplate } from "@/types/whatsapp";

export type BulkSendResult = { total: number; sent: number; failed: number };
interface Customer {
  id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number;
  status?: string; devolutiva?: string | null;
  email?: string | null; cpf?: string | null; address_city?: string | null; address_state?: string | null;
  distribuidora?: string | null; observacao?: string | null; andamento_igreen?: string | null;
  media_consumo?: number | null; registered_by_name?: string | null;
  customer_origin?: "igreen_sync" | "whatsapp_lead" | "manual" | null;
  do_not_contact?: boolean | null;
}
interface BulkSendPanelProps {
  instanceName: string; customers: Customer[]; templates: MessageTemplate[];
  applyTemplate: (t: MessageTemplate, c: { name: string; electricity_bill_value?: number }) => string;
}
const SEND_INTERVAL_MIN_S = 18;
const SEND_INTERVAL_MAX_S = 35;
const PROGRESSIVE_EXTRA_S = 5;

function getRandomInterval(messageIndex: number): number {
  const base = SEND_INTERVAL_MIN_S + Math.random() * (SEND_INTERVAL_MAX_S - SEND_INTERVAL_MIN_S);
  const progressive = Math.floor(messageIndex / 10) * PROGRESSIVE_EXTRA_S;
  return Math.round(base + progressive);
}

/** Check if a phone number is valid for sending */
function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  if (/sem_celular/i.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10;
}

/** Estimate total send time in seconds */
function estimateSendTime(count: number): number {
  if (count <= 1) return 0;
  const avgInterval = (SEND_INTERVAL_MIN_S + SEND_INTERVAL_MAX_S) / 2;
  let total = 0;
  for (let i = 0; i < count - 1; i++) {
    total += avgInterval + Math.floor(i / 10) * PROGRESSIVE_EXTRA_S;
  }
  return Math.round(total);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}min ${s}s` : `${m}min`;
}

type StatusFilter = "all" | "approved" | "rejected" | "pending";

const DEVOLUTIVA_CATEGORIES = [
  { key: "fatura_ilegivel", label: "Fatura Ilegível", match: ["fatura ilegível", "fatura ilegivel"] },
  { key: "sem_fatura", label: "Sem Fatura de Energia", match: ["sem anexo de fatura", "fatura de energia não anexada", "fatura não anexada"] },
  { key: "distribuidora_diferente", label: "Distribuidora Diferente", match: ["distribuidora da fatura diferente"] },
  { key: "sem_documento", label: "Sem Documento Pessoal", match: ["sem anexo de documento pessoal"] },
  { key: "documento_ilegivel", label: "Documento Ilegível", match: ["ilegível no anexo de rg", "ilegível no anexo de cnh", "número no rg diferente", "nome no rg diferente", "cpf na cnh diferente", "nome na cnh diferente"] },
  { key: "debito_aberto", label: "Débito em Aberto", match: ["débito em aberto", "débitos em aberto", "debito em aberto"] },
  { key: "fatura_desatualizada", label: "Fatura Desatualizada", match: ["fatura desatualizada"] },
  { key: "cancelado", label: "Cancelado", match: ["cancelado"] },
  { key: "excluido", label: "Excluído", match: ["excluido", "excluído"] },
  { key: "consumo_inferior", label: "Consumo Inferior", match: ["consumo inferior"] },
];

function matchDevolutiva(devolutiva: string | null | undefined, categoryKey: string): boolean {
  if (!devolutiva) return false;
  const lower = devolutiva.toLowerCase();
  const cat = DEVOLUTIVA_CATEGORIES.find(c => c.key === categoryKey);
  if (!cat) return false;
  return cat.match.some(m => lower.includes(m));
}

export function BulkSendPanel({ instanceName, customers, templates, applyTemplate }: BulkSendPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<BulkSendResult | null>(null);
  const [result, setResult] = useState<BulkSendResult | null>(null);
  const [warning, setWarning] = useState("");
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [originFilter, setOriginFilter] = useState<"whatsapp_lead" | "igreen_sync">("igreen_sync");
  const [devolutivaFilter, setDevolutivaFilter] = useState<string>("all");
  const [licenciadoFilter, setLicenciadoFilter] = useState<Set<string>>(new Set());
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const licenciadoOptions = useMemo(() => {
    const names = new Set<string>();
    customers.forEach(c => { if (c.registered_by_name) names.add(c.registered_by_name); });
    return Array.from(names).sort();
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    // Filtro de origem: NUNCA mistura Leads WhatsApp com Clientes iGreen
    let list = customers.filter((c) => {
      const origin = c.customer_origin || "whatsapp_lead";
      if (originFilter === "igreen_sync") return origin === "igreen_sync";
      return origin === "whatsapp_lead" || origin === "manual";
    });
    if (statusFilter === "approved") list = list.filter(c => c.status === "approved");
    else if (statusFilter === "rejected") list = list.filter(c => c.status === "rejected");
    else if (statusFilter === "pending") list = list.filter(c => c.status === "pending");
    if (devolutivaFilter !== "all") {
      list = list.filter(c => matchDevolutiva(c.devolutiva, devolutivaFilter));
    }
    if (licenciadoFilter.size > 0) {
      list = list.filter(c => c.registered_by_name != null && licenciadoFilter.has(c.registered_by_name));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        c.phone_whatsapp.toLowerCase().includes(q)
      );
    }
    return list;
  }, [customers, originFilter, statusFilter, devolutivaFilter, licenciadoFilter, searchQuery]);

  // Valid/invalid phone counts
  const validCount = useMemo(() => filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).length, [filteredCustomers]);
  const invalidCount = filteredCustomers.length - validCount;

  // Selected valid count
  const selectedValidCount = useMemo(() => {
    return customers.filter(c => selectedIds.has(c.id) && isValidPhone(c.phone_whatsapp)).length;
  }, [customers, selectedIds]);
  const selectedInvalidCount = selectedIds.size - selectedValidCount;

  // Time estimate for selected valid
  const timeEstimate = useMemo(() => estimateSendTime(selectedValidCount), [selectedValidCount]);

  const allValidSelected = useMemo(() => {
    const validInList = filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp));
    return validInList.length > 0 && validInList.every(c => selectedIds.has(c.id));
  }, [filteredCustomers, selectedIds]);

  // Preview message with first selected customer's data
  const previewMessage = useMemo(() => {
    if (!message.trim()) return null;
    const firstSelected = customers.find(c => selectedIds.has(c.id));
    if (!firstSelected) return null;
    if (message.includes("{{")) {
      return applyTemplate(
        { id: "", consultant_id: "", name: "", content: message, media_type: "text", media_url: null, image_url: null, created_at: "" },
        firstSelected
      );
    }
    return message;
  }, [message, selectedIds, customers, applyTemplate]);

  function toggleCustomer(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setWarning("");
  }

  function toggleAll() {
    if (allValidSelected) {
      // Deselect all valid from filtered
      setSelectedIds(prev => {
        const n = new Set(prev);
        filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).forEach(c => n.delete(c.id));
        return n;
      });
    } else {
      // Select only valid phones from filtered
      setSelectedIds(prev => {
        const n = new Set(prev);
        filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).forEach(c => n.add(c.id));
        return n;
      });
    }
    setWarning("");
  }

  function handleTemplateChange(tid: string) {
    const t = templates.find((t) => t.id === tid);
    if (t) {
      setMessage(t.content);
      setSelectedTemplate(t);
    }
  }

  function handleStatusFilter(val: string) {
    setStatusFilter(val as StatusFilter);
    setDevolutivaFilter("all");
    setLicenciadoFilter(new Set());
    setSelectedIds(new Set());
  }

  async function handleBulkSend() {
    if (selectedIds.size === 0) { setWarning("Selecione pelo menos um destinatário"); return; }
    const hasTemplateItems = !!(selectedTemplate && ((selectedTemplate.items && selectedTemplate.items.length > 0) || selectedTemplate.media_url));
    if (!message.trim() && !hasTemplateItems) return;
    abortRef.current = false;
    setWarning(""); setIsSending(true); setResult(null);
    // LGPD: nunca envia para quem optou por sair (do_not_contact=true).
    const selected = customers.filter((c) => selectedIds.has(c.id) && !c.do_not_contact);
    let sent = 0, failed = 0;

    for (let i = 0; i < selected.length; i++) {
      if (abortRef.current) break;
      setProgress({ total: selected.length, sent, failed });
      try {
        const phone = selected[i].phone_whatsapp;
        const renderText = (txt: string) =>
          txt.includes("{{")
            ? applyTemplate({ id: "", consultant_id: "", name: "", content: txt, media_type: "text", media_url: null, image_url: null, created_at: "" }, selected[i])
            : txt;

        let allOk = true;

        if (selectedTemplate && hasTemplateItems) {
          // Envia todos os itens do template em ordem (multi-arquivo).
          allOk = await sendTemplate(selectedTemplate, { instanceName, phone, renderText });
          // Mensagem livre adicional digitada no campo (além do template).
          if (message.trim()) {
            const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text: renderText(message) });
            if (r.status === "failed") allOk = false;
          }
        } else if (message.trim()) {
          const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text: renderText(message) });
          if (r.status === "failed") allOk = false;
        }

        if (allOk) {
          sent++;
          setSentIds(prev => new Set(prev).add(selected[i].id));
        } else { failed++; }
      } catch { failed++; }

      if (i < selected.length - 1 && !abortRef.current) {
        const intervalS = getRandomInterval(i);
        setCountdown(intervalS);
        await new Promise<void>((resolve) => {
          let seconds = intervalS;
          countdownRef.current = setInterval(() => {
            seconds--;
            setCountdown(seconds);
            if (seconds <= 0 || abortRef.current) {
              if (countdownRef.current) clearInterval(countdownRef.current);
              countdownRef.current = null;
              resolve();
            }
          }, 1000);
        });
        setCountdown(0);
      }
    }
    const r: BulkSendResult = { total: selected.length, sent, failed };
    setProgress(null); setResult(r); setIsSending(false);
    toast({ title: "Envio concluído", description: `${sent} enviadas, ${failed} falhas`, variant: failed > 0 ? "destructive" : "default" });
  }
  const pct = progress && progress.total > 0 ? ((progress.sent + progress.failed) / progress.total) * 100 : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-warning/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-warning/3 rounded-full blur-3xl" />
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warning/20 to-warning/10 flex items-center justify-center border border-warning/20">
            <Megaphone className="w-5 h-5 text-warning" />
          </div>
          <div className="flex-1">
            <h3 className="font-heading font-bold text-foreground text-lg flex items-center gap-2">
              Envio em Massa
              <HelpHint
                title="Envio em Massa"
                summary="Envia a mesma mensagem para vários contatos com delay seguro"
                details="Selecione público (Clientes interessados WhatsApp ou Clientes iGreen — nunca mistura os dois), aplique filtros de status/licenciada, escreva ou escolha um template e dispare. O envio respeita delay entre mensagens (1,5s–2,5s) e ordem áudio → imagem → texto para parecer humano."
                example="Quer avisar todos os leads em 'Aguardando conta' sobre um novo prazo? Filtre por esse status e envie um lembrete único."
              />
            </h3>
            <p className="text-xs text-muted-foreground">Envie para vários clientes de uma vez</p>
          </div>
        </div>

        {/* Origem do público — NUNCA mistura Clientes interessados WhatsApp com Clientes iGreen */}
        <div className="flex flex-wrap gap-2 mb-3 p-2 rounded-xl border border-border/50 bg-secondary/20">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80 mr-1">
            <Users className="w-3.5 h-3.5" /> Público:
          </div>
          {[
            { key: "igreen_sync", label: "Clientes iGreen (carteira)" },
            { key: "whatsapp_lead", label: "Clientes interessados WhatsApp (anúncio)" },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => {
                setOriginFilter(o.key as any);
                setStatusFilter("all");
                setDevolutivaFilter("all");
                setLicenciadoFilter(new Set());
                setSelectedIds(new Set());
              }}
              disabled={isSending}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                originFilter === o.key
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-card/60 border-border/40 text-muted-foreground hover:bg-card"
              } ${isSending ? "opacity-50 pointer-events-none" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Status filters — específicos por público (NUNCA misturar) */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
            <Filter className="w-3.5 h-3.5" /> Filtrar:
          </div>
          {(originFilter === "igreen_sync"
            ? [
                { key: "all", label: "Todos" },
                { key: "approved", label: "Aprovado" },
                { key: "rejected", label: "Reprovado / Devolutiva" },
                { key: "pending", label: "Em análise" },
              ]
            : [
                { key: "all", label: "Todos" },
                { key: "pending", label: "Em conversa" },
                { key: "approved", label: "Convertido" },
                { key: "rejected", label: "Falha" },
              ]
          ).map(f => (
            <button
              key={f.key}
              onClick={() => handleStatusFilter(f.key)}
              disabled={isSending}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                statusFilter === f.key
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
              } ${isSending ? "opacity-50 pointer-events-none" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Devolutiva filter — só para carteira iGreen reprovada */}
        {originFilter === "igreen_sync" && statusFilter === "rejected" && (
          <div className="mb-3">
            <Select value={devolutivaFilter} onValueChange={setDevolutivaFilter} disabled={isSending}>
              <SelectTrigger className="rounded-xl bg-secondary/50 border-border/50">
                <AlertTriangle className="w-3.5 h-3.5 text-warning mr-2" />
                <SelectValue placeholder="Filtrar por devolutiva..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as devolutivas</SelectItem>
                {DEVOLUTIVA_CATEGORIES.map(cat => (
                  <SelectItem key={cat.key} value={cat.key}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Licenciado multi-select filter — só faz sentido para carteira iGreen */}
        {originFilter === "igreen_sync" && licenciadoOptions.length > 0 && (
          <div className="mb-3">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  disabled={isSending}
                  className={`w-full flex items-center gap-2 rounded-xl bg-secondary/50 border border-border/50 text-sm px-3 py-2 text-left transition-colors hover:bg-secondary/70 ${isSending ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate text-muted-foreground">
                    {licenciadoFilter.size === 0
                      ? "Todos os licenciados"
                      : licenciadoFilter.size === 1
                        ? Array.from(licenciadoFilter)[0]
                        : `${licenciadoFilter.size} licenciados selecionados`}
                  </span>
                  {licenciadoFilter.size > 0 && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setLicenciadoFilter(new Set()); setSelectedIds(new Set()); }}
                      className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                  <span className="text-xs font-medium text-muted-foreground">Licenciados</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { setLicenciadoFilter(new Set(licenciadoOptions)); setSelectedIds(new Set()); }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Todos
                    </button>
                    <span className="text-muted-foreground/40">|</span>
                    <button
                      onClick={() => { setLicenciadoFilter(new Set()); setSelectedIds(new Set()); }}
                      className="text-[11px] text-muted-foreground hover:underline"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
                  {licenciadoOptions.map(name => (
                    <label
                      key={name}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-secondary/50 transition-colors"
                    >
                      <Checkbox
                        checked={licenciadoFilter.has(name)}
                        onCheckedChange={(checked) => {
                          setLicenciadoFilter(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(name); else next.delete(name);
                            return next;
                          });
                          setSelectedIds(new Set());
                        }}
                      />
                      <span className="text-sm text-foreground truncate">{name}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isSending}
            className="pl-9 rounded-xl bg-secondary/50 border-border/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Select all + counters */}
        <div className="flex items-center justify-between mb-2 px-1">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <Checkbox checked={allValidSelected} onCheckedChange={toggleAll} disabled={isSending || filteredCustomers.length === 0} />
            <span className="text-sm text-foreground font-medium flex items-center gap-1.5">
              <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" /> Selecionar Válidos
            </span>
          </label>
          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
            {selectedIds.size} selecionados
          </span>
        </div>

        {/* Valid/invalid counter */}
        <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
          <span className="text-[11px] text-muted-foreground">{filteredCustomers.length} filtrados:</span>
          <span className="text-[11px] text-primary flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {validCount} válidos
          </span>
          {invalidCount > 0 && (
            <span className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {invalidCount} sem número válido
            </span>
          )}
          {selectedInvalidCount > 0 && (
            <span className="text-[11px] text-warning flex items-center gap-1">
              ⚠ {selectedInvalidCount} inválido(s) selecionado(s)
            </span>
          )}
        </div>

        {/* Customer list */}
        <div className="max-h-52 overflow-y-auto rounded-xl border border-border/50 mb-4 divide-y divide-border/30">
          {filteredCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {customers.length === 0 ? "Nenhum cliente" : searchQuery ? "Nenhum resultado para a busca" : "Nenhum cliente com este filtro"}
            </p>
          ) : filteredCustomers.map((c) => {
            const phoneValid = isValidPhone(c.phone_whatsapp);
            return (
              <div key={c.id} className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all hover:bg-secondary/40 ${selectedIds.has(c.id) ? "bg-warning/5" : ""} ${!phoneValid ? "opacity-50" : ""} ${isSending ? "pointer-events-none opacity-50" : ""}`}>
                <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleCustomer(c.id)} disabled={isSending} />
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setViewingCustomer(c)}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm text-foreground truncate hover:underline">{c.name}</p>
                    {sentIds.has(c.id) && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                    {!phoneValid && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium shrink-0">
                        Nº inválido
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/70">{c.phone_whatsapp}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.status === "approved" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">Aprovado</span>}
                  {c.status === "rejected" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">Reprovado</span>}
                  {c.status === "pending" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium">Pendente</span>}
                  {c.devolutiva && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-medium">Dev.</span>}
                  <button onClick={() => setViewingCustomer(c)} className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {warning && (
          <div className="rounded-xl bg-destructive/5 border border-destructive/20 px-4 py-2.5 mb-3">
            <p className="text-sm text-destructive font-medium">{warning}</p>
          </div>
        )}

        {templates.length > 0 && (
          <div className="mb-3">
            <Select onValueChange={handleTemplateChange} disabled={isSending}>
              <SelectTrigger className="rounded-xl bg-secondary/50 border-border/50">
                <Sparkles className="w-3.5 h-3.5 text-primary mr-2" />
                <SelectValue placeholder="Usar template..." />
              </SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        <Textarea placeholder="Digite sua mensagem..." value={message} onChange={(e) => setMessage(e.target.value)} rows={4} disabled={isSending} className="mb-3 rounded-xl bg-secondary/30 border-border/40 resize-none" />

        {/* Message preview */}
        {previewMessage && selectedIds.size > 0 && !isSending && (
          <div className="mb-4 rounded-xl border border-border/40 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border-b border-border/30">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Preview da mensagem</span>
            </div>
            <div className="p-3 bg-[#0b141a]">
              <div className="max-w-[85%] ml-auto rounded-lg bg-[#005c4b] px-3 py-2 shadow-sm">
                <p className="text-sm text-white/90 whitespace-pre-wrap break-words">{previewMessage}</p>
                <p className="text-[10px] text-white/40 text-right mt-1">agora</p>
              </div>
            </div>
          </div>
        )}

        {/* Time estimate */}
        {selectedValidCount > 1 && !isSending && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <Clock className="w-3.5 h-3.5 text-info" />
            <span className="text-xs text-info">
              Tempo estimado: <span className="font-bold">~{formatDuration(timeEstimate)}</span> para {selectedValidCount} contatos
            </span>
          </div>
        )}

        {isSending && progress && (
          <div className="mb-4 space-y-3 rounded-xl bg-secondary/20 border border-border/30 p-4">
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-warning" />
              <span className="font-medium flex-1">Enviando... {progress.sent + progress.failed}/{progress.total}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => { abortRef.current = true; if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; } }}
              >
                Parar
              </Button>
            </div>
            <Progress value={pct} className="h-2" />
            {countdown > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg bg-info/10 border border-info/20 px-3 py-2">
                <Shield className="w-4 h-4 text-info shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-info font-medium">Proteção anti-bloqueio ativa</p>
                  <p className="text-[11px] text-info/70">Aguardando intervalo de segurança...</p>
                </div>
                <div className="flex items-center gap-1.5 bg-info/15 px-2.5 py-1 rounded-full">
                  <Timer className="w-3.5 h-3.5 text-info" />
                  <span className="text-sm font-mono font-bold text-info">{countdown}s</span>
                </div>
              </div>
            )}
          </div>
        )}

        {result && !isSending && (
          <div className="rounded-xl border border-border/40 bg-secondary/20 px-4 py-3.5 mb-4">
            <p className="text-sm text-foreground font-bold mb-2">Envio concluído</p>
            <div className="flex gap-4 text-xs font-medium">
              <span className="text-primary flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" />{result.sent} enviadas</span>
              {result.failed > 0 && <span className="text-destructive flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" />{result.failed} falhas</span>}
            </div>
          </div>
        )}

        <Button onClick={handleBulkSend} disabled={selectedIds.size === 0 || (!message.trim() && !selectedTemplate?.media_url && !(selectedTemplate?.items && selectedTemplate.items.length > 0)) || isSending} className="gap-2 rounded-xl h-11 font-bold shadow-lg shadow-green-500/10 hover:shadow-green-500/20 transition-all" style={{ background: "var(--gradient-green)" }}>
          {isSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : <><Send className="w-4 h-4" /> Enviar para {selectedValidCount} clientes</>}
        </Button>
      </div>

      {/* Customer detail dialog */}
      <Dialog open={!!viewingCustomer} onOpenChange={(open) => !open && setViewingCustomer(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">{viewingCustomer?.name}</DialogTitle>
          </DialogHeader>
          {viewingCustomer && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>{viewingCustomer.phone_whatsapp}</span>
                </div>
                {viewingCustomer.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-4 h-4 shrink-0" />
                    <span className="truncate">{viewingCustomer.email}</span>
                  </div>
                )}
              </div>

              {viewingCustomer.cpf && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">CPF:</span> {viewingCustomer.cpf}</div>
              )}

              {(viewingCustomer.address_city || viewingCustomer.address_state) && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{[viewingCustomer.address_city, viewingCustomer.address_state].filter(Boolean).join(" - ")}</span>
                </div>
              )}

              {viewingCustomer.distribuidora && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Distribuidora:</span> {viewingCustomer.distribuidora}</div>
              )}

              {viewingCustomer.electricity_bill_value != null && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Conta de Luz:</span> R$ {viewingCustomer.electricity_bill_value.toFixed(2)}</div>
              )}

              {viewingCustomer.media_consumo != null && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Consumo Médio:</span> {viewingCustomer.media_consumo} kWh</div>
              )}

              {viewingCustomer.registered_by_name && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Licenciado:</span> {viewingCustomer.registered_by_name}</div>
              )}

              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Status:</span>
                {viewingCustomer.status === "approved" && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">Aprovado</span>}
                {viewingCustomer.status === "rejected" && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">Reprovado</span>}
                {viewingCustomer.status === "pending" && <span className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium">Pendente</span>}
              </div>

              {viewingCustomer.andamento_igreen && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Andamento:</span> {viewingCustomer.andamento_igreen}</div>
              )}

              {viewingCustomer.devolutiva && (
                <div className="rounded-lg bg-warning/10 border border-warning/20 p-3">
                  <p className="text-xs font-medium text-warning mb-1">Devolutiva</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{viewingCustomer.devolutiva}</p>
                </div>
              )}

              {viewingCustomer.observacao && (
                <div className="text-muted-foreground"><span className="font-medium text-foreground">Observação:</span> {viewingCustomer.observacao}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
