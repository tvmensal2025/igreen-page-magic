// CapturedLeadsPanel
// ──────────────────
// Painel onde o consultor vê os leads captados (anúncios, site, empresas
// pesquisadas), filtra, seleciona e dispara mensagem em massa.
//
// Regra de organização:
//  - Lista PRINCIPAL = só leads que AINDA NÃO receberam mensagem.
//  - Painel LATERAL "Já conversados" = leads que o consultor já disparou
//    em campanhas anteriores. Ficam fora da lista principal para não
//    misturar e nem repetir disparos.

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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Search, Send, Loader2, Building2, User as UserIcon, MapPin, Phone, Mail,
  RefreshCw, Megaphone, Sparkles, MessageCircle,
} from "lucide-react";
import {
  listCapturedLeads, countLeadsByChannel, listAlreadyDispatchedPhones,
  type CapturedLead, type LeadChannel, type PersonType, type LeadStatus,
} from "@/services/capturedLeads";
import { BusinessResearchDialog } from "@/components/captacao/BusinessResearchDialog";
import { AlreadyContactedList } from "@/components/captacao/AlreadyContactedList";
import type { BulkContact } from "@/types/whatsapp";

const BulkProPanel = lazy(() =>
  import("@/components/whatsapp/bulk-pro/BulkProPanel").then((m) => ({ default: m.BulkProPanel })),
);

interface Props {
  consultantId: string;
  instanceName?: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  meta_leadads: "Anúncio Facebook/Instagram",
  tiktok_leadgen: "Anúncio TikTok",
  ctwa: "Veio do anúncio",
  landing: "Site / Página",
  research: "Empresa pesquisada",
  manual: "Cadastro manual",
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
  const [tab, setTab] = useState<"novos" | "conversados">("novos");

  // filtros (somente lista principal)
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<LeadChannel | "all">("all");
  const [personType, setPersonType] = useState<PersonType | "all">("all");
  const [status, setStatus] = useState<LeadStatus | "all">("all");

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

