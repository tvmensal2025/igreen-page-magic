/**
 * Hook do caderno de anotações da iGreen Academy.
 *
 * Cada consultor pode ter VÁRIAS anotações, organizadas como um caderno
 * profissional: cada uma tem título, data (o "dia") e conteúdo livre, além de
 * uma lista de materiais de apoio (título + link).
 *
 * Persistência: tabela `academy_notes` no Supabase, protegida por RLS — cada
 * consultor só enxerga e edita as próprias anotações.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Um material de apoio: título + link. */
export interface AcademyMaterial {
  /** Identificador local, só para a lista do React (não vai para o banco). */
  id: string;
  titulo: string;
  url: string;
}

/** Como o material é guardado no banco (sem o id local). */
interface StoredMaterial {
  titulo: string;
  url: string;
}

/** Uma anotação completa do caderno. */
export interface AcademyNote {
  id: string;
  title: string;
  /** Data de referência no formato YYYY-MM-DD. */
  noteDate: string;
  content: string;
  materials: AcademyMaterial[];
  updatedAt: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withLocalIds(rows: unknown): AcademyMaterial[] {
  const arr = Array.isArray(rows) ? (rows as StoredMaterial[]) : [];
  return arr.map((m) => ({
    id: localId(),
    titulo: String(m?.titulo ?? ""),
    url: String(m?.url ?? ""),
  }));
}

function toStored(materials: AcademyMaterial[]): StoredMaterial[] {
  return materials
    .map((m) => ({ titulo: m.titulo.trim(), url: m.url.trim() }))
    .filter((m) => m.titulo !== "" || m.url !== "");
}

/** Linha crua vinda do banco. */
interface NoteRow {
  id: string;
  title: string;
  note_date: string;
  content: string;
  materials: unknown;
  updated_at: string;
}

function rowToNote(row: NoteRow): AcademyNote {
  return {
    id: row.id,
    title: row.title ?? "",
    noteDate: row.note_date,
    content: row.content ?? "",
    materials: withLocalIds(row.materials),
    updatedAt: row.updated_at,
  };
}

export function useAcademyNotes() {
  const [notes, setNotes] = useState<AcademyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const consultantIdRef = useRef<string | null>(null);

  // ---- carregamento inicial ----
  const reload = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("academy_notes")
      .select("id, title, note_date, content, materials, updated_at")
      .eq("consultant_id", uid)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (!error && data) {
      setNotes((data as NoteRow[]).map(rowToNote));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id ?? null;
      consultantIdRef.current = uid;
      if (!uid) { if (alive) setLoading(false); return; }
      await reload(uid);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [reload]);

  // ---- criar nova anotação ----
  const createNote = useCallback(async (): Promise<string | null> => {
    const uid = consultantIdRef.current;
    if (!uid) { setStatus("error"); return null; }
    setStatus("saving");
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("academy_notes")
      .insert({ consultant_id: uid, title: "", note_date: today, content: "", materials: [] })
      .select("id, title, note_date, content, materials, updated_at")
      .single();
    if (error || !data) { setStatus("error"); return null; }
    const note = rowToNote(data as NoteRow);
    setNotes((prev) => [note, ...prev]);
    setStatus("saved");
    return note.id;
  }, []);

  // ---- salvar uma anotação (campos editáveis) ----
  const saveNote = useCallback(async (note: AcademyNote) => {
    setStatus("saving");
    const { error } = await supabase
      .from("academy_notes")
      .update({
        title: note.title.trim(),
        note_date: note.noteDate,
        content: note.content,
        materials: toStored(note.materials) as unknown as never,
      })
      .eq("id", note.id);
    setStatus(error ? "error" : "saved");
  }, []);

  // ---- excluir uma anotação ----
  const deleteNote = useCallback(async (id: string) => {
    setStatus("saving");
    const { error } = await supabase.from("academy_notes").delete().eq("id", id);
    if (!error) setNotes((prev) => prev.filter((n) => n.id !== id));
    setStatus(error ? "error" : "saved");
  }, []);

  // ---- edições locais (refletem na UI antes do save) ----
  const patchNoteLocal = useCallback((id: string, patch: Partial<Omit<AcademyNote, "id">>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const addMaterial = useCallback((noteId: string) => {
    setNotes((prev) => prev.map((n) =>
      n.id === noteId
        ? { ...n, materials: [...n.materials, { id: localId(), titulo: "", url: "" }] }
        : n,
    ));
  }, []);

  const updateMaterial = useCallback((noteId: string, matId: string, patch: Partial<Pick<AcademyMaterial, "titulo" | "url">>) => {
    setNotes((prev) => prev.map((n) =>
      n.id === noteId
        ? { ...n, materials: n.materials.map((m) => (m.id === matId ? { ...m, ...patch } : m)) }
        : n,
    ));
  }, []);

  const removeMaterial = useCallback((noteId: string, matId: string) => {
    setNotes((prev) => prev.map((n) =>
      n.id === noteId
        ? { ...n, materials: n.materials.filter((m) => m.id !== matId) }
        : n,
    ));
  }, []);

  return {
    notes, loading, status,
    createNote, saveNote, deleteNote,
    patchNoteLocal, addMaterial, updateMaterial, removeMaterial,
  };
}
