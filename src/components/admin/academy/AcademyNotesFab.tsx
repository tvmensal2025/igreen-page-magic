/**
 * Botão flutuante (FAB) + caderno de anotações da iGreen Academy.
 *
 * O aluno mantém VÁRIAS anotações, cada uma com título, data e conteúdo, além
 * de materiais de apoio (título + link). Tudo é salvo no Supabase
 * automaticamente (ver useAcademyNotes).
 *
 * Duas telas dentro do painel:
 *  - LISTA: todas as anotações (título + data), com busca e botão "Nova".
 *  - EDITOR: edição de uma anotação específica (salva sozinho).
 *
 * Tema: iGreen oficial (modo escuro) — ver ./theme.ts
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  NotebookPen, X, Plus, Trash2, ExternalLink, Loader2, Check, AlertCircle,
  ArrowLeft, Search, FileText, Calendar,
} from "lucide-react";
import {
  useAcademyNotes, type SaveStatus, type AcademyNote,
} from "@/hooks/useAcademyNotes";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

const SAVE_DEBOUNCE_MS = 800;

function StatusPill({ status, loading }: { status: SaveStatus; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: AC.textMute }}>
        <Loader2 className="w-3 h-3 animate-spin" /> Carregando…
      </span>
    );
  }
  const map = {
    saving: { icon: <Loader2 className="w-3 h-3 animate-spin" />, text: "Salvando…", color: AC.textMute },
    saved:  { icon: <Check className="w-3 h-3" />, text: "Salvo", color: AC.primary },
    error:  { icon: <AlertCircle className="w-3 h-3" />, text: "Erro ao salvar", color: AC.danger },
    idle:   null,
  } as const;
  const item = map[status];
  if (!item) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: item.color }}>
      {item.icon} {item.text}
    </span>
  );
}

/** Formata YYYY-MM-DD para DD/MM/AAAA sem depender de timezone. */
function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/* ============================ EDITOR ============================ */
function NoteEditor({
  note, onBack,
  patchNoteLocal, saveNote, deleteNote,
  addMaterial, updateMaterial, removeMaterial,
}: {
  note: AcademyNote;
  onBack: () => void;
  patchNoteLocal: ReturnType<typeof useAcademyNotes>["patchNoteLocal"];
  saveNote: ReturnType<typeof useAcademyNotes>["saveNote"];
  deleteNote: ReturnType<typeof useAcademyNotes>["deleteNote"];
  addMaterial: ReturnType<typeof useAcademyNotes>["addMaterial"];
  updateMaterial: ReturnType<typeof useAcademyNotes>["updateMaterial"];
  removeMaterial: ReturnType<typeof useAcademyNotes>["removeMaterial"];
}) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // salva a anotação com debounce sempre que algo muda
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void saveNote(note); }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [note, saveNote]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
      {/* voltar + excluir */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => { void saveNote(note); onBack(); }}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/10"
          style={{ color: AC.textDim }}
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <button
          onClick={() => { if (confirm("Excluir esta anotação?")) { void deleteNote(note.id); onBack(); } }}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/10"
          style={{ color: AC.danger }}
        >
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
      </div>

      {/* título */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
          Título
        </label>
        <input
          value={note.title}
          onChange={(e) => patchNoteLocal(note.id, { title: e.target.value })}
          placeholder="Ex.: Aula 3 — Técnicas de objeção"
          className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2"
          style={{ background: AC.bg, color: AC.text, border: `1px solid ${AC.border}`, fontFamily: AC_FONT_DISPLAY }}
        />
      </div>

      {/* data */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
          Data
        </label>
        <div className="relative">
          <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: AC.textMute }} />
          <input
            type="date"
            value={note.noteDate}
            onChange={(e) => patchNoteLocal(note.id, { noteDate: e.target.value })}
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2"
            style={{ background: AC.bg, color: AC.text, border: `1px solid ${AC.border}`, colorScheme: "dark" }}
          />
        </div>
      </div>

      {/* conteúdo */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
          Anotação
        </label>
        <textarea
          value={note.content}
          onChange={(e) => patchNoteLocal(note.id, { content: e.target.value })}
          placeholder="Escreva aqui o que aprendeu nesta aula…"
          rows={9}
          className="w-full resize-y rounded-lg px-3 py-2.5 text-sm leading-relaxed outline-none focus:ring-2"
          style={{ background: AC.bg, color: AC.text, border: `1px solid ${AC.border}` }}
        />
      </div>

      {/* materiais */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
            Materiais
          </label>
          <button
            onClick={() => addMaterial(note.id)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors hover:bg-white/10"
            style={{ color: AC.text, border: `1px solid ${AC.border}` }}
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        </div>

        {note.materials.length === 0 && (
          <p className="text-[12px]" style={{ color: AC.textMute }}>
            Nenhum material. Adicione links de PDFs, planilhas ou vídeos de apoio.
          </p>
        )}

        <div className="space-y-3">
          {note.materials.map((m) => (
            <div key={m.id} className="rounded-lg p-3 space-y-2" style={{ background: AC.bg, border: `1px solid ${AC.border}` }}>
              <div className="flex items-center gap-2">
                <input
                  value={m.titulo}
                  onChange={(e) => updateMaterial(note.id, m.id, { titulo: e.target.value })}
                  placeholder="Título do material"
                  className="flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-2"
                  style={{ background: AC.surface2, color: AC.text, border: `1px solid ${AC.border}` }}
                />
                <button
                  onClick={() => removeMaterial(note.id, m.id)}
                  aria-label="Remover material"
                  className="p-1.5 rounded-md transition-colors hover:bg-white/10 shrink-0"
                  style={{ color: AC.textMute }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={m.url}
                  onChange={(e) => updateMaterial(note.id, m.id, { url: e.target.value })}
                  placeholder="https://…"
                  inputMode="url"
                  className="flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-xs outline-none focus:ring-2"
                  style={{ background: AC.surface2, color: AC.textDim, border: `1px solid ${AC.border}` }}
                />
                {m.url.trim() && (
                  <a
                    href={m.url.trim()} target="_blank" rel="noopener noreferrer"
                    aria-label="Abrir link"
                    className="p-1.5 rounded-md transition-colors hover:bg-white/10 shrink-0"
                    style={{ color: AC.primary }}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================ LISTA ============================ */
function NotesList({
  notes, loading, onOpen, onNew,
}: {
  notes: AcademyNote[];
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }, [notes, search]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* busca + nova */}
      <div className="px-5 pt-4 pb-3 space-y-3 shrink-0">
        <button
          onClick={onNew}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: `linear-gradient(135deg, ${AC.primary}, ${AC.primaryDeep})`, color: "#FFFFFF", fontFamily: AC_FONT_DISPLAY }}
        >
          <Plus className="w-4 h-4" /> Nova anotação
        </button>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: AC.textMute }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar anotações…"
            className="w-full rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2"
            style={{ background: AC.bg, color: AC.text, border: `1px solid ${AC.border}` }}
          />
        </div>
      </div>

      {/* lista */}
      <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2.5">
        {loading && (
          <p className="text-center text-[12px] py-8" style={{ color: AC.textMute }}>
            <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Carregando…
          </p>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <FileText className="w-8 h-8 mx-auto opacity-40" style={{ color: AC.textMute }} />
            <p className="text-[13px]" style={{ color: AC.textMute }}>
              {notes.length === 0 ? "Nenhuma anotação ainda." : "Nada encontrado."}
            </p>
          </div>
        )}

        {!loading && filtered.map((n) => (
          <button
            key={n.id}
            onClick={() => onOpen(n.id)}
            className="w-full text-left rounded-lg p-3.5 transition-colors hover:bg-white/[0.04]"
            style={{ background: AC.bg, border: `1px solid ${AC.border}` }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold truncate flex-1" style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
                {n.title.trim() || "Sem título"}
              </h3>
              <span className="text-[10px] shrink-0 inline-flex items-center gap-1" style={{ color: AC.primary }}>
                <Calendar className="w-3 h-3" /> {formatDateBR(n.noteDate)}
              </span>
            </div>
            {n.content.trim() && (
              <p className="text-[12px] mt-1.5 line-clamp-2" style={{ color: AC.textDim }}>
                {n.content.trim()}
              </p>
            )}
            {n.materials.length > 0 && (
              <p className="text-[10px] mt-2 inline-flex items-center gap-1" style={{ color: AC.textMute }}>
                <ExternalLink className="w-3 h-3" /> {n.materials.length} material{n.materials.length !== 1 ? "is" : ""}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ FAB ============================ */
export function AcademyNotesFab() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const {
    notes, loading, status,
    createNote, saveNote, deleteNote,
    patchNoteLocal, addMaterial, updateMaterial, removeMaterial,
  } = useAcademyNotes();

  // fecha com ESC (volta para a lista se estiver no editor)
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeId) setActiveId(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, activeId]);

  const activeNote = activeId ? notes.find((n) => n.id === activeId) ?? null : null;

  const handleNew = async () => {
    const id = await createNote();
    if (id) setActiveId(id);
  };

  return (
    <>
      {/* botão flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir caderno de anotações"
          className="fixed bottom-20 max-lg:bottom-20 lg:bottom-5 right-4 lg:right-5 z-[110] flex items-center gap-2 rounded-full min-h-[48px] min-w-[48px] px-3 lg:px-4 py-3 shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{
            background: `linear-gradient(135deg, ${AC.primary}, ${AC.primaryDeep})`,
            color: "#FFFFFF", fontFamily: AC_FONT_DISPLAY,
            boxShadow: "0 10px 30px -8px rgba(0,168,89,0.6)",
          }}
        >
          <NotebookPen className="w-5 h-5" />
          <span className="hidden sm:inline text-sm font-semibold">Anotações</span>
          {notes.length > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-2"
              style={{ background: AC.primary, color: "#FFFFFF", borderColor: AC.bg }}
            >
              {notes.length}
            </span>
          )}
        </button>
      )}

      {/* overlay + drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[110] animate-in fade-in duration-200"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => setOpen(false)}
          />
          <aside
            className="fixed top-0 right-0 z-[120] h-full w-full sm:w-[440px] flex flex-col animate-in slide-in-from-right duration-300"
            style={{ background: AC.surface, borderLeft: `1px solid ${AC.border}`, color: AC.text, fontFamily: AC_FONT_BODY }}
          >
            <header className="flex items-center justify-between gap-3 px-5 h-16 shrink-0" style={{ borderBottom: `1px solid ${AC.border}` }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <NotebookPen className="w-5 h-5 shrink-0" style={{ color: AC.primary }} />
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-tight" style={{ fontFamily: AC_FONT_DISPLAY }}>
                    {activeNote ? "Editar anotação" : "Meu caderno"}
                  </h2>
                  <StatusPill status={status} loading={loading} />
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="p-2 rounded-lg transition-colors hover:bg-white/10"
                style={{ color: AC.textDim }}
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            {activeNote ? (
              <NoteEditor
                note={activeNote}
                onBack={() => setActiveId(null)}
                patchNoteLocal={patchNoteLocal}
                saveNote={saveNote}
                deleteNote={deleteNote}
                addMaterial={addMaterial}
                updateMaterial={updateMaterial}
                removeMaterial={removeMaterial}
              />
            ) : (
              <NotesList notes={notes} loading={loading} onOpen={setActiveId} onNew={handleNew} />
            )}

            <footer className="px-5 py-3 shrink-0 text-center" style={{ borderTop: `1px solid ${AC.border}` }}>
              <p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: AC.textMute, fontFamily: AC_FONT_DISPLAY }}>
                Salvo automaticamente · iGreen Academy
              </p>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}
