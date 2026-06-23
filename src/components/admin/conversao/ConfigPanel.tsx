import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Clock, Power, CalendarClock, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Painel de CONFIGURAÇÃO do reaquecimento — auto-save com debounce de 600ms.
 * Cada mudança em um campo grava automaticamente em reactivation_settings;
 * sem botão "Salvar". Cache em escopo de módulo evita piscar o loader quando
 * o consultor alterna entre abas do ViewSwitcher.
 */

interface Settings {
  auto_enabled: boolean;
  horas_ate_primeiro_followup: number;
  max_envios: number;
  horas_entre_envios: number;
  janela_inicio: number;
  janela_fim: number;
  enviar_fim_de_semana: boolean;
}

const DEFAULTS: Settings = {
  auto_enabled: false,
  horas_ate_primeiro_followup: 24,
  max_envios: 3,
  horas_entre_envios: 48,
  janela_inicio: 9,
  janela_fim: 20,
  enviar_fim_de_semana: false,
};

// Cache em escopo de módulo: ao remontar a aba "Configurar" o estado já
// aparece preenchido sem spinner, enquanto o load() confirma em background.
const SETTINGS_CACHE = new Map<string, Settings>();

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  consultantId: string;
}

export function ConfigPanel({ consultantId }: Props) {
  const cached = SETTINGS_CACHE.get(consultantId);
  const [s, setS] = useState<Settings>(cached ?? DEFAULTS);
  const [loading, setLoading] = useState(!cached);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const hydratedRef = useRef<boolean>(!!cached);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  // Carga inicial — sempre confirma com o banco. Se já tinha cache, não pisca.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("reactivation_settings")
        .select("*")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const next: Settings = {
          auto_enabled: data.auto_enabled,
          horas_ate_primeiro_followup: data.horas_ate_primeiro_followup,
          max_envios: data.max_envios,
          horas_entre_envios: data.horas_entre_envios,
          janela_inicio: data.janela_inicio,
          janela_fim: data.janela_fim,
          enviar_fim_de_semana: data.enviar_fim_de_semana,
        };
        SETTINGS_CACHE.set(consultantId, next);
        setS(next);
      }
      setLoading(false);
      // Marca hidratado só depois do estado inicial vir do banco — evita
      // que o efeito de auto-save dispare com os valores DEFAULTS.
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId]);

  // Persiste no banco. Serializa: se já há um save em voo, espera antes do próximo.
  async function persist(snapshot: Settings) {
    if (inflightRef.current) {
      try { await inflightRef.current; } catch { /* ignored */ }
    }
    setSaveState("saving");
    const p = (async () => {
      const { error } = await (supabase as any)
        .from("reactivation_settings")
        .upsert({
          consultant_id: consultantId,
          ...snapshot,
          updated_at: new Date().toISOString(),
        });
      if (error) {
        setSaveState("error");
        setLastError(error.message);
        toast.error("Erro ao salvar configuração", { description: error.message });
      } else {
        SETTINGS_CACHE.set(consultantId, snapshot);
        setLastSavedAt(new Date());
        setLastError(null);
        setSaveState("saved");
      }
    })();
    inflightRef.current = p;
    try { await p; } finally {
      if (inflightRef.current === p) inflightRef.current = null;
    }
  }

  // Auto-save com debounce sempre que `s` mudar.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void persist(s);
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, consultantId]);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function retry() {
    void persist(s);
  }

  if (loading) {
    return <div className="grid place-items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Cabeçalho com status de auto-save */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Configuração do reaquecimento</h2>
          <p className="text-xs text-muted-foreground">Suas alterações são salvas automaticamente.</p>
        </div>
        <SaveStatus state={saveState} lastSavedAt={lastSavedAt} errorMsg={lastError} onRetry={retry} />
      </div>

      {/* Liga/desliga */}
      <Card className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 border border-primary/30">
          <Power className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Reaquecimento automático</h3>
          <p className="text-xs text-muted-foreground">
            Quando ligado, o sistema envia as frases ativas sozinho para os leads parados, respeitando as regras abaixo.
          </p>
        </div>
        <Switch checked={s.auto_enabled} onCheckedChange={(v) => set("auto_enabled", v)} />
      </Card>

      {/* Tempo */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Tempo e limites</h3>
        </div>

        <Field
          label="Esperar quantas horas paradas antes de reativar"
          hint="Tempo sem resposta do cliente até o primeiro toque."
        >
          <Input type="number" min={1} max={720} value={s.horas_ate_primeiro_followup}
            onChange={(e) => set("horas_ate_primeiro_followup", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>

        <Field label="Máximo de mensagens automáticas por lead" hint="Depois disso, o sistema para de insistir.">
          <Input type="number" min={1} max={10} value={s.max_envios}
            onChange={(e) => set("max_envios", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">mensagens</span>
        </Field>

        <Field label="Intervalo entre uma mensagem e outra" hint="Evita mandar várias seguidas pro mesmo lead.">
          <Input type="number" min={1} max={336} value={s.horas_entre_envios}
            onChange={(e) => set("horas_entre_envios", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>
      </Card>

      {/* Janela de horário */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Janela de envio</h3>
        </div>
        <Field label="Enviar somente entre" hint="Horário comercial evita incomodar de madrugada.">
          <Input type="number" min={0} max={23} value={s.janela_inicio}
            onChange={(e) => set("janela_inicio", Number(e.target.value))} className="w-20" />
          <span className="text-xs text-muted-foreground">e</span>
          <Input type="number" min={0} max={23} value={s.janela_fim}
            onChange={(e) => set("janela_fim", Number(e.target.value))} className="w-20" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={s.enviar_fim_de_semana} onCheckedChange={(v) => set("enviar_fim_de_semana", v)} />
          Enviar também aos sábados e domingos
        </label>
      </Card>
    </div>
  );
}

function SaveStatus({
  state, lastSavedAt, errorMsg, onRetry,
}: {
  state: SaveState;
  lastSavedAt: Date | null;
  errorMsg: string | null;
  onRetry: () => void;
}) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Salvando…
      </span>
    );
  }
  if (state === "error") {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>Erro ao salvar{errorMsg ? `: ${errorMsg}` : ""}</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (state === "saved" && lastSavedAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-primary" />
        Salvo às {lastSavedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
