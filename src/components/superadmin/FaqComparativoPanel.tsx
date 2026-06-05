// Painel comparativo Evolution × Whapi — Fase 1 da auditoria de FAQ.
// Read-only: lê de ai_decisions agrupando por `channel`. Nenhum
// efeito colateral no bot.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, GitCompareArrows, RefreshCw } from "lucide-react";

interface Row {
  id: string;
  created_at: string;
  channel: string | null;
  confidence: number | null;
  intent_detected: string | null;
  user_input: string | null;
  source: string | null;
  phase: string | null;
}

interface ChannelStats {
  total: number;
  avgConf: number;
  lowConfPct: number;
  handoffPct: number;
  topLow: { input: string; conf: number }[];
}

const DAYS = [
  { label: "24h", h: 24 },
  { label: "7d", h: 24 * 7 },
  { label: "30d", h: 24 * 30 },
];

function stats(rows: Row[]): ChannelStats {
  if (rows.length === 0) {
    return { total: 0, avgConf: 0, lowConfPct: 0, handoffPct: 0, topLow: [] };
  }
  const withConf = rows.filter((r) => r.confidence !== null);
  const avg =
    withConf.reduce((a, r) => a + Number(r.confidence ?? 0), 0) /
    Math.max(withConf.length, 1);
  const low = withConf.filter((r) => Number(r.confidence) < 0.6).length;
  const hand = rows.filter((r) => r.intent_detected === "handoff").length;
  const topLow = [...withConf]
    .filter((r) => Number(r.confidence) < 0.6 && r.user_input)
    .sort((a, b) => Number(a.confidence) - Number(b.confidence))
    .slice(0, 8)
    .map((r) => ({ input: r.user_input || "", conf: Number(r.confidence) }));
  return {
    total: rows.length,
    avgConf: avg,
    lowConfPct: withConf.length ? low / withConf.length : 0,
    handoffPct: rows.length ? hand / rows.length : 0,
    topLow,
  };
}

export function FaqComparativoPanel() {
  const [hours, setHours] = useState(24 * 7);
  const [loading, setLoading] = useState(true);
  const [evo, setEvo] = useState<ChannelStats | null>(null);
  const [whp, setWhp] = useState<ChannelStats | null>(null);
  const [legacy, setLegacy] = useState<number>(0);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("ai_decisions")
      .select(
        "id,created_at,channel,confidence,intent_detected,user_input,source,phase",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    const list = (data ?? []) as Row[];
    setEvo(stats(list.filter((r) => r.channel === "evolution")));
    setWhp(stats(list.filter((r) => r.channel === "whapi")));
    setLegacy(list.filter((r) => !r.channel).length);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  return (
    <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold">
            FAQ Comparativo · Evolution × Whapi
          </h3>
          <Badge variant="outline" className="text-[10px]">
            Fase 1 · auditoria
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {DAYS.map((d) => (
            <Button
              key={d.h}
              size="sm"
              variant={hours === d.h ? "default" : "outline"}
              onClick={() => setHours(d.h)}
            >
              {d.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando…
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <ChannelCard title="Evolution" stats={evo} accent="emerald" />
            <ChannelCard title="Whapi (superadmin)" stats={whp} accent="blue" />
          </div>

          {legacy > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {legacy} decisões sem canal marcado (legado, antes do deploy desta auditoria).
            </p>
          )}

          <Verdict evo={evo} whp={whp} />
        </>
      )}
    </div>
  );
}

function ChannelCard({
  title,
  stats,
  accent,
}: {
  title: string;
  stats: ChannelStats | null;
  accent: "emerald" | "blue";
}) {
  const s = stats || { total: 0, avgConf: 0, lowConfPct: 0, handoffPct: 0, topLow: [] };
  const tone = accent === "emerald" ? "text-emerald-400" : "text-blue-400";
  return (
    <div className="border border-border/40 rounded-lg p-4 bg-secondary/10">
      <div className="flex items-center justify-between mb-3">
        <h4 className={`font-semibold ${tone}`}>{title}</h4>
        <Badge variant="outline">{s.total} decisões</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Mini label="Conf. média" value={s.avgConf.toFixed(2)} />
        <Mini
          label="% baixa conf."
          value={`${(s.lowConfPct * 100).toFixed(0)}%`}
          warn={s.lowConfPct > 0.3}
        />
        <Mini
          label="% handoff"
          value={`${(s.handoffPct * 100).toFixed(0)}%`}
          warn={s.handoffPct > 0.15}
        />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Top perguntas com baixa confiança
        </div>
        {s.topLow.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Nenhuma 🎉</div>
        ) : (
          <ul className="space-y-1 max-h-44 overflow-auto text-xs">
            {s.topLow.map((t, i) => (
              <li
                key={i}
                className="flex items-start gap-2 border-l-2 border-amber-500/40 pl-2"
              >
                <span className="font-mono text-amber-400 shrink-0">
                  {t.conf.toFixed(2)}
                </span>
                <span className="truncate" title={t.input}>
                  "{t.input}"
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`p-2 rounded border ${
        warn
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-border/40 bg-background/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function Verdict({
  evo,
  whp,
}: {
  evo: ChannelStats | null;
  whp: ChannelStats | null;
}) {
  if (!evo || !whp || evo.total < 10 || whp.total < 10) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Volume insuficiente para conclusão. Aguarde mais dados (mín. 10
        decisões por canal).
      </p>
    );
  }
  const diff = Math.abs(evo.avgConf - whp.avgConf);
  const evoBetter = evo.avgConf >= whp.avgConf;
  if (diff < 0.05) {
    return (
      <p className="text-xs text-emerald-400">
        ✅ Qualidade equivalente entre os canais. Não vale gastar tokens
        extras com o orchestrator no Evolution agora.
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-400">
      ⚠️ Diferença de {(diff * 100).toFixed(0)} pp entre os canais.{" "}
      {evoBetter ? "Evolution" : "Whapi"} está melhor. Vale investigar antes
      de equiparar.
    </p>
  );
}
