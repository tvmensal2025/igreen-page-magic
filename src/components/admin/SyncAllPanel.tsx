// Painel "Sincronizar tudo" — dispara sob demanda todas as functions que
// deixaram de rodar automaticamente por cron (para aliviar o Supabase).
// Executa em sequência com pequeno delay para não sobrecarregar o banco.
//
// Nenhuma dessas chamadas é destrutiva; todas são idempotentes e
// respeitam quiet hours / cooldowns internos.

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Task = {
  key: string;
  label: string;
  fn: string;
  body?: Record<string, unknown>;
};

// Ordem escolhida pela cadeia lógica: primeiro sync de dados externos,
// depois análise/aprendizado, por último manutenção e alertas.
const TASKS: Task[] = [
  { key: "igreen", label: "Sincronizar clientes iGreen", fn: "sync-igreen-customers" },
  { key: "fb-metrics", label: "Atualizar métricas do Facebook Ads", fn: "facebook-sync-metrics" },
  { key: "fb-creatives", label: "Sincronizar criativos do Facebook", fn: "facebook-sync-ad-creatives" },
  { key: "fb-audiences", label: "Sincronizar audiências do Facebook", fn: "facebook-sync-audiences" },
  { key: "cpl-watchdog", label: "Analisar variação de CPL", fn: "ai-cpl-watchdog" },
  { key: "ad-learner", label: "Aprender com criativos (30 dias)", fn: "ad-creative-learner" },
  { key: "ai-feedback", label: "Consolidar feedbacks da IA", fn: "ai-learn-feedback" },
  { key: "classifier", label: "Classificar temperatura dos leads", fn: "lead-temperature-classifier", body: { scope: "stale_24h", source: "sync" } },
  { key: "followup", label: "Processar follow-ups pendentes", fn: "bot-followup-checker" },
  { key: "stuck", label: "Resgatar leads parados", fn: "bot-stuck-recovery" },
  { key: "instance", label: "Checar saúde das instâncias WhatsApp", fn: "instance-health-cron" },
  { key: "minio", label: "Checar cota do MinIO", fn: "minio-quota-check" },
  { key: "digest", label: "Gerar digest diário da IA", fn: "ai-daily-digest" },
];

type Status = "idle" | "running" | "done" | "error";

interface TaskState {
  status: Status;
  message?: string;
}

export function SyncAllPanel() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, TaskState>>({});

  const runOne = async (t: Task): Promise<TaskState> => {
    try {
      const { error } = await supabase.functions.invoke(t.fn, { body: t.body ?? {} });
      if (error) return { status: "error", message: error.message };
      return { status: "done" };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "Erro desconhecido" };
    }
  };

  const runAll = async () => {
    if (running) return;
    setRunning(true);
    setStates({});
    let okCount = 0;
    let errCount = 0;

    for (const t of TASKS) {
      setStates((s) => ({ ...s, [t.key]: { status: "running" } }));
      const res = await runOne(t);
      setStates((s) => ({ ...s, [t.key]: res }));
      if (res.status === "done") okCount++;
      else errCount++;
      // pequeno espaçamento para não empilhar tudo ao mesmo tempo
      await new Promise((r) => setTimeout(r, 600));
    }

    setRunning(false);
    toast({
      title: errCount === 0 ? "Sincronização concluída" : "Sincronização terminou com avisos",
      description: `${okCount} ok · ${errCount} com erro`,
      variant: errCount === 0 ? "default" : "destructive",
    });
  };

  const iconFor = (st?: Status) => {
    if (st === "running") return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
    if (st === "done") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (st === "error") return <XCircle className="w-4 h-4 text-destructive" />;
    return <div className="w-4 h-4 rounded-full border border-border" />;
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" /> Sincronizar tudo
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Dispara em sequência todas as sincronizações e análises que hoje rodam sob demanda
            (Facebook Ads, iGreen, aprendizado da IA, saúde das instâncias, etc.). Use quando
            quiser deixar tudo atualizado de uma vez, sem esperar o horário automático.
          </p>
        </div>
        <Button
          type="button"
          onClick={runAll}
          disabled={running}
          className="shrink-0 gap-2"
          style={{ background: "var(--gradient-green)" }}
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {running ? "Atualizando..." : "Atualizar agora"}
        </Button>
      </div>

      <ul className="space-y-1.5">
        {TASKS.map((t) => {
          const st = states[t.key];
          return (
            <li
              key={t.key}
              className="flex items-center gap-3 text-sm text-foreground/90 py-1"
            >
              {iconFor(st?.status)}
              <span className="flex-1">{t.label}</span>
              {st?.status === "error" && st.message && (
                <span className="text-[11px] text-destructive truncate max-w-[220px]" title={st.message}>
                  {st.message}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
