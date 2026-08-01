// CapturedLeadsPanel
// ──────────────────
// Lista paginada de captured_leads + disparo enfileirado no servidor
// (leads-to-campaign → bulk-scheduler). Não baixa 95k no browser.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast as sonnerToast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Search, Send, Loader2, Building2, User as UserIcon, MapPin, Phone, Mail,
  RefreshCw, Megaphone, Sparkles, MessageCircle, ChevronLeft, ChevronRight, ShieldBan,
} from "lucide-react";
import {
  listCapturedLeads, countLeadsByChannel, filterAlreadyDispatchedPhones,
  dispatchLeadsToCampaign, discardLead,
  type CapturedLead, type LeadChannel, type PersonType, type LeadStatus,
} from "@/services/capturedLeads";
import { suppressContact } from "@/services/contactSuppression";
import { NeverContactConfirmDialog } from "@/components/leads/NeverContactDialogs";
import { BusinessResearchDialog } from "@/components/captacao/BusinessResearchDialog";
import { AlreadyContactedList } from "@/components/captacao/AlreadyContactedList";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  consultantId: string;
  instanceName?: string | null;
}

const PAGE_SIZE = 50;

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
  tiktok_leadgen: "border-primary/40 text-primary bg-primary/10",
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
  const confirm = useConfirm();
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sentPhones, setSentPhones] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"novos" | "conversados">("novos");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<LeadChannel | "all">("all");
  const [personType, setPersonType] = useState<PersonType | "all">("all");
  const [status, setStatus] = useState<LeadStatus | "all">("all");

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [neverLead, setNeverLead] = useState<CapturedLead | null>(null);

  // Debounce busca
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset página ao mudar filtros
  useEffect(() => { setPage(0); setSelected(new Set()); }, [channel, personType, status]);

  const loadCounts = useCallback(async () => {
    try {
      const c = await countLeadsByChannel(consultantId);
      setCounts(c);
    } catch {
      /* contagem é secundária */
    }
  }, [consultantId]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCapturedLeads({
        consultantId,
        channel,
        personType,
        status,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      setLeads(result.rows);
      setTotalFiltered(result.total);

      // Anti-repetição só da página (não bloqueia se falhar)
      const phones = result.rows.map((r) => r.phone || "").filter(Boolean);
      try {
        const sent = await filterAlreadyDispatchedPhones(consultantId, phones);
        setSentPhones(sent);
      } catch {
        setSentPhones(new Set());
      }
    } catch (e) {
      sonnerToast.error("Falha ao carregar leads: " + (e as Error).message);
      setLeads([]);
      setTotalFiltered(0);
    } finally {
      setLoading(false);
    }
  }, [consultantId, channel, personType, status, search, page]);

  useEffect(() => { void loadPage(); }, [loadPage]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);

  // Backfill CTWA silencioso (1x) — não bloqueia lista
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
          await loadPage();
          await loadCounts();
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [consultantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalAll = useMemo(() => Object.values(counts).reduce((s, n) => s + n, 0), [counts]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  const partitioned = useMemo(() => {
    const novos: CapturedLead[] = [];
    const jaConv: CapturedLead[] = [];
    for (const l of leads) {
      if (sentPhones.has(normalizePhone(l.phone))) jaConv.push(l);
      else novos.push(l);
    }
    return { novos, jaConv };
  }, [leads, sentPhones]);

  const visible = tab === "novos" ? partitioned.novos : partitioned.jaConv;

  const allVisibleSelected =
    visible.length > 0 && visible.every((l) => selected.has(l.id));

  const toggleAll = () => {
    setSelected(() => {
      if (allVisibleSelected) return new Set();
      return new Set(visible.map((l) => l.id));
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
    () => leads.filter((l) => selected.has(l.id) && l.phone && !sentPhones.has(normalizePhone(l.phone))),
    [leads, selected, sentPhones],
  );

  const openDispatch = () => {
    if (selected.size === 0) { sonnerToast.warning("Selecione ao menos um lead."); return; }
    if (selectedWithPhone.length === 0) {
      sonnerToast.error("Nenhum lead com telefone novo selecionado (ou já disparados).");
      return;
    }
    if (!instanceName) {
      sonnerToast.error("WhatsApp desconectado — reconecte para enfileirar o disparo.");
      return;
    }
    setDispatchMsg("");
    setDispatchOpen(true);
  };

  const discardSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      sonnerToast.warning("Selecione ao menos um lead.");
      return;
    }
    const ok = await confirm({
      title: `Descartar ${ids.length} lead(s)?`,
      description:
        "Eles não entram em disparos. Se já forem customers, marque “Nunca mais” um a um.",
      confirmText: "Descartar",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    setDiscarding(true);
    try {
      for (const id of ids) {
        const lead = leads.find((l) => l.id === id);
        if (lead?.customer_id || lead?.phone) {
          await suppressContact({
            consultantId,
            customerId: lead.customer_id,
            phone: lead.phone,
            capturedLeadId: id,
            reason: "complaint",
            channel: "captacao_buffer",
          });
        } else {
          await discardLead(id);
        }
      }
      sonnerToast.success(`${ids.length} lead(s) descartado(s) / bloqueado(s).`);
      setSelected(new Set());
      void loadPage();
      void loadCounts();
    } catch (e) {
      sonnerToast.error("Falha ao descartar: " + (e as Error).message);
    } finally {
      setDiscarding(false);
    }
  };

  const confirmDispatch = async () => {
    const msg = dispatchMsg.trim();
    if (!msg) { sonnerToast.warning("Digite a mensagem."); return; }
    const ids = selectedWithPhone.map((l) => l.id);
    if (ids.length > 5000) {
      sonnerToast.error("Máximo 5.000 por disparo. Selecione menos.");
      return;
    }
    setDispatching(true);
    try {
      const r = await dispatchLeadsToCampaign({
        leadIds: ids,
        campaignName: `Captação ${new Date().toLocaleString("pt-BR")}`,
        messageText: msg,
      });
      if (!r.ok) {
        sonnerToast.error(r.error || "Falha ao enfileirar");
        return;
      }
      sonnerToast.success(
        `${r.queued ?? ids.length} na fila do servidor` +
          (r.skipped ? ` · ${r.skipped} sem telefone` : "") +
          " · o worker envia com intervalo anti-ban",
      );
      setDispatchOpen(false);
      setSelected(new Set());
      await loadPage();
    } finally {
      setDispatching(false);
    }
  };

  const doResearchImported = async () => {
    await loadCounts();
    await loadPage();
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Lista de leads</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge variant="secondary" className="gap-1 font-normal">
              <span className="text-foreground font-semibold">{totalFiltered.toLocaleString("pt-BR")}</span>
              <span className="text-muted-foreground">neste filtro</span>
            </Badge>
            {selected.size > 0 && (
              <Badge variant="default" className="gap-1 font-normal">
                <span className="font-semibold">{selected.size}</span>
                <span>selecionados</span>
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground ml-1">
              {totalAll.toLocaleString("pt-BR")} no total
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => { void loadPage(); void loadCounts(); }} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResearchOpen(true)} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Pesquisar empresas
          </Button>
          <Button size="sm" onClick={openDispatch} disabled={selected.size === 0} className="gap-1.5">
            <Send className="w-3.5 h-3.5" /> Enviar ({selected.size})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void discardSelected()}
            disabled={selected.size === 0 || discarding}
            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
            title="Descarta e bloqueia contato (reclamação / nunca mais)"
          >
            {discarding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldBan className="w-3.5 h-3.5" />}
            Nunca mais ({selected.size})
          </Button>
        </div>
      </div>

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
          <div className="shrink-0 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 p-2 rounded-lg border border-border/60 bg-card/40 min-w-0">
            <div className="relative flex-1 min-w-0 w-full sm:min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar nome, telefone, empresa, cidade..."
                className="pl-8 h-9 bg-background w-full"
              />
            </div>
            <Select value={channel} onValueChange={(v) => setChannel(v as LeadChannel | "all")}>
              <SelectTrigger className="w-full sm:w-[200px] h-9 bg-background"><SelectValue placeholder="Origem" /></SelectTrigger>
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
            <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select value={personType} onValueChange={(v) => setPersonType(v as PersonType | "all")}>
              <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Pessoa e Empresa</SelectItem>
                <SelectItem value="pf">Pessoa física</SelectItem>
                <SelectItem value="pj">Empresa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | "all")}>
              <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background"><SelectValue placeholder="Situação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas situações</SelectItem>
                <SelectItem value="new">Novos</SelectItem>
                <SelectItem value="enriched">Enriquecidos</SelectItem>
                <SelectItem value="converted">Convertidos</SelectItem>
                <SelectItem value="discarded">Descartados</SelectItem>
              </SelectContent>
            </Select>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto rounded-lg border border-border bg-card/30">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : partitioned.novos.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
                <Megaphone className="w-10 h-10 text-primary/30" strokeWidth={1} />
                <p className="text-sm font-medium">
                  {totalFiltered === 0
                    ? "Nenhum lead aqui ainda"
                    : partitioned.jaConv.length > 0
                      ? "Nesta página, todos já foram contactados"
                      : "Nada para mostrar com esses filtros"}
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {totalFiltered === 0
                    ? 'Use "Pesquisar empresas" ou aguarde leads de anúncios/site.'
                    : "Troque de página ou ajuste os filtros."}
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
                        aria-label="Selecionar página"
                      />
                    </th>
                    <th className="px-3 py-2.5">Nome / Empresa</th>
                    <th className="px-3 py-2.5 hidden sm:table-cell">Contato</th>
                    <th className="px-3 py-2.5 hidden md:table-cell">Cidade</th>
                    <th className="px-3 py-2.5">Origem</th>
                    <th className="px-3 py-2.5 w-12" />
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
                          <Badge variant="outline" className={`text-[10px] ${CHANNEL_STYLE[l.channel] || ""}`}>
                            {CHANNEL_LABEL[l.channel] || l.channel}
                          </Badge>
                        </td>
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          {l.status !== "discarded" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              title="Nunca mais contatar"
                              onClick={() => setNeverLead(l)}
                            >
                              <ShieldBan className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="shrink-0 flex items-center justify-between gap-2 text-xs text-muted-foreground px-1">
            <span>
              Página {page + 1} de {totalPages}
              {totalFiltered > 0 && ` · ${Math.min(PAGE_SIZE, partitioned.novos.length + partitioned.jaConv.length)} nesta página`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="outline" className="h-8 gap-1"
                disabled={loading || page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Anterior
              </Button>
              <Button
                size="sm" variant="outline" className="h-8 gap-1"
                disabled={loading || page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="conversados" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
          <AlreadyContactedList leads={partitioned.jaConv} />
          {partitioned.jaConv.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhum lead desta página foi marcado como já disparado.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* Disparo leve → servidor (bulk-scheduler) */}
      <Dialog open={dispatchOpen} onOpenChange={(v) => !dispatching && setDispatchOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" /> Enfileirar disparo
            </DialogTitle>
            <DialogDescription>
              {selectedWithPhone.length} contato(s) com telefone. A mensagem entra na fila do servidor
              (anti-ban). Pode fechar o painel — o envio continua.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="cap-dispatch-msg" className="text-xs">Mensagem</Label>
              <Textarea
                id="cap-dispatch-msg"
                value={dispatchMsg}
                onChange={(e) => setDispatchMsg(e.target.value)}
                placeholder="Olá! Aqui é da iGreen…"
                rows={5}
                className="mt-1"
                disabled={dispatching}
              />
            </div>
            {!instanceName && (
              <p className="text-xs text-destructive">WhatsApp desconectado — reconecte antes de enfileirar.</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={dispatching} onClick={() => setDispatchOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmDispatch()} disabled={dispatching || !instanceName} className="gap-1.5">
              {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enfileirar {selectedWithPhone.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BusinessResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        onImported={doResearchImported}
      />

      {neverLead && (
        <NeverContactConfirmDialog
          open={!!neverLead}
          onOpenChange={(o) => { if (!o) setNeverLead(null); }}
          consultantId={consultantId}
          customerId={neverLead.customer_id}
          phone={neverLead.phone}
          capturedLeadId={neverLead.id}
          channel="captacao_buffer"
          leadLabel={neverLead.company_name || neverLead.full_name || neverLead.phone}
          onDone={() => {
            setNeverLead(null);
            void loadPage();
            void loadCounts();
          }}
        />
      )}
    </div>
  );
}
