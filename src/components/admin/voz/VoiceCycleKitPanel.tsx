/**
 * Programação do ciclo — onde configurar arquivos/textos para lead novo e lead antigo.
 * Regras de timing ficam no motor (cycle.ts); aqui só o conteúdo para rodar 100%.
 * Envio real só com áudio + 3 cadeados ON (não liga sozinho).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Save,
  Upload,
  Volume2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type KitRow = {
  consultant_id: string;
  wa_open_text: string | null;
  wa_audio_mon_url: string | null;
  wa_audio_tue_url: string | null;
  wa_audio_wed_url: string | null;
  wa_audio_thu_url: string | null;
  wa_audio_fri_url: string | null;
  wa_audio_sat_url: string | null;
  voice_audio_clip_id: string | null;
  voice_audio_clip_id_retry: string | null;
  personalize_name: boolean;
  call_tts_fallback: string | null;
  sms_na_text: string | null;
  sms_retry_text: string | null;
  bina_notes: string | null;
};

type Clip = {
  id: string;
  name: string;
  velip_audio_id: string | null;
  is_call_body?: boolean | null;
  voice_id?: string | null;
};

/** Mesmas vozes do Estúdio (ElevenLabs) — ligação usa Sofia por padrão. */
const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";
const VOICE_DIEGO = "rpNe0HOx7heUulPiOEaG";
const VOICE_RAFAEL = "9qVywhT8Ja45eyJbO8lc";

function voiceLabel(voiceId: string | null | undefined): string {
  if (voiceId === VOICE_SOFIA) return "Sofia";
  if (voiceId === VOICE_DIEGO) return "Diego";
  if (voiceId === VOICE_RAFAEL) return "Rafael";
  return voiceId ? "voz" : "";
}

const WEEKDAY_FIELDS = [
  { key: "wa_audio_mon_url", label: "Segunda" },
  { key: "wa_audio_tue_url", label: "Terça" },
  { key: "wa_audio_wed_url", label: "Quarta" },
  { key: "wa_audio_thu_url", label: "Quinta" },
  { key: "wa_audio_fri_url", label: "Sexta" },
  { key: "wa_audio_sat_url", label: "Sábado" },
] as const;

type WeekdayKey = (typeof WEEKDAY_FIELDS)[number]["key"];

const EMPTY: KitRow = {
  consultant_id: "",
  wa_open_text: "",
  wa_audio_mon_url: null,
  wa_audio_tue_url: null,
  wa_audio_wed_url: null,
  wa_audio_thu_url: null,
  wa_audio_fri_url: null,
  wa_audio_sat_url: null,
  voice_audio_clip_id: null,
  voice_audio_clip_id_retry: null,
  personalize_name: false,
  call_tts_fallback: "",
  sms_na_text: "",
  sms_retry_text: "",
  bina_notes: "",
};

type StepKind = "info" | "wa" | "call1" | "call2" | "sms" | "flow";

type TimelineStep = {
  id: string;
  label: string;
  hint: string;
  kind: StepKind;
};

const NOVO_STEPS: TimelineStep[] = [
  { id: "ask_name", label: "Entrada no ciclo", hint: "WhatsApp — pede o nome (Sofia)", kind: "wa" },
  { id: "flow", label: "Ativo · início do fluxo", hint: "Conversa em andamento", kind: "flow" },
  { id: "wait", label: "Aguardando resposta (~2h)", hint: "Tempo fixo no motor", kind: "info" },
  { id: "nudge", label: "Retomada no WhatsApp", hint: "Clique em Editar cutuca abaixo — Textos Multicanal", kind: "info" },
  { id: "sms", label: "SMS de reforço", hint: "Textos Multicanal → Escada · SMS", kind: "info" },
  { id: "call1", label: "Ligação (voz Sofia)", hint: "Textos Multicanal → Escada · Ligação", kind: "info" },
  { id: "retry", label: "Aguardando · fecha o A", hint: "Textos Multicanal → Escada · Fecha A", kind: "info" },
  { id: "to_b", label: "Entra no Grupo B", hint: "COLD_1 em diante", kind: "info" },
];

