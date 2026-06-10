import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Brain, Save, Loader2, Info, Lightbulb, Upload, FileText, X, CheckCircle, ChevronDown, ChevronRight, Eye } from "lucide-react";

interface UploadedDoc {
  name: string;
  text: string;
  date: string;
}

interface KnowledgeSection {
  id: string;
  title: string;
  content: string;
  position: number;
  is_active: boolean;
}

async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
    if (pageText.trim()) textParts.push(`[Página ${i}]\n${pageText}`);
  }

  return textParts.join("\n\n");
}

function KnowledgeSectionCard({ section }: { section: KnowledgeSection }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-primary shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-medium text-primary/80">#{section.position}</span>
        <span className="text-sm font-medium text-foreground flex-1">{section.title}</span>
        <span className="text-[10px] text-muted-foreground">{section.content.length.toLocaleString("pt-BR")} chars</span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-border/30 bg-secondary/10">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
            {section.content}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AIKnowledgePanel() {
  const [extraKnowledge, setExtraKnowledge] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [showSections, setShowSections] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadKnowledge();
  }, []);

  const loadKnowledge = async () => {
    setLoading(true);
    const [extraRes, docsRes, sectionsRes] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "ai_knowledge_extra").maybeSingle(),
      supabase.from("settings").select("value").eq("key", "ai_knowledge_docs").maybeSingle(),
      supabase.from("ai_knowledge_sections").select("*").eq("is_active", true).order("position", { ascending: true }),
    ]);

    if (extraRes.data?.value) setExtraKnowledge(extraRes.data.value);
    if (docsRes.data?.value) {
      try { setUploadedDocs(JSON.parse(docsRes.data.value)); } catch {}
    }
    if (sectionsRes.data) setSections(sectionsRes.data);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { key: "ai_knowledge_extra", value: extraKnowledge } as any,
          { onConflict: "key" }
        );

      if (error) {
        console.error("Save error:", error);
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "✅ Conhecimento da IA atualizado!", description: "As mudanças já estão ativas." });
      }
    } catch (err: any) {
      console.error("Save exception:", err);
      toast({ title: "Erro ao salvar", description: err.message || "Falha inesperada", variant: "destructive" });
    }
    setSaving(false);
  };

  const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const newDocs: UploadedDoc[] = [];

    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast({ title: "Arquivo ignorado", description: `${file.name} não é PDF`, variant: "destructive" });
        continue;
      }

      try {
        setUploadProgress(`Lendo ${file.name}...`);
        const rawText = await extractTextFromPDF(file);

        if (rawText.length < 30) {
          toast({
            title: `⚠️ ${file.name}`,
            description: "PDF parece ser uma imagem escaneada. Copie o conteúdo manualmente.",
            variant: "destructive",
          });
          continue;
        }

        setUploadProgress(`Organizando ${file.name} com IA...`);

        const { data: aiData, error: aiError } = await supabase.functions.invoke("igreen-chat", {
          body: {
            message: `Organize o seguinte conteúdo extraído de um PDF chamado "${file.name}" em formato limpo e estruturado para servir como base de conhecimento. Mantenha TODAS as informações importantes (valores, datas, regras, comissões, produtos, percentuais, tabelas, etc). Remova apenas lixo de formatação (cabeçalhos repetidos, números de página). Responda APENAS com o conteúdo organizado, sem explicações:\n\n${rawText.substring(0, 20000)}`,
          },
        });

        if (aiError) throw aiError;

        const organizedText = aiData?.reply || rawText;

        newDocs.push({
          name: file.name,
          text: organizedText,
          date: new Date().toISOString(),
        });

        toast({ title: `✅ ${file.name} processado!`, description: `${organizedText.length.toLocaleString("pt-BR")} caracteres extraídos.` });
      } catch (err: any) {
        console.error("PDF upload error:", err);
        toast({ title: `Erro em ${file.name}`, description: err.message || "Falha ao processar", variant: "destructive" });
      }
    }

    if (newDocs.length > 0) {
      const allDocs = [...uploadedDocs, ...newDocs];
      setUploadedDocs(allDocs);

      await supabase.from("settings").upsert(
        { key: "ai_knowledge_docs", value: JSON.stringify(allDocs) } as any,
        { onConflict: "key" }
      );

      const docsText = newDocs.map(d =>
        `\n\n--- DOCUMENTO: ${d.name} (${new Date(d.date).toLocaleDateString("pt-BR")}) ---\n${d.text}`
      ).join("");
      const updatedKnowledge = extraKnowledge + docsText;
      setExtraKnowledge(updatedKnowledge);

      await supabase
        .from("settings")
        .upsert(
          { key: "ai_knowledge_extra", value: updatedKnowledge } as any,
          { onConflict: "key" }
        );

      toast({ title: "🧠 IA atualizada!", description: `${newDocs.length} documento(s) integrado(s) ao conhecimento.` });
    }

    setUploading(false);
    setUploadProgress("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeDoc = async (index: number) => {
    const doc = uploadedDocs[index];
    const newDocs = uploadedDocs.filter((_, i) => i !== index);
    setUploadedDocs(newDocs);

    const marker = `--- DOCUMENTO: ${doc.name}`;
    const lines = extraKnowledge.split("\n");
    const filteredLines: string[] = [];
    let skipping = false;

    for (const line of lines) {
      if (line.includes(marker)) {
        skipping = true;
        continue;
      }
      if (skipping && line.startsWith("--- DOCUMENTO:")) {
        skipping = false;
      }
      if (!skipping) filteredLines.push(line);
    }

    const updatedKnowledge = filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    setExtraKnowledge(updatedKnowledge);

    await Promise.all([
      supabase.from("settings").upsert({ key: "ai_knowledge_docs", value: JSON.stringify(newDocs) } as any, { onConflict: "key" }),
      supabase.from("settings").upsert({ key: "ai_knowledge_extra", value: updatedKnowledge } as any, { onConflict: "key" }),
    ]);

    toast({ title: "Documento removido", description: `${doc.name} foi removido do conhecimento da IA.` });
  };

  const totalChars = sections.reduce((sum, s) => sum + s.content.length, 0) + extraKnowledge.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-primary" />
        <div>
          <h2 className="font-heading font-bold text-foreground text-lg">Gestão do Conhecimento da IA</h2>
          <p className="text-xs text-muted-foreground">
            {sections.length} seções ativas · {totalChars.toLocaleString("pt-BR")} caracteres totais
          </p>
        </div>
      </div>

      {/* Base Knowledge Sections - Collapsible */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <button
          onClick={() => setShowSections(!showSections)}
          className="flex items-center gap-2 w-full text-left"
        >
          <Eye className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Base de Conhecimento ({sections.length} seções)
            </p>
            <p className="text-xs text-muted-foreground">
              Clique para ver todo o conteúdo que a IA sabe
            </p>
          </div>
          {showSections ? (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
        </button>

        {showSections && (
          <div className="space-y-1.5 pt-2">
            {sections.map((section) => (
              <KnowledgeSectionCard key={section.id} section={section} />
            ))}
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-foreground space-y-2">
            <p className="font-semibold">Como adicionar conhecimento extra?</p>
            <p className="text-muted-foreground text-xs">
              A base acima é fixa. Use o campo abaixo ou envie PDFs para adicionar informações extras (promoções, eventos, regras novas, etc).
            </p>
          </div>
        </div>
      </div>

      {/* PDF Upload Section */}
      <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          <p className="text-sm font-semibold text-foreground">Upload de PDFs — A IA lê e aprende automaticamente</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Envie PDFs com tabelas de comissão, scripts de venda, regulamentos, treinamentos, etc.
          O sistema extrai o texto, a IA organiza e integra ao conhecimento.
        </p>

        <div className="flex gap-3 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handlePDFUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            variant="outline"
            className="gap-2 border-primary/40 hover:bg-primary/10"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {uploading ? uploadProgress || "Processando..." : "Enviar PDF(s)"}
          </Button>
          {!uploading && <span className="text-xs text-muted-foreground">Aceita múltiplos PDFs de uma vez</span>}
        </div>

        {uploadedDocs.length > 0 && (
          <div className="space-y-2 mt-3">
            <p className="text-xs font-medium text-muted-foreground">Documentos integrados ({uploadedDocs.length}):</p>
            {uploadedDocs.map((doc, i) => (
              <div key={i} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span className="text-sm text-foreground">{doc.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({new Date(doc.date).toLocaleDateString("pt-BR")}) — {doc.text.length.toLocaleString("pt-BR")} chars
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeDoc(i)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-warning" />
          <p className="text-sm font-semibold text-foreground">Dicas para deixar a IA mais inteligente:</p>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1.5 pl-6 list-disc">
          <li><strong>Promoções atuais:</strong> "Em julho/2025, temos promoção de R$200 de bônus extra por licenciado"</li>
          <li><strong>Novos produtos:</strong> "Lançamos o Conexão Auto - seguro veicular com comissão de 15%"</li>
          <li><strong>Atualizações de comissão:</strong> "A partir de agosto, Conexão Green em MG passa para 5% CP"</li>
          <li><strong>Eventos:</strong> "Próximo Grand Show será dia 15/08 em São Paulo"</li>
          <li><strong>Scripts de venda:</strong> "Quando o cliente perguntar sobre prazo, dizer que..."</li>
          <li><strong>Regras novas:</strong> "Novo critério: mínimo 100 kWh para clientes do Nordeste"</li>
          <li><strong>Links úteis:</strong> "Link do treinamento novo: https://..."</li>
        </ul>
      </div>

      {/* Editor */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Carregando...</span>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            Conhecimento Extra da IA (texto manual + conteúdo dos PDFs)
          </label>
          <Textarea
            value={extraKnowledge}
            onChange={(e) => setExtraKnowledge(e.target.value)}
            placeholder={`Escreva aqui informações extras para a IA...

Exemplo:
PROMOÇÕES ATIVAS:
— Até 30/07/2025: Bônus de R$500 para quem cadastrar 10 clientes no mês

EVENTOS:
— Grand Show dia 20/08 em Uberlândia, MG`}
            className="min-h-[300px] font-mono text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {extraKnowledge.length.toLocaleString("pt-BR")} caracteres extras
            </span>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Conhecimento
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