  // Backfill silencioso de leads vindos do WhatsApp/CTWA — roda 1x no mount,
  // sem botão e sem banner. Se trouxer novidades, recarrega a lista.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("captacao-backfill-ctwa", {
          body: { consultantId, days: 90 },
        });
        if (cancelled || error) return;
        const r = (data ?? {}) as { ingested?: number };
        if ((r.ingested ?? 0) > 0) {
          // eslint-disable-next-line no-console
          console.log(`[captacao] backfill silencioso trouxe ${r.ingested} lead(s) do WhatsApp`);
          await load();
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[captacao] backfill silencioso falhou:", (e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [consultantId, load]);

  const total = useMemo(() => Object.values(counts).reduce((s, n) => s + n, 0), [counts]);

  // Divide entre "novos" (aba principal) e "já conversados" (aba secundária).
  const partitioned = useMemo(() => {
    const novos: CapturedLead[] = [];
    const jaConv: CapturedLead[] = [];
    for (const l of leads) {
      if (sentPhones.has(normalizePhone(l.phone))) jaConv.push(l);
      else novos.push(l);
    }
    return { novos, jaConv };
  }, [leads, sentPhones]);

  const sideFiltered = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return partitioned.jaConv;
    return partitioned.jaConv.filter((l) =>
      [l.full_name, l.company_name, l.phone, l.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [partitioned.jaConv, sideSearch]);

  const allVisibleSelected =
    partitioned.novos.length > 0 && partitioned.novos.every((l) => selected.has(l.id));

  const toggleAll = () => {
    setSelected(() => {
      if (allVisibleSelected) return new Set();
      return new Set(partitioned.novos.map((l) => l.id));
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedWithPhone = useMemo(
    () => partitioned.novos.filter((l) => selected.has(l.id) && l.phone),
    [partitioned.novos, selected],
  );

  const openDispatch = () => {
    if (selected.size === 0) { sonnerToast.warning("Selecione ao menos um lead."); return; }
    if (selectedWithPhone.length === 0) { sonnerToast.error("Nenhum lead com telefone selecionado."); return; }
    if (!instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para enviar."); return; }
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
            <h2 className="text-lg font-semibold tracking-tight">Lista de leads</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge variant="secondary" className="gap-1 font-normal">
              <span className="text-foreground font-semibold">{partitioned.novos.length}</span>
              <span className="text-muted-foreground">novos</span>
            </Badge>
            {selected.size > 0 && (
              <Badge variant="default" className="gap-1 font-normal">
                <span className="font-semibold">{selected.size}</span>
                <span>selecionados</span>
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground ml-1">
              {total.toLocaleString("pt-BR")} no total
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => void load()} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResearchOpen(true)} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Pesquisar empresas
          </Button>
          <Button size="sm" onClick={openDispatch} disabled={selected.size === 0} className="gap-1.5">
            <Send className="w-3.5 h-3.5" /> Enviar mensagem ({selected.size})
          </Button>
        </div>
      </div>

      {/* Abas: Novos / Já conversados */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "novos" | "conversados")} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="novos" className="gap-1.5">
            Novos leads
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{partitioned.novos.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="conversados" className="gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" />
            Já conversados
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{partitioned.jaConv.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="novos" className="flex-1 min-h-0 flex flex-col gap-3 mt-3 data-[state=inactive]:hidden">
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
            <SelectTrigger className="w-[200px] h-9 bg-background"><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              <SelectItem value="meta_leadads">Anúncio Facebook/Instagram</SelectItem>
              <SelectItem value="tiktok_leadgen">Anúncio TikTok</SelectItem>
              <SelectItem value="ctwa">Veio do anúncio</SelectItem>
              <SelectItem value="landing">Site / Página</SelectItem>
              <SelectItem value="research">Empresa pesquisada</SelectItem>
              <SelectItem value="manual">Cadastro manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={personType} onValueChange={(v) => setPersonType(v as PersonType | "all")}>
            <SelectTrigger className="w-[140px] h-9 bg-background"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Pessoa e Empresa</SelectItem>
              <SelectItem value="pf">Pessoa física</SelectItem>
              <SelectItem value="pj">Empresa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | "all")}>
            <SelectTrigger className="w-[140px] h-9 bg-background"><SelectValue placeholder="Situação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas situações</SelectItem>
              <SelectItem value="new">Novos</SelectItem>
              <SelectItem value="enriched">Enriquecidos</SelectItem>
              <SelectItem value="converted">Convertidos</SelectItem>
              <SelectItem value="discarded">Descartados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-card/30">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : partitioned.novos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
              <Megaphone className="w-10 h-10 text-primary/30" strokeWidth={1} />
              <p className="text-sm font-medium">
                {leads.length === 0
                  ? "Nenhum lead aqui ainda"
                  : partitioned.jaConv.length > 0
                    ? "Todos os leads já foram contactados"
                    : "Nada para mostrar com esses filtros"}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {leads.length === 0
                  ? 'Leads vindos de anúncios e site aparecem aqui. Use "Pesquisar empresas" ou "Buscar novos do WhatsApp" para popular a lista.'
                  : partitioned.jaConv.length > 0
                    ? `Os ${partitioned.jaConv.length} leads que já receberam mensagem estão no painel "Já conversados".`
                    : "Ajuste os filtros para ver mais resultados."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-border z-10">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="px-3 py-2.5">Nome / Empresa</th>
                  <th className="px-3 py-2.5 hidden sm:table-cell">Contato</th>
                  <th className="px-3 py-2.5 hidden md:table-cell">Cidade</th>
                  <th className="px-3 py-2.5">Origem</th>
                </tr>
              </thead>
              <tbody>
                {partitioned.novos.map((l) => {
                  const isSelected = selected.has(l.id);
                  return (
                    <tr
                      key={l.id}
                      className={[
                        "border-b border-border/30 transition-colors cursor-pointer hover:bg-primary/5",
                        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "",
                      ].join(" ")}
                      onClick={() => toggleOne(l.id)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(l.id)}
                          aria-label={`Selecionar ${l.full_name || l.company_name}`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {l.person_type === "pj"
                            ? <Building2 className="w-3.5 h-3.5 text-info shrink-0" />
                            : <UserIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                          <span className="font-medium truncate">{l.company_name || l.full_name || "—"}</span>
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
      </div>

      {/* ────────── PAINEL LATERAL FIXO (desktop) ────────── */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card/40 overflow-hidden">
        {SidePanelContent}
      </aside>

      {/* ────────── SHEET (mobile) ────────── */}
      <Sheet open={sideOpen} onOpenChange={setSideOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col">
          <SheetHeader className="p-3 border-b border-border/60 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <MessageCircle className="w-4 h-4 text-success" /> Já conversados
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">{SidePanelContent}</div>
        </SheetContent>
      </Sheet>

      {/* Dialog de disparo */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" /> Enviar mensagem para os selecionados
            </DialogTitle>
            <DialogDescription>
              {seedContacts.length} contato(s) carregado(s). Siga os passos abaixo (mensagem, envio e acompanhamento) — o envio é feito com segurança para evitar bloqueio.
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
                Conecte o WhatsApp para enviar.
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
