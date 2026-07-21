import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HelpCircle, Plus, Trash2, X, ChevronUp, ChevronDown,
  Search, Sparkles, AlertTriangle, CheckCircle2, Mic, Loader2, Globe2, Lock, Headphones,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { AudioRecorderInline } from "@/components/admin/AIAgentTab/AudioRecorderInline";
import { FaqAudioReviewDialog } from "@/components/admin/fluxo/FaqAudioReviewDialog";
import {
  OBJECTION_SHORTCUTS, OBJECTION_CATEGORIES, CATEGORY_EMOJI,
  formatIntentName, parseIntentName, RESERVED_FLOW_KEYWORDS,
  type ObjectionCategory,
} from "@/lib/objectionShortcuts";

function mediaFilled(m: Media): boolean {
  return !!(m.media_id || m.slot_key);
}

type Trigger = { id?: string; qa_id?: string; phrase: string };
type Media = {
  id?: string;
  qa_id?: string;
  position: number;
  media_kind: "audio" | "video" | "image";
  media_id: string | null;
  slot_key: string | null;
};
type QA = {
  id: string;
  flow_id: string;
  position: number;
  intent_name: string;
  is_opening: boolean;
  is_closing: boolean;
  is_public?: boolean;
  text_response: string | null;
  triggers: Trigger[];
  medias: Media[];
};
type Slot = { slot_key: string; label: string; video_url: string | null };
type LibraryVideo = { id: string; label: string; url: string | null };
type LibraryAudio = {
  id: string;
  label: string;
  url: string | null;
  slot_key?: string | null;
  text_content?: string | null;
  intent_tags?: string[] | null;
  is_draft?: boolean;
};

