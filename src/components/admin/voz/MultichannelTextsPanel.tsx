/**
 * Biblioteca Multicanal — textos A/B + cortes TTS Sofia (aprovar → gerar → salvar).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { MODEL_V3, prepareTtsSegment } from "@/lib/ttsEnhanceV3";
import { generateSofiaSegmented, getCachedTTS, VOICE_SOFIA_PROFESSIONAL } from "@/lib/sofiaTtsCache";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import {
  CadenceFormatToolbar,
  CadenceMobilePreview,
} from "@/components/admin/voz/CadenceMobilePreview";
import {
  MULTICHANNEL_CADENCE_TEMPLATES,
  SPEECH_GENDERS,
  WHAPI_MAX_BUTTONS,
  WHAPI_MAX_BUTTON_TITLE,
  type AudioSegment,
  type CadenceButton,
  type CadenceGroup,
  type CadenceTemplate,
  type SavedCadenceLibrary,
  type SpeechGender,
  allAudioSegmentsApproved,
  buildAvailabilityPhrase,
  cadenceAudioUrlKey,
  emptyLibrary,
  filterSegmentsForGender,
  hasGeneratedCadenceAudio,
  hasGenderAudioVariants,
  joinAudioSegmentTexts,
  loadLibrary,
  ensureSmsConsultorWaLink,
  normalizeConsultantPhoneDigits,
  renderCadenceBody,
  resolveAudioSegments,
  resolveBody,
  resolveButtons,
  resolveCadenceAudioUrl,
  cadenceBodyAudioUrlKey,
  flowMediaSlotKeysForCadence,
  inferSpeechGender,
  saveLibrary,
  smsCharCount,
  spokenSegmentText,
  validateWhapiButtons,
} from "@/lib/multichannelCadenceTexts";
import { estimateSavingsRange, parseAverageBillValue } from "@/lib/billValueParse";
import { useConsultantPhone } from "@/hooks/useConsultantPhone";
import {
  attachVoiceClipToCadenceSteps,
  loadCadenceLibraryFromBotFlow,
  loadCadenceLibraryFromStageConfig,
  loadCadenceLibraryRemote,
  publishCadenceLibrary,
} from "@/lib/syncCadenceToBotFlow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Volume2,
  Send,
  Phone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { normalizeBrazilPhone, validateBrazilPhone, formatBrazilPhone } from "@/lib/phone";

/** Stitches nome+corpo ficam stale quando o corpo fixo é regerado no painel. */
async function deactivatePersonalizedStitches(
  consultantId: string,
  cadenceKey: string,
): Promise<void> {
  const prefix = `stitch:${cadenceKey}:`;
  const { error } = await supabase
    .from("ai_media_library")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("consultant_id", consultantId)
    .like("slot_key", `${prefix}%`)
    .eq("active", true);
  if (error) console.warn("[multichannel] desativar stitches:", error.message);
}

const GROUP_TABS: { id: CadenceGroup | "all"; label: string }[] = [
  { id: "A", label: "Grupo A" },
  { id: "B", label: "Grupo B" },
  { id: "theme", label: "Temas" },
  { id: "availability", label: "Disponibilidade" },
  { id: "all", label: "Todos" },
];

function channelLabel(ch: CadenceTemplate["channel"]): string {
  switch (ch) {
    case "whatsapp_text":
      return "WhatsApp texto";
    case "whatsapp_buttons":
      return "WhatsApp com botões";
    case "whatsapp_audio":
      return "WhatsApp áudio";
    case "sms":
      return "SMS";
    case "call_script":
      return "Ligação";
    default:
      return "Sistema";
  }
}

interface Props {
  consultantId: string;
}

