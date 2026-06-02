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
import { X, AlertTriangle } from "lucide-react";
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
}

export function PartnerForm({ open, partner, onClose, onSave }: PartnerFormProps) {
  const [nome, setNome] = useState("");
  const [cli, setCli] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [qrPhrase, setQrPhrase] = useState("");
  const [errors, setErrors] = useState<{ nome?: string; cli?: string }>({});

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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Parceiro" : "Novo Parceiro Indicador"}
          </DialogTitle>
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
