import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  ArrowLeft, BookOpen, Plus, Search, Sparkles, Save, Trash2, Copy, Eye,
  Shield, AlertCircle, Loader2, FileUp, MessageSquare, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, X, CheckCircle2,
} from "lucide-react";

interface Section {
  id: string;
  title: string;
  content: string;
  position: number;
  is_active: boolean;
  persona: string;
  is_critical: boolean;
  keywords: string[];
}

type EditState = Partial<Section> & { _new?: boolean };

async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => it.str).join(" "));
  }
  return parts.join("\n\n");
}

export default function AdminFaq({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<Section[]>([]);
  const [query, setQuery] = useState("");
  const [personaFilter, setPersonaFilter] = useState<string>("all");
  const [criticalFilter, setCriticalFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<EditState | null>(null);
  const [keywordInput, setKeywordInput] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Auto-organize
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [proposal, setProposal] = useState<{ sections: any[]; changes_summary: string } | null>(null);
  const [extraText, setExtraText] = useState("");

  // PDF upload
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  // Preview tester
  const [previewQ, setPreviewQ] = useState("");
  const [previewResp, setPreviewResp] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_knowledge_sections")
      .select("*")
      .order("position", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    }
    setSections((data || []) as Section[]);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections.filter((s) => {
      if (personaFilter !== "all" && s.persona !== personaFilter) return false;
      if (criticalFilter === "yes" && !s.is_critical) return false;
      if (criticalFilter === "no" && s.is_critical) return false;
      if (activeFilter === "active" && !s.is_active) return false;
      if (activeFilter === "inactive" && s.is_active) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        (s.keywords || []).some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [sections, query, personaFilter, criticalFilter, activeFilter]);

  const totalChars = sections.reduce((sum, s) => sum + s.content.length, 0);

  function startNew() {
    setEdit({
      _new: true,
      title: "",
      content: "",
      persona: "ambos",
      is_critical: false,
      keywords: [],
      is_active: true,
      position: (sections[sections.length - 1]?.position ?? -1) + 1,
    });
  }

  function startEdit(s: Section) {
    setEdit({ ...s });
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.title?.trim() || !edit.content?.trim()) {
      toast({ title: "Preencha título e conteúdo", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    const payload: any = {
      title: edit.title!.trim(),
      content: edit.content!.trim(),
      persona: edit.persona || "ambos",
      is_critical: !!edit.is_critical,
      keywords: edit.keywords || [],
      is_active: edit.is_active !== false,
      position: edit.position ?? 0,
    };
    let err;
    if (edit._new) {
      const { error } = await supabase.from("ai_knowledge_sections").insert(payload);
      err = error;
    } else {
      const { error } = await supabase.from("ai_knowledge_sections").update(payload).eq("id", edit.id!);
      err = error;
    }
    setSavingEdit(false);
    if (err) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: "Seção salva" });
    setEdit(null);
    setKeywordInput("");
    load();
  }

  async function deleteSection(id: string) {
    const ok = await confirm({ title: "Excluir esta seção?", description: "Não tem volta.", confirmText: "Excluir", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("ai_knowledge_sections").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Seção excluída" });
    load();
  }

  async function toggleActive(s: Section) {
    const { error } = await supabase.from("ai_knowledge_sections")
      .update({ is_active: !s.is_active }).eq("id", s.id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else load();
  }

  async function duplicate(s: Section) {
    const { error } = await supabase.from("ai_knowledge_sections").insert({
      title: `${s.title} (cópia)`,
      content: s.content,
      persona: s.persona,
      is_critical: s.is_critical,
      keywords: s.keywords,
      is_active: false,
      position: (sections[sections.length - 1]?.position ?? -1) + 1,
    });
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Duplicada (inativa)" }); load(); }
  }

  async function move(s: Section, dir: -1 | 1) {
    const idx = sections.findIndex((x) => x.id === s.id);
    const target = sections[idx + dir];
    if (!target) return;
    const a = supabase.from("ai_knowledge_sections").update({ position: target.position }).eq("id", s.id);
    const b = supabase.from("ai_knowledge_sections").update({ position: s.position }).eq("id", target.id);
    const [r1, r2] = await Promise.all([a, b]);
    if (r1.error || r2.error) toast({ title: "Erro ao reordenar", variant: "destructive" });
    else load();
  }

  async function handlePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setUploadStatus(`Lendo ${file.name}...`);
      const text = await extractTextFromPDF(file);
      if (text.length < 30) {
        toast({ title: "PDF vazio ou escaneado", variant: "destructive" });
      } else {
        setExtraText((prev) => (prev ? prev + "\n\n" : "") + `--- ${file.name} ---\n${text.slice(0, 30000)}`);
        setOrganizeOpen(true);
        toast({ title: `${text.length.toLocaleString("pt-BR")} caracteres extraídos`, description: "Adicionados ao organizador" });
      }
    } catch (err: any) {
      toast({ title: "Erro no PDF", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runOrganize() {
    setOrganizing(true);
    setProposal(null);
    const { data, error } = await supabase.functions.invoke("faq-organizer", {
      body: {
        sections: sections.filter((s) => s.is_active).map((s) => ({
          id: s.id, title: s.title, content: s.content,
          persona: s.persona, is_critical: s.is_critical, keywords: s.keywords,
        })),
        extra_raw_text: extraText,
      },
    });
    setOrganizing(false);
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao organizar", description: (error?.message || (data as any)?.error || "Falha"), variant: "destructive" });
      return;
    }
    setProposal(data as any);
  }

  async function applyProposal() {
    if (!proposal) return;
    if (!confirm(`Substituir as ${sections.filter((s) => s.is_active).length} seções ativas pelas ${proposal.sections.length} novas? As atuais serão desativadas (não excluídas).`)) return;
    setOrganizing(true);
    // 1. desativa todas as ativas atuais
    const { error: e1 } = await supabase
      .from("ai_knowledge_sections")
      .update({ is_active: false })
      .eq("is_active", true);
    if (e1) {
      setOrganizing(false);
      toast({ title: "Erro ao desativar antigas", description: e1.message, variant: "destructive" });
      return;
    }
    // 2. insere novas
    const rows = proposal.sections.map((s, i) => ({
      title: s.title,
      content: s.content,
      persona: s.persona || "ambos",
      is_critical: !!s.is_critical,
      keywords: s.keywords || [],
      is_active: true,
      position: i,
    }));
    const { error: e2 } = await supabase.from("ai_knowledge_sections").insert(rows);
    setOrganizing(false);
    if (e2) {
      toast({ title: "Erro ao inserir", description: e2.message, variant: "destructive" });
      return;
    }
    toast({ title: "FAQ reorganizado com sucesso" });
    setProposal(null);
    setExtraText("");
    setOrganizeOpen(false);
    load();
  }

  async function runPreview() {
    if (!previewQ.trim()) return;
    setPreviewLoading(true);
    setPreviewResp(null);
    const { data, error } = await supabase.functions.invoke("igreen-chat", {
      body: { message: previewQ },
    });
    setPreviewLoading(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setPreviewResp(data);
  }

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k || !edit) return;
    const arr = edit.keywords || [];
    if (arr.includes(k)) return;
    setEdit({ ...edit, keywords: [...arr, k] });
    setKeywordInput("");
  }

  const headerEl = embedded ? null : (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <BookOpen className="h-6 w-6 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold truncate">FAQ da IA</h1>
          <p className="text-xs text-muted-foreground">
            {sections.length} seções · {totalChars.toLocaleString("pt-BR")} caracteres · base que a Camila usa pra responder dúvidas
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOrganizeOpen(true)}>
          <Sparkles className="h-4 w-4 mr-1" /> Organizar com IA
        </Button>
        <Button size="sm" onClick={startNew}>
          <Plus className="h-4 w-4 mr-1" /> Nova
        </Button>
      </div>
    </header>
  );

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {headerEl}

      <main className={embedded ? "space-y-6" : "max-w-6xl mx-auto px-4 py-6 space-y-6"}>
        {embedded && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {sections.length} seções · {totalChars.toLocaleString("pt-BR")} caracteres
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOrganizeOpen(true)}>
                <Sparkles className="h-4 w-4 mr-1" /> Organizar com IA
              </Button>
              <Button size="sm" onClick={startNew}>
                <Plus className="h-4 w-4 mr-1" /> Nova
              </Button>
            </div>
          </div>
        )}
        {/* Banner: como funciona no fluxo */}
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold">Editar o FAQ <span className="underline">não bagunça</span> o fluxo do bot.</p>
              <p className="text-muted-foreground">
                Quando o lead pergunta algo durante o cadastro, o bot primeiro tenta as perguntas do fluxo. Se não bater,
                a IA usa este FAQ pra responder <strong>sem mudar de passo</strong> e termina convidando a continuar o cadastro.
                Se não tiver confiança ou for assunto sensível (cancelamento, reclamação, humano), ela pausa e te notifica.
              </p>
            </div>
          </div>
        </Card>

        {/* Filtros */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="título, conteúdo ou palavra-chave..."
                  className="pl-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Persona</Label>
              <Select value={personaFilter} onValueChange={setPersonaFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="ambos">Ambos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Crítico</Label>
              <Select value={criticalFilter} onValueChange={setCriticalFilter}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="yes">Sim</SelectItem>
                  <SelectItem value="no">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="inactive">Inativos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileUp className="h-4 w-4 mr-1" />}
              {uploading ? (uploadStatus || "Processando...") : "Importar PDF"}
            </Button>
            <input ref={fileRef} type="file" accept=".pdf" hidden onChange={handlePdf} />
          </div>
        </Card>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            Nenhuma seção encontrada. Clique em "Nova" pra criar a primeira.
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => {
              const isOpen = !!expanded[s.id];
              return (
                <Card key={s.id} className={`overflow-hidden ${!s.is_active ? "opacity-60" : ""}`}>
                  <button
                    onClick={() => setExpanded({ ...expanded, [s.id]: !isOpen })}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 text-primary shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="text-xs text-muted-foreground w-8">#{s.position}</span>
                    <span className="font-medium flex-1 truncate">{s.title}</span>
                    {s.is_critical && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Crítico</Badge>}
                    <Badge variant="outline" className="text-[10px]">{s.persona}</Badge>
                    {!s.is_active && <Badge variant="secondary">inativa</Badge>}
                    <span className="text-[10px] text-muted-foreground">{s.content.length.toLocaleString("pt-BR")} chars</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-3 bg-secondary/10">
                      <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80 max-h-[300px] overflow-auto bg-background/60 p-3 rounded">
                        {s.content}
                      </pre>
                      {(s.keywords || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {s.keywords.map((k) => (
                            <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(s)}><Save className="h-3 w-3 mr-1" />Editar</Button>
                        <Button size="sm" variant="outline" onClick={() => duplicate(s)}><Copy className="h-3 w-3 mr-1" />Duplicar</Button>
                        <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>
                          {s.is_active ? "Desativar" : "Ativar"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => move(s, -1)}><ArrowUp className="h-3 w-3" /></Button>
                        <Button size="sm" variant="outline" onClick={() => move(s, 1)}><ArrowDown className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => deleteSection(s.id)}>
                          <Trash2 className="h-3 w-3 mr-1" />Excluir
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* Preview tester */}
        <Card className="p-5 border-primary/20">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Testar resposta da IA</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Digite uma pergunta como um cliente faria. Veja o que a IA responderia usando o FAQ atual.
          </p>
          <div className="flex gap-2">
            <Input
              value={previewQ}
              onChange={(e) => setPreviewQ(e.target.value)}
              placeholder="Ex: Quanto custa pra ser consultor?"
              onKeyDown={(e) => e.key === "Enter" && runPreview()}
            />
            <Button onClick={runPreview} disabled={previewLoading || !previewQ.trim()}>
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            </Button>
          </div>
          {previewResp && (
            <div className="mt-4 rounded-lg bg-secondary/30 p-3 text-sm whitespace-pre-wrap">
              {previewResp.reply || previewResp.text || JSON.stringify(previewResp, null, 2)}
            </div>
          )}
        </Card>
      </main>

      {/* Modal Editor */}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) { setEdit(null); setKeywordInput(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit?._new ? "Nova seção" : "Editar seção"}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div>
                <Label>Título</Label>
                <Input value={edit.title || ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Ex: COMO FUNCIONA O CASHBACK" />
              </div>
              <div>
                <Label>Conteúdo</Label>
                <Textarea
                  value={edit.content || ""}
                  onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                  className="min-h-[240px] font-mono text-sm"
                  placeholder="Conteúdo que a IA vai usar pra responder..."
                />
                <p className="text-[10px] text-muted-foreground mt-1">{(edit.content || "").length.toLocaleString("pt-BR")} chars</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Persona</Label>
                  <Select value={edit.persona || "ambos"} onValueChange={(v) => setEdit({ ...edit, persona: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Lead (ainda não é cliente)</SelectItem>
                      <SelectItem value="cliente">Cliente (já contratou)</SelectItem>
                      <SelectItem value="ambos">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Posição</Label>
                  <Input type="number" value={edit.position ?? 0} onChange={(e) => setEdit({ ...edit, position: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Resposta crítica</p>
                  <p className="text-xs text-muted-foreground">IA usa texto exato, não pode parafrasear (CNPJ, contatos, valores legais).</p>
                </div>
                <Switch checked={!!edit.is_critical} onCheckedChange={(v) => setEdit({ ...edit, is_critical: v })} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Ativa</p>
                  <p className="text-xs text-muted-foreground">Se desligado, a IA ignora esta seção.</p>
                </div>
                <Switch checked={edit.is_active !== false} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} />
              </div>
              <div>
                <Label>Palavras-chave</Label>
                <div className="flex gap-2">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                    placeholder="digite e Enter"
                  />
                  <Button type="button" variant="outline" onClick={addKeyword}>Adicionar</Button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(edit.keywords || []).map((k) => (
                    <Badge key={k} variant="secondary" className="gap-1">
                      {k}
                      <button onClick={() => setEdit({ ...edit, keywords: (edit.keywords || []).filter((x) => x !== k) })}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setEdit(null); setKeywordInput(""); }}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Auto-organize */}
      <Dialog open={organizeOpen} onOpenChange={(o) => { if (!o) { setOrganizeOpen(false); setProposal(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Organizar FAQ com IA</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A IA vai ler as seções ativas (e o texto extra abaixo, se houver), deduplicar, consolidar temas, sugerir títulos,
              palavras-chave e ordenar pela jornada do lead. Você revisa antes de aplicar.
            </p>
            <div>
              <Label>Texto extra (opcional) — colar conteúdo bruto pra IA absorver</Label>
              <Textarea
                value={extraText}
                onChange={(e) => setExtraText(e.target.value)}
                placeholder="Cole aqui texto de PDFs, scripts, e-mails, regulamentos..."
                className="min-h-[140px] font-mono text-xs"
              />
            </div>

            {!proposal && (
              <Button onClick={runOrganize} disabled={organizing} className="w-full">
                {organizing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {organizing ? "IA pensando..." : "Gerar proposta organizada"}
              </Button>
            )}

            {proposal && (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold mb-1">Resumo das mudanças</p>
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">{proposal.changes_summary}</p>
                </div>
                <div className="text-sm font-semibold">Nova proposta ({proposal.sections.length} seções):</div>
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {proposal.sections.map((s: any, i: number) => (
                    <div key={i} className="rounded-lg border p-3 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">#{i}</span>
                        <span className="font-medium text-sm">{s.title}</span>
                        <Badge variant="outline" className="text-[10px]">{s.persona}</Badge>
                        {s.is_critical && <Badge variant="destructive" className="text-[10px]">crítico</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-3">{s.content}</p>
                      {s.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {s.keywords.map((k: string) => (
                            <Badge key={k} variant="secondary" className="text-[9px]">{k}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setProposal(null)} className="flex-1">
                    Descartar e gerar de novo
                  </Button>
                  <Button onClick={applyProposal} disabled={organizing} className="flex-1">
                    {organizing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    Aplicar proposta
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
