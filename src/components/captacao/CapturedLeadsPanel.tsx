// CapturedLeadsPanel
// ──────────────────
// Painel onde o consultor vê os leads captados (Meta Lead Ads, TikTok, landing,
// pesquisa B2B), filtra, seleciona vários e dispara mensagem em massa — ou roda
// uma nova pesquisa de empresas. Os leads são SEMPRE do consultor (RLS).
//
// Anti-repetição: telefones que o consultor já disparou em campanhas anteriores
// vêm marcados como "Já enviado" e ficam fora de seleção/disparo.

import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast as sonnerToast } from "sonner";
import {
  Users, Search, Send, Loader2, Building2, User as UserIcon, MapPin, Phone, Mail,
  RefreshCw, Megaphone, Sparkles, CheckCircle2, EyeOff, Eye,
} from "lucide-react";
import {
  listCapturedLeads, countLeadsByChannel, listAlreadyDispatchedPhones,
  type CapturedLead, type LeadChannel, type PersonType, type LeadStatus,
} from "@/services/capturedLeads";
import { BusinessResearchDialog } from "@/components/captacao/BusinessResearchDialog";
import type { BulkContact } from "@/types/whatsapp";

const BulkProPanel = lazy(() =>
  import("@/components/whatsapp/bulk-pro/BulkProPanel").then((m) => ({ default: m.BulkProPanel })),
);

interface Props {
  consultantId: string;
  instanceName?: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  meta_leadads: "Meta Lead Ads",
  tiktok_leadgen: "TikTok",
  ctwa: "Click-to-WhatsApp",
  landing: "Landing page",
  research: "Pesquisa B2B",
  manual: "Manual",
};

const CHANNEL_STYLE: Record<string, string> = {
  meta_leadads: "border-primary/40 text-primary bg-primary/10",
  tiktok_leadgen: "border-accent/40 text-accent bg-accent/10",
  ctwa: "border-success/40 text-success bg-success/10",
  landing: "border-info/40 text-info bg-info/10",
  research: "border-info/40 text-info bg-info/10",
  manual: "border-muted-foreground/30 text-muted-foreground bg-muted/30",
};

const normalizePhone = (p: string | null | undefined): string => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-11) : "";
};

