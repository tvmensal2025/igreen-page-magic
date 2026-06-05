import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, AlertTriangle, Trash2, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ReferralPartner } from "./hooks/useReferralPartners";

interface PartnerFormProps {
  open: boolean;
  partner?: ReferralPartner | null;
  onClose: () => void;
  onSave: (data: {
    nome: string;
    cli: string;
    keywords: string[];
    qr_phrase: string | null;
  }) => void;
  onDelete?: (id: string) => void;
}

export function PartnerForm({ open, partner, onClose, onSave, onDelete }: PartnerFormProps) {
  const [nome, setNome] = useState("");
  const [cli, setCli] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [qrPhrase, setQrPhrase] = useState("");
  const [errors, setErrors] = useState<{ nome?: string; cli?: string }>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExample, setAiExample] = useState<string | null>(null);
  const confirm = useConfirm();
  const { toast } = useToast();

  const isEdit = !!partner;

  useEffect(() => {
    if (partner) {
      setNome(partner.nome);
      setCli(partner.cli);
      setKeywords(partner.keywords || []);
      setQrPhrase(partner.qr_phrase || "");
    } else {
      setNome("");
      setCli("");
      setKeywords([]);
      setQrPhrase("");
    }
    setErrors({});
    setAiExample(null);
  }, [partner, open]);

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
    }
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  };

  const generateExample = async () => {
    const kw = keywordInput.trim() || keywords[keywords.length - 1] || "";
    if (!kw) {
      toast({
        title: "Digite uma palavra-chave",
        description: "Escreva ou adicione uma palavra-chave antes de gerar.",
      });
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "ai-generate-partner-example",
        { body: { keyword: kw, partner_name: nome || partner?.nome } },
      );
      if (error) throw error;
      const text = (data as any)?.example as string | undefined;
      if (!text) throw new Error("Resposta vazia da IA");
      setAiExample(text);
    } catch (e: any) {
      const msg = e?.message || "Falha ao gerar exemplo";
      if (msg.includes("429"))
        toast({ title: "Limite de IA atingido", description: "Tente em alguns segundos.", variant: "destructive" });
      else if (msg.includes("402"))
        toast({ title: "Créditos de IA esgotados", description: "Adicione créditos no workspace.", variant: "destructive" });
      else
        toast({ title: "Erro ao gerar exemplo", description: msg, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = () => {
    const newErrors: { nome?: string; cli?: string } = {};
    if (!nome.trim()) newErrors.nome = "Nome é obrigatório";
    if (!cli.trim()) newErrors.cli = "CLI é obrigatório";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave({
      nome: nome.trim(),
      cli: cli.trim(),
      keywords,
      qr_phrase: qrPhrase.trim() || null,
    });
    onClose();
  };

  const handleDelete = async () => {
    if (!partner || !onDelete) return;
    const ok = await confirm({
      title: "Excluir parceiro?",
      description: `O parceiro "${partner.nome}" será removido e deixará de receber atribuição de novos leads. Esta ação não pode ser desfeita pela interface.`,
      confirmText: "Excluir",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    onDelete(partner.id);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle>
              {isEdit ? "Editar Parceiro" : "Novo Parceiro Indicador"}
            </DialogTitle>
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Excluir parceiro"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isEdit && keywords.length === 0 && !qrPhrase.trim() && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                Este parceiro <strong>não consegue atribuir leads</strong> — sem palavra-chave e sem frase de QR. Adicione pelo menos uma keyword abaixo para que o sistema reconheça quando um lead mencionar este parceiro no WhatsApp.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="partner-nome">Nome *</Label>
            <Input
              id="partner-nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (errors.nome) setErrors((prev) => ({ ...prev, nome: undefined }));
              }}
              placeholder="Nome do parceiro"
            />
            {errors.nome && (
              <p className="text-sm text-destructive">{errors.nome}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-cli">CLI (ID iGreen) *</Label>
            <Input
              id="partner-cli"
              value={cli}
              onChange={(e) => {
                setCli(e.target.value);
                if (errors.cli) setErrors((prev) => ({ ...prev, cli: undefined }));
              }}
              placeholder="ID do cliente no portal iGreen"
            />
            {errors.cli && (
              <p className="text-sm text-destructive">{errors.cli}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Palavras-chave</Label>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite e pressione Enter"
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={addKeyword} size="sm">
                Adicionar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={generateExample}
                size="sm"
                disabled={aiLoading}
                className="gap-1 border-primary/40 text-primary hover:bg-primary/10"
                title="Gerar exemplo de mensagem do lead com IA"
              >
                {aiLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                IA
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="gap-1">
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {aiExample && (
              <div className="mt-2 p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/80 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Exemplo de mensagem do lead
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={generateExample}
                    disabled={aiLoading}
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-primary"
                  >
                    {aiLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed italic">
                  "{aiExample}"
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Se o lead escrever assim no WhatsApp, este parceiro será atribuído automaticamente.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-qr-phrase">Frase QR Code (opcional)</Label>
            <Input
              id="partner-qr-phrase"
              value={qrPhrase}
              onChange={(e) => setQrPhrase(e.target.value)}
              placeholder="Frase customizada para o QR code"
            />
            <p className="text-xs text-muted-foreground">
              Se vazio, a primeira keyword será usada no QR code.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit}>
            {isEdit ? "Salvar" : "Criar Parceiro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
