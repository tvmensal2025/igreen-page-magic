/**
 * Histórico completo de voz: campanhas, resultados por contato (nome, duração,
 * motivo fino Velip) e eventos de cada tentativa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Search,
  ShieldBan,
  Users,
} from "lucide-react";
import { VozCampaignShell } from "./VozCampaignShell";
import type { VozCustomer } from "./VozContactPickerDialog";
import { resolveNameByPhone } from "./voiceContactResolve";
import {
  formatDurationSec,
  isReprovedVelip,
  normalizeVelipCode,
  velipOutcomeLabel,
} from "./voiceOutcomeLabels";
import {
  crmClosingSummary,
  formatContaValue,
  resolveCrmByPhoneOrId,
  statusCrmLabel,
  etapaBotLabel,
} from "./voiceCrmContext";

interface Props {
  consultantId: string;
  customers?: VozCustomer[];
  /** Abre WhatsApp interno (Admin → Conversas). */
  onOpenChat?: (phone: string) => void;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  dialed: number;
  answered: number;
  failed: number;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  dispatch_kind: string;
  velip_mode: string;
}

interface TargetRow {
  id: string;
  campaign_id: string;
  name: string | null;
  phone: string;
  customer_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  dialed_at: string | null;
  finished_at: string | null;
  error: string | null;
  answered_by: string | null;
  velip_call_id: string | null;
  velip_status: string | null;
  velip_cost: number | null;
}

interface CallLogRow {
  id: string;
  campaign_id: string | null;
  target_id: string | null;
  velip_call_id: string | null;
  velip_status: string | null;
  velip_time_sec: number | null;
  velip_cost: number | null;
  velip_saldo_after: number | null;
  velip_dtmf: Record<string, string> | null;
  velip_raw: Record<string, unknown> | null;
  to_phone: string;
  from_phone: string | null;
  status: string | null;
  answered_by: string | null;
  duration_sec: number | null;
  price: string | null;
  price_per_min: number | null;
  error: string | null;
  raw: Record<string, unknown>;
  created_at: string;
}

const CAMPAIGN_PAGE_SIZE = 10;
const TARGET_PAGE_SIZE = 25;

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho", scheduled: "Agendada", running: "Em andamento",
  paused: "Pausada", finished: "Finalizada", queued: "Na fila",
  dialing: "Discando", ringing: "Tocando", answered: "Atendida",
  completed: "Atendida", busy: "Ocupado", no_answer: "Não atendeu",
  failed: "Reprovada / falhou", machine: "Caixa postal", canceled: "Cancelada",
  initiated: "Iniciada", "in-progress": "Em andamento",
};

function statusLabel(status: string | null | undefined) {
  return STATUS_LABEL[(status || "").toLowerCase()] || status || "—";
}

function statusVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  const s = (status || "").toLowerCase();
  if (["completed", "answered", "finished"].includes(s)) return "default";
  if (["failed", "busy", "no_answer", "machine", "canceled"].includes(s)) return "destructive";
  if (["dialing", "ringing", "queued", "running"].includes(s)) return "secondary";
  return "outline";
}

function formatPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw || "—";
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return raw || "—";
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 4,
  }).format(Number(n));
}

function displayName(
  target: TargetRow,
  customers: VozCustomer[],
): string {
  const fromTarget = String(target.name || "").trim();
  if (fromTarget) return fromTarget;
  if (target.customer_id) {
    const byId = customers.find((c) => c.id === target.customer_id);
    if (byId?.name?.trim()) return byId.name.trim();
  }
  return resolveNameByPhone(target.phone, customers) || formatPhone(target.phone);
}

