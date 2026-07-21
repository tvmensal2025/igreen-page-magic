/**
 * Padrão Sofia em qualquer passo:
 * - Se houver {{nome}} → quadrantes VARIÁVEL | FIXO
 * - Abaixo → texto do áudio fixo (quando o passo tem áudio)
 * - Depois → texto WhatsApp
 *
 * Sem M/F. Não regenera TTS do lote.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeftRight,
  Eraser,
  Loader2,
  Mic,
  MessageSquareText,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  User,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import AudioPlayer from "@/components/admin/media/AudioPlayer";
import {
  A2_BODY_EXPLAIN,
  AFTER_CLUB_BUTTONS,
  AFTER_EXPLAIN_BUTTONS,
  getTemplate,
  inferSpeechGender,
  isSofiaEditableStep,
  messageHasSofiaNomeVar,
  renderCadenceBody,
  resolveSofiaStepProfile,
  sofiaUploadTargetSlot,
  type SofiaEditableProfile,
  type SpeechGender,
} from "@/lib/multichannelCadenceTexts";

function normName(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 40);
}

function firstNameDisplay(raw: string): string {
  const t = String(raw || "").trim().split(/\s+/)[0] || "Cliente";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type StitchHit = { slot_key: string; url: string; label: string | null };
type MediaKind = "audio" | "image" | "video" | "text";

type Props = {
  consultantId: string;
  slotKey: string;
  stepKey?: string;
  messageText?: string | null;
  onMessageTextChange?: (next: string) => void;
  mediaOrder?: string[] | null;
  onSetMediaOrder?: (next: MediaKind[]) => void;
  disabled?: boolean;
  onSyncBodies?: () => void | Promise<void>;
  syncingBodies?: boolean;
};

type ProfileConfig = {
  profile: SofiaEditableProfile;
  hasName: boolean;
  hasAudioBody: boolean;
  defaultOrder: MediaKind[];
  audioCatalogKey: string | null;
  textCatalogKey: string | null;
  bodySlots: string[];
  bodyLabel: string;
  buttons: { id: string; title: string }[];
  stitchCandidates: (gender: SpeechGender, name: string) => string[];
};

function catalogAudioBody(tplKey: string | null): string {
  if (!tplKey) return "";
  if (tplKey === "a2_audio_activate_name") {
    return A2_BODY_EXPLAIN;
  }
  const tpl = getTemplate(tplKey);
  const segs = (tpl?.audioSegments || []).filter((s) => s.kind !== "name");
  const fixed = segs.filter((s) => s.kind === "fixed" || s.genderVariant);
  const pick = (fixed.length ? fixed : segs).map((s) => s.text.trim()).filter(Boolean);
  if (pick.length) return pick[pick.length - 1] || pick[0];
  return "";
}

function catalogWhatsAppText(tplKey: string | null, fallback: string): string {
  if (!tplKey) return fallback;
  return String(getTemplate(tplKey)?.body || fallback).trim();
}

function buildProfile(
  slot: string,
  step: string,
  messageText: string | null | undefined,
  mediaOrder: string[] | null | undefined,
): ProfileConfig | null {
  const known = resolveSofiaStepProfile(slot, step);
  const hasNome = messageHasSofiaNomeVar(messageText);
  const orderHasAudio = (mediaOrder || []).some((k) => String(k).toLowerCase() === "audio");
  const profile: SofiaEditableProfile | null =
    known || (hasNome ? "generic" : null);
  if (!profile) return null;

  if (profile === "bill") {
    return {
      profile,
      hasName: true,
      hasAudioBody: true,
      defaultOrder: ["audio", "text"],
      audioCatalogKey: "a2_audio_activate_name",
      textCatalogKey: "a2_text_ask_bill_value",
      bodySlots: [
        sofiaUploadTargetSlot("a2_audio_activate_name", "feminino"),
        sofiaUploadTargetSlot("a2_audio_activate_name", "masculino"),
      ],
      bodyLabel: "Sofia corpo · áudio fixo",
      buttons: [],
      stitchCandidates: (g, n) => [
        `stitch:a2_audio_activate_name:ola4:${g}:${n}`,
        `stitch:a2_audio_activate_name:ola3:${g}:${n}`,
        `stitch:a2_audio_activate_name:n3:${g}:${n}`,
        `stitch:a2_audio_activate_name:n1:${g}:${n}`,
      ],
    };
  }

  if (profile === "explain") {
    return {
      profile,
      hasName: true,
      hasAudioBody: true,
      defaultOrder: ["text", "audio"],
      audioCatalogKey: "a3_explain_with_buttons",
      textCatalogKey: "a3_explain_with_buttons",
      bodySlots: [
        sofiaUploadTargetSlot("a3_explain_with_buttons"),
        "a3_audio_explain__body",
      ],
      bodyLabel: "Sofia corpo · explicação",
      buttons: AFTER_EXPLAIN_BUTTONS,
      stitchCandidates: (_g, n) => [`stitch:a3_explain_with_buttons:en1:x:${n}`],
    };
  }

  if (profile === "club") {
    return {
      profile,
      hasName: hasNome,
      hasAudioBody: true,
      defaultOrder: ["audio", "text"],
      audioCatalogKey: "a5_audio_club_benefits",
      textCatalogKey: "a5b_after_club_buttons",
      bodySlots: ["a5_audio_club_benefits"],
      bodyLabel: "Sofia áudio · clube",
      buttons: AFTER_CLUB_BUTTONS,
      stitchCandidates: () => ["a5_audio_club_benefits"],
    };
  }

  // generic: qualquer passo com {{nome}}
  const primary = slot || step;
  const bodySlot = primary ? sofiaUploadTargetSlot(primary) : "";
  return {
    profile: "generic",
    hasName: true,
    hasAudioBody: orderHasAudio || /audio|a2_|a3_|a5_/i.test(primary),
    defaultOrder: orderHasAudio ? ["audio", "text"] : ["text"],
    audioCatalogKey: getTemplate(primary) ? primary : null,
    textCatalogKey: getTemplate(step) ? step : getTemplate(primary) ? primary : null,
    bodySlots: bodySlot ? [bodySlot, `${primary}__body`].filter(Boolean) : [],
    bodyLabel: "Sofia · áudio fixo do passo",
    buttons: [],
    stitchCandidates: (g, n) =>
      primary
        ? [
            `stitch:${primary}:n3:${g}:${n}`,
            `stitch:${primary}:n3:x:${n}`,
            primary,
          ]
        : [],
  };
}

function looksIncompleteWaText(text: string, catalog: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (catalog.length > 80 && t.length < Math.min(80, catalog.length * 0.45)) return true;
  return false;
}

export default function SofiaStepAudioTools({
  consultantId,
  slotKey,
  stepKey = "",
  messageText,
  onMessageTextChange,
  mediaOrder,
  onSetMediaOrder,
  disabled,
  onSyncBodies,
  syncingBodies,
}: Props) {
  const cfg = useMemo(
    () => buildProfile(slotKey, stepKey, messageText, mediaOrder),
    [slotKey, stepKey, messageText, mediaOrder],
  );
  const editable = isSofiaEditableStep(slotKey, stepKey, messageText);

  const defaultAudio = useMemo(
    () => catalogAudioBody(cfg?.audioCatalogKey ?? null),
    [cfg],
  );
  const defaultWa = useMemo(
    () => catalogWhatsAppText(cfg?.textCatalogKey ?? null, String(messageText || "").trim()),
    [cfg, messageText],
  );

  const [probeName, setProbeName] = useState("Felipe");
  const [probing, setProbing] = useState(false);
  const [hit, setHit] = useState<StitchHit | null>(null);
  const [probeMiss, setProbeMiss] = useState(false);
  const [audioBody, setAudioBody] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [bodyOk, setBodyOk] = useState(false);

  const previewNome = firstNameDisplay(probeName);
  const previewGender = useMemo(() => inferSpeechGender(probeName), [probeName]);

  const sendSequence = useMemo(() => {
    const order = (mediaOrder || [])
      .map((k) => String(k).toLowerCase())
      .filter((k): k is "audio" | "text" => k === "audio" || k === "text");
    if (order.length) return order;
    return (cfg?.defaultOrder || ["text"]).filter(
      (k): k is "audio" | "text" => k === "audio" || k === "text",
    );
  }, [mediaOrder, cfg]);

  useEffect(() => {
    if (!cfg) return;
    const fromStep = String(messageText || "").trim();
    if (!fromStep || looksIncompleteWaText(fromStep, defaultWa)) {
      setDraftText(defaultWa || fromStep);
    } else {
      setDraftText(fromStep);
    }
  }, [messageText, cfg, defaultWa]);

  const loadScripts = useCallback(async () => {
    if (!consultantId || !cfg?.hasAudioBody) {
      setScriptsLoaded(true);
      setAudioBody(defaultAudio);
      return;
    }
    setScriptsLoaded(false);
    try {
      if (!cfg.bodySlots.length) {
        setAudioBody(defaultAudio);
        setBodyOk(false);
        return;
      }
      const { data } = await supabase
        .from("ai_media_library")
        .select("slot_key, transcript, text_content, active, url")
        .eq("consultant_id", consultantId)
        .in("slot_key", cfg.bodySlots);
      const rows = data || [];
      setBodyOk(rows.some((r) => r.active && (r.url || r.text_content || r.transcript)));
      const stored = rows
        .map((r) => String(r.text_content || r.transcript || "").trim())
        .find((t) => t.length > 20 && !(cfg.profile === "bill" && /bem-vind/i.test(t)));
      setAudioBody(stored || defaultAudio);
    } catch (e: any) {
      console.warn("[SofiaStepAudioTools] loadScripts:", e?.message || e);
      setAudioBody(defaultAudio);
    } finally {
      setScriptsLoaded(true);
    }
  }, [consultantId, cfg, defaultAudio]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const saveAudioBody = useCallback(async () => {
    if (!cfg?.hasAudioBody) return;
    const trimmed = audioBody.trim();
    if (!trimmed) {
      toast.error("Digite o texto fixo do áudio.");
      return;
    }
    setSavingScript(true);
    try {
      let updated = 0;
      for (const slot of cfg.bodySlots) {
        const { data: existing } = await supabase
          .from("ai_media_library")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("slot_key", slot)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!existing?.id) continue;
        const { error } = await supabase
          .from("ai_media_library")
          .update({
            text_content: trimmed,
            transcript: trimmed,
            label: cfg.bodyLabel.slice(0, 120),
            active: true,
          })
          .eq("id", existing.id);
        if (error) throw error;
        updated++;
      }
      if (updated === 0) {
        toast.error(
          "Ainda não há corpo de áudio neste passo. Use Sincronizar / upload e salve de novo.",
        );
        return;
      }
      setBodyOk(true);
      toast.success("Áudio fixo salvo (não regenera MP3).");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar");
    } finally {
      setSavingScript(false);
    }
  }, [audioBody, consultantId, cfg]);

  const commitWaText = useCallback(
    (value: string) => {
      setDraftText(value);
      if (onMessageTextChange && (value.trim().length >= 8 || value.trim().length === 0)) {
        onMessageTextChange(value);
      }
    },
    [onMessageTextChange],
  );

  const restoreOfficialWa = useCallback(() => {
    const next = defaultWa || String(messageText || "");
    setDraftText(next);
    onMessageTextChange?.(next);
    toast.success("Texto WhatsApp restaurado.");
  }, [defaultWa, messageText, onMessageTextChange]);

  const restoreOfficialAudio = useCallback(() => {
    setAudioBody(defaultAudio);
    toast.message("Roteiro restaurado na tela — clique Salvar para gravar.");
  }, [defaultAudio]);

  const clearWa = useCallback(() => {
    if (!window.confirm("Limpar o texto WhatsApp deste passo?")) return;
    setDraftText("");
    onMessageTextChange?.("");
  }, [onMessageTextChange]);

  const applyDefaultOrder = useCallback(() => {
    if (!cfg || !onSetMediaOrder) return;
    onSetMediaOrder(cfg.defaultOrder);
  }, [cfg, onSetMediaOrder]);

  const swapAudioText = useCallback(() => {
    if (!onSetMediaOrder) return;
    const at = sendSequence.filter((k) => k === "audio" || k === "text");
    if (at.length < 2) {
      onSetMediaOrder(["audio", "text"]);
      return;
    }
    const extras = (mediaOrder || [])
      .map((k) => String(k).toLowerCase())
      .filter((k): k is MediaKind => k === "image" || k === "video");
    onSetMediaOrder([...([...at].reverse() as MediaKind[]), ...extras]);
  }, [onSetMediaOrder, sendSequence, mediaOrder]);

  const enableAudioOnStep = useCallback(() => {
    if (!onSetMediaOrder) return;
    const extras = (mediaOrder || [])
      .map((k) => String(k).toLowerCase())
      .filter((k): k is MediaKind => k === "image" || k === "video");
    onSetMediaOrder(["audio", "text", ...extras]);
    toast.success("Áudio adicionado à ordem — edite o texto fixo abaixo.");
  }, [onSetMediaOrder, mediaOrder]);

  const whatsappPreview = useMemo(
    () =>
      renderCadenceBody(draftText || defaultWa || "", {
        nome: previewNome,
        gender: previewGender,
        valorFormatado: "350,00",
        economiaMin: "28",
        economiaMax: "70",
      }),
    [draftText, defaultWa, previewNome, previewGender],
  );

  const probeStitch = useCallback(async () => {
    if (!cfg) return;
    const display = probeName.trim().split(/\s+/)[0] || "";
    const name = normName(display);
    if (cfg.hasName && name.length < 2) {
      toast.error("Digite um primeiro nome válido.");
      return;
    }
    setProbing(true);
    setHit(null);
    setProbeMiss(false);
    try {
      const gender = inferSpeechGender(display || "Felipe");
      for (const slot of cfg.stitchCandidates(gender, name || "felipe")) {
        const { data } = await supabase
          .from("ai_media_library")
          .select("slot_key, url, label")
          .eq("consultant_id", consultantId)
          .eq("slot_key", slot)
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        if (data?.url) {
          setHit({
            slot_key: String(data.slot_key),
            url: String(data.url),
            label: data.label ? String(data.label) : null,
          });
          return;
        }
      }
      setProbeMiss(true);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao buscar");
    } finally {
      setProbing(false);
    }
  }, [cfg, probeName, consultantId]);

  if (!editable || !cfg) return null;

  const showAudioEditor = cfg.hasAudioBody || sendSequence.includes("audio");

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Padrão Sofia
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Com <code className="text-[10px]">{"{{nome}}"}</code> → variável + fixo. Em qualquer passo.
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px] h-5">
          {sendSequence.join(" → ") || "text"}
        </Badge>
      </div>

      {/* QUADRANTES VARIÁVEL | FIXO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <fieldset
          disabled={disabled}
          className="rounded-md border-2 border-violet-500/40 bg-violet-500/5 p-2.5 space-y-1.5 min-h-[88px]"
        >
          <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-violet-800 dark:text-violet-300 flex items-center gap-1">
            <User className="h-3 w-3" />
            Variável
          </legend>
          {cfg.hasName ? (
            <>
              <code className="text-[11px] font-semibold text-foreground">{"{{nome}}"}</code>
              <p className="text-[11px] text-foreground">
                Prévia: <strong>{previewNome}.</strong>
              </p>
              <Input
                value={probeName}
                onChange={(e) => setProbeName(e.target.value)}
                placeholder="Testar com um nome…"
                className="h-8 text-xs"
              />
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Este passo não usa nome no áudio. Inclua <code>{"{{nome}}"}</code> no texto para ativar.
            </p>
          )}
        </fieldset>

        <fieldset
          disabled={disabled}
          className="rounded-md border-2 border-emerald-500/40 bg-emerald-500/5 p-2.5 space-y-1.5 min-h-[88px]"
        >
          <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
            <Mic className="h-3 w-3" />
            Fixo
          </legend>
          <p className="text-[11px] text-foreground font-medium">Corpo do áudio (igual para todos)</p>
          <p className="text-[10px] text-muted-foreground leading-snug">
            O motor costura <strong>variável</strong> + este <strong>fixo</strong>. Sem masculino/feminino no painel.
          </p>
          <Badge variant={bodyOk ? "default" : "outline"} className="text-[10px] h-5">
            {showAudioEditor ? (bodyOk ? "corpo ok" : "corpo pendente") : "só texto"}
          </Badge>
        </fieldset>
      </div>

      {/* TEXTO DO ÁUDIO FIXO — abaixo dos quadrantes */}
      {showAudioEditor ? (
        <div className="rounded-md border border-emerald-500/40 bg-background/80 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
              <Mic className="h-3 w-3" />
              Texto que vira o áudio fixo
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] gap-1 px-2"
                disabled={disabled}
                onClick={restoreOfficialAudio}
              >
                <RotateCcw className="h-3 w-3" />
                Oficial
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1 px-2"
                disabled={disabled || savingScript || !scriptsLoaded}
                onClick={() => void saveAudioBody()}
              >
                {savingScript ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Salvar
              </Button>
            </div>
          </div>
          <Textarea
            value={audioBody}
            onChange={(e) => setAudioBody(e.target.value)}
            disabled={disabled || !scriptsLoaded}
            rows={5}
            className="text-[11px] leading-relaxed resize-y min-h-[110px]"
            placeholder="Texto falado depois do nome…"
          />
          <p className="text-[10px] text-muted-foreground">
            Salvar não regenera MP3 do lote — só atualiza o roteiro do corpo.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-2.5 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Este passo ainda não tem áudio na ordem. Com <code>{"{{nome}}"}</code> você já tem os
            quadrantes; para o áudio fixo:
          </p>
          {onSetMediaOrder && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={enableAudioOnStep}
            >
              Adicionar áudio à ordem
            </Button>
          )}
        </div>
      )}

      {/* TEXTO WHATSAPP */}
      <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300 flex items-center gap-1">
            <MessageSquareText className="h-3 w-3" />
            Texto WhatsApp do passo
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 px-2"
              disabled={disabled || !onMessageTextChange}
              onClick={restoreOfficialWa}
            >
              <RotateCcw className="h-3 w-3" />
              Oficial
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 px-2 text-destructive"
              disabled={disabled || !onMessageTextChange}
              onClick={clearWa}
            >
              <Eraser className="h-3 w-3" />
              Limpar
            </Button>
          </div>
        </div>
        <Textarea
          value={draftText}
          onChange={(e) => commitWaText(e.target.value)}
          onBlur={() => {
            if (onMessageTextChange && draftText.trim().length >= 8) onMessageTextChange(draftText);
          }}
          disabled={disabled || !onMessageTextChange}
          rows={4}
          className="text-[11px] leading-relaxed resize-y min-h-[90px]"
          placeholder="Use {{nome}} para ativar o padrão Sofia…"
        />
        <div className="rounded border border-border/50 bg-background/70 p-2">
          <div className="text-[10px] text-muted-foreground mb-1">Prévia</div>
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-sans">{whatsappPreview}</pre>
        </div>
      </div>

      {cfg.buttons.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1">
            <MousePointerClick className="h-3 w-3" />
            Botões → aba Regras
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cfg.buttons.map((b) => (
              <Badge key={b.id} variant="secondary" className="text-[10px] h-5 font-normal">
                {b.title}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {onSetMediaOrder && sendSequence.includes("audio") && sendSequence.includes("text") && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={disabled}
              onClick={swapAudioText}
            >
              <ArrowLeftRight className="h-3 w-3" />
              Inverter áudio/texto
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={applyDefaultOrder}
            >
              Ordem padrão
            </Button>
          </>
        )}
        {onSyncBodies && cfg.profile !== "generic" && cfg.profile !== "club" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={disabled || syncingBodies}
            onClick={() => void onSyncBodies()}
          >
            {syncingBodies ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Sincronizar corpos
          </Button>
        )}
      </div>

      {showAudioEditor && (
        <div className="rounded-md border border-border/60 bg-background/80 p-2.5 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Volume2 className="h-3 w-3" />
            Ouvir na biblioteca
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {cfg.hasName && (
              <Input
                value={probeName}
                onChange={(e) => setProbeName(e.target.value)}
                className="h-8 text-xs max-w-[140px]"
                disabled={disabled || probing}
              />
            )}
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1"
              disabled={disabled || probing}
              onClick={() => void probeStitch()}
            >
              {probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Buscar
            </Button>
          </div>
          {hit && (
            <AudioPlayer mediaId={`probe-${hit.slot_key}`} url={hit.url} fileName={hit.label || hit.slot_key} />
          )}
          {probeMiss && !hit && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Sem arquivo em cache para esta busca.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
