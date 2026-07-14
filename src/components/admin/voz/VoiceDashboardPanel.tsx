import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, PhoneCall, PhoneOff, DollarSign, Percent, MessageSquare, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";

interface Metrics {
  total_calls: number;
  answered: number;
  no_answer: number;
  failed: number;
  avg_duration_sec: number;
  total_cost: number;
  by_day: { day: string; total: number; answered: number }[];
  by_hour: number[];
}

interface SmsRow {
  id: string;
  phone: string;
  message: string;
  status: string;
  delivery_status: string | null;
  created_at: string;
  cost: number | null;
}

interface Props { consultantId: string; }

function fmtPhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

function smsBadge(status: string, delivery: string | null): { label: string; tone: "ok" | "bad" | "mid" } {
  const s = (status || "").toLowerCase();
  const d = (delivery || "").toUpperCase();
  if (s === "delivered" || d === "DELIVRD") return { label: "Entregue", tone: "ok" };
  if (s === "sent" || s === "queued") return { label: "Enviado", tone: "mid" };
  if (s === "failed") return { label: "Falhou", tone: "bad" };
  return { label: status || "—", tone: "mid" };
}

export function VoiceDashboardPanel({ consultantId }: Props) {
  const [m, setM] = useState<Metrics | null>(null);
  const [sms, setSms] = useState<SmsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data }, smsRes] = await Promise.all([
          supabase.functions.invoke("voice-dashboard-metrics", {
            body: { consultant_id: consultantId, days: 30 },
          }),
          (supabase as any)
            .from("voice_sms_log")
            .select("id, phone, message, status, delivery_status, created_at, cost")
            .eq("consultant_id", consultantId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        setM((data ?? null) as Metrics | null);
        setSms((smsRes.data as SmsRow[]) ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [consultantId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const rate = m && m.total_calls > 0 ? Math.round((m.answered / m.total_calls) * 100) : 0;
  const smsDelivered = sms.filter((s) => s.status === "delivered" || s.delivery_status === "DELIVRD").length;
  const smsFailed = sms.filter((s) => s.status === "failed").length;

  const kpis = [
    { icon: PhoneCall, label: "Ligações", value: m?.total_calls ?? 0, color: "var(--pe-emerald)" },
    { icon: Percent, label: "Atendimento", value: `${rate}%`, color: "var(--pe-emerald)" },
    { icon: MessageSquare, label: "SMS (20)", value: sms.length, color: "var(--pe-emerald)" },
    { icon: CheckCircle2, label: "SMS entregues", value: smsDelivered, color: "var(--pe-emerald)" },
    { icon: PhoneOff, label: "Não atendeu", value: m?.no_answer ?? 0, color: "#e5a800" },
    { icon: DollarSign, label: "Custo 30d", value: `R$ ${(m?.total_cost || 0).toFixed(2)}`, color: "var(--pe-emerald)" },
  ];

  return (
    <VozCampaignShell
      title="Painel — ligações e SMS"
      subtitle="Visão geral Velip: discagem, atendimento, SMS entregues e custo."
    >
      <VozSection title="Resumo">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div
                key={k.label}
                className="rounded-[var(--pe-radius)] border p-3"
                style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
              >
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--pe-text-muted)" }}>
                  <Icon className="h-4 w-4" style={{ color: k.color }} />
                  {k.label}
                </div>
                <div className="text-2xl font-bold mt-1" style={{ color: "var(--pe-text)" }}>
                  {k.value}
                </div>
              </div>
            );
          })}
        </div>
        {smsFailed > 0 && (
          <p className="text-[11px] mt-2" style={{ color: "var(--pe-text-muted)" }}>
            {smsFailed} SMS com falha nos últimos registros.
          </p>
        )}
      </VozSection>

      <VozSection title="Últimos SMS">
        {sms.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
            Nenhum SMS ainda. Use a aba SMS para enviar via MakeSMS.
          </p>
        ) : (
          <ul className="space-y-2">
            {sms.map((row) => {
              const b = smsBadge(row.status, row.delivery_status);
              return (
                <li
                  key={row.id}
                  className="rounded-[var(--pe-radius)] border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--pe-border)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{fmtPhone(row.phone)}</span>
                    <Badge
                      variant={b.tone === "ok" ? "default" : b.tone === "bad" ? "destructive" : "secondary"}
                    >
                      {b.label}
                    </Badge>
                  </div>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--pe-text-muted)" }}>
                    {row.message}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--pe-text-muted)" }}>
                    {new Date(row.created_at).toLocaleString("pt-BR")}
                    {row.delivery_status ? ` · ${row.delivery_status}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </VozSection>

      {m?.by_hour?.length === 24 && (
        <VozSection title="Melhor horário para ligar">
          <div className="flex items-end gap-1 h-24">
            {m.by_hour.map((v, i) => {
              const max = Math.max(...m.by_hour, 1);
              const h = Math.round((v / max) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${h}%`, background: "var(--pe-emerald)", opacity: v ? 0.85 : 0.15 }}
                  />
                  <span className="text-[9px]" style={{ color: "var(--pe-text-muted)" }}>{i}h</span>
                </div>
              );
            })}
          </div>
        </VozSection>
      )}

      {m && m.by_day?.length > 0 && (
        <VozSection title="Últimos dias (ligações)">
          <ul className="space-y-1 text-sm">
            {m.by_day.slice(0, 10).map((d) => (
              <li key={d.day} className="flex items-center justify-between">
                <span style={{ color: "var(--pe-text-muted)" }}>{d.day}</span>
                <span style={{ color: "var(--pe-text)" }}>{d.answered}/{d.total}</span>
              </li>
            ))}
          </ul>
        </VozSection>
      )}
    </VozCampaignShell>
  );
}