export function VoiceCallHistoryPanel({ consultantId, customers = [], onOpenChat }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignCount, setCampaignCount] = useState(0);
  const [campaignPage, setCampaignPage] = useState(0);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRow | null>(null);

  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [targetCount, setTargetCount] = useState(0);
  const [targetPage, setTargetPage] = useState(0);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetStatus, setTargetStatus] = useState("all");
  const [loadingTargets, setLoadingTargets] = useState(false);
  /** Última duração conhecida por target_id (vindo de voice_call_logs). */
  const [durationByTarget, setDurationByTarget] = useState<Record<string, number>>({});

  const [selectedTarget, setSelectedTarget] = useState<TargetRow | null>(null);
  const [logs, setLogs] = useState<CallLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState<CallLogRow | null>(null);

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    const from = campaignPage * CAMPAIGN_PAGE_SIZE;
    let query = (supabase as any)
      .from("voice_campaigns")
      .select(
        "id, name, status, total, dialed, answered, failed, scheduled_at, started_at, finished_at, created_at, dispatch_kind, velip_mode",
        { count: "exact" },
      )
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .range(from, from + CAMPAIGN_PAGE_SIZE - 1);
    if (campaignSearch.trim()) query = query.ilike("name", `%${campaignSearch.trim()}%`);
    const { data, count, error } = await query;
    if (error) console.error("[VoiceHistory] campanhas", error);
    setCampaigns((data as CampaignRow[]) ?? []);
    setCampaignCount(count ?? 0);
    setLoadingCampaigns(false);
  }, [campaignPage, campaignSearch, consultantId]);

  const loadTargets = useCallback(async () => {
    if (!selectedCampaign) return;
    setLoadingTargets(true);
    const from = targetPage * TARGET_PAGE_SIZE;
    let query = (supabase as any)
      .from("voice_campaign_targets")
      .select(
        "id, campaign_id, name, phone, customer_id, status, attempts, max_attempts, next_attempt_at, dialed_at, finished_at, error, answered_by, velip_call_id, velip_status, velip_cost",
        { count: "exact" },
      )
      .eq("campaign_id", selectedCampaign.id)
      .order("created_at", { ascending: true })
      .range(from, from + TARGET_PAGE_SIZE - 1);

    if (targetStatus === "reproved") {
      query = query.eq("status", "failed");
    } else if (targetStatus === "blocked") {
      query = query.in("velip_status", ["BK", "CK", "bk", "ck"]);
    } else if (targetStatus !== "all") {
      query = query.eq("status", targetStatus);
    }

    const needle = targetSearch.trim();
    if (needle) {
      const digits = needle.replace(/\D/g, "");
      query = query.or(`name.ilike.%${needle}%,phone.ilike.%${digits || needle}%`);
    }
    const { data, count, error } = await query;
    if (error) console.error("[VoiceHistory] alvos", error);
    const rows = (data as TargetRow[]) ?? [];
    setTargets(rows);
    setTargetCount(count ?? 0);

    // Duração: pega o último log com tempo > 0 por alvo visível
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const { data: logRows } = await (supabase as any)
        .from("voice_call_logs")
        .select("target_id, velip_time_sec, duration_sec, created_at")
        .in("target_id", ids)
        .order("created_at", { ascending: false });
      const map: Record<string, number> = {};
      for (const log of (logRows as { target_id: string; velip_time_sec: number | null; duration_sec: number | null }[]) ?? []) {
        if (!log.target_id || map[log.target_id] != null) continue;
        const sec = log.velip_time_sec ?? log.duration_sec;
        if (sec != null && Number.isFinite(sec) && sec >= 0) map[log.target_id] = Number(sec);
      }
      setDurationByTarget(map);
    } else {
      setDurationByTarget({});
    }

    setLoadingTargets(false);
  }, [selectedCampaign, targetPage, targetSearch, targetStatus]);

  const openTarget = useCallback(async (target: TargetRow) => {
    setSelectedTarget(target);
    setLoadingLogs(true);
    const { data, error } = await (supabase as any)
      .from("voice_call_logs")
      .select(
        "id, campaign_id, target_id, velip_call_id, velip_status, velip_time_sec, velip_cost, velip_saldo_after, velip_dtmf, velip_raw, to_phone, from_phone, status, answered_by, duration_sec, price, price_per_min, error, raw, created_at",
      )
      .eq("target_id", target.id)
      .order("created_at", { ascending: false });
    if (error) console.error("[VoiceHistory] eventos", error);
    setLogs((data as CallLogRow[]) ?? []);
    setLoadingLogs(false);
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);
  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  const totalPages = Math.max(1, Math.ceil(campaignCount / CAMPAIGN_PAGE_SIZE));
  const targetPages = Math.max(1, Math.ceil(targetCount / TARGET_PAGE_SIZE));

  const outcomeStats = useMemo(() => {
    const answered = targets.filter((t) => t.status === "completed").length;
    const noAnswer = targets.filter((t) => t.status === "no_answer").length;
    const reproved = targets.filter((t) => t.status === "failed" || isReprovedVelip(t.velip_status)).length;
    const blocked = targets.filter((t) => {
      const c = normalizeVelipCode(t.velip_status);
      return c === "BK" || c === "CK";
    }).length;
    return { answered, noAnswer, reproved, blocked };
  }, [targets]);

  const currentStats = useMemo(
    () =>
      selectedCampaign
        ? [
            { label: "Contatos", value: selectedCampaign.total, icon: Users },
            { label: "Discadas", value: selectedCampaign.dialed, icon: PhoneCall },
            { label: "Atendidas", value: selectedCampaign.answered, icon: CheckCircle2 },
            { label: "Falhas", value: selectedCampaign.failed, icon: PhoneOff },
          ]
        : [],
    [selectedCampaign],
  );

  if (selectedCampaign) {
    return (
      <>
        <VozCampaignShell
          title={selectedCampaign.name}
          subtitle={`Resultado completo · ${statusLabel(selectedCampaign.status)}`}
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCampaign(null);
                  setTargets([]);
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Todas as campanhas
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadTargets()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Atualizar resultados
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={statusVariant(selectedCampaign.status)}>
              {statusLabel(selectedCampaign.status)}
            </Badge>
            <span>Criada em {formatWhen(selectedCampaign.created_at)}</span>
            {selectedCampaign.started_at && (
              <span>· Iniciada em {formatWhen(selectedCampaign.started_at)}</span>
            )}
            <span>· {selectedCampaign.dispatch_kind === "tts" ? "Texto falado" : "Áudio gravado"}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {currentStats.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-[var(--pe-radius)] border p-3"
                style={{ borderColor: "var(--pe-border)" }}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
                <div className="text-2xl font-bold mt-1">{value}</div>
              </div>
            ))}
          </div>

          {/* Resumo da página atual: motivos finos */}
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <CheckCircle2 className="h-3 w-3" /> {outcomeStats.answered} atendidas (página)
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <PhoneOff className="h-3 w-3" /> {outcomeStats.noAnswer} não atenderam
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <Phone className="h-3 w-3" /> {outcomeStats.reproved} reprovadas / falha
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <ShieldBan className="h-3 w-3" /> {outcomeStats.blocked} bloqueio / DNC
            </span>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={targetSearch}
                onChange={(e) => {
                  setTargetSearch(e.target.value);
                  setTargetPage(0);
                }}
                className="pl-9"
                placeholder="Buscar por nome ou telefone…"
              />
            </div>
            <select
              value={targetStatus}
              onChange={(e) => {
                setTargetStatus(e.target.value);
                setTargetPage(0);
              }}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">Todos os resultados</option>
              <option value="queued">Na fila</option>
              <option value="dialing">Discando</option>
              <option value="completed">Atendidas</option>
              <option value="no_answer">Não atenderam</option>
              <option value="failed">Falhas</option>
              <option value="reproved">Reprovadas (falha)</option>
              <option value="blocked">Bloqueados (CK/BK)</option>
            </select>
          </div>

          {loadingTargets ? (
            <Loading />
          ) : targets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>
          ) : (
            <ul className="space-y-2">
              {targets.map((target) => {
                const name = displayName(target, customers);
                const dur = durationByTarget[target.id];
                const outcome = velipOutcomeLabel(target.velip_status);
                const crm = resolveCrmByPhoneOrId(target.phone, target.customer_id, customers);
                const conta = formatContaValue(crm?.electricity_bill_value);
                return (
                  <li key={target.id}>
                    <button
                      type="button"
                      onClick={() => void openTarget(target)}
                      className="w-full rounded-[var(--pe-radius)] border p-3 text-left hover:bg-muted/40"
                      style={{ borderColor: "var(--pe-border)" }}
                    >
                      <div className="flex items-start gap-3">
                        <Phone className="h-4 w-4 mt-1 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm">{name}</strong>
                            <Badge variant={statusVariant(target.status)}>{statusLabel(target.status)}</Badge>
                            {crm?.status && (
                              <Badge variant="secondary">{statusCrmLabel(crm.status)}</Badge>
                            )}
                            {target.velip_status && (
                              <Badge
                                variant={
                                  isReprovedVelip(target.velip_status) ? "destructive" : "outline"
                                }
                              >
                                {outcome}
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {target.attempts}/{target.max_attempts} tentativa(s)
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatPhone(target.phone)}
                            {crm?.conversation_step
                              ? ` · ${etapaBotLabel(crm.conversation_step)}`
                              : ""}
                            {conta ? ` · conta ${conta}` : ""}
                            {target.dialed_at
                              ? ` · discada ${formatWhen(target.dialed_at)}`
                              : " · aguardando discagem"}
                            {target.next_attempt_at
                              ? ` · próxima ${formatWhen(target.next_attempt_at)}`
                              : ""}
                          </p>
                          {crm && (
                            <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
                              CRM: {crmClosingSummary(crm)}
                            </p>
                          )}
                          {target.answered_by && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Atendido por: {target.answered_by}
                            </p>
                          )}
                          {target.error && (
                            <p className="mt-1 text-xs text-destructive">{target.error}</p>
                          )}
                        </div>
                        <div className="text-right text-xs text-muted-foreground shrink-0">
                          <div className="flex items-center justify-end gap-1 font-medium text-foreground">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDurationSec(dur)}
                          </div>
                          <div className="mt-1">{fmtBRL(target.velip_cost)}</div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager
            page={targetPage}
            pages={targetPages}
            count={targetCount}
            onChange={setTargetPage}
            label="contatos"
          />
        </VozCampaignShell>

        <Dialog
          open={!!selectedTarget}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedTarget(null);
              setLogs([]);
            }
          }}
        >
          <DialogContent className="painel-elite max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedTarget ? displayName(selectedTarget, customers) : "Contato"}
              </DialogTitle>
              <DialogDescription>
                Resultado atual, duração e histórico de todas as tentativas.
              </DialogDescription>
            </DialogHeader>
            {selectedTarget && (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Detail label="Nome" value={displayName(selectedTarget, customers)} />
                  <Detail label="Telefone" value={formatPhone(selectedTarget.phone)} />
                  <Detail label="Resultado ligação" value={statusLabel(selectedTarget.status)} />
                  <Detail label="Resultado" value={velipOutcomeLabel(selectedTarget.velip_status)} />
                  <Detail
                    label="Duração"
                    value={formatDurationSec(durationByTarget[selectedTarget.id])}
                  />
                  <Detail
                    label="Tentativas"
                    value={`${selectedTarget.attempts} de ${selectedTarget.max_attempts}`}
                  />
                  <Detail label="Atendido por" value={selectedTarget.answered_by || "—"} />
                  <Detail label="Custo" value={fmtBRL(selectedTarget.velip_cost)} />
                  <Detail label="Última discagem" value={formatWhen(selectedTarget.dialed_at)} />
                  <Detail label="Finalizada" value={formatWhen(selectedTarget.finished_at)} />
                  {(() => {
                    const crm = resolveCrmByPhoneOrId(
                      selectedTarget.phone,
                      selectedTarget.customer_id,
                      customers,
                    );
                    return (
                      <>
                        <Detail label="Status CRM" value={crm ? statusCrmLabel(crm.status) : "Sem vínculo"} />
                        <Detail
                          label="Etapa do fluxo"
                          value={crm?.conversation_step ? etapaBotLabel(crm.conversation_step) : "—"}
                        />
                        <Detail
                          label="Valor da conta"
                          value={formatContaValue(crm?.electricity_bill_value) || "—"}
                        />
                        <Detail
                          label="Contexto fechamento"
                          value={crmClosingSummary(crm)}
                        />
                      </>
                    );
                  })()}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    const phone = selectedTarget.phone;
                    setSelectedTarget(null);
                    setLogs([]);
                    onOpenChat?.(phone);
                  }}
                  disabled={!onOpenChat}
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Abrir conversa no WhatsApp (CRM)
                </Button>
              </>
            )}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Eventos registrados</h4>
              {loadingLogs ? (
                <Loading />
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este contato ainda não possui tentativa registrada.
                </p>
              ) : (
                <ul className="space-y-2">
                  {logs.map((log) => (
                    <li key={log.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        className="w-full rounded-md border p-3 text-left hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={statusVariant(log.status)}>
                              {statusLabel(log.status)}
                            </Badge>
                            <Badge variant="outline">{velipOutcomeLabel(log.velip_status)}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatWhen(log.created_at)}
                            </span>
                          </div>
                          <span className="text-xs shrink-0">
                            {formatDurationSec(log.velip_time_sec ?? log.duration_sec)} ·{" "}
                            {fmtBRL(log.velip_cost)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {log.answered_by ? `Atendido por ${log.answered_by}` : "Sem atendimento registrado"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <LogDialog log={selectedLog} onClose={() => setSelectedLog(null)} />
      </>
    );
  }

  return (
    <VozCampaignShell
      title="Histórico e resultados"
      subtitle="Follow-up de leads do CRM: nome, etapa, duração, reprovadas e bloqueados."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {campaignCount} campanha(s) no histórico
          </span>
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
        </div>
      }
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={campaignSearch}
          onChange={(e) => {
            setCampaignSearch(e.target.value);
            setCampaignPage(0);
          }}
          className="pl-9"
          placeholder="Buscar campanha…"
        />
      </div>

      {loadingCampaigns ? (
        <Loading />
      ) : campaigns.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma campanha encontrada.</p>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => {
            const progress = campaign.total
              ? Math.round((campaign.dialed / campaign.total) * 100)
              : 0;
            return (
              <li key={campaign.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCampaign(campaign);
                    setTargetPage(0);
                    setTargetSearch("");
                    setTargetStatus("all");
                  }}
                  className="w-full rounded-[var(--pe-radius)] border p-4 text-left hover:bg-muted/40"
                  style={{ borderColor: "var(--pe-border)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{campaign.name}</strong>
                        <Badge variant={statusVariant(campaign.status)}>
                          {statusLabel(campaign.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Criada em {formatWhen(campaign.created_at)}
                        {campaign.scheduled_at
                          ? ` · agendada para ${formatWhen(campaign.scheduled_at)}`
                          : ""}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {campaign.dialed}/{campaign.total} discadas
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>
                      <Users className="inline h-3.5 w-3.5 mr-1" />
                      {campaign.total} contatos
                    </span>
                    <span>
                      <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
                      {campaign.answered} atendidas
                    </span>
                    <span>
                      <PhoneOff className="inline h-3.5 w-3.5 mr-1" />
                      {campaign.failed} reprovadas / sem sucesso
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Pager
        page={campaignPage}
        pages={totalPages}
        count={campaignCount}
        onChange={setCampaignPage}
        label="campanhas"
      />
    </VozCampaignShell>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--pe-emerald)" }} />
    </div>
  );
}

function Pager({
  page,
  pages,
  count,
  onChange,
  label,
}: {
  page: number;
  pages: number;
  count: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-3">
      <span className="text-xs text-muted-foreground">
        {count} {label} · página {page + 1} de {pages}
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <dt className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm"}>{value}</dd>
    </div>
  );
}

function LogDialog({ log, onClose }: { log: CallLogRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!log} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="painel-elite max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe da ligação</DialogTitle>
          <DialogDescription>Resumo do que aconteceu nesta chamada.</DialogDescription>
        </DialogHeader>
        {log && (
          <dl className="grid grid-cols-2 gap-2">
            <Detail label="Quando" value={formatWhen(log.created_at)} />
            <Detail label="Situação" value={statusLabel(log.status)} />
            <Detail label="Resultado" value={velipOutcomeLabel(log.velip_status)} />
            <Detail label="Duração" value={formatDurationSec(log.velip_time_sec ?? log.duration_sec)} />
            <Detail label="Telefone" value={formatPhone(log.to_phone)} />
            <Detail label="Número que aparece" value={formatPhone(log.from_phone)} />
            <Detail label="Atendido por" value={log.answered_by || "—"} />
            <Detail
              label="Custo"
              value={log.velip_cost != null ? fmtBRL(log.velip_cost) : log.price || "—"}
            />
            <Detail
              label="Saldo depois"
              value={log.velip_saldo_after != null ? fmtBRL(log.velip_saldo_after) : "—"}
            />
            <Detail
              label="Preço por minuto"
              value={log.price_per_min != null ? fmtBRL(log.price_per_min) : "—"}
            />
            {log.error && (
              <div className="col-span-2">
                <Detail label="Problema" value={log.error} />
              </div>
            )}
            {log.velip_dtmf && Object.keys(log.velip_dtmf).length > 0 && (
              <div className="col-span-2">
                <Detail
                  label="Teclas digitadas"
                  value={Object.entries(log.velip_dtmf)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ")}
                  mono
                />
              </div>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