export function CapturedLeadsPanel({ consultantId, instanceName = null }: Props) {
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sentPhones, setSentPhones] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // filtros
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<LeadChannel | "all">("all");
  const [personType, setPersonType] = useState<PersonType | "all">("all");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [hideSent, setHideSent] = useState(true);

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [seedContacts, setSeedContacts] = useState<BulkContact[]>([]);
  const [researchOpen, setResearchOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, c, sent] = await Promise.all([
        listCapturedLeads({ consultantId, channel, personType, status, search }),
        countLeadsByChannel(consultantId),
        listAlreadyDispatchedPhones(consultantId),
      ]);
      setLeads(rows);
      setCounts(c);
      setSentPhones(sent);
    } catch (e) {
      sonnerToast.error("Falha ao carregar leads: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [consultantId, channel, personType, status, search]);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => Object.values(counts).reduce((s, n) => s + n, 0), [counts]);

  // Marca cada lead como "já enviado" e aplica o filtro "Ocultar já enviados".
  const decorated = useMemo(
    () => leads.map((l) => ({ lead: l, alreadySent: sentPhones.has(normalizePhone(l.phone)) })),
    [leads, sentPhones],
  );
  const visible = useMemo(
    () => (hideSent ? decorated.filter((d) => !d.alreadySent) : decorated),
    [decorated, hideSent],
  );
  const sentCount = useMemo(() => decorated.filter((d) => d.alreadySent).length, [decorated]);

  const selectableVisible = useMemo(() => visible.filter((d) => !d.alreadySent), [visible]);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((d) => selected.has(d.lead.id));

  const toggleAll = () => {
    setSelected(() => {
      if (allVisibleSelected) return new Set();
      return new Set(selectableVisible.map((d) => d.lead.id));
    });
  };
  const toggleOne = (id: string, alreadySent: boolean) => {
    if (alreadySent) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedWithPhone = useMemo(
    () =>
      leads.filter(
        (l) => selected.has(l.id) && l.phone && !sentPhones.has(normalizePhone(l.phone)),
      ),
    [leads, selected, sentPhones],
  );

  const openDispatch = () => {
    if (selected.size === 0) { sonnerToast.warning("Selecione ao menos um lead."); return; }
    if (selectedWithPhone.length === 0) { sonnerToast.error("Nenhum lead disparável selecionado."); return; }
    if (!instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para disparar."); return; }
    const contacts: BulkContact[] = selectedWithPhone.map((l) => ({
      id: l.id,
      name: l.full_name || l.company_name || "Lead",
      phone: l.phone as string,
      source: "imported",
    }));
    setSeedContacts(contacts);
    setDispatchOpen(true);
  };

  const doResearchImported = async () => { await load(); };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Cabeçalho */}
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Leads captados</h2>
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            <span className="font-medium text-foreground">{total.toLocaleString("pt-BR")}</span> no total
            <span className="mx-1.5 opacity-50">·</span>
            <span className="text-foreground">{visible.length.toLocaleString("pt-BR")}</span> visíveis
            {sentCount > 0 && (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                <span className="text-success">{sentCount.toLocaleString("pt-BR")}</span> já enviados
              </>
            )}
            {selected.size > 0 && (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                <span className="text-primary font-medium">{selected.size} selecionados</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => void load()} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResearchOpen(true)} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Pesquisar empresas
          </Button>
          <Button size="sm" onClick={openDispatch} disabled={selected.size === 0} className="gap-1.5">
            <Send className="w-3.5 h-3.5" /> Disparar ({selected.size})
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 p-2 rounded-lg border border-border/60 bg-card/40">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone, empresa, cidade..."
            className="pl-8 h-9 bg-background"
          />
        </div>
        <Select value={channel} onValueChange={(v) => setChannel(v as LeadChannel | "all")}>
          <SelectTrigger className="w-[160px] h-9 bg-background"><SelectValue placeholder="Canal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os canais</SelectItem>
            <SelectItem value="meta_leadads">Meta Lead Ads</SelectItem>
            <SelectItem value="tiktok_leadgen">TikTok</SelectItem>
            <SelectItem value="ctwa">Click-to-WhatsApp</SelectItem>
            <SelectItem value="landing">Landing page</SelectItem>
            <SelectItem value="research">Pesquisa B2B</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={personType} onValueChange={(v) => setPersonType(v as PersonType | "all")}>
          <SelectTrigger className="w-[120px] h-9 bg-background"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">PF e PJ</SelectItem>
            <SelectItem value="pf">Pessoa física</SelectItem>
            <SelectItem value="pj">Empresa (PJ)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | "all")}>
          <SelectTrigger className="w-[140px] h-9 bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="new">Novos</SelectItem>
            <SelectItem value="enriched">Enriquecidos</SelectItem>
            <SelectItem value="converted">Convertidos</SelectItem>
            <SelectItem value="discarded">Descartados</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={hideSent ? "secondary" : "outline"}
          onClick={() => setHideSent((v) => !v)}
          className="gap-1.5 h-9"
          title={hideSent ? "Mostrar leads já enviados" : "Ocultar leads já enviados"}
        >
          {hideSent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {hideSent ? "Ocultando já enviados" : "Mostrando todos"}
        </Button>
      </div>

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-card/30">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
            <Megaphone className="w-10 h-10 text-primary/30" strokeWidth={1} />
            <p className="text-sm font-medium">
              {leads.length === 0 ? "Nenhum lead captado ainda" : "Nada para mostrar com esses filtros"}
            </p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {leads.length === 0
                ? 'Os leads do Meta Lead Ads, TikTok e landing pages aparecem aqui. Você também pode usar "Pesquisar empresas" para gerar leads B2B.'
                : sentCount > 0 && hideSent
                  ? `${sentCount} lead(s) escondidos por já terem sido disparados.`
                  : "Ajuste os filtros para ver mais resultados."}
            </p>
            {sentCount > 0 && hideSent && (
              <Button size="sm" variant="secondary" onClick={() => setHideSent(false)} className="gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Mostrar já enviados
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-border z-10">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={toggleAll}
                    disabled={selectableVisible.length === 0}
                    aria-label="Selecionar todos visíveis"
                  />
                </th>
                <th className="px-3 py-2.5">Nome / Empresa</th>
                <th className="px-3 py-2.5 hidden sm:table-cell">Contato</th>
                <th className="px-3 py-2.5 hidden md:table-cell">Cidade</th>
                <th className="px-3 py-2.5">Canal</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ lead: l, alreadySent }) => {
                const isSelected = selected.has(l.id);
                return (
                  <tr
                    key={l.id}
                    className={[
                      "border-b border-border/30 transition-colors",
                      alreadySent
                        ? "opacity-60 cursor-default bg-muted/10"
                        : "cursor-pointer hover:bg-primary/5",
                      isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "",
                    ].join(" ")}
                    onClick={() => toggleOne(l.id, alreadySent)}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(l.id, alreadySent)}
                        disabled={alreadySent}
                        aria-label={`Selecionar ${l.full_name || l.company_name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {l.person_type === "pj"
                          ? <Building2 className="w-3.5 h-3.5 text-info shrink-0" />
                          : <UserIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                        <span className="font-medium truncate">{l.company_name || l.full_name || "—"}</span>
                        {alreadySent && (
                          <Badge
                            variant="outline"
                            className="ml-1 text-[10px] gap-1 border-success/40 text-success bg-success/10 px-1.5 py-0"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Já enviado
                          </Badge>
                        )}
                      </div>
                      {l.person_type === "pj" && l.full_name && (
                        <span className="text-[11px] text-muted-foreground ml-5 block">contato: {l.full_name}</span>
                      )}
                      {l.person_type === "pj" && (l.pj_data?.ramo as string) && (
                        <span className="text-[11px] text-muted-foreground ml-5 block capitalize">{l.pj_data?.ramo as string}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5 text-[12px]">
                        {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-muted-foreground" />{l.phone}</span>}
                        {l.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" />{l.email}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell text-[12px] text-muted-foreground">
                      {(() => {
                        const addr = (l.pj_data?.full_address as string) || null;
                        if (addr) return <span className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[260px]">{addr}</span></span>;
                        if (l.city) return <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{l.city}{l.uf ? `/${l.uf}` : ""}</span>;
                        return "—";
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${CHANNEL_STYLE[l.channel] || ""}`}
                      >
                        {CHANNEL_LABEL[l.channel] || l.channel}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialog de disparo */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" /> Disparar para os leads selecionados
            </DialogTitle>
            <DialogDescription>
              {seedContacts.length} contato(s) com telefone já estão carregados. Siga os passos do Disparo PRO (mensagem, envio e acompanhamento) — o envio respeita o anti-ban.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            {instanceName ? (
              <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
                <BulkProPanel
                  instanceName={instanceName}
                  customers={[]}
                  templates={[]}
                  consultantId={consultantId}
                  seedContacts={seedContacts}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                Conecte o WhatsApp para disparar.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BusinessResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        onImported={doResearchImported}
      />
    </div>
  );
}
