import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

// Painel individual de gasto de IA do consultor. Mostra o total do mês e,
// ao expandir, o detalhamento por dia e por finalidade (fase). Lê de
// `ai_costs`, que tem RLS permitindo o consultor ver só os próprios dados.

type CostRow = {
  day: string;
  model: string;
  phase: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  usd_est: number;
};

// Nome amigável das fases técnicas para o consultor entender o que gastou.
const PHASE_LABEL: Record<string, string> = {
  orchestrator: "Atendimento (conversa)",
  conversa: "Atendimento (conversa)",
  faq: "Respostas de dúvidas",
  intent: "Entender a mensagem",
  triage: "Triagem",
  extract: "Leitura de dados",
  ocr: "Leitura de conta/documento",
  other: "Outros",
  embedding: "Busca de conhecimento",
};

function phaseLabel(p: string): string {
  return PHASE_LABEL[p] || p;
}

// Câmbio aproximado só para exibir em reais (estimativa, não cobrança).
const USD_TO_BRL = 5.5;
function brl(usd: number): string {
  return (usd * USD_TO_BRL).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AICostCard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Primeiro dia do mês atual (BRT aproximado).
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("ai_costs")
        .select("day, model, phase, calls, input_tokens, output_tokens, usd_est")
        .eq("consultant_id", userId)
        .gte("day", first)
        .order("day", { ascending: false });
      if (cancelled) return;
      setRows((data as CostRow[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const totalUsd = rows.reduce((s, r) => s + Number(r.usd_est || 0), 0);
  const totalCalls = rows.reduce((s, r) => s + Number(r.calls || 0), 0);

  // Agrupa por fase para o resumo.
  const byPhase = new Map<string, { usd: number; calls: number }>();
  for (const r of rows) {
    const k = phaseLabel(r.phase);
    const cur = byPhase.get(k) || { usd: 0, calls: 0 };
    cur.usd += Number(r.usd_est || 0);
    cur.calls += Number(r.calls || 0);
    byPhase.set(k, cur);
  }
  const phases = Array.from(byPhase.entries()).sort((a, b) => b[1].usd - a[1].usd);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-foreground">Gasto com a IA (este mês)</h3>
            <p className="text-xs text-muted-foreground">
              Estimativa do custo da sua assistente virtual. Valores aproximados.
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-foreground">{loading ? "…" : brl(totalUsd)}</div>
          <div className="text-xs text-muted-foreground">{loading ? "" : `${totalCalls} interações`}</div>
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum gasto registrado neste mês ainda.</p>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Resumo por finalidade */}
          <div className="space-y-2">
            {phases.map(([label, v]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{brl(v.usd)}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 text-sm text-primary font-medium"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {open ? "Ocultar detalhes" : "Ver detalhes por dia"}
          </button>

          {open && (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Dia</th>
                    <th className="text-left p-2">Finalidade</th>
                    <th className="text-right p-2">Interações</th>
                    <th className="text-right p-2">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2">{new Date(r.day + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                      <td className="p-2">{phaseLabel(r.phase)}</td>
                      <td className="p-2 text-right">{r.calls}</td>
                      <td className="p-2 text-right">{brl(Number(r.usd_est || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