export default function FaqSection({ flowId }: { flowId: string }) {
  const confirm = useConfirm();
  const [userId, setUserId] = useState<string | null>(null);
  const { isSuperAdmin } = useUserRole(userId);
  const [qas, setQas] = useState<QA[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availableVideos, setAvailableVideos] = useState<LibraryVideo[]>([]);
  const [availableAudios, setAvailableAudios] = useState<LibraryAudio[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState<ObjectionCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedingPack, setSeedingPack] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: slotsRow }, { data: videoRows }, { data: audioRows }, { data: qaRows }] = await Promise.all([
      supabase.from("ai_agent_slots").select("slot_key, label, video_url").eq("active", true).order("position"),
      supabase
        .from("ai_media_library").select("id, label, url")
        .eq("kind", "video").eq("active", true).not("url", "is", null)
        .order("priority", { ascending: false }).order("created_at", { ascending: false }),
      supabase
        .from("ai_media_library")
        .select("id, label, url, slot_key, text_content, intent_tags, is_draft")
        .eq("kind", "audio").eq("active", true).not("url", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("bot_flow_qa").select("*").or(`flow_id.eq.${flowId},is_public.eq.true`).order("position"),
    ]);
    setSlots((slotsRow as Slot[]) || []);
    setAvailableVideos(((videoRows as LibraryVideo[]) || []).filter((v) => !!v.url));
    setAvailableAudios(((audioRows as LibraryAudio[]) || []).filter((a) => !!a.url));

    const qaList = (qaRows as any[]) || [];
    const ids = qaList.map((q) => q.id);
    const [{ data: trigs }, { data: meds }] = await Promise.all([
      ids.length ? supabase.from("bot_flow_qa_triggers").select("*").in("qa_id", ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? supabase.from("bot_flow_qa_media").select("*").in("qa_id", ids).order("position") : Promise.resolve({ data: [] as any[] }),
    ]);
    setQas(
      qaList
        .filter((q) => !q.is_opening && !q.is_closing)
        .map((q) => ({
          ...q,
          triggers: ((trigs as Trigger[]) || []).filter((t) => t.qa_id === q.id),
          medias: ((meds as Media[]) || []).filter((m) => m.qa_id === q.id),
        }))
    );
    setLoading(false);
  }, [flowId]);

  useEffect(() => { load(); }, [load]);

  // Conjunto global de gatilhos (lowercase) → qa_id, pra detectar duplicados
  const triggerIndex = useMemo(() => {
    const m = new Map<string, string[]>(); // phrase -> qa_ids
    qas.forEach((q) => q.triggers.forEach((t) => {
      const key = t.phrase.toLowerCase().trim();
      m.set(key, [...(m.get(key) || []), q.id]);
    }));
    return m;
  }, [qas]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return qas.filter((q) => {
      const { category } = parseIntentName(q.intent_name);
      if (filterCat !== "all" && category !== filterCat) return false;
      if (term) {
        const hay = [q.intent_name, q.text_response || "", ...q.triggers.map((t) => t.phrase)]
          .join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [qas, filterCat, search]);

  const countByCategory = useMemo(() => {
    const out: Record<string, number> = { all: qas.length };
    OBJECTION_CATEGORIES.forEach((c) => (out[c] = 0));
    qas.forEach((q) => {
      const { category } = parseIntentName(q.intent_name);
      if (category) out[category] = (out[category] || 0) + 1;
    });
    return out;
  }, [qas]);

  const addQA = async () => {
    const nextPos = (qas[qas.length - 1]?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from("bot_flow_qa")
      .insert({ flow_id: flowId, position: nextPos, intent_name: "Nova dúvida", is_opening: false, is_closing: false, text_response: null })
      .select().single();
    if (error) return toast.error("Erro ao adicionar");
    setQas([...qas, { ...(data as any), triggers: [], medias: [] }]);
  };

  const seedDefaults = async () => {
    const ok = await confirm({
      title: `Sincronizar ${OBJECTION_SHORTCUTS.length} atalhos padrão?`,
      description: `Atualiza texto e gatilhos (frases compostas) dos ${OBJECTION_SHORTCUTS.length} atalhos oficiais. Cria os que faltarem. Mídia já preenchida não é apagada.`,
      confirmText: "Sincronizar",
      tone: "success",
    });
    if (!ok) return;
    setSeeding(true);
    let okCount = 0;
    try {
      for (const s of OBJECTION_SHORTCUTS) {
        const intentName = formatIntentName(s);
        const { error } = await supabase.rpc("refresh_objection_shortcut", {
          _flow_id: flowId,
          _intent_name: intentName,
          _text_response: s.text,
          _triggers: s.triggers,
        });
        if (error) { console.error(error); continue; }
        okCount++;
      }
      toast.success(`${okCount} atalhos sincronizados com gatilhos limpos`);
      await load();
    } finally {
      setSeeding(false);
    }
  };

  /** @deprecated Pacote curto de 15 — redireciona para o seed completo de 50. */
  const seedIgreenPack = async () => {
    toast.message("Pacote completo", { description: `Usando os ${OBJECTION_SHORTCUTS.length} atalhos padrão (o pacote de 15 foi aposentado).` });
    await seedDefaults();
  };

  const updateQA = async (id: string, patch: Partial<QA>) => {
    setQas((cur) => cur.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    const { triggers: _t, medias: _m, ...rest } = patch as any;
    if (Object.keys(rest).length) {
      const { error } = await supabase.from("bot_flow_qa").update(rest).eq("id", id);
      if (error) toast.error("Erro ao salvar");
    }
  };

  const deleteQA = async (id: string) => {
    const ok = await confirm({
      title: "Excluir esta dúvida?",
      description: "A resposta automática vinculada a essa pergunta será removida permanentemente.",
      confirmText: "Excluir dúvida",
      tone: "danger",
    });
    if (!ok) return;
    await supabase.from("bot_flow_qa").delete().eq("id", id);
    setQas((cur) => cur.filter((q) => q.id !== id));
  };

  const moveQA = async (id: string, dir: -1 | 1) => {
    const idx = qas.findIndex((q) => q.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= qas.length) return;
    const a = qas[idx], b = qas[swap];
    const next = [...qas];
    next[idx] = { ...b, position: a.position };
    next[swap] = { ...a, position: b.position };
    setQas(next);
    await Promise.all([
      supabase.from("bot_flow_qa").update({ position: b.position }).eq("id", a.id),
      supabase.from("bot_flow_qa").update({ position: a.position }).eq("id", b.id),
    ]);
  };

  const addTrigger = async (qa: QA, phrase: string) => {
    const p = phrase.trim();
    if (!p) return;
    const pNorm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (RESERVED_FLOW_KEYWORDS.some((k) => k.toLowerCase() === pNorm || k.toLowerCase() === p.toLowerCase())) {
      toast.error("Use uma frase completa (ex.: tem fidelidade). Palavra sola genérica é bloqueada.");
      return;
    }
    if (!p.includes(" ") && p.length <= 8) {
      toast.error("Prefira frases com 2+ palavras pra não casar errado.");
      return;
    }
    // duplicado dentro do mesmo atalho
    if (qa.triggers.some((t) => t.phrase.toLowerCase() === p.toLowerCase())) {
      toast.error("Esse gatilho já está aqui");
      return;
    }
    const { data, error } = await supabase
      .from("bot_flow_qa_triggers").insert({ qa_id: qa.id, phrase: p }).select().single();
    if (error) return toast.error("Erro");
    setQas((cur) => cur.map((q) => (q.id === qa.id ? { ...q, triggers: [...q.triggers, data as Trigger] } : q)));
  };
  const removeTrigger = async (qa: QA, t: Trigger) => {
    if (!t.id) return;
    await supabase.from("bot_flow_qa_triggers").delete().eq("id", t.id);
    setQas((cur) => cur.map((q) => (q.id === qa.id ? { ...q, triggers: q.triggers.filter((x) => x.id !== t.id) } : q)));
  };

  const addMedia = async (qa: QA, kind: "audio" | "video") => {
    const pos = qa.medias.length;
    const { data, error } = await supabase
      .from("bot_flow_qa_media")
      .insert({ qa_id: qa.id, position: pos, media_kind: kind, slot_key: null, media_id: null })
      .select().single();
    if (error) return toast.error("Erro");
    setQas((cur) => cur.map((q) => (q.id === qa.id ? { ...q, medias: [...q.medias, data as Media] } : q)));
  };
  const updateMedia = async (qa: QA, m: Media, patch: Partial<Media>) => {
    setQas((cur) => cur.map((q) => (q.id === qa.id ? { ...q, medias: q.medias.map((x) => (x.id === m.id ? { ...x, ...patch } : x)) } : q)));
    if (m.id) await supabase.from("bot_flow_qa_media").update(patch).eq("id", m.id);
  };
  const removeMedia = async (qa: QA, m: Media) => {
    if (!m.id) return;
    await supabase.from("bot_flow_qa_media").delete().eq("id", m.id);
    setQas((cur) => cur.map((q) => (q.id === qa.id ? { ...q, medias: q.medias.filter((x) => x.id !== m.id) } : q)));
  };

  // Sobe áudio gravado: upload-media → ai_media_library → assign no QA
  const onAudioRecorded = async (qa: QA, blob: Blob) => {
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const file = new File([blob], `atalho-${Date.now()}.ogg`, { type: "audio/ogg" });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "audio");
      fd.append("scope", "admin");
      if (uid) fd.append("consultant_id", uid);
      fd.append("slug", qa.intent_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40));

      const { data: upRes, error: upErr } = await supabase.functions.invoke("upload-media", { body: fd });
      if (upErr || !upRes?.url) throw upErr || new Error("Upload falhou");

      // Cria registro em ai_media_library
      const { data: lib, error: libErr } = await supabase
        .from("ai_media_library")
        .insert({
          consultant_id: uid,
          kind: "audio",
          label: `Atalho: ${qa.intent_name}`,
          url: upRes.url,
          storage_path: upRes.key,
          active: true,
          is_public: false,
        })
        .select("id, label, url").single();
      if (libErr || !lib) throw libErr || new Error("Falha ao salvar na biblioteca");

      // Adiciona como mídia do atalho
      const pos = qa.medias.length;
      const { data: med, error: medErr } = await supabase
        .from("bot_flow_qa_media")
        .insert({ qa_id: qa.id, position: pos, media_kind: "audio", media_id: null, slot_key: null })
        .select().single();
      if (medErr) throw medErr;
      // associa media_id
      await supabase.from("bot_flow_qa_media").update({ media_id: lib.id }).eq("id", (med as any).id);

      setAvailableAudios((cur) => [{ id: lib.id, label: lib.label, url: lib.url }, ...cur]);
      setQas((cur) => cur.map((q) => q.id === qa.id
        ? { ...q, medias: [...q.medias, { ...(med as Media), media_id: lib.id }] }
        : q));
      toast.success("Áudio gravado e vinculado!");
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro: ${e?.message || "falha ao gravar"}`);
    }
  };

  return (
    <Card className="p-4 sm:p-5 border-primary/20 bg-card/40">
      <div className="flex items-start gap-2 mb-4">
        <HelpCircle className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Atalhos / FAQ do fluxo</h2>
          <p className="text-xs text-muted-foreground">
            Quando a frase do lead casa com um gatilho, o bot responde com áudio (se houver) <strong>ou</strong> texto — nunca os dois juntos — e <strong>volta ao passo atual</strong>.
            Use <strong>frases completas</strong> (ex.: “tem fidelidade”) — palavra sola genérica é bloqueada.
            Sem match? Cai na Base da IA.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Button variant="secondary" size="sm" onClick={() => setReviewOpen(true)}>
            <Headphones className="w-3 h-3 mr-1" />
            Revisar áudios ({qas.filter((q) => q.flow_id === flowId).length})
          </Button>
          <Button variant="default" size="sm" onClick={seedDefaults} disabled={seeding || seedingPack}>
            {seeding || seedingPack ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Sincronizar {OBJECTION_SHORTCUTS.length} atalhos
          </Button>
        </div>
      </div>

      <FaqAudioReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        flowId={flowId}
        qas={qas}
        availableAudios={availableAudios}
        onChanged={load}
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge
          variant={filterCat === "all" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setFilterCat("all")}
        >
          Todos <span className="ml-1 opacity-70">({countByCategory.all})</span>
        </Badge>
        {OBJECTION_CATEGORIES.map((c) => (
          <Badge
            key={c}
            variant={filterCat === c ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilterCat(c)}
          >
            {CATEGORY_EMOJI[c]} {c} <span className="ml-1 opacity-70">({countByCategory[c] || 0})</span>
          </Badge>
        ))}
        <div className="relative ml-auto w-full sm:w-auto sm:flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar título, gatilho, resposta…"
            className="pl-7 h-8 text-xs"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((qa) => {
            const realIdx = qas.findIndex((q) => q.id === qa.id);
            const isOwned = qa.flow_id === flowId;
            return (
              <QACard
                key={qa.id}
                qa={qa}
                slots={slots}
                availableVideos={availableVideos}
                availableAudios={availableAudios}
                triggerIndex={triggerIndex}
                readOnly={!isOwned && !isSuperAdmin}
                isSuperAdmin={isSuperAdmin}
                onMoveUp={isOwned && realIdx > 0 ? () => moveQA(qa.id, -1) : undefined}
                onMoveDown={isOwned && realIdx < qas.length - 1 ? () => moveQA(qa.id, 1) : undefined}
                onUpdate={(p) => updateQA(qa.id, p)}
                onDelete={() => deleteQA(qa.id)}
                onAddTrigger={(p) => addTrigger(qa, p)}
                onRemoveTrigger={(t) => removeTrigger(qa, t)}
                onAddMedia={(k) => addMedia(qa, k)}
                onUpdateMedia={(m, p) => updateMedia(qa, m, p)}
                onRemoveMedia={(m) => removeMedia(qa, m)}
                onAudioRecorded={(blob) => onAudioRecorded(qa, blob)}
              />
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground italic py-6 text-center">
              {qas.length === 0
                ? `Nenhum atalho ainda. Clique em "${OBJECTION_SHORTCUTS.length} atalhos padrão" pra começar.`
                : "Nenhum atalho com esse filtro."}
            </p>
          )}
          <Button variant="outline" onClick={addQA} className="w-full">
            <Plus className="w-4 h-4 mr-1" /> Novo atalho em branco
          </Button>
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
function getStatus(qa: QA, triggerIndex: Map<string, string[]>) {
  const issues: string[] = [];
  if (qa.triggers.length === 0) issues.push("Sem gatilhos");
  const noText = !qa.text_response || !qa.text_response.trim();
  const hasFilledMedia = qa.medias.some(mediaFilled);
  if (noText && !hasFilledMedia) issues.push("Sem texto nem mídia preenchida");
  // duplicado entre atalhos
  const dup = qa.triggers.filter((t) => (triggerIndex.get(t.phrase.toLowerCase().trim()) || []).length > 1);
  if (dup.length) issues.push(`${dup.length} gatilho(s) duplicado(s) com outro atalho`);
  // reservada
  const reserved = qa.triggers.filter((t) => RESERVED_FLOW_KEYWORDS.includes(t.phrase.toLowerCase().trim()));
  if (reserved.length) issues.push(`Conflita com palavras do fluxo: ${reserved.map((r) => r.phrase).join(", ")}`);
  // variável inválida
  if (qa.text_response) {
    const badVars = (qa.text_response.match(/\{[a-z_]+\}(?!\})/gi) || []);
    if (badVars.length) issues.push(`Use {{nome}} em vez de ${badVars[0]}`);
  }
  return issues;
}

function QACard(props: {
  qa: QA;
  slots: Slot[];
  availableVideos: LibraryVideo[];
  availableAudios: LibraryAudio[];
  triggerIndex: Map<string, string[]>;
  readOnly?: boolean;
  isSuperAdmin?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onUpdate: (p: Partial<QA>) => void;
  onDelete: () => void;
  onAddTrigger: (phrase: string) => void;
  onRemoveTrigger: (t: Trigger) => void;
  onAddMedia: (kind: "audio" | "video") => void;
  onUpdateMedia: (m: Media, p: Partial<Media>) => void;
  onRemoveMedia: (m: Media) => void;
  onAudioRecorded: (blob: Blob) => Promise<void>;
}) {
  const { qa, slots, availableVideos, availableAudios, triggerIndex, readOnly, isSuperAdmin } = props;
  const [phraseInput, setPhraseInput] = useState("");
  const [name, setName] = useState(qa.intent_name);
  const [text, setText] = useState(qa.text_response ?? "");
  const [recording, setRecording] = useState(false);

  useEffect(() => setName(qa.intent_name), [qa.intent_name]);
  useEffect(() => setText(qa.text_response ?? ""), [qa.text_response]);

  const { category, name: shortName } = parseIntentName(qa.intent_name);
  const issues = getStatus(qa, triggerIndex);
  const isOk = issues.length === 0;

  return (
    <Card className="p-4 space-y-3 bg-background/60">
      <div className="flex items-start gap-2">
        {category && (
          <Badge variant="secondary" className="mt-2 shrink-0">
            {CATEGORY_EMOJI[category]} {category}
          </Badge>
        )}
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== qa.intent_name && props.onUpdate({ intent_name: name })}
            placeholder={category ? `${category} · Nome do atalho` : "Nome do atalho"}
            className="font-semibold"
          />
          {shortName !== qa.intent_name && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Use o formato <code>"Categoria · Nome"</code> pra organizar.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isOk ? (
            <CheckCircle2 className="w-4 h-4 text-primary" aria-label="Pronto" />
          ) : (
            <span title={issues.join(" • ")}>
              <AlertTriangle className="w-4 h-4 text-warning" />
            </span>
          )}
          {props.onMoveUp && <Button size="icon" variant="ghost" onClick={props.onMoveUp}><ChevronUp className="w-4 h-4" /></Button>}
          {props.onMoveDown && <Button size="icon" variant="ghost" onClick={props.onMoveDown}><ChevronDown className="w-4 h-4" /></Button>}
          {isSuperAdmin && (
            <Button
              size="icon"
              variant="ghost"
              title={qa.is_public ? "Tornar privado" : "Tornar público (todos os consultores veem)"}
              onClick={() => props.onUpdate({ is_public: !qa.is_public })}
            >
              {qa.is_public ? <Globe2 className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
            </Button>
          )}
          {qa.is_public && !isSuperAdmin && (
            <Badge variant="secondary" className="gap-1"><Globe2 className="w-3 h-3" /> Público</Badge>
          )}
          {!readOnly && (
            <Button size="icon" variant="ghost" onClick={props.onDelete}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          )}
        </div>
      </div>

      {/* Avisos */}
      {issues.length > 0 && (
        <div className="rounded border border-warning/30 bg-warning/5 p-2 text-xs space-y-0.5">
          {issues.map((i, idx) => (
            <p key={idx} className="text-warning dark:text-warning flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {i}
            </p>
          ))}
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">❓ Quando o cliente disser…</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {qa.triggers.map((t) => {
            const dup = (triggerIndex.get(t.phrase.toLowerCase().trim()) || []).length > 1;
            const reserved = RESERVED_FLOW_KEYWORDS.includes(t.phrase.toLowerCase().trim());
            return (
              <Badge
                key={t.id}
                variant={dup || reserved ? "destructive" : "outline"}
                className="gap-1 py-1"
                title={dup ? "Duplicado em outro atalho" : reserved ? "Palavra usada pelo fluxo principal" : undefined}
              >
                {t.phrase}
                <button onClick={() => props.onRemoveTrigger(t)} className="hover:text-destructive ml-1">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
          <Input
            value={phraseInput}
            onChange={(e) => setPhraseInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && phraseInput.trim()) {
                e.preventDefault();
                props.onAddTrigger(phraseInput);
                setPhraseInput("");
              }
            }}
            placeholder="Palavra-chave + Enter"
            className="h-8 w-48"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">💬 Resposta em texto</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (qa.text_response ?? "") && props.onUpdate({ text_response: text || null })}
          placeholder="Ex.: 'Relaxa {{nome}}, a iGreen é regulamentada pela ANEEL…' — variáveis disponíveis: {{nome}}, {{telefone}}, {{valor_conta}}"
          className="mt-2"
          rows={3}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">🎙️ Lacunas de mídia (opcional)</Label>
          {(() => {
            const filled = qa.medias.filter(mediaFilled).length;
            const total = qa.medias.length;
            if (total === 0) return null;
            return (
              <Badge variant={filled > 0 ? "default" : "outline"} className="text-[10px]">
                {filled}/{total} preenchida{filled === 1 ? "" : "s"}
              </Badge>
            );
          })()}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 mb-2">
          Cada atalho já tem espaço pra <strong>áudio</strong> e <strong>vídeo</strong>. Vazio = só texto. Preencha pra reforçar a dúvida.
        </p>
        <div className="space-y-2 mt-2">
          {qa.medias.map((m, i) => {
            const filled = mediaFilled(m);
            const isAudioLib = m.media_kind === "audio" && m.media_id;
            const audioObj = isAudioLib ? availableAudios.find((a) => a.id === m.media_id) : null;
            return (
              <div
                key={m.id}
                className={`flex items-center gap-2 p-2 rounded border ${
                  filled
                    ? "bg-primary/5 border-primary/25"
                    : "bg-muted/20 border-dashed border-muted-foreground/30"
                }`}
              >
                <Badge>{i + 1}</Badge>
                <Badge variant="secondary">{m.media_kind === "audio" ? "🎙️ Áudio" : "🎬 Vídeo"}</Badge>
                {!filled && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Lacuna vazia
                  </Badge>
                )}
                {m.media_kind === "video" ? (
                  <Select value={m.media_id ?? ""} onValueChange={(v) => props.onUpdateMedia(m, { media_id: v, slot_key: null })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Escolha o vídeo…" /></SelectTrigger>
                    <SelectContent>
                      {availableVideos.map((v) => (<SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                ) : audioObj ? (
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="text-xs truncate flex-1">{audioObj.label}</span>
                    {audioObj.url && <audio controls src={audioObj.url} className="h-7" />}
                  </div>
                ) : (
                  <Select
                    value={m.slot_key ?? (m.media_id ?? "")}
                    onValueChange={(v) => {
                      if (v.startsWith("lib:")) props.onUpdateMedia(m, { media_id: v.slice(4), slot_key: null });
                      else props.onUpdateMedia(m, { slot_key: v, media_id: null });
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Escolha o áudio…" /></SelectTrigger>
                    <SelectContent>
                      {availableAudios.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Biblioteca</div>
                          {availableAudios.map((a) => (
                            <SelectItem key={`lib-${a.id}`} value={`lib:${a.id}`}>{a.label}</SelectItem>
                          ))}
                        </>
                      )}
                      {slots.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Slots de IA</div>
                          {slots.map((s) => (<SelectItem key={s.slot_key} value={s.slot_key}>{s.label}</SelectItem>))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}
                <Button size="icon" variant="ghost" onClick={() => props.onRemoveMedia(m)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            );
          })}

          {recording ? (
            <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Grave o áudio e clique em ✓ para salvar:</p>
              <AudioRecorderInline
                onRecorded={async (blob) => {
                  await props.onAudioRecorded(blob);
                  setRecording(false);
                }}
              />
              <Button size="sm" variant="ghost" onClick={() => setRecording(false)}>Cancelar</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={() => setRecording(true)}>
                <Mic className="w-3 h-3 mr-1" /> Gravar áudio agora
              </Button>
              <Button size="sm" variant="outline" onClick={() => props.onAddMedia("audio")}>
                <Plus className="w-3 h-3 mr-1" /> + Lacuna áudio
              </Button>
              <Button size="sm" variant="outline" onClick={() => props.onAddMedia("video")}>
                <Plus className="w-3 h-3 mr-1" /> + Lacuna vídeo
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