export function MultichannelTextsPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [lib, setLib] = useState<SavedCadenceLibrary>(() => emptyLibrary());
  const [group, setGroup] = useState<CadenceGroup | "all">("A");
  const [selectedKey, setSelectedKey] = useState<string>("a1_ask_name");
  const [previewName, setPreviewName] = useState("Maria");
  const [previewGender, setPreviewGender] = useState<SpeechGender>("feminino");
  const [previewBill, setPreviewBill] = useState("500");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lastGenStats, setLastGenStats] = useState<string | null>(null);
  const [nameInCache, setNameInCache] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  /** WhatsApp CONECTADO (chip) — mesma cascata do QR/ads; nunca notification_phone. */
  const { phone: connectedWaPhone } = useConsultantPhone(consultantId);
  const consultantPhone = normalizeConsultantPhoneDigits(connectedWaPhone || "");
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadLibrary(consultantId);
      const remote = await loadCadenceLibraryRemote(consultantId).catch(() => null);
      const fromFlow: Partial<SavedCadenceLibrary> = await loadCadenceLibraryFromBotFlow(consultantId, "A").catch(
        () => ({} as Partial<SavedCadenceLibrary>),
      );
      const fromStage: Partial<SavedCadenceLibrary> = await loadCadenceLibraryFromStageConfig().catch(
        () => ({} as Partial<SavedCadenceLibrary>),
      );
      // Prioridade: motor (Grupo B) + fluxo WhatsApp (Grupo A) > remoto > localStorage.
      const merged: SavedCadenceLibrary = {
        ...emptyLibrary(),
        ...local,
        ...(remote || {}),
        bodies: {
          ...local.bodies,
          ...(remote?.bodies || {}),
          ...(fromFlow.bodies || {}),
          ...(fromStage.bodies || {}),
        },
        buttons: {
          ...local.buttons,
          ...(remote?.buttons || {}),
          ...(fromFlow.buttons || {}),
        },
        audioUrls: {
          ...local.audioUrls,
          ...(remote?.audioUrls || {}),
        },
        audioClipIds: {
          ...local.audioClipIds,
          ...(remote?.audioClipIds || {}),
          ...(fromFlow.audioClipIds || {}),
        },
        segmentBodies: {
          ...local.segmentBodies,
          ...(remote?.segmentBodies || {}),
        },
        segmentApproved: {
          ...local.segmentApproved,
          ...(remote?.segmentApproved || {}),
        },
        approved: {
          ...local.approved,
          ...(remote?.approved || {}),
        },
        version: 2,
        updatedAt: new Date().toISOString(),
      };
      if (!cancelled) {
        setLib(merged);
        saveLibrary(consultantId, merged);
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId]);

  /** Espelha no fluxo WhatsApp sem o usuário precisar editar código. */
  const publishNow = useCallback(
    async (nextLib: SavedCadenceLibrary, opts?: { quiet?: boolean }) => {
      saveLibrary(consultantId, nextLib);
      const result = await publishCadenceLibrary(consultantId, nextLib, "A");
      if (!opts?.quiet) {
        if (result.errors.length) {
          toast({
            title: "Falha ao publicar no WhatsApp",
            description: result.errors.slice(0, 2).join(" · "),
            variant: "destructive",
          });
        } else {
          toast({
            title: "Publicado no fluxo WhatsApp",
            description:
              result.updated.length > 0
                ? `${result.updated.length} passo(s) atualizados (texto + botões).`
                : "Nada a sincronizar neste fluxo.",
          });
        }
      }
      return result;
    },
    [consultantId, toast],
  );

  const schedulePublish = useCallback(
    (nextLib: SavedCadenceLibrary) => {
      saveLibrary(consultantId, nextLib);
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
      publishTimerRef.current = setTimeout(() => {
        void publishNow(nextLib, { quiet: true }).catch((e) =>
          console.warn("[multichannel] auto-publish:", (e as Error)?.message),
        );
      }, 1200);
    },
    [consultantId, publishNow],
  );

  useEffect(() => {
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [selectedKey, previewGender]);

  const list = useMemo(() => {
    const base =
      group === "all"
        ? MULTICHANNEL_CADENCE_TEMPLATES
        : MULTICHANNEL_CADENCE_TEMPLATES.filter((t) => t.group === group);
    return base.filter((t) => !t.hiddenInPanel);
  }, [group]);

  const selected = useMemo(
    () => MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === selectedKey) ?? list[0],
    [selectedKey, list],
  );

  useEffect(() => {
    if (list.length && !list.some((t) => t.key === selectedKey)) {
      setSelectedKey(list[0].key);
    }
  }, [list, selectedKey]);

  const draftSegments = selected ? resolveAudioSegments(selected, lib) : [];
  const hasSegments = draftSegments.length > 0;
  /** Texto WhatsApp + áudio no mesmo passo (ex.: passo 3 unificado). */
  const isMixedMessageAudio =
    !!hasSegments &&
    selected?.channel !== "whatsapp_audio" &&
    selected?.channel !== "call_script";
  const genderAudioVariants = hasGenderAudioVariants(draftSegments);
  const previewSegments = genderAudioVariants
    ? filterSegmentsForGender(draftSegments, previewGender)
    : draftSegments;
  const draft = selected
    ? isMixedMessageAudio
      ? resolveBody(selected, lib)
      : genderAudioVariants
        ? joinAudioSegmentTexts(previewSegments)
        : resolveBody(selected, lib)
    : "";
  const draftButtons = selected ? resolveButtons(selected, lib) : [];
  const pairedAudioKey = selected?.pairedAudioKey;
  const audioLookupKey = selected?.canGenerateAudio
    ? selected.key
    : pairedAudioKey ?? null;
  const audioLookupNeedsGender = audioLookupKey
    ? hasGenderAudioVariants(
        MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === audioLookupKey)
          ?.audioSegments ?? [],
      )
    : false;
  const previewAudioUrl =
    audioUrl ||
    (audioLookupKey
      ? resolveCadenceAudioUrl(
          lib,
          audioLookupKey,
          audioLookupNeedsGender ? previewGender : null,
        ) ||
        (audioLookupKey === "a3_explain_with_buttons"
          ? resolveCadenceAudioUrl(lib, "a3_audio_explain", null)
          : undefined)
      : null) ||
    null;
  const showAudioAboveButtons =
    !!previewAudioUrl ||
    selected?.channel === "whatsapp_audio" ||
    !!pairedAudioKey ||
    (!!selected?.canGenerateAudio && hasSegments);
  const audioPlacement =
    selected?.audioPlacement ??
    (pairedAudioKey
      ? MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === pairedAudioKey)
          ?.audioPlacement
      : undefined) ??
    "before_text";
  const btnValidation = validateWhapiButtons(draftButtons);
  const billParsed = parseAverageBillValue(previewBill);
  const savings = billParsed.ok ? estimateSavingsRange(billParsed.value) : null;
  const previewVars = {
    nome: previewName,
    gender: previewGender,
    valorFormatado: billParsed.ok ? billParsed.formatted : previewBill,
    valorConta: billParsed.ok ? billParsed.formatted : previewBill,
    economiaMin: savings?.minFormatted,
    economiaMax: savings?.maxFormatted,
    economiaRange: savings
      ? `R$ ${savings.minFormatted} a R$ ${savings.maxFormatted}`
      : undefined,
    consultorPhone: consultantPhone || undefined,
  };
  const previewSource =
    selected?.channel === "sms" ? ensureSmsConsultorWaLink(draft) : draft;
  const preview = selected ? renderCadenceBody(previewSource, previewVars) : "";
  const avail = buildAvailabilityPhrase();
  const smsLen =
    selected?.channel === "sms"
      ? smsCharCount(draft, { consultorPhone: consultantPhone })
      : null;
  const segmentsReady = selected ? allAudioSegmentsApproved(selected, lib) : false;

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const first = previewName.trim().split(/\s+/)[0] || "";
      if (!first) {
        setNameInCache(false);
        return;
      }
      setPreviewGender(inferSpeechGender(first));
      const phrase = `Olá, ${first}.`;
      const prepared = prepareTtsSegment(phrase, MODEL_V3, { namePause: true }).trim();
      // prepared ≈ "Olá, Maria..." (final calmo)
      const hit = await getCachedTTS(prepared, VOICE_SOFIA_PROFESSIONAL, MODEL_V3);
      if (!cancelled) setNameInCache(!!hit);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [previewName]);

  const setDraft = (body: string) => {
    if (!selected || (hasSegments && !isMixedMessageAudio)) return;
    setLib((prev) => {
      const next = {
        ...prev,
        bodies: { ...prev.bodies, [selected.key]: body },
      };
      if (hydrated) schedulePublish(next);
      return next;
    });
  };

  const insertIntoDraft = (
    snippet: string,
    wrap?: { before: string; after: string },
  ) => {
    if (!selected || (hasSegments && !isMixedMessageAudio)) return;
    const el = draftTextareaRef.current;
    const value = draft;
    if (!el) {
      if (wrap) setDraft(`${value}${wrap.before}texto${wrap.after}`);
      else setDraft(`${value}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selectedText = value.slice(start, end);
    let next: string;
    let cursor: number;
    if (wrap) {
      const inner = selectedText || "texto";
      next = value.slice(0, start) + wrap.before + inner + wrap.after + value.slice(end);
      cursor = start + wrap.before.length + inner.length + wrap.after.length;
    } else {
      next = value.slice(0, start) + snippet + value.slice(end);
      cursor = start + snippet.length;
    }
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const setSegmentText = (segId: string, text: string) => {
    if (!selected) return;
    setLib((prev) => {
      const nextSegs = {
        ...(prev.segmentBodies[selected.key] ?? {}),
        [segId]: text,
      };
      const merged = (selected.audioSegments ?? []).map((s) => ({
        ...s,
        text: nextSegs[s.id] ?? s.text,
      }));
      return {
        ...prev,
        segmentBodies: { ...prev.segmentBodies, [selected.key]: nextSegs },
        bodies: {
          ...prev.bodies,
          // Em passo misto, bodies = texto WhatsApp (não sobrescrever com roteiro TTS)
          ...(selected.channel === "whatsapp_audio" || selected.channel === "call_script"
            ? { [selected.key]: joinAudioSegmentTexts(merged) }
            : {}),
        },
      };
    });
  };

  /** Insere {{nome}} no corte (cursor do textarea, se focado). */
  const insertNomeInSegment = (segId: string, current: string) => {
    const el = document.getElementById(`seg-ta-${segId}`) as HTMLTextAreaElement | null;
    const placeholder = "{{nome}}";
    if (!el) {
      const needsSpace = current.length > 0 && !/\s$/.test(current) && !current.endsWith(",");
      setSegmentText(segId, `${current}${needsSpace ? " " : ""}${placeholder}`);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + placeholder + current.slice(end);
    setSegmentText(segId, next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + placeholder.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleSegmentApproved = (segId: string, on: boolean) => {
    if (!selected) return;
    setLib((prev) => {
      const next = {
        ...prev,
        segmentApproved: {
          ...prev.segmentApproved,
          [selected.key]: {
            ...(prev.segmentApproved[selected.key] ?? {}),
            [segId]: on,
          },
        },
      };
      // Persiste na hora — senão o Ok some no refresh e parece "sempre errado".
      saveLibrary(consultantId, next);
      return next;
    });
  };

  const approveAllSegments = () => {
    if (!selected?.audioSegments?.length) return;
    const map: Record<string, boolean> = {};
    for (const s of selected.audioSegments) map[s.id] = true;
    setLib((prev) => {
      const next = {
        ...prev,
        segmentApproved: { ...prev.segmentApproved, [selected.key]: map },
        approved: { ...prev.approved, [selected.key]: true },
      };
      saveLibrary(consultantId, next);
      return next;
    });
    toast({ title: "Cortes aprovados", description: "Agora pode gerar o áudio Sofia." });
  };

  const setButtons = (buttons: CadenceButton[]) => {
    if (!selected) return;
    setLib((prev) => {
      const next = {
        ...prev,
        buttons: { ...prev.buttons, [selected.key]: buttons.slice(0, WHAPI_MAX_BUTTONS) },
      };
      if (hydrated) schedulePublish(next);
      return next;
    });
  };

  const updateButton = (idx: number, patch: Partial<CadenceButton>) => {
    const next = draftButtons.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    setButtons(next);
  };

  const addButton = () => {
    if (draftButtons.length >= WHAPI_MAX_BUTTONS) {
      toast({
        title: "Limite Whapi",
        description: `No máximo ${WHAPI_MAX_BUTTONS} botões por mensagem.`,
        variant: "destructive",
      });
      return;
    }
    setButtons([
      ...draftButtons,
      { id: `opt_${draftButtons.length + 1}`, title: "Novo" },
    ]);
  };

  const removeButton = (idx: number) => {
    setButtons(draftButtons.filter((_, i) => i !== idx));
  };

  const toggleApproved = (on: boolean) => {
    if (!selected) return;
    setLib((prev) => ({
      ...prev,
      approved: { ...prev.approved, [selected.key]: on },
    }));
  };

  const handleSave = async () => {
    const bad = MULTICHANNEL_CADENCE_TEMPLATES
      .map((t) => ({ t, v: validateWhapiButtons(resolveButtons(t, lib)) }))
      .filter((x) => !x.v.ok);
    if (bad.length) {
      toast({
        title: "Corrija os botões antes de salvar",
        description: bad.map((x) => x.t.key).slice(0, 3).join(", "),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await publishNow(lib);
    } catch (e: unknown) {
      toast({
        title: "Falha ao salvar",
        description: e instanceof Error ? e.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetOne = () => {
    if (!selected) return;
    setLib((prev) => {
      const bodies = { ...prev.bodies };
      const buttons = { ...prev.buttons };
      const segmentBodies = { ...prev.segmentBodies };
      const segmentApproved = { ...prev.segmentApproved };
      delete bodies[selected.key];
      delete buttons[selected.key];
      delete segmentBodies[selected.key];
      delete segmentApproved[selected.key];
      return { ...prev, bodies, buttons, segmentBodies, segmentApproved };
    });
    toast({ title: "Texto, cortes e botões restaurados ao padrão" });
  };

  const handleCopy = async () => {
    const lines = [preview];
    if (draftButtons.length) {
      lines.push("", "Botões Whapi:");
      draftButtons.forEach((b, i) => lines.push(`${i + 1}. [${b.id}] ${b.title}`));
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Prévia copiada" });
  };

  const generateAudio = useCallback(async () => {
    if (!selected?.canGenerateAudio) {
      toast({ title: "Este item não é roteiro de áudio", variant: "destructive" });
      return;
    }
    if (hasSegments && !allAudioSegmentsApproved(selected, lib)) {
      toast({
        title: "Aprove os cortes antes de gerar",
        description: "Marque cada bloco ou use “Aprovar todos os cortes”.",
        variant: "destructive",
      });
      return;
    }
    if (!hasSegments && !lib.approved[selected.key]) {
      toast({
        title: "Aprove o texto antes de gerar",
        description: "Ligue o switch Aprovado e depois gere o áudio.",
        variant: "destructive",
      });
      return;
    }

    const gendersToGenerate: Array<SpeechGender | null> = genderAudioVariants
      ? SPEECH_GENDERS
      : [null];

    setGenerating(true);
    setLastGenStats(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      let nextUrls = { ...lib.audioUrls };
      let nextClipIds = { ...lib.audioClipIds };
      let totalReused = 0;
      let totalGenerated = 0;
      let totalCuts = 0;
      let previewBlobUrl: string | null = null;

      for (const gender of gendersToGenerate) {
        const segsForRun =
          gender && hasSegments
            ? filterSegmentsForGender(draftSegments, gender)
            : draftSegments;
        const vars = { ...previewVars, gender: gender ?? previewGender };
        const spokenFull = hasSegments
          ? joinAudioSegmentTexts(
              segsForRun.map((s) => ({ text: spokenSegmentText(s, vars) })),
            ).trim()
          : renderCadenceBody(draft, vars).trim();
        if (spokenFull.length < 8) {
          throw new Error("Texto muito curto para gerar áudio.");
        }
        const spokenSegs = hasSegments
          ? segsForRun.map((s) => spokenSegmentText(s, vars)).filter(Boolean)
          : [spokenFull];

        const result = await generateSofiaSegmented({
          segments: spokenSegs,
          fullTextFallback: spokenFull,
          accessToken: token,
        });
        totalReused += result.reused;
        totalGenerated += result.generated;
        totalCuts += result.total;

        const storageKey = cadenceAudioUrlKey(selected.key, gender);
        const slug = `multichannel-${storageKey}`.slice(0, 80);
        const file = new File([result.blob], `${slug}.mp3`, { type: "audio/mpeg" });
        let publicUrl: string;
        try {
          const up = await uploadMedia(file, undefined, {
            scope: "admin",
            consultant_id: consultantId,
            kind: "audio",
            slug,
          });
          publicUrl = up.url;
        } catch {
          const path = `${consultantId}/multichannel/${storageKey}-${Date.now()}.mp3`;
          const { error: upErr } = await supabase.storage
            .from("ai-agent-media")
            .upload(path, result.blob, { upsert: false, contentType: "audio/mpeg" });
          if (upErr) throw upErr;
          publicUrl = supabase.storage.from("ai-agent-media").getPublicUrl(path).data.publicUrl;
        }

        const genderLabel = gender ? ` (${gender})` : "";
        const { data: clip, error: clipErr } = await supabase
          .from("voice_audio_clips")
          .insert({
            consultant_id: consultantId,
            name: `[Multicanal] ${selected.title}${genderLabel}`.slice(0, 120),
            audio_url: publicUrl,
            voice_id: VOICE_SOFIA_PROFESSIONAL,
            model_id: MODEL_V3,
            is_call_body: selected.channel === "call_script",
          })
          .select("id")
          .single();
        if (clipErr) throw clipErr;

        nextUrls = { ...nextUrls, [storageKey]: publicUrl };
        nextClipIds = {
          ...nextClipIds,
          [storageKey]: String((clip as { id: string }).id),
        };

        // Corpo fixo (sem nome) — motor costura Olá+nome (passo 2) ou só nome (3/4a) em runtime.
        const bodySegs = segsForRun.filter((s) => s.kind !== "name");
        if (bodySegs.length > 0 && hasSegments) {
          const bodySpoken = bodySegs
            .map((s) => spokenSegmentText(s, vars))
            .filter(Boolean);
          if (bodySpoken.length > 0) {
            const bodyResult = await generateSofiaSegmented({
              segments: bodySpoken,
              fullTextFallback: bodySpoken.join(" "),
              accessToken: token,
            });
            const bodyKey = cadenceBodyAudioUrlKey(selected.key, gender);
            const bodySlug = `multichannel-${bodyKey}`.slice(0, 80);
            const bodyFile = new File([bodyResult.blob], `${bodySlug}.mp3`, {
              type: "audio/mpeg",
            });
            let bodyUrl: string;
            try {
              const upBody = await uploadMedia(bodyFile, undefined, {
                scope: "admin",
                consultant_id: consultantId,
                kind: "audio",
                slug: bodySlug,
              });
              bodyUrl = upBody.url;
            } catch {
              const path = `${consultantId}/multichannel/${bodyKey}-${Date.now()}.mp3`;
              const { error: upErr } = await supabase.storage
                .from("ai-agent-media")
                .upload(path, bodyResult.blob, {
                  upsert: false,
                  contentType: "audio/mpeg",
                });
              if (upErr) throw upErr;
              bodyUrl = supabase.storage.from("ai-agent-media").getPublicUrl(path).data
                .publicUrl;
            }
            nextUrls = { ...nextUrls, [bodyKey]: bodyUrl };
            totalReused += bodyResult.reused;
            totalGenerated += bodyResult.generated;
            totalCuts += bodyResult.total;

            if (consultantId) {
              const bodyTextContent = bodySpoken.join("\n\n").trim();
              try {
                await supabase
                  .from("ai_media_library")
                  .update({ active: false, updated_at: new Date().toISOString() })
                  .eq("consultant_id", consultantId)
                  .eq("slot_key", bodyKey)
                  .eq("active", true);
                await supabase.from("ai_media_library").insert({
                  consultant_id: consultantId,
                  slot_key: bodyKey,
                  kind: "audio",
                  label: `Sofia corpo · ${selected.title}${genderLabel}`.slice(0, 120),
                  url: bodyUrl,
                  text_content: bodyTextContent.slice(0, 8000),
                  active: true,
                  send_order: 0,
                  is_draft: false,
                  is_public: false,
                  delay_before_ms: 0,
                  priority: 10,
                });
                await deactivatePersonalizedStitches(consultantId, selected.key);
              } catch (bodyMirrorErr) {
                console.warn("[multichannel] corpo ai_media_library:", bodyMirrorErr);
              }
            }
          }
        }

        // Alias legado do passo 3 unificado
        if (selected.key === "a3_explain_with_buttons") {
          const aliasKey = cadenceAudioUrlKey("a3_audio_explain", gender);
          nextUrls = { ...nextUrls, [aliasKey]: publicUrl };
          nextClipIds = {
            ...nextClipIds,
            [aliasKey]: String((clip as { id: string }).id),
          };
          if (!gender) {
            nextUrls = { ...nextUrls, a3_audio_explain: publicUrl };
            nextClipIds = {
              ...nextClipIds,
              a3_audio_explain: String((clip as { id: string }).id),
            };
          }
        }
        // Compat: chave sem sufixo = gênero da prévia (ou único áudio)
        if (!gender || gender === previewGender) {
          nextUrls = { ...nextUrls, [selected.key]: publicUrl };
          nextClipIds = {
            ...nextClipIds,
            [selected.key]: String((clip as { id: string }).id),
          };
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          previewBlobUrl = URL.createObjectURL(result.blob);
        }
      }

      if (previewBlobUrl) setAudioUrl(previewBlobUrl);
      setLastGenStats(
        genderAudioVariants
          ? `2 áudios M/F · ${totalReused}/${totalCuts} cortes do cache · ${totalGenerated} gerados`
          : `${totalReused}/${totalCuts} cortes do cache · ${totalGenerated} gerados (tokens)`,
      );

      const next: SavedCadenceLibrary = {
        ...lib,
        approved: { ...lib.approved, [selected.key]: true },
        audioUrls: nextUrls,
        audioClipIds: nextClipIds,
      };
      setLib(next);
      saveLibrary(consultantId, next);

      // Clip principal → passo do fluxo (referência do painel).
      const primaryClip =
        nextClipIds[selected.key] ||
        nextClipIds[cadenceAudioUrlKey(selected.key, previewGender)] ||
        nextClipIds[cadenceAudioUrlKey(selected.key, "feminino")] ||
        null;
      if (primaryClip && consultantId) {
        await attachVoiceClipToCadenceSteps(
          consultantId,
          selected.key,
          primaryClip,
          "A",
        ).catch((e) => console.warn("[multichannel] attach clip:", (e as Error)?.message));
      }

      // Espelha no ai_media_library.
      // A2/A3: NÃO gravar MP3 com nome da prévia no slot do fluxo (Rodrigo/Maria).
      // Corpos __body_* já foram gravados acima. A5 (sem nome) espelha normalmente.
      if (consultantId) {
        const slots = flowMediaSlotKeysForCadence(selected.key);
        const mirrorEntries: Array<{ slot: string; url: string; label: string }> = [];
        for (const slot of slots) {
          const preferred =
            nextUrls[cadenceAudioUrlKey(selected.key, "feminino")] ||
            nextUrls[selected.key] ||
            nextUrls[cadenceAudioUrlKey(selected.key, previewGender)] ||
            null;
          if (preferred) {
            mirrorEntries.push({
              slot,
              url: preferred,
              label: `Sofia multicanal · ${selected.title}`,
            });
          }
        }
        for (const entry of mirrorEntries) {
          try {
            await supabase
              .from("ai_media_library")
              .update({ active: false, updated_at: new Date().toISOString() })
              .eq("consultant_id", consultantId)
              .eq("slot_key", entry.slot)
              .eq("active", true);
            await supabase.from("ai_media_library").insert({
              consultant_id: consultantId,
              slot_key: entry.slot,
              kind: "audio",
              label: entry.label.slice(0, 120),
              url: entry.url,
              active: true,
              send_order: 0,
              is_draft: false,
              is_public: false,
              delay_before_ms: 0,
              priority: 10,
            });
          } catch (bodyMirrorErr) {
            console.warn("[multichannel] espelho ai_media_library:", bodyMirrorErr);
          }
        }
      }

      // Texto + botões + clips → fluxo WhatsApp (fonte da verdade).
      await publishNow(next, { quiet: true }).catch((e) =>
        console.warn("[multichannel] publish pós-gerar:", (e as Error)?.message),
      );

      toast({
        title: genderAudioVariants
          ? "Áudios gerados e publicados no fluxo"
          : "Áudio Sofia gerado e publicado no fluxo",
        description: genderAudioVariants
          ? "2 MP3 + corpos · texto/botões sincronizados no WhatsApp."
          : `${totalReused} cache · ${totalGenerated} novos · fluxo atualizado.`,
      });
    } catch (e: unknown) {
      toast({
        title: "Erro ao gerar áudio",
        description: e instanceof Error ? e.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [
    selected,
    hasSegments,
    genderAudioVariants,
    draft,
    draftSegments,
    previewVars,
    previewGender,
    audioUrl,
    consultantId,
    lib,
    toast,
  ]);

  const runTestSms = useCallback(async () => {
    if (!selected) return;
    const v = validateBrazilPhone(testPhone);
    if (!v.valid) {
      toast({ title: "Telefone inválido", description: v.message, variant: "destructive" });
      return;
    }
    const text = renderCadenceBody(resolveBody(selected, lib), previewVars).trim();
    if (!text) {
      toast({ title: "Mensagem vazia", description: "Escreva o texto antes de testar.", variant: "destructive" });
      return;
    }
    setTestBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-sms-send", {
        body: {
          recipients: [{ phone: v.normalized, name: previewName || "Teste" }],
          message: text,
          consultant_id: consultantId,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error && !data?.sent) throw new Error(String(data.message || data.error));
      const sent = Number(data?.sent ?? 0);
      if (sent === 0) {
        const firstErr = Array.isArray(data?.results)
          ? (data.results.find((r: { error?: string }) => r?.error)?.error as string | undefined)
          : undefined;
        throw new Error(firstErr || data?.message || "Falha ao enviar SMS");
      }
      toast({ title: "SMS enviado", description: `Para ${formatBrazilPhone(v.normalized)}` });
    } catch (e) {
      toast({ title: "Erro no SMS de teste", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTestBusy(false);
    }
  }, [selected, testPhone, lib, previewVars, previewName, consultantId, toast]);

  const runTestCall = useCallback(async () => {
    if (!selected) return;
    const v = validateBrazilPhone(testPhone);
    if (!v.valid) {
      toast({ title: "Telefone inválido", description: v.message, variant: "destructive" });
      return;
    }
    const clipKey = audioLookupKey && audioLookupNeedsGender
      ? cadenceAudioUrlKey(audioLookupKey, previewGender)
      : audioLookupKey || selected.key;
    const clipId =
      (clipKey && lib.audioClipIds?.[clipKey]) ||
      (audioLookupKey && lib.audioClipIds?.[audioLookupKey]) ||
      lib.audioClipIds?.[selected.key];
    if (!clipId) {
      toast({
        title: "Áudio não gerado",
        description: "Gere o áudio Sofia deste passo antes de fazer o teste de ligação.",
        variant: "destructive",
      });
      return;
    }
    setTestBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", {
        body: {
          action: "test_call",
          test_phone: v.normalized,
          test_name: previewName || "Teste",
          audio_clip_id: clipId,
          audio_url: previewAudioUrl,
          dispatch_kind: "audio",
          campaign_name: `Teste · ${selected.title}`,
          config: { sofia_test: true, source: "multichannel_panel" },
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.message || data.detail || data.error));
      toast({ title: "Sofia está ligando", description: `Atenda em ${formatBrazilPhone(v.normalized)}` });
    } catch (e) {
      toast({ title: "Erro na ligação de teste", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTestBusy(false);
    }
  }, [selected, testPhone, previewName, audioLookupKey, audioLookupNeedsGender, previewGender, lib, previewAudioUrl, toast]);

  const approvedCount = MULTICHANNEL_CADENCE_TEMPLATES.filter((t) => lib.approved[t.key]).length;
  const withButtons = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) => (t.buttons?.length ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Biblioteca Multicanal — Whapi + Sofia TTS</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Áudios Sofia em cortes (voz profissional obrigatória); só o <strong>nome novo</strong>{" "}
              gasta crédito. No 2a: 2 corpos (feminino / masculino). Envio automático OFF.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{MULTICHANNEL_CADENCE_TEMPLATES.length} textos</Badge>
            <Badge variant="outline">{withButtons} c/ botões</Badge>
            <Badge variant="outline">{approvedCount} aprovados</Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Disponibilidade agora ({avail.slot}): “{avail.phrase}”
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nome na prévia / TTS</Label>
          <Input
            className="w-40 h-9"
            value={previewName}
            onChange={(e) => setPreviewName(e.target.value)}
          />
          {nameInCache ? (
            <p className="text-[10px] text-emerald-700">Nome já no cache · 0 crédito</p>
          ) : (
            <p className="text-[10px] text-amber-700">Nome novo · 1 crédito na 1ª fala</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Gênero (fala)</Label>
          <Select
            value={previewGender}
            onValueChange={(v) => setPreviewGender(v as SpeechGender)}
          >
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feminino">Feminino (corpo)</SelectItem>
              <SelectItem value="masculino">Masculino (corpo)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor conta (teste)</Label>
          <Input
            className="w-32 h-9"
            value={previewBill}
            onChange={(e) => setPreviewBill(e.target.value)}
            placeholder="500 ou 500,00"
          />
          {billParsed.ok === false && (
            <p className="text-[10px] text-destructive max-w-[140px] leading-tight">
              {billParsed.message}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Voz TTS</Label>
          <div className="h-9 px-3 rounded-md border border-border/60 bg-muted/30 flex items-center gap-2 min-w-[220px]">
            <Badge variant="secondary" className="text-[10px]">
              Obrigatória
            </Badge>
            <span className="text-sm">Sofia · profissional</span>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar todos
        </Button>
      </div>

      <Tabs value={group} onValueChange={(v) => setGroup(v as CadenceGroup | "all")}>
        <TabsList className="flex-wrap h-auto">
          {GROUP_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={group} className="mt-3 space-y-3">
          {group === "B" && (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">
                Grupo B — reabrir leads que já estão no CRM
              </p>
              <p>
                Onda profissional (anti-spam): reabre no{" "}
                <span className="text-foreground font-medium">D+1</span>; SMS/ligação só se houver
                silêncio. Cap diário de frios na Central de Automações. Grupo A (lead novo) não é
                limitado.
              </p>
            </div>
          )}
          <div className="grid lg:grid-cols-[240px_minmax(0,1fr)_minmax(260px,290px)] gap-4 items-start">
            <div className="rounded-lg border border-border/50 max-h-[70vh] overflow-y-auto divide-y lg:max-h-[78vh]">
              {list.map((t) => {
                const ok =
                  !!lib.approved[t.key] ||
                  (t.canGenerateAudio && hasGeneratedCadenceAudio(t.key, lib));
                const nBtn = resolveButtons(t, lib).length;
                const nSeg = t.audioSegments?.length ?? 0;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedKey(t.key)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 hover:bg-secondary/40 transition-colors",
                      selected?.key === t.key && "bg-secondary/60",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">{t.title}</p>
                        <p className="text-[11px] text-foreground/80 mt-0.5 font-medium">
                          {t.timing}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {channelLabel(t.channel)}
                          {nSeg > 0 ? ` · ${nSeg} cortes de áudio` : ""}
                          {nBtn > 0 ? ` · ${nBtn} botão(ões)` : " · cliente digita"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div className="rounded-lg border border-border/50 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold">{selected.title}</h4>
                    <p className="text-xs text-foreground/90 mt-1 font-medium">
                      Horário de envio: {selected.timing}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Canal: {channelLabel(selected.channel)}
                    </p>
                    {selected.notes && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        {selected.notes}
                      </p>
                    )}
                    {selected.requiresApproval && (
                      <Badge variant="destructive" className="mt-2 text-[10px]">
                        Requer {selected.requiresApproval}=true
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="approved" className="text-xs">
                      Aprovado
                    </Label>
                    <Switch
                      id="approved"
                      checked={!!lib.approved[selected.key]}
                      onCheckedChange={toggleApproved}
                    />
                  </div>
                </div>

                {(selected.channel === "sms" || selected.channel === "call_script") && (
                  <div className="rounded-md border border-dashed border-emerald-500/50 bg-emerald-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      {selected.channel === "sms" ? (
                        <Send className="h-4 w-4 text-emerald-700" />
                      ) : (
                        <Phone className="h-4 w-4 text-emerald-700" />
                      )}
                      <Label className="text-xs font-semibold">
                        Teste {selected.channel === "sms" ? "de SMS" : "de ligação"} — envie para um número escolhido
                      </Label>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1 flex-1 min-w-[180px]">
                        <Label className="text-[11px] text-muted-foreground">
                          Celular (com DDD)
                        </Label>
                        <Input
                          className="h-9"
                          value={testPhone}
                          onChange={(e) => setTestPhone(e.target.value)}
                          placeholder="11 99999-9999"
                          inputMode="tel"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={selected.channel === "sms" ? runTestSms : runTestCall}
                        disabled={testBusy || !testPhone.trim()}
                        className="gap-1.5 h-9"
                        style={{ background: "var(--pe-emerald)", color: "#fff" }}
                      >
                        {testBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : selected.channel === "sms" ? (
                          <Send className="h-4 w-4" />
                        ) : (
                          <Phone className="h-4 w-4" />
                        )}
                        {selected.channel === "sms" ? "Enviar SMS de teste" : "Ligar agora (teste)"}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {selected.channel === "sms"
                        ? "Envia o texto atual (com variáveis substituídas) via Velip SMS para o número informado."
                        : "Usa o áudio Sofia já gerado deste passo. Se ainda não existir, gere o áudio primeiro."}
                    </p>
                  </div>
                )}


                {isMixedMessageAudio && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label>1 · Texto da simulação (valor + economia)</Label>
                      <span className="text-[10px] text-muted-foreground">
                        Ordem no WA: texto → áudio → botões
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Use{" "}
                      <code className="rounded bg-muted px-1">{"{{valor_conta}}"}</code> e{" "}
                      <code className="rounded bg-muted px-1">{"{{economia_range}}"}</code>{" "}
                      — a prévia preenche com o valor de teste ao lado.
                    </p>
                    <CadenceFormatToolbar onInsert={insertIntoDraft} />
                    <Textarea
                      ref={draftTextareaRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={8}
                      className="font-mono text-sm"
                      placeholder={
                        "Perfeito, {{nome}}!\n\nCom base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%*…\n\n(depois vem o áudio e os botões)"
                      }
                    />
                  </div>
                )}

                {hasSegments ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Label>
                          {isMixedMessageAudio
                            ? "2 · Cortes do áudio Sofia"
                            : "Cortes do áudio Sofia"}
                        </Label>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {isMixedMessageAudio ? (
                            <>
                              Ordem no WhatsApp: <strong>texto → áudio → botões</strong>. Áudio
                              = <strong>só o nome</strong> + explicação até{" "}
                              <strong>“É simples”</strong> (sem Então).
                            </>
                          ) : selected?.key === "a5_audio_club_benefits" ? (
                            <>
                              Passo 4 (benefício): <strong>só o nome</strong> no início → corpo
                              fixo do clube (sem Olá de novo).
                            </>
                          ) : selected?.key === "a2_audio_activate_name" ? (
                            <>
                              Passo 2: <strong>Olá + nome</strong> (1 corte variável) → corpo fixo
                              Sofia/Rafael gestor (M/F). Reutiliza cache de 200+ nomes.
                            </>
                          ) : (
                            <>
                              Passo 3: só o nome + explicação fixa. Passo 4a: só o nome + clube.
                            </>
                          )}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={approveAllSegments}
                      >
                        Aprovar todos os cortes
                      </Button>
                    </div>
                    {draftSegments.map((seg: AudioSegment) => {
                      const ok =
                        !!lib.segmentApproved[selected.key]?.[seg.id] ||
                        hasGeneratedCadenceAudio(selected.key, lib);
                      const spoken = spokenSegmentText(seg, previewVars);
                      const nameLead = /^então\b/i.test(spoken)
                        ? "Então"
                        : /^olá\b/i.test(spoken)
                          ? "Olá"
                          : null;
                      const kindLabel =
                        seg.kind === "name"
                          ? nameLead
                            ? `${nameLead} + nome · pausa`
                            : "Nome · pausa"
                          : seg.kind === "gendered"
                            ? "M/F · cache"
                            : seg.kind === "with_name"
                              ? "Nome · início"
                              : "Fixo · cache";
                      const lockedName = seg.kind === "name";
                      const firstNome = previewName.split(/\s+/)[0] || "Nome";
                      return (
                        <div
                          key={seg.id}
                          className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/10"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="text-sm font-medium truncate">{seg.label}</span>
                              <Badge
                                variant={
                                  seg.kind === "name" || seg.kind === "with_name"
                                    ? "outline"
                                    : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {kindLabel}
                              </Badge>
                              {seg.reusable && (
                                <Badge variant="outline" className="text-[10px]">
                                  Reutilizável
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs">Ok</Label>
                              <Switch
                                checked={ok}
                                onCheckedChange={(v) => toggleSegmentApproved(seg.id, v)}
                              />
                            </div>
                          </div>
                          {lockedName ? (
                            <div className="rounded-md border bg-background px-3 py-2 text-sm font-mono">
                              {spoken}
                              <p className="text-[10px] text-muted-foreground mt-1 font-sans">
                                {nameLead ? (
                                  <>
                                    TTS com pausa: “{nameLead}... {firstNome}...” — Olá + nome no
                                    mesmo corte (passo 2 · cache por nome).
                                  </>
                                ) : (
                                  <>
                                    Só o nome (passos 3 e 4a). Em seguida vem o corpo fixo salvo no
                                    painel — sem Olá nem “Então”.
                                  </>
                                )}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 text-[11px] font-mono"
                                  onClick={() => insertNomeInSegment(seg.id, seg.text)}
                                >
                                  {"{{nome}}"}
                                </Button>
                                <span className="text-[10px] text-muted-foreground">
                                  Clique para encaixar o nome da pessoa neste corte
                                </span>
                                {seg.text.includes("{{nome}}") && (
                                  <Badge variant="outline" className="text-[10px]">
                                    variável · cache por nome
                                  </Badge>
                                )}
                              </div>
                              <Textarea
                                id={`seg-ta-${seg.id}`}
                                value={seg.text}
                                onChange={(e) => setSegmentText(seg.id, e.target.value)}
                                rows={seg.kind === "gendered" || seg.kind === "with_name" ? 2 : 5}
                                className="font-mono text-sm"
                                placeholder='Ex.: Deixa eu te explicar, {{nome}}, de um jeito simples...'
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Na prévia/TTS, {"{{nome}}"} vira o primeiro nome (ex.:{" "}
                                <span className="font-mono">{firstNome}</span>). No passo 3 o
                                nome já entra no início do áudio; use aqui só se quiser
                                citar de novo na explicação.
                              </p>
                            </div>
                          )}
                          <div className="rounded border bg-background/50 p-2 max-h-24 overflow-y-auto">
                            <WhatsAppFormattedText
                              text={spoken}
                              className="text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-words"
                            />
                          </div>
                        </div>
                      );
                    })}
                    {!segmentsReady && (
                      <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>Aprove todos os cortes antes de gerar o áudio.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label>Texto da mensagem</Label>
                      {smsLen != null && (
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            smsLen > 160 ? "text-destructive font-medium" : "text-muted-foreground",
                          )}
                        >
                          SMS: {smsLen}/160
                        </span>
                      )}
                    </div>
                    <CadenceFormatToolbar onInsert={insertIntoDraft} />
                    <Textarea
                      ref={draftTextareaRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={selected.channel === "sms" ? 4 : 12}
                      className="font-mono text-sm"
                      placeholder="Use *negrito* e emojis — a prévia no celular atualiza ao vivo"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Dica: selecione um trecho e clique em <strong>B</strong> para *negrito* WhatsApp.
                    </p>
                  </div>
                )}

                {(selected.channel === "whatsapp_buttons" ||
                  selected.channel === "whatsapp_text" ||
                  draftButtons.length > 0) && (
                  <div className="space-y-2 rounded-md border border-border/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label>
                        {isMixedMessageAudio ? "3 · " : ""}
                        Botões Whapi ({draftButtons.length}/{WHAPI_MAX_BUTTONS})
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1 h-8"
                        onClick={addButton}
                        disabled={draftButtons.length >= WHAPI_MAX_BUTTONS}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Botão
                      </Button>
                    </div>
                    {draftButtons.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sem botões — mensagem só texto (ex.: pedir nome).
                      </p>
                    )}
                    {draftButtons.map((b, idx) => (
                      <div key={`${b.id}-${idx}`} className="flex flex-wrap items-center gap-2">
                        <Input
                          className="w-28 h-8 text-xs font-mono"
                          value={b.id}
                          onChange={(e) => updateButton(idx, { id: e.target.value })}
                          placeholder="id"
                        />
                        <Input
                          className="flex-1 min-w-[140px] h-8 text-sm"
                          value={b.title}
                          maxLength={WHAPI_MAX_BUTTON_TITLE}
                          onChange={(e) => updateButton(idx, { title: e.target.value })}
                          placeholder="título (máx 25)"
                        />
                        <span
                          className={cn(
                            "text-[10px] tabular-nums w-10",
                            b.title.length > WHAPI_MAX_BUTTON_TITLE
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {b.title.length}/{WHAPI_MAX_BUTTON_TITLE}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => removeButton(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {!btnValidation.ok && (
                      <div className="flex items-start gap-2 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{btnValidation.errors.join(" · ")}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="lg:hidden rounded-lg border border-border/50 bg-muted/20 p-3">
                  <CadenceMobilePreview
                    text={preview}
                    buttons={draftButtons}
                    channel={selected.channel}
                    contactName="Sofia · iGreen"
                    audioUrl={previewAudioUrl}
                    showAudio={showAudioAboveButtons}
                    audioPlacement={audioPlacement}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSave} disabled={saving} className="gap-2">
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Salvar
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={handleCopy}>
                    <Copy className="h-4 w-4" /> Copiar
                  </Button>
                  <Button type="button" variant="outline" className="gap-2" onClick={handleResetOne}>
                    <RotateCcw className="h-4 w-4" /> Restaurar
                  </Button>
                  {selected.canGenerateAudio && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="gap-2"
                      disabled={generating || (hasSegments ? !segmentsReady : !lib.approved[selected.key])}
                      onClick={() => void generateAudio()}
                    >
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                      {genderAudioVariants
                        ? "Aprovar e gerar Sofia (M + F)"
                        : "Aprovar e gerar Sofia"}
                    </Button>
                  )}
                  {(audioUrl ||
                    resolveCadenceAudioUrl(
                      lib,
                      selected.key,
                      genderAudioVariants ? previewGender : null,
                    )) && (
                    <Button type="button" variant="outline" className="gap-2" asChild>
                      <a
                        href={
                          audioUrl ||
                          resolveCadenceAudioUrl(
                            lib,
                            selected.key,
                            genderAudioVariants ? previewGender : null,
                          )
                        }
                        download={`${cadenceAudioUrlKey(selected.key, genderAudioVariants ? previewGender : null)}.mp3`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="h-4 w-4" /> Baixar áudio
                        {genderAudioVariants ? ` (${previewGender})` : ""}
                      </a>
                    </Button>
                  )}
                </div>

                {lastGenStats && (
                  <p className="text-xs text-muted-foreground">{lastGenStats}</p>
                )}
                {genderAudioVariants ? (
                  <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Áudios 2a por gênero (envio usa o da pessoa)
                    </p>
                    {SPEECH_GENDERS.map((g) => {
                      const url = resolveCadenceAudioUrl(lib, selected.key, g);
                      const clipId = lib.audioClipIds[cadenceAudioUrlKey(selected.key, g)];
                      return (
                        <div key={g} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant={g === previewGender ? "default" : "outline"}>
                              {g === "feminino" ? "Feminino · corpo fixo" : "Masculino · corpo fixo"}
                            </Badge>
                            {clipId && (
                              <span className="text-[10px] font-mono text-muted-foreground truncate">
                                {clipId.slice(0, 8)}…
                              </span>
                            )}
                          </div>
                          {url || (g === previewGender && audioUrl) ? (
                            <audio
                              controls
                              className="w-full"
                              src={(g === previewGender && audioUrl) || url}
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">Ainda não gerado</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    {lib.audioClipIds[selected.key] && (
                      <p className="text-[11px] text-muted-foreground font-mono">
                        clip_id: {lib.audioClipIds[selected.key]}
                        {lib.audioUrls[selected.key]
                          ? ` · url: ${lib.audioUrls[selected.key].slice(0, 64)}…`
                          : ""}
                      </p>
                    )}
                    {(audioUrl || lib.audioUrls[selected.key]) && (
                      <audio
                        controls
                        className="w-full"
                        src={audioUrl || lib.audioUrls[selected.key]}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {selected && (
              <div className="hidden lg:block sticky top-4 self-start">
                <CadenceMobilePreview
                  text={preview}
                  buttons={draftButtons}
                  channel={selected.channel}
                  contactName="Sofia · iGreen"
                  audioUrl={previewAudioUrl}
                  showAudio={showAudioAboveButtons}
                  audioPlacement={audioPlacement}
                />
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
