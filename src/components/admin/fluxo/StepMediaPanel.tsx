import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Mic, Image as ImageIcon, Video, Trash2, Upload, ArrowUp, ArrowDown, Loader2, Library, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AudioRecorderInline } from "@/components/admin/AIAgentTab/AudioRecorderInline";
import AudioPlayer from "@/components/admin/media/AudioPlayer";
import { prettyStepLabel } from "@/lib/posVenda/format";
import {
  cadenceBodyAudioUrlKey,
  isSofiaEditableStep,
  isSofiaStitchMediaSlot,
  loadLibrary,
  sofiaUploadTargetSlot,
  stepMediaLookupKeys,
} from "@/lib/multichannelCadenceTexts";
import { APPROVED_A2_AUDIOS } from "@/lib/multichannelApprovedAudios";
import SofiaStepAudioTools from "@/components/admin/fluxo/SofiaStepAudioTools";
import { dedupeMediaLibraryPreferLightest } from "@/lib/dedupeMediaLibrary";

type Kind = "audio" | "image" | "video";
type Media = {
  id: string;
  kind: Kind;
  label: string;
  url: string | null;
  storage_path: string | null;
  slot_key: string | null;
  send_order: number;
  duration_sec: number | null;
  delay_before_ms?: number | null;
  original_size_bytes?: number | null;
  final_size_bytes?: number | null;
  transcript?: string | null;
};

// Whapi (WhatsApp) rejeita .webm com erro 500 em /messages/voice.
// Aceitamos só formatos que ele entrega como voice note: .ogg/opus, .mp3 ou .m4a.
const ACCEPT: Record<Kind, string> = {
  audio: "audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,.ogg,.mp3,.m4a,.wav",
  image: "image/*",
  video: "video/*",
};

const KIND_LABEL: Record<Kind, string> = {
  audio: "Áudios",
  image: "Imagens",
  video: "Vídeos",
};

const KIND_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  audio: Mic,
  image: ImageIcon,
  video: Video,
};

// Vídeo aceita até 200MB porque o compress-worker comprime antes de salvar.
// Se o worker não estiver configurado, fica salvo no Supabase Storage (limite real do bucket).
const MAX_BYTES: Record<Kind, number> = {
  audio: 10 * 1024 * 1024,
  image: 8 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  consultantId: string;
  stepKey: string;
  slotKeys: string[];
  /** Texto WhatsApp do passo (aba Conteúdo) — prévia Sofia áudio→texto. */
  messageText?: string | null;
  onMessageTextChange?: (next: string) => void;
  // Ordem padrão para este passo. Pode ser sobrescrita por consultant.flow_step_media_order[stepKey]
  defaultOrder?: ("audio" | "image" | "video" | "text")[];
  initialOrder?: ("audio" | "image" | "video" | "text")[];
  onOrderChange?: (order: ("audio" | "image" | "video" | "text")[]) => void;
  variant?: string;
  /**
   * Quando true, não monta SofiaStepAudioTools (ex.: Multicanal já tem CadenceAudioCutsPanel acima).
   * Upload/ordem de arquivos continuam iguais.
   */
  hideSofiaTools?: boolean;
}

const DEFAULT_ORDER: ("audio" | "image" | "video" | "text")[] = ["audio", "image", "video", "text"];

