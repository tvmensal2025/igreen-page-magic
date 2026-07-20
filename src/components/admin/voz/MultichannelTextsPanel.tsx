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
  CadenceFlowStyleEditor,
  type CadenceEditorTab,
} from "@/components/admin/voz/CadenceFlowStyleEditor";
import { CadenceTimelineItem } from "@/components/admin/voz/CadenceTimelineItem";
import {
  CadenceSendOrderGuide,
  buildSendOrderSteps,
} from "@/components/admin/voz/CadenceSendOrderGuide";
import { CadenceAudioCutsPanel } from "@/components/admin/voz/CadenceAudioCutsPanel";
import { BUTTON_PRESETS } from "@/components/admin/flow-builder/flowTypes";
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
  availabilityOverridesFromLibrary,
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
  firstNameFromConsultantLabel,
  renderCadenceBody,
  unresolvedConsultantIdentityPlaceholders,
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
  themePlaceholderKind,
  themeBodyForPreview,
  ROTATING_CADENCE_THEMES,
  getTemplate,
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
import { CadenceMissingAlert } from "@/components/admin/CadenceMissingAlert";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertTriangle,
  Copy,
  Download,
  Loader2,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Volume2,
  Send,
  Phone,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { normalizeBrazilPhone, validateBrazilPhone, formatBrazilPhone } from "@/lib/phone";
import { whapiSendMedia } from "@/services/whapiApi";

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
  { id: "A", label: "Grupo A — Novo" },
  { id: "B", label: "Grupo B — Reaquecimento" },
  { id: "C", label: "Grupo C — Longo prazo" },
  { id: "theme", label: "Temas" },
  { id: "availability", label: "Disponibilidade" },
  { id: "all", label: "Todos" },
];

