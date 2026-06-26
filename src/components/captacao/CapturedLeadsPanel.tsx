// CapturedLeadsPanel
// ──────────────────
// Painel onde o consultor vê os leads captados (Meta Lead Ads, TikTok, landing,
// pesquisa B2B), filtra, seleciona vários e dispara mensagem em massa — ou roda
// uma nova pesquisa de empresas. Os leads são SEMPRE do consultor (RLS).
//
// O disparo reaproveita o motor de Disparo PRO (bulk_campaigns + bulk-scheduler
// + anti-ban), via a edge function leads-to-campaign.

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
import { toast as sonnerToast } from "sonner";
import {
  Users, Search, Send, Loader2, Building2, User as UserIcon, MapPin, Phone, Mail,
  RefreshCw, Megaphone, Sparkles,
} from "lucide-react";
import {
  listCapturedLeads, countLeadsByChannel, dispatchLeadsToCampaign,
  type CapturedLead, type LeadChannel, type PersonType, type LeadStatus,
} from "@/services/capturedLeads";
import { BusinessResearchDialog } from "@/components/captacao/BusinessResearchDialog";

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

export function CapturedLeadsPanel({ consultantId, instanceName = null }: Props) {
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // filtros
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<LeadChannel | "all">("all");
  const [personType, setPersonType] = useState<PersonType | "all">("all");
  const [status, setStatus] = useState<LeadStatus | "all">("new");

  // disparo
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [dispatching, setDispatching] = useState(false);

  // pesquisa B2B (modal rico)
  const [researchOpen, setResearchOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, c] = await Promise.all([
        listCapturedLeads({ consultantId, channel, personType, status, search }),
        countLeadsByChannel(consultantId),
      ]);
      setLeads(rows);
      setCounts(c);
    } catch (e) {
      sonnerToast.error("Falha ao carregar leads: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [consultantId, channel, personType, status, search]);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => Object.values(counts).reduce((s, n) => s + n, 0), [counts]);

  const allVisibleSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      return new Set(leads.map((l) => l.id));
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
    () => leads.filter((l) => selected.has(l.id) && l.phone),
    [leads, selected],
  );

  const openDispatch = () => {
    if (selected.size === 0) { sonnerToast.warning("Selecione ao menos um lead."); return; }
    if (selectedWithPhone.length === 0) { sonnerToast.error("Nenhum lead selecionado tem telefone."); return; }
    if (!instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para disparar."); return; }
    setCampaignName(`Disparo ${new Date().toLocaleDateString("pt-BR")}`);
    setDispatchOpen(true);
  };

  const doDispatch = async () => {
    if (!messageText.trim()) { sonnerToast.warning("Escreva a mensagem."); return; }
    setDispatching(true);
    try {
      const r = await dispatchLeadsToCampaign({
        leadIds: selectedWithPhone.map((l) => l.id),
        campaignName,
        messageText,
      });
      if (!r.ok) { sonnerToast.error(r.error || "Falha no disparo"); return; }
      sonnerToast.success(`Campanha criada: ${r.queued} na fila. O envio respeita o anti-ban.`);
      setDispatchOpen(false);
      setMessageText("");
      setSelected(new Set());
    } finally {
      setDispatching(false);
    }
  };

  const doResearchImported = async () => {
    await load();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Cabeçalho + ações */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Leads captados</h2>
          <Badge variant="secondary">{total}</Badge>
        </div>
        <div className="flex items-center gap-2">
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone, empresa, cidade..."
            className="pl-8 h-9"
          />
        </div>
        <Select value={channel} onValueChange={(v) => setChannel(v as LeadChannel | "all")}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Canal" /></SelectTrigger>
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
          <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">PF e PJ</SelectItem>
            <SelectItem value="pf">Pessoa física</SelectItem>
            <SelectItem value="pj">Empresa (PJ)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | "all")}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="new">Novos</SelectItem>
            <SelectItem value="enriched">Enriquecidos</SelectItem>
            <SelectItem value="converted">Convertidos</SelectItem>
            <SelectItem value="discarded">Descartados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
            <Megaphone className="w-10 h-10 text-primary/30" strokeWidth={1} />
            <p className="text-sm font-medium">Nenhum lead captado ainda</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Os leads do Meta Lead Ads, TikTok e landing pages aparecem aqui. Você também pode usar "Pesquisar empresas" para gerar leads B2B.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur border-b border-border z-10">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-2 w-10">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                </th>
                <th className="p-2">Nome / Empresa</th>
                <th className="p-2 hidden sm:table-cell">Contato</th>
                <th className="p-2 hidden md:table-cell">Cidade</th>
                <th className="p-2">Canal</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr
                  key={l.id}
                  className={`border-b border-border/40 hover:bg-secondary/30 cursor-pointer ${selected.has(l.id) ? "bg-primary/5" : ""}`}
                  onClick={() => toggleOne(l.id)}
                >
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggleOne(l.id)} aria-label={`Selecionar ${l.full_name || l.company_name}`} />
                  </td>
                  <td className="p-2">
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
                  <td className="p-2 hidden sm:table-cell">
                    <div className="flex flex-col gap-0.5 text-[12px]">
                      {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-muted-foreground" />{l.phone}</span>}
                      {l.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" />{l.email}</span>}
                    </div>
                  </td>
                  <td className="p-2 hidden md:table-cell text-[12px] text-muted-foreground">
                    {(() => {
                      const addr = (l.pj_data?.full_address as string) || null;
                      if (addr) return <span className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[260px]">{addr}</span></span>;
                      if (l.city) return <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{l.city}{l.uf ? `/${l.uf}` : ""}</span>;
                      return "—";
                    })()}
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">{CHANNEL_LABEL[l.channel] || l.channel}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialog de disparo */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disparar mensagem</DialogTitle>
            <DialogDescription>
              {selectedWithPhone.length} contato(s) com telefone serão adicionados à fila. O envio respeita o anti-ban (aquecimento e intervalos humanos).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="campaign-name" className="text-xs">Nome da campanha</Label>
              <Input id="campaign-name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label htmlFor="message-text" className="text-xs">Mensagem</Label>
              <Textarea
                id="message-text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={5}
                placeholder="Oi {primeiro_nome}, tudo bem? ..."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Variáveis: <code>{"{primeiro_nome}"}</code>, <code>{"{nome}"}</code>, <code>{"{cidade}"}</code>. Spintax: <code>{"{oi|olá|e aí}"}</code>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)} disabled={dispatching}>Cancelar</Button>
            <Button onClick={doDispatch} disabled={dispatching} className="gap-1.5">
              {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Disparar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de pesquisa de empresas (rico, estilo anúncios) */}
      <BusinessResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        onImported={doResearchImported}
      />
    </div>
  );
}
