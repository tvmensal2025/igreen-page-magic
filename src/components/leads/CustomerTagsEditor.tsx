import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Loader2, Pencil, Check } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import {
  MAX_TAG_NAME_LEN,
  MAX_TAGS_PER_CONTACT,
  TAG_COLOR_PALETTE,
  phoneToRemoteJid,
  useCustomerTags,
  type CustomerTag,
} from "@/hooks/useCustomerTags";

interface Props {
  consultantId: string;
  phone: string | null | undefined;
  /** compact = chips na lista; full = editor com rename no chat */
  compact?: boolean;
  /** Tags pré-carregadas (lista); se omitido, carrega via hook */
  preloadedTags?: CustomerTag[];
  onTagsChange?: () => void;
  className?: string;
}

export function CustomerTagsEditor({
  consultantId,
  phone,
  compact = false,
  preloadedTags,
  onTagsChange,
  className = "",
}: Props) {
  const remoteJid = phoneToRemoteJid(phone);
  const useHook = !preloadedTags;
  const hook = useCustomerTags(useHook ? remoteJid : null, useHook ? consultantId : null);
  const tags = preloadedTags ?? hook.tags;
  const loading = useHook ? hook.loading : false;

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<string>(TAG_COLOR_PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  if (!remoteJid) {
    if (compact) return null;
    return (
      <p className={`text-[10px] text-muted-foreground ${className}`}>
        Sem telefone válido — tags indisponíveis.
      </p>
    );
  }

  async function handleAdd() {
    const name = draft.trim().slice(0, MAX_TAG_NAME_LEN);
    if (!name) return;
    setBusy(true);
    try {
      if (useHook) {
        await hook.add(name, color);
      } else {
        if (tags.length >= MAX_TAGS_PER_CONTACT) throw new Error(`Máximo de ${MAX_TAGS_PER_CONTACT} tags`);
        if (tags.some((t) => t.tag_name.toLowerCase() === name.toLowerCase())) {
          throw new Error("Tag já existe");
        }
        const { error } = await supabase.from("customer_tags").insert({
          consultant_id: consultantId,
          remote_jid: remoteJid!,
          tag_name: name,
          tag_color: color,
        });
        if (error) throw error;
      }
      onTagsChange?.();
      setDraft("");
      setAdding(false);
      toast.success("Tag adicionada");
    } catch (e) {
      toast.error((e as Error).message || "Falha ao adicionar tag");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    try {
      if (useHook) {
        await hook.remove(id);
      } else {
        const { error } = await supabase.from("customer_tags").delete().eq("id", id);
        if (error) throw error;
      }
      onTagsChange?.();
    } catch (e) {
      toast.error((e as Error).message || "Falha ao remover tag");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim().slice(0, MAX_TAG_NAME_LEN);
    if (!name) return;
    setBusy(true);
    try {
      if (useHook) {
        await hook.update(id, { tag_name: name });
      } else {
        const { error } = await supabase
          .from("customer_tags")
          .update({ tag_name: name })
          .eq("id", id);
        if (error) throw error;
      }
      onTagsChange?.();
      setEditingId(null);
      toast.success("Tag atualizada");
    } catch (e) {
      toast.error((e as Error).message || "Falha ao editar tag");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {tags.map((t) =>
        editingId === t.id && !compact ? (
          <span key={t.id} className="inline-flex items-center gap-0.5">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={MAX_TAG_NAME_LEN}
              className="h-6 w-24 text-[10px] px-1.5"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename(t.id);
                if (e.key === "Escape") setEditingId(null);
              }}
            />
            <button
              type="button"
              className="p-0.5 rounded hover:bg-muted"
              disabled={busy}
              onClick={() => void handleRename(t.id)}
              aria-label="Salvar nome"
            >
              <Check className="h-3 w-3 text-primary" />
            </button>
          </span>
        ) : (
          <span
            key={t.id}
            className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium max-w-[120px]"
            style={{
              borderColor: `${t.tag_color}55`,
              backgroundColor: `${t.tag_color}18`,
              color: t.tag_color,
            }}
            title={t.tag_name}
          >
            <span className="truncate">{t.tag_name}</span>
            {!compact && (
              <button
                type="button"
                className="shrink-0 opacity-70 hover:opacity-100"
                disabled={busy}
                onClick={() => {
                  setEditingId(t.id);
                  setEditName(t.tag_name);
                }}
                aria-label={`Editar ${t.tag_name}`}
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 opacity-70 hover:opacity-100"
              disabled={busy}
              onClick={() => void handleRemove(t.id)}
              aria-label={`Remover ${t.tag_name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ),
      )}

      {!adding && tags.length < MAX_TAGS_PER_CONTACT && (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:bg-muted"
          onClick={() => setAdding(true)}
          title="Adicionar tag"
        >
          <Plus className="h-2.5 w-2.5" />
          {!compact && <span>Tag</span>}
        </button>
      )}

      {adding && (
        <span className="inline-flex items-center gap-1 flex-wrap">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_TAG_NAME_LEN}
            placeholder="Nome"
            className="h-6 w-24 text-[10px] px-1.5"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
          />
          <span className="inline-flex gap-0.5">
            {TAG_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`h-3.5 w-3.5 rounded-full border ${
                  color === c ? "ring-1 ring-offset-1 ring-foreground" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
              />
            ))}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={busy || !draft.trim()}
            onClick={() => void handleAdd()}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Ok"}
          </Button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground px-1"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
          >
            Cancelar
          </button>
        </span>
      )}
    </div>
  );
}