const CHANNEL_FILTERS: { id: CadenceTemplate["channel"]; emoji: string; label: string }[] = [
  { id: "whatsapp_text", emoji: "💬", label: "Texto" },
  { id: "whatsapp_buttons", emoji: "🔘", label: "Botões" },
  { id: "whatsapp_audio", emoji: "🎧", label: "Áudio" },
  { id: "sms", emoji: "📱", label: "SMS" },
  { id: "call_script", emoji: "📞", label: "Ligação" },
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
  const [group, setGroup] = useState<CadenceGroup | "all">(() => {
    try {
      const g = new URLSearchParams(window.location.search).get("cadenceGroup");
      if (g === "A" || g === "B" || g === "C" || g === "theme" || g === "availability") return g;
    } catch { /* noop */ }
    return "A";
  });
  const [selectedKey, setSelectedKey] = useState<string>("a1_ask_name");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<CadenceEditorTab>("conteudo");
  const [listQuery, setListQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [previewName, setPreviewName] = useState("Maria");
  const listSearchRef = useRef<HTMLInputElement | null>(null);
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
  /** Nome + IA dos Dados — usados na prévia e no TTS ({{consultor}} / {{assistente}}). */
  const [consultantDisplayName, setConsultantDisplayName] = useState("");
  const [consultantAssistantName, setConsultantAssistantName] = useState("");
  /** null = ainda carregando; true = bot + motor + live ligados. */
  const [autoDispatchLive, setAutoDispatchLive] = useState<boolean | null>(null);
  const consultantFirstName = firstNameFromConsultantLabel(consultantDisplayName);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewThemeId, setPreviewThemeId] = useState("simplified_analysis");
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  /** WhatsApp humano (alertas) — destino padrão do teste de áudio. */
  const [myWaPhone, setMyWaPhone] = useState("");
  const [waSendOpen, setWaSendOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("consultants")
        .select("notification_phone, phone, display_name, name, assistant_name")
        .eq("id", consultantId)
        .maybeSingle();
      if (cancelled) return;
      const mine =
        normalizeBrazilPhone(String(data?.notification_phone || "")) ||
        normalizeBrazilPhone(String(data?.phone || "")) ||
        "";
      if (mine) {
        setMyWaPhone(mine);
        setTestPhone((prev) => prev || formatBrazilPhone(mine));
      }
      const display = String(
        (data as { display_name?: string | null })?.display_name ||
          (data as { name?: string | null })?.name ||
          "",
      ).trim();
      setConsultantDisplayName(display);
      setConsultantAssistantName(
        String((data as { assistant_name?: string | null })?.assistant_name || "").trim(),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [appRes, reheatRes, toggleRes] = await Promise.all([
        supabase.from("app_settings").select("bot_global_enabled").eq("id", "global").maybeSingle(),
        supabase
          .from("daily_reheat_settings")
          .select("enabled, live_dispatch_enabled")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("automation_toggles")
          .select("enabled")
          .eq("key", "cadence_engine")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const botOn = !!(appRes.data as { bot_global_enabled?: boolean } | null)?.bot_global_enabled;
      const reheat = reheatRes.data as {
        enabled?: boolean;
        live_dispatch_enabled?: boolean;
      } | null;
      const engineOn = !!(toggleRes.data as { enabled?: boolean } | null)?.enabled;
      setAutoDispatchLive(
        botOn && !!reheat?.enabled && !!reheat?.live_dispatch_enabled && engineOn,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadLibrary(consultantId);
      const remote = await loadCadenceLibraryRemote(consultantId).catch(() => null);
      const fromFlow: Partial<SavedCadenceLibrary> = await loadCadenceLibraryFromBotFlow(consultantId, "A").catch(
        () => ({} as Partial<SavedCadenceLibrary>),
      );
      const fromStage: Partial<SavedCadenceLibrary> = await loadCadenceLibraryFromStageConfig(consultantId).catch(
        () => ({} as Partial<SavedCadenceLibrary>),
      );
      // Prioridade: motor (Grupo B + C) + fluxo WhatsApp (Grupo A) > remoto > localStorage.
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
          ...(fromStage.buttons || {}),
        },
        audioUrls: {
          ...local.audioUrls,
          ...(remote?.audioUrls || {}),
        },
        audioClipIds: {
          ...local.audioClipIds,
          ...(remote?.audioClipIds || {}),
          ...(fromFlow.audioClipIds || {}),
          ...(fromStage.audioClipIds || {}),
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
          const flowN = result.updated.filter((u) => !u.startsWith("motor:")).length;
          const motorN = result.updated.filter((u) => u.startsWith("motor:")).length;
          toast({
            title: "Publicado (ContentContract)",
            description:
              result.updated.length > 0
                ? `Grupo A: ${flowN} passo(s) no fluxo · Grupos B/C: ${motorN} estágio(s) no motor (texto + botões).`
                : "Nada a sincronizar neste fluxo/motor.",
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

  const filteredList = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return list.filter((t) => {
      if (channelFilter.size > 0 && !channelFilter.has(t.channel)) return false;
      if (!q) return true;
      const body = resolveBody(t, lib).toLowerCase();
      const btns = resolveButtons(t, lib)
        .map((b) => `${b.id} ${b.title}`)
        .join(" ")
        .toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        t.timing.toLowerCase().includes(q) ||
        body.includes(q) ||
        btns.includes(q) ||
        channelLabel(t.channel).toLowerCase().includes(q)
      );
    });
  }, [list, listQuery, channelFilter, lib]);

  const selected = useMemo(
    () => MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === selectedKey) ?? list[0],
    [selectedKey, list],
  );

  useEffect(() => {
    if (list.length && !list.some((t) => t.key === selectedKey)) {
      setSelectedKey(list[0].key);
    }
  }, [list, selectedKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        listSearchRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === listSearchRef.current) {
        setListQuery("");
        listSearchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openInspector = (key: string, tab: CadenceEditorTab = "conteudo") => {
    setSelectedKey(key);
    setInspectorTab(tab);
    setInspectorOpen(true);
  };

  // Deep-link pizza / Motor → toque Multicanal (?cadenceKey= ou sessionStorage / event).
  useEffect(() => {
    const focusKey = (key: string, tab?: CadenceEditorTab) => {
      const tpl = getTemplate(key);
      if (!tpl) return;
      setGroup(tpl.group);
      openInspector(key, tab || (tpl.channel === "call_script" ? "midias" : "conteudo"));
    };
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("cadenceKey");
      const fromSs = sessionStorage.getItem("igreen-multichannel-focus-key");
      const key = fromUrl || fromSs;
      if (key) {
        focusKey(key);
        sessionStorage.removeItem("igreen-multichannel-focus-key");
      }
    } catch { /* noop */ }
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string; tab?: CadenceEditorTab } | undefined;
      if (detail?.key) focusKey(detail.key, detail.tab);
    };
    window.addEventListener("igreen-multichannel-focus", onFocus);
    return () => window.removeEventListener("igreen-multichannel-focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no mount + listener
  }, []);

  const draftSegments = selected ? resolveAudioSegments(selected, lib) : [];
  const hasSegments = draftSegments.length > 0;
  /** Texto WhatsApp + áudio no mesmo passo (ex.: passo 3 unificado). */
  const isMixedMessageAudio =
    !!hasSegments &&
    selected?.channel !== "whatsapp_audio" &&
    selected?.channel !== "call_script";
  /** Toque só de áudio (2a / 4a) — roteiro mora na aba Mídia. */
  const isAudioOnlyStep =
    selected?.channel === "whatsapp_audio" || selected?.channel === "call_script";
  const pairedTpl = selected?.pairedAudioKey
    ? getTemplate(selected.pairedAudioKey)
    : null;
  const pairedSegments = pairedTpl ? resolveAudioSegments(pairedTpl, lib) : [];
  const listIdx = selected ? list.findIndex((t) => t.key === selected.key) : -1;
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
  const sendOrderSteps = selected
    ? buildSendOrderSteps(selected, {
        hasButtons: draftButtons.length > 0 || selected.channel === "whatsapp_buttons",
        textDone: !!resolveBody(selected, lib).trim(),
        audioDone:
          hasGeneratedCadenceAudio(selected.key, lib) ||
          (!!selected.pairedAudioKey &&
            hasGeneratedCadenceAudio(selected.pairedAudioKey, lib)),
        buttonsDone: draftButtons.length > 0,
      })
    : [];
  const themePreviewMeta =
    ROTATING_CADENCE_THEMES.find((t) => t.id === previewThemeId) ||
    ROTATING_CADENCE_THEMES[0]!;
  const themeWaTpl = getTemplate(themePreviewMeta.waKey);
  // themeSlot é calculado depois do draft — botões da prévia usam o tema escolhido no Dia 2/7.
  const themeSlotEarly = selected ? themePlaceholderKind(resolveBody(selected, lib)) : null;
  const previewButtons =
    themeSlotEarly === "wa" && themeWaTpl
      ? resolveButtons(themeWaTpl, lib)
      : draftButtons;
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
    consultor: consultantFirstName || undefined,
    assistente: consultantAssistantName || undefined,
    availabilityOverrides: availabilityOverridesFromLibrary(lib),
  };
  const themeSlot = themePlaceholderKind(draft);
  const previewSource = themeSlot
    ? themeBodyForPreview(previewThemeId, themeSlot, lib)
    : selected?.channel === "sms"
      ? ensureSmsConsultorWaLink(draft)
      : draft;
  const preview = selected ? renderCadenceBody(previewSource, previewVars) : "";
  const avail = buildAvailabilityPhrase(
    new Date(),
    availabilityOverridesFromLibrary(lib),
  );
  const smsLen =
    selected?.channel === "sms"
      ? smsCharCount(
          themeSlot ? themeBodyForPreview(previewThemeId, "sms", lib) : draft,
          { consultorPhone: consultantPhone },
        )
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
      const phrase = `Olá, ${first}! Tudo bem?`;
      const prepared = prepareTtsSegment(phrase, MODEL_V3, { namePause: true }).trim();
      // prepared ≈ “Olá, Maria! Tudo bem?” (igual ligação)
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

  const addButton = (preset?: { id: string; title: string; emoji?: string }) => {
    if (draftButtons.length >= WHAPI_MAX_BUTTONS) {
      toast({
        title: "Limite iGreen Chat",
        description: `No máximo ${WHAPI_MAX_BUTTONS} botões por mensagem.`,
        variant: "destructive",
      });
      return;
    }
    if (preset) {
      if (draftButtons.some((b) => b.id === preset.id)) return;
      const title = preset.emoji
        ? `${preset.emoji} ${preset.title}`.slice(0, WHAPI_MAX_BUTTON_TITLE)
        : preset.title.slice(0, WHAPI_MAX_BUTTON_TITLE);
      setButtons([...draftButtons, { id: preset.id, title }]);
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
      lines.push("", "Botões iGreen Chat:");
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
        const missingIdentity = unresolvedConsultantIdentityPlaceholders(spokenFull);
        if (missingIdentity.length) {
          throw new Error(
            "Preencha em Dados o nome (como o lead te chama) e o nome da IA antes de gerar áudio. " +
              `Faltando: ${missingIdentity.join(", ")}.`,
          );
        }
        const spokenSegs = hasSegments
          ? segsForRun.map((s) => spokenSegmentText(s, vars)).filter(Boolean)
          : [spokenFull];
        for (const seg of spokenSegs) {
          const miss = unresolvedConsultantIdentityPlaceholders(seg);
          if (miss.length) {
            throw new Error(
              "Preencha em Dados o nome e o nome da IA antes de gerar áudio. " +
                `Faltando: ${miss.join(", ")}.`,
            );
          }
        }

        const result = await generateSofiaSegmented({
          segments: spokenSegs,
          fullTextFallback: spokenFull,
          accessToken: token,
        });
        totalReused += result.reused;
        totalGenerated += result.generated;
        totalCuts += result.total;

        // Ligação: o clip do Motor deve ser SÓ o corpo (sem nome).
        // Runtime costura “Olá, Nome! Tudo bem?” + corpo (personalize_name).
        const bodySegs = hasSegments
          ? segsForRun.filter((s) => s.kind !== "name")
          : [];
        let bodyUrlForCall: string | null = null;
        let bodyBlobForCall: Blob | null = null;
        if (bodySegs.length > 0) {
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
            try {
              const upBody = await uploadMedia(bodyFile, undefined, {
                scope: "admin",
                consultant_id: consultantId,
                kind: "audio",
                slug: bodySlug,
              });
              bodyUrlForCall = upBody.url;
            } catch {
              const path = `${consultantId}/multichannel/${bodyKey}-${Date.now()}.mp3`;
              const { error: upErr } = await supabase.storage
                .from("ai-agent-media")
                .upload(path, bodyResult.blob, {
                  upsert: false,
                  contentType: "audio/mpeg",
                });
              if (upErr) throw upErr;
              bodyUrlForCall = supabase.storage.from("ai-agent-media").getPublicUrl(path).data
                .publicUrl;
            }
            bodyBlobForCall = bodyResult.blob;
            nextUrls = { ...nextUrls, [bodyKey]: bodyUrlForCall };
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
                  label: `Sofia corpo · ${selected.title}${gender ? ` (${gender})` : ""}`.slice(0, 120),
                  url: bodyUrlForCall,
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

        const isCall = selected.channel === "call_script";
        const clipBlob = isCall && bodyBlobForCall ? bodyBlobForCall : result.blob;
        const storageKey = cadenceAudioUrlKey(selected.key, gender);
        const slug = `multichannel-${storageKey}${isCall ? "-body" : ""}`.slice(0, 80);
        const file = new File([clipBlob], `${slug}.mp3`, { type: "audio/mpeg" });
        let publicUrl: string;
        if (isCall && bodyUrlForCall) {
          publicUrl = bodyUrlForCall;
        } else {
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
              .upload(path, clipBlob, { upsert: false, contentType: "audio/mpeg" });
            if (upErr) throw upErr;
            publicUrl = supabase.storage.from("ai-agent-media").getPublicUrl(path).data.publicUrl;
          }
        }

        const genderLabel = gender ? ` (${gender})` : "";
        const { data: clip, error: clipErr } = await supabase
          .from("voice_audio_clips")
          .insert({
            consultant_id: consultantId,
            name: `[Multicanal] ${selected.title}${genderLabel}${isCall ? " · corpo" : ""}`.slice(0, 120),
            audio_url: publicUrl,
            voice_id: VOICE_SOFIA_PROFESSIONAL,
            model_id: MODEL_V3,
            is_call_body: isCall,
          })
          .select("id")
          .single();
        if (clipErr) throw clipErr;

        nextUrls = { ...nextUrls, [storageKey]: publicUrl };
        nextClipIds = {
          ...nextClipIds,
          [storageKey]: String((clip as { id: string }).id),
        };

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

  /** URL pública do áudio (nunca blob:) — necessária para Whapi enviar. */
  const resolvePublicAudioUrl = useCallback((): string | null => {
    if (!selected) return null;
    const gender = audioLookupNeedsGender || genderAudioVariants ? previewGender : null;
    const key = audioLookupKey || selected.key;
    const fromLib =
      resolveCadenceAudioUrl(lib, key, gender) ||
      resolveCadenceAudioUrl(lib, selected.key, gender) ||
      (key === "a3_explain_with_buttons"
        ? resolveCadenceAudioUrl(lib, "a3_audio_explain", null)
        : null);
    if (fromLib && !fromLib.startsWith("blob:")) return fromLib;
    if (audioUrl && !audioUrl.startsWith("blob:")) return audioUrl;
    return null;
  }, [
    selected,
    audioLookupKey,
    audioLookupNeedsGender,
    genderAudioVariants,
    previewGender,
    lib,
    audioUrl,
  ]);

  const runTestWhatsAppAudio = useCallback(
    async (phoneOverride?: string) => {
      if (!selected) return;
      const raw = phoneOverride ?? testPhone;
      const v = validateBrazilPhone(raw);
      if (!v.valid) {
        toast({ title: "Telefone inválido", description: v.message, variant: "destructive" });
        return;
      }
      const mediaUrl = resolvePublicAudioUrl();
      if (!mediaUrl) {
        toast({
          title: "Áudio não disponível",
          description: "Gere o áudio Sofia deste passo (Aprovar e gerar) antes de enviar no WhatsApp.",
          variant: "destructive",
        });
        return;
      }
      setTestBusy(true);
      try {
        await whapiSendMedia(
          v.normalized,
          mediaUrl,
          "audio",
          undefined,
          `${cadenceAudioUrlKey(selected.key, genderAudioVariants ? previewGender : null)}.mp3`,
          { intent: "reply" },
        );
        toast({
          title: "Áudio enviado no WhatsApp",
          description: `Para ${formatBrazilPhone(v.normalized)}`,
        });
        setWaSendOpen(false);
      } catch (e) {
        toast({
          title: "Erro ao enviar áudio",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        setTestBusy(false);
      }
    },
    [
      selected,
      testPhone,
      resolvePublicAudioUrl,
      genderAudioVariants,
      previewGender,
      toast,
    ],
  );

  const approvedCount = MULTICHANNEL_CADENCE_TEMPLATES.filter((t) => lib.approved[t.key]).length;
  const withButtons = MULTICHANNEL_CADENCE_TEMPLATES.filter(
    (t) => (t.buttons?.length ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-3">
      <CadenceMissingAlert />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/50 pb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">Biblioteca Multicanal</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Clique no toque para editar · Sofia em cortes · envio automático{" "}
            {autoDispatchLive === null ? "…" : autoDispatchLive ? "ON" : "OFF"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            Agora ({avail.slot}): “{avail.phrase}”
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="h-5 text-[10px]">
            {MULTICHANNEL_CADENCE_TEMPLATES.length} textos
          </Badge>
          <Badge variant="outline" className="h-5 text-[10px]">
            {withButtons} botões
          </Badge>
          <Badge variant="outline" className="h-5 text-[10px]">
            {approvedCount} ok
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Nome / TTS</Label>
          <Input
            className="h-8 w-36 text-sm"
            value={previewName}
            onChange={(e) => setPreviewName(e.target.value)}
          />
          <p className={cn("text-[9px]", nameInCache ? "text-emerald-700" : "text-amber-700")}>
            {nameInCache ? "cache · 0 crédito" : "novo · 1 crédito"}
          </p>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Gênero</Label>
          <Select
            value={previewGender}
            onValueChange={(v) => setPreviewGender(v as SpeechGender)}
          >
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feminino">Feminino</SelectItem>
              <SelectItem value="masculino">Masculino</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Conta (teste)</Label>
          <Input
            className="h-8 w-28 text-sm"
            value={previewBill}
            onChange={(e) => setPreviewBill(e.target.value)}
            placeholder="500"
          />
        </div>
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/50 bg-muted/25 px-2.5 text-[11px] text-muted-foreground">
          Sofia · profissional
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="h-8 gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar
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
                Grupo B — Reaquecimento (lead frio)
              </p>
              <p>
                Lead que já está no CRM e parou. Onda curta D+1→D10: reabre no{" "}
                <span className="text-foreground font-medium">D+1</span>; SMS/ligação só se houver
                silêncio. Cap diário na Central de Automações. Grupo A (lead novo) não é limitado.
              </p>
              <p className="text-foreground/90">
                Ao publicar: texto + botões (máx. 3) vão para{" "}
                <span className="font-medium">cadence_stage_config</span> — mesmo contrato de
                conteúdo do Construtor de Fluxos. O motor (cadence-tick) continua no tempo/estágio;
                se o botão for inválido, usa o fallback padrão.
              </p>
            </div>
          )}
          {group === "C" && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">
                Grupo C — Longo prazo (Meta + recalls)
              </p>
              <p>
                Começa após o Dia 10 (fim da onda B).{" "}
                <span className="text-foreground font-medium">Meta</span> = sync de público + remarketing
                (~15d).{" "}
                <span className="text-foreground font-medium">Cada marco longo</span> = WhatsApp com
                análise → SMS se silêncio → ligação Sofia se silêncio (60d, 90d, 5m, 8m, 12m, anual).
                Toggles de recall/Meta na Central de Automações / Motor.
              </p>
              <p className="text-foreground/90">
                Ao publicar: textos/botões WA sincronizam no motor (ContentContract). SMS/call
                texto; ligação também publica o clip Sofia no motor. Executor: cadence-tick — sem misturar com o grafo do Grupo A.
              </p>
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div className="min-w-0 space-y-2">
              <div className="sticky top-0 z-[5] space-y-1.5 rounded-lg border border-border/60 bg-background/90 px-2.5 py-1.5 backdrop-blur">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={listSearchRef}
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                      placeholder="Buscar toque…  ( / )"
                      className="h-7 border-0 bg-transparent pl-7 text-xs shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {filteredList.length}/{list.length}
                  </span>
                  {(listQuery.trim() || channelFilter.size > 0) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10px]"
                      onClick={() => {
                        setListQuery("");
                        setChannelFilter(new Set());
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {CHANNEL_FILTERS.map((ch) => {
                    const active = channelFilter.has(ch.id);
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => {
                          setChannelFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(ch.id)) next.delete(ch.id);
                            else next.add(ch.id);
                            return next;
                          });
                        }}
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] transition-colors",
                          active
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-transparent bg-muted/50 text-muted-foreground hover:border-border",
                        )}
                      >
                        <span>{ch.emoji}</span>
                        <span className="hidden sm:inline">{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto pr-1 lg:max-h-[78vh] space-y-0">
                {filteredList.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                    <p className="text-sm font-medium text-foreground">Nenhum toque encontrado</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ajuste a busca ou limpe os filtros de canal.
                    </p>
                  </div>
                ) : (
                  filteredList.map((t, idx) => {
                    const ok =
                      !!lib.approved[t.key] ||
                      (t.canGenerateAudio && hasGeneratedCadenceAudio(t.key, lib));
                    const nBtn = resolveButtons(t, lib).length;
                    const nSeg = t.audioSegments?.length ?? 0;
                    const snippet = renderCadenceBody(
                      resolveBody(t, lib),
                      previewVars,
                    )
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 90);
                    return (
                      <CadenceTimelineItem
                        key={t.key}
                        position={idx + 1}
                        template={t}
                        previewText={snippet}
                        selected={selected?.key === t.key}
                        isLast={idx === filteredList.length - 1}
                        approved={ok}
                        buttonCount={nBtn}
                        segmentCount={nSeg}
                        onSelect={() => setSelectedKey(t.key)}
                        onEdit={() => openInspector(t.key)}
                        onJumpLinked={(key) => {
                          setSelectedKey(key);
                          openInspector(key);
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>

            {selected && (
              <div className="sticky top-3 hidden self-start lg:block">
                <div className="overflow-hidden rounded-xl border border-border/60 bg-gradient-to-b from-card to-muted/20 p-2.5 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold">{selected.title}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {selected.timing}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                      onClick={() => openInspector(selected.key)}
                    >
                      <Pencil className="h-3 w-3" />
                      Editar
                    </Button>
                  </div>
                  <CadenceMobilePreview
                    text={preview}
                    buttons={previewButtons}
                    channel={selected.channel}
                    contactName="Sofia · iGreen"
                    audioUrl={previewAudioUrl}
                    showAudio={showAudioAboveButtons}
                    audioPlacement={audioPlacement}
                    className="max-w-none"
                  />
                </div>
              </div>
            )}
          </div>

            {selected && (
              <CadenceFlowStyleEditor
                open={inspectorOpen}
                onClose={() => setInspectorOpen(false)}
                stepKey={selected.key}
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                title={`#${Math.max(1, listIdx + 1)} · ${selected.title}`}
                description={`${selected.timing} · ${channelLabel(selected.channel)} · use tela cheia para prévia ao lado`}
                preview={(
                  <CadenceMobilePreview
                    text={preview}
                    buttons={previewButtons}
                    channel={selected.channel}
                    contactName="Sofia · iGreen"
                    audioUrl={previewAudioUrl}
                    showAudio={showAudioAboveButtons}
                    audioPlacement={audioPlacement}
                  />
                )}
                contentTab={(
                  <>
                <CadenceSendOrderGuide
                  steps={sendOrderSteps}
                  activeTab={inspectorTab}
                  onGoTab={setInspectorTab}
                />

                {selected.linkedToStepKey && (
                  <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.04] px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                    Erro OCR ligado a{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => openInspector(selected.linkedToStepKey!)}
                    >
                      {getTemplate(selected.linkedToStepKey)?.title ?? selected.linkedToStepKey}
                    </button>
                    . Não avança o funil — só reenvia e continua aguardando a foto.
                    Gere áudio opcional na aba Mídia.
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-border/60 px-2.5 py-2">
                  <Label htmlFor="approved" className="text-xs font-medium">
                    Aprovado
                  </Label>
                  <Switch
                    id="approved"
                    checked={!!lib.approved[selected.key]}
                    onCheckedChange={toggleApproved}
                    className="scale-90"
                  />
                </div>

                {selected.notes && (
                  <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <p className="text-[11px] leading-snug text-muted-foreground">{selected.notes}</p>
                  </div>
                )}

                {selected.channel === "system" && selected.group === "C" && (
                  <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground flex gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-info" />
                    <span>
                      Card informativo do Grupo C — <strong className="text-foreground">não envia mensagem</strong> ao
                      lead. Use para documentar Meta/sync. Toggles na Central de Automações e clip de ligação no Motor.
                    </span>
                  </div>
                )}

                {(selected.channel === "sms" || selected.channel === "call_script") && (
                  <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      {selected.channel === "sms" ? (
                        <Send className="h-4 w-4 text-primary" />
                      ) : (
                        <Phone className="h-4 w-4 text-primary" />
                      )}
                      <Label className="text-sm font-semibold">
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
                        ? "Envia o texto atual (com variáveis substituídas) via SMS iGreen Fone para o número informado."
                        : "Usa o áudio Sofia já gerado deste passo. Se ainda não existir, gere o áudio primeiro."}
                    </p>
                  </div>
                )}


                {isAudioOnlyStep ? (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
                    Roteiro e MP3 na aba{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setInspectorTab("midias")}
                    >
                      Mídia
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {isMixedMessageAudio && (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Texto após o áudio · use{" "}
                        <code className="rounded bg-muted px-1 text-[10px]">{"{{valor_conta}}"}</code>{" "}
                        e{" "}
                        <code className="rounded bg-muted px-1 text-[10px]">{"{{economia_range}}"}</code>
                      </p>
                    )}
                    {themeSlot && (
                      <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2.5 text-xs space-y-2">
                        <div>
                          <p className="font-semibold text-foreground">
                            Temas que o motor pode enviar neste passo
                          </p>
                          <p className="text-muted-foreground leading-relaxed mt-1">
                            No Dia 2/7, se o lead ficou em silêncio, o motor escolhe{" "}
                            <strong className="text-foreground">um</strong> destes temas.
                            Clique para ver na prévia — sem editar aqui.
                          </p>
                        </div>
                        <div className="grid gap-1.5">
                          {ROTATING_CADENCE_THEMES.map((t, idx) => {
                            const active = previewThemeId === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => setPreviewThemeId(t.id)}
                                className={cn(
                                  "text-left rounded-md border px-2.5 py-2 transition-colors",
                                  active
                                    ? "border-sky-600 bg-sky-500/15 text-foreground"
                                    : "border-border/60 bg-background/60 hover:bg-muted/50 text-muted-foreground",
                                )}
                              >
                                <span className="font-medium text-foreground">
                                  {idx + 1}. {t.label}
                                </span>
                                <span className="block text-[10px] mt-0.5 opacity-80">
                                  id: {t.id}
                                  {active ? " · vendo na prévia →" : ""}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {!themeSlot && (
                      <>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Label className="text-sm">
                            {isMixedMessageAudio
                              ? "Texto da simulação (valor + economia)"
                              : "Texto da mensagem"}
                          </Label>
                          {smsLen != null && (
                            <span
                              className={cn(
                                "text-xs tabular-nums",
                                smsLen > 160
                                  ? "text-destructive font-medium"
                                  : "text-muted-foreground",
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
                          rows={selected.channel === "sms" ? 3 : isMixedMessageAudio ? 6 : 8}
                          className="min-h-0 resize-y text-[13px] leading-snug"
                          placeholder="Use *negrito* e emojis — a prévia no celular atualiza ao vivo"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Dica: selecione um trecho e clique em <strong>B</strong> para *negrito*
                          WhatsApp. Variáveis:{" "}
                          <code className="rounded bg-muted px-1">{"{{nome}}"}</code>
                        </p>
                      </>
                    )}
                    {themeSlot && smsLen != null && (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        SMS do tema selecionado: {smsLen}/160
                      </p>
                    )}
                    {selected.pairedAudioKey && (
                      <button
                        type="button"
                        onClick={() => setInspectorTab("midias")}
                        className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
                      >
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>
                          Áudio deste toque vem de{" "}
                          <strong className="text-foreground">
                            {pairedTpl?.title ?? selected.pairedAudioKey}
                          </strong>
                          {" — "}abra a aba Mídia
                        </span>
                      </button>
                    )}
                  </div>
                )}

                  </>
                )}
                buttonsTab={(
                  <>
                <p className="text-[11px] text-muted-foreground">
                  Máx. {WHAPI_MAX_BUTTONS} · título ≤ {WHAPI_MAX_BUTTON_TITLE}
                </p>

                {themeSlot ||
                (selected.channel !== "whatsapp_buttons" &&
                  selected.channel !== "whatsapp_text" &&
                  selected.channel !== "whatsapp_audio" &&
                  draftButtons.length === 0) ? (
                  <div className="rounded-lg border border-dashed bg-muted/15 px-3 py-5 text-center text-[12px] text-muted-foreground">
                    Este toque não usa botões.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap gap-1">
                      {BUTTON_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={
                            draftButtons.length >= WHAPI_MAX_BUTTONS ||
                            draftButtons.some((b) => b.id === p.id)
                          }
                          onClick={() => addButton(p)}
                          className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-35"
                        >
                          {p.emoji} {p.title}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">
                        Botões ({draftButtons.length}/{WHAPI_MAX_BUTTONS})
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => addButton()}
                        disabled={draftButtons.length >= WHAPI_MAX_BUTTONS}
                      >
                        <Plus className="h-3 w-3" />
                        Botão
                      </Button>
                    </div>

                    {draftButtons.length === 0 ? (
                      <div className="rounded-lg border border-dashed bg-muted/15 px-3 py-5 text-center text-[12px] text-muted-foreground">
                        Sem botões — use um preset ou “+ Botão”.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {draftButtons.map((b, idx) => (
                          <div
                            key={`${b.id}-${idx}`}
                            className="space-y-1.5 rounded-lg border border-border/60 bg-card/70 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="secondary" className="h-4 text-[9px]">
                                #{idx + 1}
                              </Badge>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive"
                                onClick={() => removeButton(idx)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-[88px_1fr] gap-1.5">
                              <Input
                                className="h-7 font-mono text-[11px]"
                                value={b.id}
                                onChange={(e) => updateButton(idx, { id: e.target.value })}
                                placeholder="id"
                              />
                              <div className="relative">
                                <Input
                                  className="h-7 pr-10 text-[12px]"
                                  value={b.title}
                                  maxLength={WHAPI_MAX_BUTTON_TITLE}
                                  onChange={(e) => updateButton(idx, { title: e.target.value })}
                                  placeholder="título"
                                />
                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] tabular-nums text-muted-foreground">
                                  {b.title.length}/{WHAPI_MAX_BUTTON_TITLE}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!btnValidation.ok && (
                      <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{btnValidation.errors.join(" · ")}</span>
                      </div>
                    )}
                  </div>
                )}
                  </>
                )}
                mediaTab={(
                  <>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Cortes TTS · gerar MP3 · teste WA
                  {(selected.audioPlacement === "before_text" || selected.pairedAudioKey) &&
                    " · ordem: áudio → texto → botões"}
                  {selected.audioPlacement === "after_text" && " · ordem: texto → áudio → botões"}
                </p>

                {pairedTpl && !hasSegments && (
                  <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Label className="flex items-center gap-1 text-xs">
                          <Link2 className="h-3 w-3" />
                          Áudio pareado
                        </Label>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {pairedTpl.title}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 shrink-0 text-[11px]"
                        onClick={() => openInspector(pairedTpl.key, "midias")}
                      >
                        Editar
                      </Button>
                    </div>
                    {pairedSegments.length > 0 && (
                      <CadenceAudioCutsPanel
                        segments={pairedSegments}
                        previewName={previewName}
                        previewVars={previewVars}
                        isSegmentOk={(id) =>
                          !!lib.segmentApproved[pairedTpl.key]?.[id] ||
                          hasGeneratedCadenceAudio(pairedTpl.key, lib)
                        }
                        segmentsReady={allAudioSegmentsApproved(pairedTpl, lib)}
                        readOnly
                        onApproveAll={() => {}}
                        onToggleApproved={() => {}}
                        onSetText={() => {}}
                        onInsertNome={() => {}}
                      />
                    )}
                    {(resolveCadenceAudioUrl(lib, pairedTpl.key, null) ||
                      lib.audioUrls[pairedTpl.key]) && (
                      <audio
                        controls
                        className="w-full"
                        src={
                          resolveCadenceAudioUrl(lib, pairedTpl.key, null) ||
                          lib.audioUrls[pairedTpl.key]
                        }
                      />
                    )}
                  </div>
                )}

                {hasSegments && (
                  <CadenceAudioCutsPanel
                    segments={draftSegments}
                    previewName={previewName}
                    previewVars={previewVars}
                    isSegmentOk={(id) =>
                      !!lib.segmentApproved[selected.key]?.[id] ||
                      hasGeneratedCadenceAudio(selected.key, lib)
                    }
                    segmentsReady={segmentsReady}
                    hint={
                      isMixedMessageAudio ? (
                        <>
                          Ordem no WhatsApp: <strong>áudio → texto → botões</strong>.
                          Áudio = nome + corpo fixo.
                        </>
                      ) : selected.key === "a5_audio_club_benefits" ? (
                        <>Passo 4a: Então + nome → corpo fixo do clube.</>
                      ) : selected.key === "a3_explain_with_buttons" ? (
                        <>Passo 3: Nome + “não tem segredo” → corpo fixo.</>
                      ) : selected.key === "a2_audio_activate_name" ? (
                        <>Passo 2a: Olá + nome + tudo bem? → corpo fixo M/F (igual ligação).</>
                      ) : (
                        <>Aprove cada corte antes de gerar o MP3.</>
                      )
                    }
                    onApproveAll={approveAllSegments}
                    onToggleApproved={toggleSegmentApproved}
                    onSetText={setSegmentText}
                    onInsertNome={insertNomeInSegment}
                  />
                )}

                {!selected.canGenerateAudio &&
                  !hasSegments &&
                  !pairedTpl &&
                  !lib.audioUrls[selected.key] &&
                  !audioUrl && (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      Este toque não tem áudio. Use a aba Conteúdo para o texto.
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
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
                  <Popover open={waSendOpen} onOpenChange={setWaSendOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="gap-2">
                        <MessageCircle className="h-4 w-4" />
                        Enviar áudio no WhatsApp
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Teste de áudio no WhatsApp</p>
                        <p className="text-[11px] text-muted-foreground">
                          Envia o MP3 Sofia já gerado para o número que você escolher (envio manual).
                        </p>
                      </div>
                      {myWaPhone && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="w-full gap-1.5"
                          disabled={testBusy}
                          onClick={() => {
                            setTestPhone(formatBrazilPhone(myWaPhone));
                            void runTestWhatsAppAudio(myWaPhone);
                          }}
                        >
                          {testBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MessageCircle className="h-3.5 w-3.5" />
                          )}
                          Meu WhatsApp ({formatBrazilPhone(myWaPhone)})
                        </Button>
                      )}
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                          Ou escolha outro número (DDD)
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
                        className="w-full gap-1.5"
                        disabled={testBusy || !testPhone.trim()}
                        onClick={() => void runTestWhatsAppAudio()}
                        style={{ background: "var(--pe-emerald)", color: "#fff" }}
                      >
                        {testBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Enviar para este número
                      </Button>
                      {!resolvePublicAudioUrl() && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                          Ainda sem áudio público — use “Aprovar e gerar Sofia” primeiro.
                        </p>
                      )}
                    </PopoverContent>
                  </Popover>
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

                  </>
                )}
                advancedTab={(
                  <>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between rounded-lg border border-border/60 px-2.5 py-2">
                    <Label htmlFor="approved-adv" className="text-xs">Aprovado</Label>
                    <Switch
                      id="approved-adv"
                      checked={!!lib.approved[selected.key]}
                      onCheckedChange={toggleApproved}
                      className="scale-90"
                    />
                  </div>

                  <div className="space-y-1 rounded-lg border border-dashed bg-muted/15 px-2.5 py-2">
                    <Label className="text-xs">Runtime</Label>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      A → <code className="rounded bg-muted px-1 text-[10px]">bot_flow_steps</code>
                      {" · "}
                      B/C → <code className="rounded bg-muted px-1 text-[10px]">cadence_stage_config</code>
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {selected.key} · {selected.channel} · {selected.group}
                    </p>
                  </div>

                  {selected.requiresApproval && (
                    <Badge variant="destructive" className="text-[10px]">
                      Requer {selected.requiresApproval}=true
                    </Badge>
                  )}
                </div>
                  </>
                )}
                footer={(
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-0.5 px-2 text-[12px]"
                    disabled={listIdx <= 0}
                    onClick={() => {
                      if (listIdx > 0) openInspector(list[listIdx - 1]!.key, inspectorTab);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Ant.
                  </Button>
                  <span className="px-1.5 text-[12px] tabular-nums text-muted-foreground">
                    {listIdx + 1}/{list.length}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-0.5 px-2 text-[12px]"
                    disabled={listIdx < 0 || listIdx >= list.length - 1}
                    onClick={() => {
                      if (listIdx >= 0 && listIdx < list.length - 1) {
                        openInspector(list[listIdx + 1]!.key, inspectorTab);
                      }
                    }}
                  >
                    Próx.
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      size="sm"
                      className="h-8 gap-1.5 text-[12px]"
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Salvar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2.5 text-[12px]"
                      onClick={handleCopy}
                      aria-label="Copiar"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2.5 text-[12px]"
                      onClick={handleResetOne}
                      aria-label="Restaurar"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                )}
              />
            )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