const FRIO_STEPS: TimelineStep[] = [
  { id: "call1", label: "1ª ligação (voz Sofia)", hint: "Áudio Sofia do Estúdio", kind: "call1" },
  { id: "open", label: "WhatsApp: abre + áudio do dia", hint: "Texto + áudio seg–sáb", kind: "wa" },
  { id: "retry", label: "2ª ligação (retry)", hint: "Outro áudio Sofia ou reusa a 1ª", kind: "call2" },
  { id: "sms", label: "SMS se não atender", hint: "Texto curto com {{nome}}", kind: "sms" },
  { id: "wait", label: "Aguarda → fluxo", hint: "Sem arquivo", kind: "flow" },
  { id: "close", label: "Fecha + nota", hint: "Automático", kind: "info" },
];

interface Props {
  consultantId: string;
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export function VoiceCycleKitPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [kit, setKit] = useState<KitRow>({ ...EMPTY, consultant_id: consultantId });
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingGates, setSavingGates] = useState(false);
  const [uploading, setUploading] = useState<WeekdayKey | null>(null);
  const [queueTab, setQueueTab] = useState<"novo" | "frio">("novo");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [gates, setGates] = useState<{
    toggle: boolean;
    enabled: boolean;
    live: boolean;
    cap: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [kitRes, clipsRes, toggleRes, settingsRes] = await Promise.all([
      (supabase as any).from("daily_reheat_kit").select("*").eq("consultant_id", consultantId).maybeSingle(),
      supabase
        .from("voice_audio_clips")
        .select("id, name, velip_audio_id, is_call_body, voice_id")
        .eq("consultant_id", consultantId)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase.from("automation_toggles").select("enabled").eq("key", "daily_reheat").maybeSingle(),
      (supabase as any)
        .from("daily_reheat_settings")
        .select("enabled, live_dispatch_enabled, daily_whapi_cap")
        .eq("id", "global")
        .maybeSingle(),
    ]);

    if (kitRes.data) {
      const row = kitRes.data as Partial<KitRow>;
      setKit({
        ...EMPTY,
        ...row,
        consultant_id: consultantId,
        personalize_name: !!row.personalize_name,
        voice_audio_clip_id_retry: row.voice_audio_clip_id_retry ?? null,
      });
    } else {
      setKit({ ...EMPTY, consultant_id: consultantId });
    }
    const list = ((clipsRes.data as Clip[]) ?? []).slice().sort((a, b) => {
      const score = (c: Clip) =>
        (c.voice_id === VOICE_SOFIA ? 4 : 0) +
        (c.is_call_body ? 2 : 0) +
        (c.velip_audio_id ? 1 : 0);
      return score(b) - score(a);
    });
    setClips(list);
    const s = settingsRes.data as {
      enabled?: boolean;
      live_dispatch_enabled?: boolean;
      daily_whapi_cap?: number;
    } | null;
    setGates({
      toggle: !!(toggleRes.data as { enabled?: boolean } | null)?.enabled,
      enabled: !!s?.enabled,
      live: !!s?.live_dispatch_enabled,
      cap: Number(s?.daily_whapi_cap ?? 60),
    });
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasAnyWaAudio = WEEKDAY_FIELDS.some(({ key }) => !!kit[key]);
  const hasWaText = !!(kit.wa_open_text?.trim());
  const hasCall1 = !!(kit.voice_audio_clip_id || kit.call_tts_fallback?.trim());
  const hasSms = !!(kit.sms_na_text?.trim());
  const motorReady = !!(gates?.toggle && gates?.enabled && gates?.live);
  const contentReady = hasAnyWaAudio && hasWaText && hasCall1 && hasSms;
  const readyPct = [hasWaText, hasAnyWaAudio, hasCall1, hasSms].filter(Boolean).length;

  const save = async () => {
    setSaving(true);
    const payload = {
      ...kit,
      consultant_id: consultantId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await (supabase as any).from("daily_reheat_kit").upsert(payload, {
      onConflict: "consultant_id",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Programação salva",
      description: contentReady
        ? motorReady
          ? "Conteúdo ok e motor ligado."
          : "Conteúdo ok. Motor ainda desligado (Avançado)."
        : `Falta preencher ${4 - readyPct} item(ns) do checklist.`,
    });
  };

  const patchGates = async (patch: { toggle?: boolean; enabled?: boolean; live?: boolean }) => {
    if (!gates) return;
    setSavingGates(true);
    const next = { ...gates, ...patch };
    try {
      if (patch.toggle !== undefined) {
        const { error } = await supabase
          .from("automation_toggles")
          .update({ enabled: patch.toggle })
          .eq("key", "daily_reheat");
        if (error) throw error;
      }
      if (patch.enabled !== undefined || patch.live !== undefined) {
        const { error } = await (supabase as any)
          .from("daily_reheat_settings")
          .update({
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.live !== undefined ? { live_dispatch_enabled: patch.live } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", "global");
        if (error) throw error;
      }
      setGates(next);
      toast({
        title: next.toggle && next.enabled && next.live ? "Motor ligado" : "Motor atualizado",
        description: "Envio real só com os 3 interruptores ON + arquivos no checklist.",
      });
    } catch (e) {
      toast({
        title: "Falha ao atualizar motor",
        description: (e as Error).message,
        variant: "destructive",
      });
      await load();
    } finally {
      setSavingGates(false);
    }
  };

  const uploadWeekday = async (key: WeekdayKey, file: File) => {
    setUploading(key);
    try {
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: `ciclo-${key}`,
      });
      setKit((k) => ({ ...k, [key]: up.url }));
      toast({ title: "Áudio enviado", description: "Clique em Salvar para gravar." });
    } catch (e) {
      toast({
        title: "Falha no upload",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setUploading(null);
    }
  };

  const clipSelect = (
    value: string | null,
    onChange: (id: string | null) => void,
    emptyLabel: string,
  ) => (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Selecione áudio Sofia" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{emptyLabel}</SelectItem>
        {clips.map((c) => {
          const vLabel = voiceLabel(c.voice_id);
          return (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
              {vLabel ? ` · ${vLabel}` : ""}
              {c.is_call_body ? " · corpo" : ""}
              {c.velip_audio_id ? "" : " · sem iGreen Fone"}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );

  const waBlock = (
      <div className="space-y-3 rounded-md border border-border/80 bg-background/50 p-3">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Texto ao abrir WhatsApp
          </Label>
          <Textarea
            rows={3}
            value={kit.wa_open_text ?? ""}
            onChange={(e) => setKit((k) => ({ ...k, wa_open_text: e.target.value }))}
            placeholder="Oi {{nome}}, aqui é {{consultor}} da iGreen…"
          />
          <p className="text-[11px] text-muted-foreground">{"{{nome}}"}, {"{{consultor}}"}, {"{{protocolo}}"}</p>
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5" /> Áudio WhatsApp por dia (obrigatório ≥1)
          </Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEEKDAY_FIELDS.map(({ key, label }) => (
              <div key={key} className="rounded-md border border-border p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{label}</span>
                  <label className="inline-flex cursor-pointer">
                    <input
                      type="file"
                      accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav"
                      className="hidden"
                      disabled={uploading === key}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadWeekday(key, f);
                        e.target.value = "";
                      }}
                    />
                    <span className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs">
                      {uploading === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      Upload
                    </span>
                  </label>
                </div>
                <Input
                  className="text-xs h-8"
                  placeholder="URL"
                  value={kit[key] ?? ""}
                  onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value || null }))}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
  );

  const call1Block = (
    <div className="space-y-3 rounded-md border border-border/80 bg-background/50 p-3">
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5" /> Voz Sofia — áudio da 1ª ligação
        </Label>
        {clipSelect(
          kit.voice_audio_clip_id,
          (id) => setKit((k) => ({ ...k, voice_audio_clip_id: id })),
          "Selecione áudio Sofia (Estúdio)",
        )}
        <p className="text-[11px] text-muted-foreground">
          No Estúdio escolha a voz <strong>Sofia</strong> → Texto livre → gerar →{" "}
          <strong>Usar em ligações</strong>. Depois escolha o clip aqui.
        </p>
        {kit.voice_audio_clip_id && (() => {
          const sel = clips.find((c) => c.id === kit.voice_audio_clip_id);
          const vl = voiceLabel(sel?.voice_id);
          if (vl && vl !== "Sofia") {
            return (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Clip selecionado está com voz {vl}. Para o padrão do ciclo, use um áudio Sofia.
              </p>
            );
          }
          if (vl === "Sofia") {
            return (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Voz Sofia selecionada.
              </p>
            );
          }
          return null;
        })()}
      </div>
      <div className="flex items-start gap-2 rounded-md border border-border/60 p-2.5">
        <Switch
          checked={kit.personalize_name}
          onCheckedChange={(v) => setKit((k) => ({ ...k, personalize_name: v }))}
          id="kit-personalize"
          className="mt-0.5"
        />
        <div>
          <Label htmlFor="kit-personalize">Personalizar com nome (Sofia)</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Costura &quot;Olá, {"{Nome}"}! Tudo bem?&quot; na mesma voz Sofia + corpo (cache 1x por nome).
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Texto fallback (legado — não disca mais)</Label>
        <Textarea
          rows={2}
          value={kit.call_tts_fallback ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, call_tts_fallback: e.target.value }))}
          placeholder="(desativado) Sem clip Sofia a ligação é pulada"
          disabled
        />
        <p className="text-[11px] text-muted-foreground">
          Regra: sem clip Sofia a ligação <strong>não sai</strong>. TTS genérico desativado.
        </p>
      </div>
    </div>
  );

  const call2Block = (
    <div className="space-y-2 rounded-md border border-border/80 bg-background/50 p-3">
      <Label className="flex items-center gap-1.5">
        <Phone className="h-3.5 w-3.5" /> Voz Sofia — 2ª ligação (opcional)
      </Label>
      {clipSelect(
        kit.voice_audio_clip_id_retry,
        (id) => setKit((k) => ({ ...k, voice_audio_clip_id_retry: id })),
        "Reusar áudio Sofia da 1ª ligação",
      )}
    </div>
  );

  const smsBlock = (
    <div className="space-y-3 rounded-md border border-border/80 bg-background/50 p-3">
      <div className="space-y-1.5">
        <Label>SMS principal (após ligações)</Label>
        <Textarea
          rows={2}
          value={kit.sms_na_text ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, sms_na_text: e.target.value.slice(0, 160) }))}
          placeholder="Oi {{nome}}, tentei ligar. Me chama no WhatsApp. iGreen"
        />
        <p className="text-[11px] text-muted-foreground">{(kit.sms_na_text ?? "").length}/160</p>
      </div>
      <div className="space-y-1.5">
        <Label>SMS reforço (opcional)</Label>
        <Textarea
          rows={2}
          value={kit.sms_retry_text ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, sms_retry_text: e.target.value.slice(0, 160) }))}
        />
      </div>
    </div>
  );

  const renderStepBody = (step: TimelineStep) => {
    if (step.kind === "wa") return waBlock;
    if (step.kind === "call1") return call1Block;
    if (step.kind === "call2") return call2Block;
    if (step.kind === "sms") return smsBlock;
    return null;
  };

  const renderTimeline = (steps: TimelineStep[]) => (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const body = renderStepBody(step);
        const needsFile = step.kind === "wa" || step.kind === "call1" || step.kind === "sms";
        let filled = true;
        if (step.kind === "wa") filled = hasWaText && hasAnyWaAudio;
        if (step.kind === "call1") filled = hasCall1;
        if (step.kind === "sms") filled = hasSms;
        if (step.kind === "call2") filled = true;

        return (
          <li
            key={step.id}
            className={cn(
              "rounded-lg border p-3 space-y-2",
              needsFile && !filled ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  filled && needsFile
                    ? "bg-emerald-600 text-white"
                    : needsFile
                      ? "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-sm text-foreground">{step.label}</p>
                  {needsFile && (
                    <Badge variant={filled ? "default" : "secondary"} className="text-[10px]">
                      {filled ? "ok" : "falta arquivo"}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{step.hint}</p>
              </div>
            </div>
            {body}
          </li>
        );
      })}
    </ol>
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
        <p className="font-heading font-bold text-foreground text-base">
          Programação do ciclo — arquivos para rodar 100%
        </p>
        <p className="text-sm text-muted-foreground">
          Aqui você coloca o que o motor vai usar. Lead novo e lead antigo seguem ordens diferentes;
          o conteúdo (WA / ligação / SMS) é o mesmo kit. Regras de tempo ficam para depois.
        </p>
        <p className="text-xs text-muted-foreground">
          Checklist: {readyPct}/4 · {contentReady ? "Pronto para ligar o motor" : "Complete os itens em âmbar"}
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2 mt-2">
          <CheckItem ok={hasWaText} label="Texto WhatsApp" />
          <CheckItem ok={hasAnyWaAudio} label="Áudio WA (≥1 dia)" />
          <CheckItem ok={hasCall1} label="1ª ligação Sofia (clip obrigatório)" />
          <CheckItem ok={hasSms} label="SMS" />
        </ul>
      </div>

      <Tabs value={queueTab} onValueChange={(v) => setQueueTab(v as "novo" | "frio")}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="novo" className="flex-1 sm:flex-none">
            Lead novo
          </TabsTrigger>
          <TabsTrigger value="frio" className="flex-1 sm:flex-none">
            Lead antigo
          </TabsTrigger>
        </TabsList>
        <TabsContent value="novo" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Escada A (cutuca / SMS / ligação): edite em Textos Multicanal — Grupo A (topo da lista).
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mb-2"
            onClick={() => {
              try {
                sessionStorage.setItem("igreen-voz-subtab", "textos");
                sessionStorage.setItem("igreen-multichannel-focus-key", "a_nudge_wa");
              } catch { /* noop */ }
              window.dispatchEvent(new CustomEvent("igreen-voz-subtab", { detail: { sub: "textos" } }));
              window.dispatchEvent(
                new CustomEvent("igreen-multichannel-focus", { detail: { key: "a_nudge_wa" } }),
              );
            }}
          >
            Editar retomada (cutuca)
          </Button>
          {renderTimeline(NOVO_STEPS)}
        </TabsContent>
        <TabsContent value="frio" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Ordem: ligação 1 → WhatsApp → ligação 2 → SMS → fluxo
          </p>
          {renderTimeline(FRIO_STEPS)}
        </TabsContent>
      </Tabs>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label>BINA / notas (opcional)</Label>
        <Textarea
          rows={2}
          value={kit.bina_notes ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, bina_notes: e.target.value }))}
          placeholder="Números BINA ou observações"
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between">
            Avançado — ligar motor (cuidado)
            <ChevronDown className={cn("h-4 w-4 transition", advancedOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            {motorReady
              ? contentReady
                ? "Ligado — cron pode enviar"
                : "Ligado — falta conteúdo no checklist"
              : "Desligado (padrão seguro)"}
            {savingGates ? " · salvando…" : ""} · teto iGreen Chat {gates?.cap}/dia
          </p>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Toggle Central <code className="text-xs">daily_reheat</code></span>
            <Switch
              checked={!!gates?.toggle}
              disabled={savingGates}
              onCheckedChange={(v) => void patchGates({ toggle: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>settings.enabled</span>
            <Switch
              checked={!!gates?.enabled}
              disabled={savingGates}
              onCheckedChange={(v) => void patchGates({ enabled: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>live_dispatch_enabled (envio real)</span>
            <Switch
              checked={!!gates?.live}
              disabled={savingGates}
              onCheckedChange={(v) => void patchGates({ live: v })}
            />
          </label>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap gap-2 sticky bottom-2 bg-background/90 backdrop-blur py-2">
        <Button type="button" onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar programação
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Recarregar
        </Button>
      </div>
    </div>
  );
}