export default function StepMediaPanel({
  consultantId,
  stepKey,
  slotKeys,
  messageText,
  onMessageTextChange,
  initialOrder,
  onOrderChange,
  variant = "A",
  hideSofiaTools = false,
}: Props) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<("audio" | "image" | "video" | "text")[]>(
    initialOrder && initialOrder.length ? initialOrder : DEFAULT_ORDER,
  );
  const [savingOrder, setSavingOrder] = useState(false);
  const fileInputs = useRef<Record<Kind, HTMLInputElement | null>>({ audio: null, image: null, video: null });
  const [uploading, setUploading] = useState<Kind | null>(null);
  const [pickerKind, setPickerKind] = useState<Kind | null>(null);
  const [libraryItems, setLibraryItems] = useState<Media[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [savingDraft, setSavingDraft] = useState(false);
  const [syncingSofia, setSyncingSofia] = useState(false);
  const hasPendingChanges = pendingDeletes.size > 0;

  const primarySlot = slotKeys[0] || stepKey || "";
  const lookupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const sk of slotKeys) {
      for (const k of stepMediaLookupKeys(sk)) keys.add(k);
    }
    if (stepKey) {
      for (const k of stepMediaLookupKeys(stepKey)) keys.add(k);
    }
    return Array.from(keys);
  }, [slotKeys.join("|"), stepKey]);
  const isSofiaStitch = isSofiaStitchMediaSlot(primarySlot) || isSofiaStitchMediaSlot(stepKey);
  const isSofiaEditable =
    isSofiaEditableStep(primarySlot, stepKey, messageText) ||
    isSofiaEditableStep(stepKey, primarySlot, messageText);
  /** C = Sofia Multicanal: edita mídia livremente. B legado ainda compartilha com A. */
  const mediaLockedShared = variant === "B";
  const audioUploadSlot =
    isSofiaStitch || isSofiaEditable
      ? sofiaUploadTargetSlot(primarySlot || stepKey, "feminino")
      : primarySlot;

  async function openLibrary(kind: Kind) {
    setPickerKind(kind);
    setLoadingLibrary(true);
    // Inclui mídias do próprio consultor + públicas (Super Admin)
    const { data } = await supabase
      .from("ai_media_library")
      .select("id, kind, label, url, storage_path, slot_key, send_order, duration_sec, delay_before_ms, original_size_bytes, final_size_bytes, consultant_id, is_public")
      .or(`consultant_id.eq.${consultantId},and(consultant_id.is.null,is_public.eq.true)`)
      .eq("kind", kind)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(200);
    const existingUrls = new Set(items.filter(i => i.kind === kind).map(i => i.url));
    const raw = (((data as any[]) ?? []).filter(m => !existingUrls.has(m.url)) as Media[]);
    // Títulos repetidos (reupload) → só a cópia mais leve
    setLibraryItems(dedupeMediaLibraryPreferLightest(raw));
    setLoadingLibrary(false);
  }

  async function linkFromLibrary(m: Media) {
    const slotKey =
      m.kind === "audio" && isSofiaStitch
        ? sofiaUploadTargetSlot(primarySlot || stepKey, "feminino")
        : slotKeys[0];
    if (!slotKey) return;
    setLinking(m.id);
    // Permite múltiplas mídias por passo: NÃO desativa as existentes.
    // Apenas anexa esta nova mídia ao slot, com send_order incremental.
    const { data: row, error } = await supabase
      .from("ai_media_library")
      .insert({
        consultant_id: consultantId,
        kind: m.kind,
        label: m.label,
        slot_key: slotKey,
        url: m.url,
        // 🔧 2026-07-07: copia o storage_path da origem para que o guard
        // "há outra row usando esse arquivo?" no saveAllChanges funcione.
        // Antes gravávamos null, e o arquivo real acabava deletado quando
        // qualquer uma das rows-irmãs era removida.
        storage_path: m.storage_path ?? null,
        active: true,
        is_public: false,
        send_order: 100 + items.length,
        duration_sec: m.duration_sec,
        delay_before_ms: 1500,
      })
      .select("id, kind, label, url, storage_path, slot_key, send_order, duration_sec, delay_before_ms, original_size_bytes, final_size_bytes")
      .maybeSingle();
    setLinking(null);
    if (error) { toast.error("Erro ao vincular: " + error.message); return; }
    if (row) {
      setItems(prev => [...prev, row as Media]);
      setLibraryItems(prev => prev.filter(x => x.id !== m.id));
    }
    toast.success("Mídia adicionada ao passo");
  }


  // Quando o fluxo do consultor está em sync_mode='public' (padrão), as
  // mídias enviadas ao lead vêm do Super Admin (dono do flow público). O
  // painel precisa refletir EXATAMENTE essas mídias — senão o consultor vê
  // áudio/imagem que não é o que sai no WhatsApp. Resolvemos o "media owner"
  // antes de carregar.
  const [mediaOwnerId, setMediaOwnerId] = useState<string>(consultantId);
  const [readOnlySync, setReadOnlySync] = useState<boolean>(false);

  useEffect(() => {
    if (!lookupKeys.length) {
      setItems([]);
      setLoading(false);
      return;
    }
    (async () => {
      // 1) Descobre se o flow ativo do consultor está sincronizado com o público.
      const v = String(variant || "A").toUpperCase();
      let ownerId = consultantId;
      let isSync = false;
      try {
        const { data: own } = await supabase
          .from("bot_flows")
          .select("sync_mode")
          .eq("consultant_id", consultantId)
          .eq("is_active", true)
          .eq("variant", v)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const mode = String((own as any)?.sync_mode ?? "public").toLowerCase();
        if (!own || mode === "public") {
          const { data: pub } = await supabase
            .from("bot_flows")
            .select("consultant_id")
            .eq("is_public", true)
            .eq("is_active", true)
            .eq("variant", v)
            .limit(1)
            .maybeSingle();
          const pubOwner = (pub as any)?.consultant_id as string | undefined;
          if (pubOwner) {
            ownerId = pubOwner;
            isSync = pubOwner !== consultantId;
          }
        }
      } catch { /* fallback: usa o próprio consultor */ }
      setMediaOwnerId(ownerId);
      setReadOnlySync(isSync);

      const [{ data, error }, { data: cons }] = await Promise.all([
        supabase
          .from("ai_media_library")
          .select("id, kind, label, url, storage_path, slot_key, send_order, duration_sec, delay_before_ms, original_size_bytes, final_size_bytes, transcript")
          .eq("consultant_id", ownerId)
          .eq("active", true)
          .in("slot_key", lookupKeys)
          .order("send_order", { ascending: true }),
        supabase.from("consultants").select("flow_step_media_order").eq("id", ownerId).maybeSingle(),
      ]);
      if (!error) setItems((data as Media[]) ?? []);
      // Ordem: 1) salva no consultor 2) media_order do passo (initialOrder) 3) default
      const map = (cons?.flow_step_media_order as Record<string, string[]> | null) ?? {};
      const saved = map?.[stepKey];
      if (Array.isArray(saved) && saved.length >= 2) {
        setOrder(saved as ("audio" | "image" | "video" | "text")[]);
      } else if (initialOrder && initialOrder.length >= 2) {
        setOrder(initialOrder);
      }
      setLoading(false);
    })();
  }, [consultantId, stepKey, lookupKeys.join("|"), variant]);

  function group(kind: Kind) {
    return items.filter(i => i.kind === kind);
  }

  async function persistOrder(next: ("audio" | "image" | "video" | "text")[], opts?: { toastOk?: boolean }) {
    setOrder(next);
    setSavingOrder(true);
    const { data: cons } = await supabase.from("consultants").select("flow_step_media_order").eq("id", consultantId).maybeSingle();
    const map = (cons?.flow_step_media_order as Record<string, string[]>) ?? {};
    map[stepKey] = next;
    const { error } = await supabase.from("consultants").update({ flow_step_media_order: map }).eq("id", consultantId);
    setSavingOrder(false);
    if (error) toast.error("Erro ao salvar ordem: " + error.message);
    else {
      onOrderChange?.(next);
      if (opts?.toastOk) toast.success("Ordem de envio: " + next.join(" → "));
    }
  }

  async function moveOrder(idx: number, dir: -1 | 1) {
    const next = [...order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    await persistOrder(next);
  }

  async function handleUpload(kind: Kind, file: File, slotKey: string) {
    if (file.size > MAX_BYTES[kind]) {
      toast.error(`Arquivo grande demais (máx ${MAX_BYTES[kind] / 1024 / 1024}MB)`);
      return;
    }
    if (kind === "audio" && /\.webm$/i.test(file.name)) {
      toast.error("O WhatsApp não aceita áudio .webm. Use .ogg, .mp3 ou .m4a — ou grave pelo botão 'Gravar' aqui no painel.");
      return;
    }
    setUploading(kind);

    let finalUrl: string | null = null;
    let storagePath: string | null = null;
    let durationSec: number | null = null;
    let originalSize: number | null = file.size;
    let finalSize: number | null = file.size;
    let deduplicated = false;

    // === Dedupe por SHA-256: se já existir, reaproveita url/storage e evita reupload ===
    let contentHash: string | null = null;
    try {
      const { sha256File, findExistingByHash } = await import("@/lib/mediaHash");
      contentHash = await sha256File(file);
      const existing = await findExistingByHash(consultantId, contentHash);
      if (existing?.url) {
        finalUrl = existing.url;
        storagePath = existing.storage_path;
        durationSec = existing.duration_sec;
        originalSize = existing.original_size_bytes ?? originalSize;
        finalSize = existing.final_size_bytes ?? finalSize;
        deduplicated = true;
        toast.success("Mídia já existia — reutilizada sem novo upload");
      }
    } catch (e) {
      console.warn("[mediaHash] falhou, seguindo upload normal:", e);
    }

    // === Vídeo: tenta comprimir via compress-worker (Easypanel) antes de salvar ===
    const compressUrl = import.meta.env.VITE_COMPRESS_WORKER_URL as string | undefined;
    const compressKey = import.meta.env.VITE_COMPRESS_WORKER_KEY as string | undefined;
    if (!finalUrl && kind === "video" && compressUrl) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", `fluxos/${consultantId}/${slotKey}`);
        fd.append("name", file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "video");
        toast.message("Comprimindo vídeo… isso pode levar até 1 min para vídeos grandes.");
        const r = await fetch(`${compressUrl.replace(/\/+$/, "")}/compress`, {
          method: "POST",
          headers: compressKey ? { "x-api-key": compressKey } : {},
          body: fd,
        });
        if (!r.ok) throw new Error(`worker ${r.status}`);
        const j = await r.json();
        if (!j?.url) throw new Error("resposta sem url");
        finalUrl = j.url as string;
        durationSec = typeof j.duration_sec === "number" ? Math.round(j.duration_sec) : null;
        if (typeof j.original_size === "number") originalSize = j.original_size;
        if (typeof j.final_size === "number") finalSize = j.final_size;
        const ratio = j.compression_ratio ? ` (${Math.round((1 - j.compression_ratio) * 100)}% menor)` : "";
        toast.success(`Vídeo comprimido e enviado ao MinIO${ratio}`);
      } catch (e) {
        console.warn("[compress-worker] falhou, caindo para upload direto:", e);
        toast.message("Compressor indisponível — salvando vídeo original.");
      }
    }

    // === Fallback / outros tipos: upload direto no Supabase Storage ===
    if (!finalUrl) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${consultantId}/${slotKey}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) {
        setUploading(null);
        toast.error("Falha no upload: " + upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
      finalUrl = pub.publicUrl;
      storagePath = path;
    }

    const { data: row, error: insErr } = await supabase
      .from("ai_media_library")
      .insert({
        consultant_id: consultantId,
        kind,
        label: file.name.slice(0, 80),
        slot_key: slotKey,
        url: finalUrl,
        storage_path: storagePath,
        active: true,
        send_order: 100 + items.length,
        delay_before_ms: 1500,
        original_size_bytes: originalSize,
        final_size_bytes: finalSize,
        ...(contentHash ? { content_hash: contentHash } : {}),
        ...(durationSec ? { duration_sec: durationSec } : {}),
      })
      .select("id, kind, label, url, storage_path, slot_key, send_order, duration_sec, delay_before_ms, original_size_bytes, final_size_bytes")
      .maybeSingle();
    setUploading(null);
    if (insErr) {
      toast.error("Erro ao salvar: " + insErr.message);
      return;
    }
    if (row) setItems(prev => [...prev, row as Media]);
    if (!deduplicated) toast.success("Mídia adicionada");
  }

  async function removeMedia(m: Media) {
    if (mediaLockedShared) {
      toast.error("Mídias são compartilhadas entre A/B. Remova pela aba A. Na B, áudios já são ignorados automaticamente.");
      return;
    }
    // 🔧 Draft local: NÃO apaga do banco aqui. Só marca como pendente.
    // O consultor precisa clicar em "Salvar alterações" para confirmar.
    if (pendingDeletes.has(m.id)) {
      // Toggle off — desmarca a remoção pendente.
      setPendingDeletes(prev => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
      toast.info(`Remoção de "${m.label}" cancelada`);
      return;
    }
    setPendingDeletes(prev => new Set(prev).add(m.id));
    toast.info(`"${m.label}" marcada para remoção. Clique em *Salvar alterações* para confirmar.`);
  }

  /** Garante corpos A2 (M/F) e A3 na library — evita painel vazio / falso erro. */
  async function syncSofiaCadenceAudios() {
    if (readOnlySync || mediaLockedShared) {
      toast.error("Personalize o fluxo (modo custom) antes de sincronizar áudios.");
      return;
    }
    setSyncingSofia(true);
    try {
      let inserted = 0;
      const targets: Array<{ slot: string; url: string; label: string }> = [];
      if (
        primarySlot.includes("a2") ||
        stepKey.includes("a2") ||
        lookupKeys.some((k) => k.startsWith("a2_"))
      ) {
        for (const a of APPROVED_A2_AUDIOS) {
          const bodySlot = sofiaUploadTargetSlot("a2_audio_activate_name", a.gender);
          targets.push({
            slot: bodySlot,
            url: a.audioUrl,
            label: a.label,
          });
        }
      }
      // A3: corpo fixo gerado no painel Multicanal (localStorage → __body).
      if (
        primarySlot.includes("a3") ||
        stepKey.includes("a3") ||
        lookupKeys.some((k) => k.startsWith("a3_"))
      ) {
        const lib = loadLibrary(consultantId);
        const bodyKey = cadenceBodyAudioUrlKey("a3_explain_with_buttons");
        const bodyUrl =
          lib.audioUrls[bodyKey] ||
          lib.audioUrls[cadenceBodyAudioUrlKey("a3_audio_explain")] ||
          null;
        if (bodyUrl) {
          targets.push({
            slot: bodyKey,
            url: bodyUrl,
            label: "Sofia corpo · explicação (passo 3)",
          });
        }
      }
      for (const t of targets) {
        const { data: existing } = await supabase
          .from("ai_media_library")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("slot_key", t.slot)
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        if (existing?.id) continue;
        const { data: row, error } = await supabase
          .from("ai_media_library")
          .insert({
            consultant_id: consultantId,
            kind: "audio",
            label: t.label.slice(0, 120),
            slot_key: t.slot,
            url: t.url,
            active: true,
            is_public: false,
            send_order: 10 + inserted,
            delay_before_ms: 0,
          })
          .select("id, kind, label, url, storage_path, slot_key, send_order, duration_sec, delay_before_ms, original_size_bytes, final_size_bytes")
          .maybeSingle();
        if (error) throw error;
        if (row) {
          setItems((prev) => [...prev, row as Media]);
          inserted++;
        }
      }
      if (inserted === 0) {
        toast.message(
          "Áudios Sofia já estavam no passo (ou gere o passo 3 em Ligação → Textos automáticos).",
        );
      } else {
        toast.success(`${inserted} áudio(s) Sofia sincronizado(s) neste passo.`);
      }
    } catch (e: any) {
      toast.error("Falha ao sincronizar: " + (e?.message || String(e)));
    } finally {
      setSyncingSofia(false);
    }
  }

  // Aplica todas as remoções pendentes no banco quando o consultor clica
  // em "Salvar alterações". Antes desse momento, o bot continua usando
  // as mídias normalmente em produção.
  async function saveAllChanges() {
    if (!hasPendingChanges) {
      toast.info("Nenhuma alteração pendente.");
      return;
    }
    const ok = await confirm({
      title: `Salvar ${pendingDeletes.size} remoção(ões)?`,
      description: "Estas mídias serão removidas do passo permanentemente. Você poderá adicionar novas depois.",
      confirmText: "Salvar alterações",
      tone: "danger",
    });
    if (!ok) return;
    setSavingDraft(true);
    try {
      const ids = Array.from(pendingDeletes);
      const toRemove = items.filter(x => ids.includes(x.id));
      // 1. Marcar inactive em batch.
      const { error } = await supabase
        .from("ai_media_library")
        .update({ active: false })
        .in("id", ids);
      if (error) throw error;
      // 2. Remover do storage (best-effort) — MAS só se nenhuma outra row
      //    ativa ainda referencia o mesmo arquivo (mesmo storage_path OU
      //    mesma url). Sem esse guard, remover uma cópia órfã apagava o
      //    arquivo real e quebrava todas as demais entradas (404 no player
      //    e no envio via Whapi/Evolution). Bug observado em 2026-07-07.
      for (const m of toRemove) {
        if (!m.storage_path) continue;
        const { count } = await supabase
          .from("ai_media_library")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .or(`storage_path.eq.${m.storage_path},url.eq.${m.url}`);
        if ((count ?? 0) > 0) {
          console.log(`[StepMediaPanel] Pulando remove do storage: ${count} row(s) ativa(s) ainda usam ${m.storage_path}`);
          continue;
        }
        await supabase.storage.from("ai-agent-media").remove([m.storage_path]).catch(() => {});
      }
      // 3. Atualizar UI.
      setItems(prev => prev.filter(x => !ids.includes(x.id)));
      setPendingDeletes(new Set());
      toast.success(`${ids.length} mídia(s) removida(s) com sucesso`);
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || String(e)));
    } finally {
      setSavingDraft(false);
    }
  }

  function discardChanges() {
    if (!hasPendingChanges) return;
    setPendingDeletes(new Set());
    toast.info("Alterações descartadas. O fluxo continua igual.");
  }


  async function updateDelay(m: Media, newDelayMs: number) {
    const clamped = Math.max(0, Math.min(60000, Math.round(newDelayMs)));
    setItems(prev => prev.map(x => x.id === m.id ? { ...x, delay_before_ms: clamped } : x));
    const { error } = await supabase
      .from("ai_media_library")
      .update({ delay_before_ms: clamped })
      .eq("id", m.id);
    if (error) toast.error("Erro ao salvar atraso: " + error.message);
  }

  async function moveItem(m: Media, dir: -1 | 1) {
    // Reordena globalmente (todas as mídias do passo, sem agrupar por kind)
    const sorted = [...items].sort((a, b) => a.send_order - b.send_order);
    const idx = sorted.findIndex(x => x.id === m.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sorted.length) return;
    [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];
    // Reatribui send_order sequencial
    const updates = sorted.map((x, i) => ({ ...x, send_order: 100 + i }));
    setItems(updates);
    await Promise.all(
      updates.map(u =>
        supabase.from("ai_media_library").update({ send_order: u.send_order }).eq("id", u.id)
      )
    );
  }

  function renderMediaItem(m: Media) {
    const Icon = KIND_ICON[m.kind];
    const delaySec = ((m.delay_before_ms ?? 1500) / 1000).toFixed(1);
    const isPendingDelete = pendingDeletes.has(m.id);
    return (
      <div
        key={m.id}
        className={`rounded-md border p-2 flex flex-col gap-2 transition-all ${
          isPendingDelete
            ? "border-destructive/60 bg-destructive/10 opacity-60 line-through"
            : "border-border/60 bg-muted/20"
        }`}
      >
        {isPendingDelete && (
          <div className="text-[10px] font-bold uppercase tracking-wider text-destructive no-underline">
            ⚠️ Marcada para remoção — clique em Salvar alterações para confirmar
          </div>
        )}
        <div className="flex items-start justify-between gap-2 no-underline">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{m.label}</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <span>ordem: {m.send_order}</span>
                {m.slot_key ? (
                  <span className="font-mono truncate max-w-[140px]" title={m.slot_key}>
                    · {m.slot_key}
                  </span>
                ) : null}
                {m.duration_sec ? <span>· {m.duration_sec}s</span> : null}
                {m.final_size_bytes ? (
                  m.original_size_bytes && m.original_size_bytes > m.final_size_bytes ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">
                      {formatBytes(m.original_size_bytes)} → {formatBytes(m.final_size_bytes)} ({Math.round((1 - m.final_size_bytes / m.original_size_bytes) * 100)}% menor)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">{formatBytes(m.final_size_bytes)}</Badge>
                  )
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveItem(m, -1)} title="Mover para cima">
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveItem(m, 1)} title="Mover para baixo">
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 no-underline"
              onClick={() => removeMedia(m)}
              disabled={mediaLockedShared}
              title={
                mediaLockedShared
                  ? "Mídias são compartilhadas. Remova pela aba A."
                  : pendingDeletes.has(m.id)
                    ? "Desfazer remoção"
                    : "Marcar para remover (precisa salvar)"
              }
            >
              {pendingDeletes.has(m.id) ? (
                <ArrowUp className="h-3.5 w-3.5 rotate-180 text-primary" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              )}
            </Button>

          </div>
        </div>
        {m.url && m.kind === "audio" && (
          <AudioPlayer mediaId={m.id} url={m.url} fileName={m.label} onConverted={() => window.location.reload()} />
        )}
        {m.kind === "audio" && variant === "B" && (
          <AudioTranscriptEditor media={m} onChange={(t) => setItems(prev => prev.map(x => x.id === m.id ? { ...x, transcript: t } : x))} />
        )}
        {m.url && m.kind === "image" && <img src={m.url} alt={m.label} className="w-full max-h-32 object-cover rounded" loading="lazy" decoding="async" />}
        {m.url && m.kind === "video" && <video controls src={m.url} className="w-full max-h-40 rounded" />}
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0">⏱️ Aguardar antes de enviar:</span>
          <input
            type="number"
            min={0}
            max={60}
            step={0.5}
            defaultValue={delaySec}
            onBlur={(e) => updateDelay(m, parseFloat(e.target.value || "0") * 1000)}
            className="w-16 h-7 px-1.5 text-xs rounded border border-border bg-background"
          />
          <span>seg</span>
        </label>
      </div>
    );
  }

  function renderKindBlock(kind: Kind) {
    const list = group(kind);
    const Icon = KIND_ICON[kind];
    const slotForUpload = kind === "audio" ? audioUploadSlot : primarySlot;
    return (
      <div key={kind} className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {KIND_LABEL[kind]}
            </span>
            <Badge variant="secondary" className="text-[10px] h-4">{list.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {kind === "audio" && slotForUpload && (
              <AudioRecorderInline
                onRecorded={async (blob, durationSec) => {
                  const file = new File([blob], `gravacao-${Date.now()}.ogg`, { type: "audio/ogg" });
                  await handleUpload("audio", file, slotForUpload);
                }}
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={!slotForUpload}
              onClick={() => openLibrary(kind)}
              title="Usar mídia já salva na sua biblioteca"
            >
              <Library className="h-3 w-3 mr-1" />
              Biblioteca
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={uploading === kind || !slotForUpload}
              onClick={() => fileInputs.current[kind]?.click()}
            >
              {uploading === kind ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
              Enviar
            </Button>
          </div>
          <input
            ref={el => (fileInputs.current[kind] = el)}
            type="file"
            accept={ACCEPT[kind]}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f && slotForUpload) handleUpload(kind, f, slotForUpload);
              e.target.value = "";
            }}
          />
        </div>
        {kind === "audio" && isSofiaStitch && list.length > 0 && (
          <p className="text-[10px] text-muted-foreground px-1">
            Cortes Sofia: o motor costura <strong>o nome</strong> em runtime + estes corpos
            fixos. Slot de upload: <code className="text-[9px]">{audioUploadSlot}</code>
          </p>
        )}
        {list.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{list.map(renderMediaItem)}</div>
        ) : (
          <div className="text-xs text-muted-foreground italic px-1 space-y-1">
            <div>Nenhum {kind} cadastrado.</div>
            {kind === "audio" && isSofiaEditable && !hideSofiaTools && (
              <div className="not-italic text-amber-700 dark:text-amber-400 space-y-1">
                <p>
                  Isto <strong>não</strong> significa que o WhatsApp fica sem áudio. Use o card{" "}
                  <strong>Personalizar Sofia</strong> acima para editar nome, roteiro do áudio e
                  texto. Passos A2/A3/A5 compartilham o mesmo editor.
                </p>
                <p>
                  Use <strong>Sincronizar corpos</strong> (quando aparecer) ou upload abaixo. Nomes
                  do lote <strong>não</strong> regeneram TTS ao salvar o roteiro.
                </p>
              </div>
            )}
            {kind === "audio" && isSofiaEditable && hideSofiaTools && (
              <div className="not-italic text-muted-foreground text-[11px]">
                Cortes Sofia ficam no painel acima. Aqui você anexa arquivos extras (áudio/imagem/vídeo)
                e define a ordem de envio com o texto.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando mídias…
      </div>
    );
  }

  if (!lookupKeys.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-4">
      {readOnlySync && (
        <div className="rounded-md border border-info/40 bg-info/10 p-2 text-xs text-info">
          🔒 Este passo está sincronizado com o Super Admin. As mídias mostradas
          aqui são <strong>exatamente as mesmas</strong> que o bot envia ao lead.
          Para personalizar, peça ao Super Admin para liberar o modo customizado.
        </div>
      )}
      <fieldset disabled={readOnlySync} className={readOnlySync ? "opacity-70 pointer-events-none select-none" : ""}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold">Mídias deste passo</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {(isSofiaStitch || lookupKeys.some((k) => k.startsWith("a2_") || k.startsWith("a5_"))) && !isSofiaStitch && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={syncingSofia || readOnlySync || mediaLockedShared}
              onClick={() => void syncSofiaCadenceAudios()}
            >
              {syncingSofia ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Sincronizar Sofia
            </Button>
          )}
          {hasPendingChanges && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-warning/60 text-warning dark:text-warning text-[10px]">
              {pendingDeletes.size} alteração(ões) pendente(s)
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={discardChanges}
              disabled={savingDraft}
            >
              Descartar
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1 bg-primary/100 hover:bg-primary text-white"
              onClick={saveAllChanges}
              disabled={savingDraft}
            >
              {savingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Salvar alterações
            </Button>
          </div>
          )}
        </div>
      </div>

      {isSofiaEditable && !hideSofiaTools && (
        <SofiaStepAudioTools
          consultantId={mediaOwnerId || consultantId}
          slotKey={primarySlot}
          stepKey={stepKey}
          messageText={messageText}
          onMessageTextChange={onMessageTextChange}
          mediaOrder={order}
          onSetMediaOrder={(next) => {
            void persistOrder(next, { toastOk: true });
          }}
          disabled={readOnlySync || mediaLockedShared}
          syncingBodies={syncingSofia}
          onSyncBodies={() => void syncSofiaCadenceAudios()}
        />
      )}

      {(["audio", "image", "video"] as Kind[]).map(renderKindBlock)}

      {/* R5: aviso só se falta mídia de verdade. Em stitch Sofia, corpos __body_* contam como áudio. */}
      {(() => {
        const presentKinds = new Set(items.filter(m => !pendingDeletes.has(m.id)).map(m => m.kind));
        const hasSofiaAudio =
          presentKinds.has("audio") ||
          (isSofiaStitch &&
            items.some(
              (m) =>
                m.kind === "audio" &&
                !pendingDeletes.has(m.id) &&
                String(m.slot_key || "").includes("__body"),
            ));
        const missingSlots = order.filter((s) => {
          if (s === "text") return false;
          if (s === "audio" && (hasSofiaAudio || isSofiaStitch || isSofiaEditable)) return false;
          return !presentKinds.has(s as Kind);
        });
        if (missingSlots.length === 0) return null;
        return (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            ⚠️ A ordem de envio inclui <strong>{missingSlots.join(", ")}</strong> mas nenhum arquivo desse tipo foi enviado neste passo. Remova da ordem ou faça upload — caso contrário o bot pode pular ou enviar mídia errada.
          </div>
        );
      })()}

      {/* Ordem de envio */}
      <div className="rounded-md bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ordem de envio
          </div>
          {savingOrder && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {order.map((slot, idx) => (
            <div key={slot} className="flex items-center gap-1">
              <div className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs">
                {slot === "audio" && <Mic className="h-3 w-3" />}
                {slot === "image" && <ImageIcon className="h-3 w-3" />}
                {slot === "video" && <Video className="h-3 w-3" />}
                {slot === "text" && <span className="text-[10px]">💬</span>}
                <span className="capitalize">{slot}</span>
                <div className="flex flex-col -my-0.5">
                  <button
                    onClick={() => moveOrder(idx, -1)}
                    disabled={idx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => moveOrder(idx, 1)}
                    disabled={idx === order.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
              {idx < order.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Define em que ordem o bot envia as mídias e o texto deste passo.
        </p>
      </div>

      <Dialog open={!!pickerKind} onOpenChange={(o) => !o && setPickerKind(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sua biblioteca de {pickerKind && KIND_LABEL[pickerKind].toLowerCase()}</DialogTitle>
            <DialogDescription>
              Toque para vincular a este passo. Títulos repetidos mostram só a cópia mais leve
              (não duplica arquivo no storage).
            </DialogDescription>
          </DialogHeader>
          {loadingLibrary ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : libraryItems.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-8 text-center">
              Nenhuma mídia disponível na biblioteca. Envie uma nova pelo botão "Enviar".
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {libraryItems.map(m => (
                <button
                  key={m.id}
                  onClick={() => linkFromLibrary(m)}
                  disabled={!!linking}
                  className="text-left rounded-md border border-border/60 bg-muted/20 p-2 hover:bg-muted/40 transition disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-xs font-medium truncate">{m.label}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(m.final_size_bytes || m.original_size_bytes) ? (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatBytes(m.final_size_bytes || m.original_size_bytes)}
                        </span>
                      ) : null}
                      {linking === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </div>
                  {m.url && m.kind === "audio" && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <AudioPlayer mediaId={m.id} url={m.url} fileName={m.label} />
                    </div>
                  )}
                  {m.url && m.kind === "image" && <img src={m.url} alt={m.label} className="w-full max-h-32 object-cover rounded" loading="lazy" decoding="async" />}
                  {m.url && m.kind === "video" && <video controls src={m.url} className="w-full max-h-40 rounded" onClick={e => e.stopPropagation()} />}
                  {m.slot_key && <div className="text-[10px] text-muted-foreground mt-1">já usada em: {prettyStepLabel(m.slot_key)}</div>}
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerKind(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </fieldset>
    </div>
  );
}

function AudioTranscriptEditor({ media, onChange }: { media: Media; onChange: (t: string) => void }) {
  const [value, setValue] = useState<string>(media.transcript || "");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(text: string) {
    setSaving(true);
    const { error } = await supabase.from("ai_media_library").update({ transcript: text }).eq("id", media.id);
    setSaving(false);
    if (error) toast.error("Erro: " + error.message);
    else { onChange(text); toast.success("Transcrição salva"); }
  }

  async function transcribe() {
    if (!media.url) return;
    setBusy(true);
    try {
      const res = await fetch(media.url);
      const blob = await res.blob();
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { data, error } = await supabase.functions.invoke("ai-transcribe-media", {
        body: { base64, mimeType: blob.type || "audio/ogg", kind: "audio", language: "pt-BR" },
      });
      if (error) throw error;
      const transcript = String((data as any)?.transcript || "").trim();
      if (!transcript) { toast.error("Transcrição vazia"); return; }
      setValue(transcript);
      await save(transcript);
    } catch (e: any) {
      toast.error("Falha ao transcrever: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const hasTranscript = !!(value && value.trim());
  return (
    <div className="space-y-1 border-t border-border/40 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Texto enviado no Fluxo B</span>
        <Badge variant={hasTranscript ? "secondary" : "outline"} className="h-4 px-1 text-[9px]">
          {hasTranscript ? "transcrito" : "sem transcrição"}
        </Badge>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => { if (e.target.value !== (media.transcript || "")) save(e.target.value); }}
        placeholder="Texto que será enviado no lugar deste áudio no Fluxo B…"
        rows={3}
        className="w-full text-xs rounded border border-border bg-background p-2"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={transcribe} disabled={busy || !media.url}>
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          {hasTranscript ? "Re-transcrever" : "Transcrever áudio"}
        </Button>
        {saving && <span className="text-[10px] text-muted-foreground">salvando…</span>}
      </div>
    </div>
  );
}
