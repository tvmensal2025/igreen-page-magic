/**
 * Histórico detalhado de ligações PSTN (voice_call_logs + targets) — driver Velip.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, Phone, Search } from "lucide-react";
import { VozCampaignShell } from "./VozCampaignShell";

interface Props {
  consultantId: string;
}

interface CallLogRow {
  id: string;
  campaign_id: string | null;
  target_id: string | null;
  twilio_sid: string | null;
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
  error: string | null;
  raw: Record<string, unknown>;
  created_at: string;
  campaign_name?: string | null;
  target_name?: string | null;
  target_status?: string | null;
}

function fmtBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 }).format(n);
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  dialing: "Discando",
  ringing: "Tocando",
  answered: "Atendida",
  completed: "Concluída",
  busy: "Ocupado",
  no_answer: "Não atendeu",
  failed: "Falhou",
  machine: "Caixa postal",
  canceled: "Cancelada",
  initiated: "Iniciada",
  "in-progress": "Em andamento",
};

function statusVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "answered") return "default";
  if (s === "failed" || s === "busy" || s === "no_answer" || s === "machine") return "destructive";
  if (s === "dialing" || s === "ringing" || s === "queued") return "secondary";
  return "outline";
}

function formatPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 10) return raw || "—";
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw || "—";
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return raw || "—";
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function VoiceCallHistoryPanel({ consultantId }: Props) {
  const [rows, setRows] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CallLogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("voice_call_logs")
      .select("id, campaign_id, target_id, twilio_sid, velip_call_id, velip_status, velip_time_sec, velip_cost, velip_saldo_after, velip_dtmf, velip_raw, to_phone, from_phone, status, answered_by, duration_sec, price, error, raw, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error(error);
      setRows([]);
      setLoading(false);
      return;
    }

    const logs = (data as CallLogRow[]) || [];
    const campaignIds = [...new Set(logs.map((l) => l.campaign_id).filter(Boolean))] as string[];
    const targetIds = [...new Set(logs.map((l) => l.target_id).filter(Boolean))] as string[];

    const campMap = new Map<string, string>();
    const tgtMap = new Map<string, { name: string | null; status: string | null }>();

    if (campaignIds.length) {
      const { data: camps } = await (supabase as any)
        .from("voice_campaigns")
        .select("id, name")
        .in("id", campaignIds);
      for (const c of camps || []) campMap.set(c.id, c.name);
    }
    if (targetIds.length) {
      const { data: tgts } = await (supabase as any)
        .from("voice_campaign_targets")
        .select("id, name, status")
        .in("id", targetIds);
      for (const t of tgts || []) tgtMap.set(t.id, { name: t.name, status: t.status });
    }

    setRows(
      logs.map((l) => ({
        ...l,
        campaign_name: l.campaign_id ? campMap.get(l.campaign_id) ?? null : null,
        target_name: l.target_id ? tgtMap.get(l.target_id)?.name ?? null : null,
        target_status: l.target_id ? tgtMap.get(l.target_id)?.status ?? null : null,
      })),
    );
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      r.to_phone?.includes(needle.replace(/\D/g, "")) ||
      r.to_phone?.toLowerCase().includes(needle) ||
      (r.target_name || "").toLowerCase().includes(needle) ||
      (r.campaign_name || "").toLowerCase().includes(needle) ||
      (r.twilio_sid || "").toLowerCase().includes(needle) ||
      (r.status || "").toLowerCase().includes(needle)
    );
  });

  const stats = {
    total: rows.length,
    completed: rows.filter((r) => ["completed", "answered"].includes((r.status || "").toLowerCase())).length,
    failed: rows.filter((r) => ["failed", "busy", "no_answer", "machine"].includes((r.status || "").toLowerCase())).length,
    cost: rows.reduce((s, r) => s + (Number(r.velip_cost) || 0), 0),
    avgDur: (() => {
      const durs = rows.map((r) => r.velip_time_sec ?? r.duration_sec ?? 0).filter((n) => n > 0);
      return durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    })(),
  };
  const answerRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  // Agrupa por dia
  const grouped = filtered.reduce<Record<string, CallLogRow[]>>((acc, r) => {
    const day = new Date(r.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    (acc[day] = acc[day] || []).push(r);
    return acc;
  }, {});

  return (
    <>
      <VozCampaignShell
        title="Histórico de ligações"
        subtitle="Cada tentativa registrada pela Velip — status, duração, custo, DTMF e campanha."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              {stats.total} registro(s) · {stats.completed} ok · {stats.failed} falha/caixa postal
            </span>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { l: "Ligações", v: String(stats.total) },
            { l: "Atendimento", v: `${answerRate}%` },
            { l: "Duração média", v: formatDuration(stats.avgDur) },
            { l: "Custo total", v: fmtBRL(stats.cost) },
          ].map((k) => (
            <div key={k.l} className="rounded-[var(--pe-radius)] border p-2 text-center" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--pe-text-muted)" }}>{k.l}</div>
              <div className="text-lg font-bold" style={{ color: "var(--pe-text)" }}>{k.v}</div>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, telefone, campanha ou ID Velip…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--pe-emerald)" }} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nenhuma ligação ainda. Faça um teste ou campanha na aba Nova ligação.
          </p>
        ) : (
          <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
            {Object.entries(grouped).map(([day, items]) => (
              <div key={day} className="space-y-2">
                <div className="sticky top-0 z-10 -mx-1 px-1 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur" style={{ color: "var(--pe-text-label)", background: "var(--pe-bg)" }}>
                  {day} · {items.length}
                </div>
                <ul className="space-y-2">
                  {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="w-full text-left rounded-[var(--pe-radius)] border px-3 py-3 transition-colors hover:bg-[var(--pe-surface-muted)]"
                  style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <Phone className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--pe-emerald)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm" style={{ color: "var(--pe-text)" }}>
                          {r.target_name || formatPhone(r.to_phone)}
                        </span>
                        <Badge variant={statusVariant(r.status)}>
                          {STATUS_LABEL[(r.status || "").toLowerCase()] || r.status || "—"}
                        </Badge>
                        {r.answered_by && (
                          <Badge variant="outline" className="text-[10px]">
                            {r.answered_by}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatPhone(r.to_phone)}
                        {r.campaign_name ? ` · ${r.campaign_name}` : ""}
                        {" · "}
                        {formatWhen(r.created_at)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      <div>{formatDuration(r.velip_time_sec ?? r.duration_sec)}</div>
                      {r.velip_cost != null ? <div>{fmtBRL(r.velip_cost)}</div> : (r.price != null && r.price !== "" && <div>{r.price}</div>)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </VozCampaignShell>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="painel-elite max-w-lg">
          <DialogHeader>
            <DialogTitle style={{ color: "var(--pe-text)" }}>Detalhe da ligação</DialogTitle>
            <DialogDescription>
              Informações registradas no momento da chamada.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="space-y-3 text-sm">
              <Detail label="Quando" value={formatWhen(selected.created_at)} />
              <Detail label="Contato" value={selected.target_name || "—"} />
              <Detail label="Para" value={formatPhone(selected.to_phone)} />
              <Detail label="De (empresa)" value={formatPhone(selected.from_phone)} />
              <Detail
                label="Status"
                value={STATUS_LABEL[(selected.status || "").toLowerCase()] || selected.status || "—"}
              />
              <Detail label="Status do alvo" value={selected.target_status || "—"} />
              <Detail label="Atendido por" value={selected.answered_by || "—"} />
              <Detail label="Duração" value={formatDuration(selected.velip_time_sec ?? selected.duration_sec)} />
              <Detail label="Custo (Velip)" value={selected.velip_cost != null ? fmtBRL(selected.velip_cost) : (selected.price || "—")} />
              <Detail label="Saldo após" value={selected.velip_saldo_after != null ? fmtBRL(selected.velip_saldo_after) : "—"} />
              <Detail label="Campanha" value={selected.campaign_name || "—"} />
              <Detail label="ID Velip" value={selected.velip_call_id || "—"} mono />
              <Detail label="Status Velip" value={selected.velip_status || "—"} mono />
              {selected.twilio_sid && <Detail label="Twilio SID (legado)" value={selected.twilio_sid} mono />}
              {selected.velip_dtmf && Object.keys(selected.velip_dtmf).length > 0 && (
                <Detail label="DTMF" value={Object.entries(selected.velip_dtmf).map(([k,v]) => `${k}=${v}`).join(" · ")} mono />
              )}
              {selected.error && <Detail label="Erro" value={selected.error} />}
              {(selected.velip_raw ?? selected.raw) && Object.keys((selected.velip_raw ?? selected.raw) || {}).length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pe-text-label)" }}>
                    Payload Velip
                  </dt>
                  <dd>
                    <pre
                      className="text-[11px] rounded-[var(--pe-radius)] border p-3 overflow-auto max-h-40"
                      style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
                    >
                      {JSON.stringify(selected.velip_raw ?? selected.raw, null, 2)}
                    </pre>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="text-xs font-semibold uppercase tracking-wide pt-0.5" style={{ color: "var(--pe-text-label)" }}>
        {label}
      </dt>
      <dd className={`break-all ${mono ? "font-mono text-xs" : ""}`} style={{ color: "var(--pe-text)" }}>
        {value}
      </dd>
    </div>
  );
}
