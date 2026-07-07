import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AudioPlayer from "@/components/admin/media/AudioPlayer";
import {
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  FileAudio,
  FileVideo,
  FileImage,
  FileText,
  Globe,
  User,
  Tag,
  Pencil,
  Play,
  Eye,
  Star,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Kind = "audio" | "video" | "image" | "document" | "text";
type Media = {
  id: string;
  consultant_id: string | null;
  is_public: boolean;
  kind: Kind;
  label: string;
  url: string | null;
  text_content: string | null;
  active: boolean;
  priority: number;
  step_tags: string[];
  intent_tags: string[];
  is_primary_explainer?: boolean | null;
};

const STEP_OPTIONS: { value: string; label: string }[] = [
  { value: "abertura", label: "Boas-vindas" },
  { value: "descoberta", label: "Descoberta" },
  { value: "pitch", label: "Apresentar economia" },
  { value: "prova_social", label: "Prova social / depoimento" },
  { value: "objecao_preco", label: "Objeção: preço" },
  { value: "objecao_confianca", label: "Objeção: é golpe?" },
  { value: "objecao_burocracia", label: "Objeção: burocracia" },
  { value: "fechamento", label: "Fechamento" },
  { value: "pedir_documento", label: "Pedir documento" },
  { value: "followup", label: "Follow-up (cliente interessado sumiu)" },
  { value: "any", label: "Qualquer momento" },
];

// Cada item descreve uma DÚVIDA específica do lead que essa mídia resolve.
// A IA escolhe a mídia cujo intent_tag bate com a dúvida atual da conversa.
const INTENT_OPTIONS: { value: string; label: string }[] = [
  { value: "como_funciona", label: "Como funciona / explicação geral" },
  { value: "e_golpe", label: "É golpe? / é seguro?" },
  { value: "tem_custo", label: "Tem custo? / é gratuito?" },
  { value: "fidelidade", label: "Tem fidelidade / multa?" },
  { value: "instalacao", label: "Precisa instalar placa?" },
  { value: "trocar_empresa", label: "Vou trocar de distribuidora?" },
  { value: "desconto", label: "Quanto de desconto?" },
  { value: "depoimento", label: "Depoimento / prova social" },
  { value: "club", label: "Conexão Club / benefícios" },
  { value: "cadastro", label: "Como faço o cadastro?" },
  { value: "documentos", label: "Documentos necessários" },
  { value: "demora", label: "Quanto tempo demora?" },
  { value: "objecao_emocional", label: "Medo / receio / 'já me enganaram'" },
];

const QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB

function detectKind(file: File): Kind {
  const t = file.type;
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/")) return "image";
  return "document";
}

function iconFor(kind: Kind) {
  const cls = "w-4 h-4";
  switch (kind) {
    case "audio":
      return <FileAudio className={`${cls} text-info`} />;
    case "video":
      return <FileVideo className={`${cls} text-primary`} />;
    case "image":
      return <FileImage className={`${cls} text-warning`} />;
    case "text":
      return <FileText className={`${cls} text-primary`} />;
    default:
      return <FileText className={`${cls} text-muted-foreground`} />;
  }
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function EditableLabel({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group/lbl flex items-center gap-1 text-sm text-foreground truncate w-full text-left hover:text-primary transition-colors"
        title="Clique para renomear"
      >
        <span className="truncate">{value}</span>
        <Pencil className="w-3 h-3 opacity-0 group-hover/lbl:opacity-60 shrink-0" />
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className="w-full text-sm bg-background border border-primary/40 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

export function MediaColumn({ userId }: { userId: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { isSuperAdmin } = useUserRole(userId);
  const [view, setView] = useState<"mine" | "public">("mine");
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [usedBytes, setUsedBytes] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadList() {
    setLoading(true);
    const q = supabase.from("ai_media_library").select("*");
    const { data } =
      view === "mine"
        ? await q.eq("consultant_id", userId).order("priority", { ascending: false }).order("created_at", { ascending: false })
        : await q.eq("is_public", true).order("priority", { ascending: false }).order("created_at", { ascending: false });
    setItems((data as any) || []);
    setLoading(false);
  }

  async function loadUsage() {
    const { data } = await supabase.storage.from("ai-agent-media").list(userId, { limit: 1000 });
    const total = (data || []).reduce((s, f: any) => s + (f.metadata?.size || 0), 0);
    setUsedBytes(total);
  }

  useEffect(() => {
    loadList();
  }, [view, userId]);
  useEffect(() => {
    loadUsage();
  }, [userId]);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const { sha256File, findExistingByHash } = await import("@/lib/mediaHash");
      let dedupedCount = 0;
      for (const file of arr) {
        if (file.size + usedBytes > QUOTA_BYTES) {
          toast({
            title: "Limite atingido",
            description: "Você atingiu 100 MB de armazenamento.",
            variant: "destructive",
          });
          break;
        }
        const kind = detectKind(file);

        // Dedupe por hash antes de subir
        let contentHash: string | null = null;
        let reuseUrl: string | null = null;
        try {
          contentHash = await sha256File(file);
          const existing = await findExistingByHash(userId, contentHash);
          if (existing?.url) reuseUrl = existing.url;
        } catch (e) {
          console.warn("[mediaHash] falhou:", e);
        }

        let publicUrl = reuseUrl;
        if (!publicUrl) {
          const ext = file.name.split(".").pop() || "bin";
          const safeName = file.name.replace(/\.[^.]+$/, "").replace(/\W+/g, "_").slice(0, 60);
          const path = `${userId}/${Date.now()}-${safeName}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("ai-agent-media")
            .upload(path, file, { upsert: false, contentType: file.type });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
          publicUrl = pub.publicUrl;
        } else {
          dedupedCount++;
        }

        const { error: insErr } = await supabase.from("ai_media_library").insert({
          consultant_id: userId,
          is_public: false,
          kind,
          label: file.name,
          url: publicUrl,
          step_tags: ["any"],
          intent_tags: [],
          active: true,
          priority: 10,
          ...(contentHash ? { content_hash: contentHash } : {}),
        });
        if (insErr) throw insErr;
      }
      toast({
        title: dedupedCount > 0 ? `✅ Mídia adicionada (${dedupedCount} reutilizada${dedupedCount > 1 ? "s" : ""})` : "✅ Mídia adicionada",
      });
      await Promise.all([loadList(), loadUsage()]);
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function toggleActive(m: Media, v: boolean) {
    await supabase.from("ai_media_library").update({ active: v }).eq("id", m.id);
    loadList();
  }

  async function togglePublic(m: Media) {
    const next = !m.is_public;
    const { error } = await supabase
      .from("ai_media_library")
      .update({ is_public: next })
      .eq("id", m.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: next ? "🌐 Mídia tornada pública" : "🔒 Mídia tornada privada",
      description: next
        ? `"${m.label}" agora aparece para todos os consultores como fallback.`
        : `"${m.label}" não está mais disponível publicamente.`,
    });
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_public: next } : x)));
  }

  async function remove(m: Media) {
    const ok = await confirm({ title: `Excluir "${m.label}"?`, confirmText: "Excluir", tone: "danger" });
    if (!ok) return;
    if (m.url && m.consultant_id === userId) {
      // best effort: derive storage path from public URL
      const marker = "/ai-agent-media/";
      const idx = m.url.indexOf(marker);
      if (idx >= 0) {
        const path = decodeURIComponent(m.url.substring(idx + marker.length));
        await supabase.storage.from("ai-agent-media").remove([path]);
      }
    }
    await supabase.from("ai_media_library").delete().eq("id", m.id);
    await Promise.all([loadList(), loadUsage()]);
  }

  async function cloneToMine(m: Media) {
    const { error } = await supabase.rpc("fork_public_ai_media" as any, { _media_id: m.id });
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else {
      toast({ title: "✅ Adicionado à sua biblioteca" });
      setView("mine");
    }
  }

  async function updateTags(m: Media, patch: Partial<Pick<Media, "step_tags" | "intent_tags">>) {
    const { error } = await supabase
      .from("ai_media_library")
      .update(patch)
      .eq("id", m.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
  }

  async function updateLabel(m: Media, newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === m.label) return;
    const { error } = await supabase.from("ai_media_library").update({ label: trimmed }).eq("id", m.id);
    if (error) { toast({ title: "Erro ao renomear", description: error.message, variant: "destructive" }); return; }
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, label: trimmed } : x)));
  }

  async function updatePriority(m: Media, value: number) {
    const v = Number.isFinite(value) ? Math.max(0, Math.min(999, Math.trunc(value))) : 0;
    if (v === m.priority) return;
    const { error } = await supabase.from("ai_media_library").update({ priority: v }).eq("id", m.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setItems((prev) => {
      const next = prev.map((x) => (x.id === m.id ? { ...x, priority: v } : x));
      return next.sort((a, b) => b.priority - a.priority);
    });
  }

  async function togglePrimary(m: Media) {
    const next = !m.is_primary_explainer;
    if (next) {
      // Desmarca apenas a mídia principal do MESMO tipo (vídeo/áudio/imagem).
      // Cada consultor pode ter 1 principal por tipo (índice único por kind).
      await supabase
        .from("ai_media_library")
        .update({ is_primary_explainer: false } as any)
        .eq("consultant_id", userId)
        .eq("kind", m.kind)
        .eq("is_primary_explainer", true);
    }
    const { error } = await supabase
      .from("ai_media_library")
      .update({ is_primary_explainer: next } as any)
      .eq("id", m.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    const kindLabel = m.kind === "video" ? "Vídeo" : m.kind === "audio" ? "Áudio" : "Imagem";
    toast({
      title: next ? `⭐ ${kindLabel} principal definido` : `${kindLabel} principal removido`,
      description: next ? `"${m.label}" será priorizado pela IA quando esse tipo for o ideal.` : undefined,
    });
    setItems((prev) =>
      prev.map((x) => {
        if (x.id === m.id) return { ...x, is_primary_explainer: next };
        if (next && x.consultant_id === userId && x.kind === m.kind) return { ...x, is_primary_explainer: false };
        return x;
      })
    );
  }

  function TagEditor({ m }: { m: Media }) {
    const stepTags = m.step_tags || [];
    const intentTags = m.intent_tags || [];
    const summary =
      stepTags.length === 0
        ? "Sem tags"
        : stepTags
            .map((t) => STEP_OPTIONS.find((o) => o.value === t)?.label || t)
            .slice(0, 2)
            .join(", ") + (stepTags.length > 2 ? ` +${stepTags.length - 2}` : "");
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors max-w-[150px] truncate"
            title="Configurar quando enviar"
          >
            <Tag className="w-3 h-3 shrink-0" />
            <span className="truncate">{summary}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-3" align="end">
          <div>
            <p className="text-xs font-semibold mb-2 text-foreground">Quando enviar?</p>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {STEP_OPTIONS.map((opt) => {
                const checked = stepTags.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = v
                          ? [...stepTags, opt.value]
                          : stepTags.filter((t) => t !== opt.value);
                        updateTags(m, { step_tags: next });
                      }}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold mb-2 text-foreground">Qual dúvida essa mídia resolve?</p>
            <div className="space-y-1.5">
              {INTENT_OPTIONS.map((opt) => {
                const checked = intentTags.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = v
                          ? [...intentTags, opt.value]
                          : intentTags.filter((t) => t !== opt.value);
                        updateTags(m, { intent_tags: next });
                      }}
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const usagePct = Math.min(100, (usedBytes / QUOTA_BYTES) * 100);

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-2xl overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-border">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground text-sm sm:text-base">Mídias</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[140px]">
              <div
                className={`h-full transition-all ${usagePct > 85 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {fmtBytes(usedBytes)} / 100 MB
            </span>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setUploaderOpen((v) => !v)}
          disabled={uploading}
          variant={uploaderOpen ? "secondary" : "default"}
          className="gap-1.5 shrink-0"
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : uploaderOpen ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {uploaderOpen ? "Fechar" : "Enviar"}
        </Button>
      </header>

      <div className="px-4 sm:px-5 pt-3">
        <div className="inline-flex items-center gap-1 p-1 bg-muted/40 rounded-lg border border-border/60">
          <button
            onClick={() => setView("mine")}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
              view === "mine" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="w-3.5 h-3.5" /> Minhas
          </button>
          <button
            onClick={() => setView("public")}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
              view === "public" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="w-3.5 h-3.5" /> Públicas
          </button>
        </div>
      </div>

      {uploaderOpen && (
        <div className="px-4 sm:px-5 pt-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              uploadFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30"
            }`}
          >
            <UploadCloud className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">Arraste ou clique</p>
            <p className="text-[11px] text-muted-foreground">PNG, JPG, PDF, MP3, MP4 — máx. 50 MB</p>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && uploadFiles(e.target.files)}
      />

      <div className="flex-1 overflow-y-auto px-3 pt-5 pb-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma mídia ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((m) => {
              const isMine = m.consultant_id === userId;
              return (
              <li
                key={m.id}
                className="group flex items-center gap-2 px-2 sm:px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors"
              >
                {m.url && (m.kind === "image" || m.kind === "video") ? (
                  <button
                    onClick={() => setPreviewMedia(m)}
                    className="relative w-14 h-14 sm:w-12 sm:h-12 rounded-md overflow-hidden bg-muted/40 border border-border/60 shrink-0 group/thumb"
                    title="Pré-visualizar"
                  >
                    {m.kind === "image" ? (
                      <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                    ) : (
                      <video src={m.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 sm:opacity-0 sm:group-hover/thumb:opacity-100 transition-opacity">
                      <Play className="w-5 h-5 text-white fill-white" />
                    </div>
                    {m.is_primary_explainer && (
                      <span className="absolute top-0.5 left-0.5 bg-warning text-black rounded-full p-0.5">
                        <Star className="w-2.5 h-2.5 fill-current" />
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="w-14 h-14 sm:w-12 sm:h-12 rounded-md bg-muted/40 border border-border/60 shrink-0 flex items-center justify-center">
                    {iconFor(m.kind)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  {isMine ? (
                    <EditableLabel value={m.label} onSave={(v) => updateLabel(m, v)} />
                  ) : (
                    <p className="text-sm text-foreground truncate">{m.label}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground uppercase">
                    {m.kind} · prio {m.priority}
                    {m.is_primary_explainer && <span className="ml-1 text-warning normal-case">⭐ principal</span>}
                  </p>
                </div>
                {m.url && (
                  <button
                    onClick={() => setPreviewMedia(m)}
                    className="text-muted-foreground hover:text-primary p-2 transition-colors shrink-0"
                    aria-label="Pré-visualizar"
                    title="Ver mídia"
                  >
                    <Eye className="w-5 h-5" />
                  </button>
                )}
                {view === "mine" ? (
                  <>
                    {(m.kind === "video" || m.kind === "audio" || m.kind === "image") && (
                      <button
                        onClick={() => togglePrimary(m)}
                        className={`p-1.5 rounded transition-colors shrink-0 ${
                          m.is_primary_explainer
                            ? "text-warning hover:text-warning"
                            : "text-muted-foreground hover:text-warning"
                        }`}
                        title={m.is_primary_explainer
                          ? `${m.kind === "video" ? "Vídeo" : m.kind === "audio" ? "Áudio" : "Imagem"} principal — clique para remover`
                          : `Marcar como ${m.kind === "video" ? "vídeo" : m.kind === "audio" ? "áudio" : "imagem"} principal (1 por tipo)`}
                        aria-label="Mídia principal"
                      >
                        <Star className={`w-4 h-4 ${m.is_primary_explainer ? "fill-current" : ""}`} />
                      </button>
                    )}
                    <Input
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={m.priority}
                      key={`${m.id}-${m.priority}`}
                      onBlur={(e) => updatePriority(m, parseInt(e.target.value, 10))}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="h-6 w-10 text-[10px] px-1 text-center hidden sm:block"
                      title="Prioridade (maior = enviado primeiro)"
                    />
                    <TagEditor m={m} />
                    {isSuperAdmin && (
                      <button
                        onClick={() => togglePublic(m)}
                        className={`p-1.5 rounded transition-colors shrink-0 ${
                          m.is_public
                            ? "text-primary hover:text-primary"
                            : "text-muted-foreground hover:text-primary"
                        }`}
                        title={m.is_public
                          ? "Pública — clique para tornar privada"
                          : "Privada — clique para tornar pública (todos os consultores poderão usar)"}
                        aria-label="Alternar público"
                      >
                        <Globe className="w-4 h-4" />
                      </button>
                    )}
                    <Switch
                      checked={m.active}
                      onCheckedChange={(v) => toggleActive(m, v)}
                      className="scale-75"
                    />
                    <button
                      onClick={() => remove(m)}
                      className="text-muted-foreground hover:text-destructive p-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                      aria-label="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => cloneToMine(m)} className="h-7 text-xs">
                    Clonar
                  </Button>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!previewMedia} onOpenChange={(o) => !o && setPreviewMedia(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base truncate pr-6">{previewMedia?.label}</DialogTitle>
          </DialogHeader>
          {previewMedia?.url && (
            <div className="w-full rounded-lg overflow-hidden bg-black/40">
              {previewMedia.kind === "video" && (
                <video src={previewMedia.url} controls autoPlay playsInline className="w-full max-h-[70vh]" />
              )}
              {previewMedia.kind === "audio" && (
                <audio src={previewMedia.url} controls autoPlay className="w-full p-4" />
              )}
              {previewMedia.kind === "image" && (
                <img src={previewMedia.url} alt={previewMedia.label} className="w-full max-h-[70vh] object-contain" />
              )}
              {previewMedia.kind === "document" && (
                <iframe src={previewMedia.url} className="w-full h-[70vh] bg-white" title={previewMedia.label} />
              )}
            </div>
          )}
          {previewMedia?.url && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <a
                href={previewMedia.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary truncate"
              >
                Abrir em nova aba
              </a>
              <Button size="sm" variant="outline" onClick={() => setPreviewMedia(null)}>
                Fechar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}