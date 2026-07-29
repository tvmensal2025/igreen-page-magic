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
import { X, AlertTriangle, Trash2, Sparkles, Loader2, RefreshCw, HelpCircle } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ReferralPartner } from "./hooks/useReferralPartners";
import { buildDefaultQrPhrase, isGenericKeyword } from "./qrPhrase";
import { HelpHint } from "@/components/ui/help-hint";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Trata "0"/vazio como ausente — evita gravar CLI inválido do dono. */
function tidyOwnerCli(raw?: string | null): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || digits === "0") return "";
  return digits;
}

interface PartnerFormProps {
  open: boolean;
  partner?: ReferralPartner | null;
  onClose: () => void;
  onSave: (data: {
    nome: string;
    cli: string | null;
    keywords: string[];
    qr_phrase: string | null;
    partner_igreen_id: string | null;
    notification_phone: string | null;
  }) => void;
  onDelete?: (id: string) => void;
}

export function PartnerForm({ open, partner, onClose, onSave, onDelete }: PartnerFormProps) {
  const [nome, setNome] = useState("");
  const [cli, setCli] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [qrPhrase, setQrPhrase] = useState("");
  const [partnerIgreenId, setPartnerIgreenId] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  const [ownerIgreenId, setOwnerIgreenId] = useState("");
  const [errors, setErrors] = useState<{ nome?: string; cli?: string; keywords?: string }>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExample, setAiExample] = useState<string | null>(null);
  const confirm = useConfirm();
  const { toast } = useToast();

  const isEdit = !!partner;

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("consultants")
        .select("igreen_id")
        .eq("id", uid)
        .maybeSingle();
      if (!active) return;
      setOwnerIgreenId(String(data?.igreen_id ?? "").replace(/\D/g, ""));
    })();
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (partner) {
      setNome(partner.nome);
      // CLI = consultor abonador deste indicador.
      // "0"/vazio legado → cai no ID do dono logado (padrão).
      setCli(tidyOwnerCli(partner.cli) || ownerIgreenId || "");
      setKeywords(partner.keywords || []);
      setQrPhrase(partner.qr_phrase || "");
      setPartnerIgreenId(partner.partner_igreen_id || "");
      setNotificationPhone(partner.notification_phone || "");
    } else {
      setNome("");
      setCli(ownerIgreenId || "");
      setKeywords([]);
      setQrPhrase("");
      setPartnerIgreenId("");
      setNotificationPhone("");
    }
    setErrors({});
    setAiExample(null);
  }, [partner, open, ownerIgreenId]);

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
      // Joga a frase direto no campo editável e mantém o preview por baixo.
      setQrPhrase(text);
      setAiExample(text);
      // Auto-save se for edição (parceiro já existe e tem nome/CLI válidos).
      const abonadorCli = tidyOwnerCli(cli) || ownerIgreenId;
      if (partner && nome.trim() && abonadorCli) {
        onSave({
          nome: nome.trim(),
          cli: abonadorCli,
          keywords,
          qr_phrase: text,
          partner_igreen_id: partnerIgreenId.trim() || null,
          notification_phone: notificationPhone.trim() || null,
        });
        toast({ title: "✨ Frase gerada e salva", description: "Edite no campo abaixo se quiser ajustar.", duration: 2200 });
      } else {
        toast({ title: "✨ Frase gerada", description: "Revise no campo abaixo e clique em Criar.", duration: 2200 });
      }
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
    const newErrors: { nome?: string; cli?: string; keywords?: string } = {};
    if (!nome.trim()) newErrors.nome = "Nome é obrigatório";
    // CLI = consultor abonador (seu ID, ou o ID de outro consultor indicador).
    const abonadorCli = tidyOwnerCli(cli) || ownerIgreenId;
    if (!abonadorCli) newErrors.cli = "ID iGreen do consultor/abonador é obrigatório";

    // Consome o que está digitado no input mesmo se o usuário esqueceu de
    // pressionar Enter — evita criar parceiro "sem keyword" por engano.
    const pending = keywordInput.trim();
    const finalKeywords = pending && !keywords.includes(pending)
      ? [...keywords, pending]
      : keywords;

    // Palavra-chave é OBRIGATÓRIA: sem ela, o lead só é atribuído pelo
    // marcador `#R{short_code}` (que cobre QRs novos). Para entrada manual
    // e QRs legados, a keyword no texto continua sendo necessária.
    if (finalKeywords.length === 0) {
      newErrors.keywords =
        "Adicione pelo menos uma palavra-chave (sem ela o lead não é atribuído a este parceiro)";
    } else {
      // Bloqueia keywords genéricas que aparecem em texto natural de leads
      // (ex.: "energia", "desconto", "oi") — atribuiriam o lead errado.
      const generic = finalKeywords.find((k) => isGenericKeyword(k));
      if (generic) {
        newErrors.keywords =
          `"${generic}" é genérica demais e pode pegar lead de outro. Use algo único (ex.: sobrenome + cidade).`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Atualiza o state pra refletir o que foi efetivamente salvo.
    if (pending) {
      setKeywords(finalKeywords);
      setKeywordInput("");
    }
    if (abonadorCli !== cli) setCli(abonadorCli);

    onSave({
      nome: nome.trim(),
      cli: abonadorCli,
      keywords: finalKeywords,
      qr_phrase: qrPhrase.trim() || null,
      partner_igreen_id: partnerIgreenId.trim() || null,
      notification_phone: notificationPhone.trim() || null,
    });
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
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-4 sm:px-5 py-3 border-b shrink-0">

          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-base">
              {isEdit ? "Editar Parceiro" : "Novo Parceiro Indicador"}
            </DialogTitle>
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Excluir parceiro"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="px-4 sm:px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {isEdit && keywords.length === 0 && !qrPhrase.trim() && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Sem palavra-chave ou frase QR este parceiro <strong>não atribui leads</strong>.
              </span>
            </div>
          )}

          {/* Section: Identificação */}
          <section className="space-y-2.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Identificação
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="partner-nome" className="text-xs">Nome *</Label>
                <Input
                  id="partner-nome"
                  value={nome}
                  onChange={(e) => {
                    setNome(e.target.value);
                    if (errors.nome) setErrors((prev) => ({ ...prev, nome: undefined }));
                  }}
                  placeholder="Nome do parceiro"
                  className="h-9"
                />
                {errors.nome && <p className="text-[11px] text-destructive">{errors.nome}</p>}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor="partner-cli" className="text-xs">
                    ID iGreen do consultor / abonador *
                  </Label>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground hover:text-foreground"
                          aria-label="Ajuda: ID do consultor abonador"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
                        Quem abona o cadastro. Padrão = o seu ID. Se o indicador
                        for consultor (ex.: Abel), coloque o ID dele aqui — ele
                        abona no lugar do seu. Não use o campo de cliente.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex gap-1.5">
                  <Input
                    id="partner-cli"
                    value={cli}
                    onChange={(e) => {
                      setCli(e.target.value);
                      if (errors.cli) setErrors((prev) => ({ ...prev, cli: undefined }));
                    }}
                    placeholder="ID do consultor que abona"
                    className="h-9"
                  />
                  {ownerIgreenId && tidyOwnerCli(cli) !== ownerIgreenId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 px-2 text-[11px]"
                      title={`Voltar para o meu ID (${ownerIgreenId})`}
                      onClick={() => setCli(ownerIgreenId)}
                    >
                      Meu ID
                    </Button>
                  )}
                </div>
                {errors.cli && <p className="text-[11px] text-destructive">{errors.cli}</p>}
                {ownerIgreenId && tidyOwnerCli(cli) && tidyOwnerCli(cli) !== ownerIgreenId && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">
                    Consultor abonando no lugar do seu ID ({ownerIgreenId}).
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <Label htmlFor="partner-igreen-id" className="text-xs">
                    ID iGreen do cliente{" "}
                    <span className="text-muted-foreground">(cashback)</span>
                  </Label>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex text-muted-foreground hover:text-foreground"
                          aria-label="Ajuda: ID iGreen do cliente"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
                        Só para cliente indicador (não consultor). É quem recebe
                        o cashback (&amp;cli= no link). Se for consultor, deixe
                        vazio e use o campo de abonador acima.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="partner-igreen-id"
                  value={partnerIgreenId}
                  onChange={(e) => setPartnerIgreenId(e.target.value)}
                  placeholder="Só se for cliente (não consultor)"
                  className="h-9"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="partner-notify" className="text-xs">
                  Aviso WhatsApp <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id="partner-notify"
                  value={notificationPhone}
                  onChange={(e) => setNotificationPhone(e.target.value)}
                  placeholder="Ex: 11999998888"
                  className="h-9"
                />
              </div>
            </div>
          </section>

          {/* Section: Atribuição */}
          <section className="space-y-2.5 pt-3 border-t">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Atribuição de leads
            </h3>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Palavra-chave do parceiro</Label>
                {keywords.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{keywords.length} cadastrada(s)</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={keywordInput}
                  onChange={(e) => {
                    setKeywordInput(e.target.value);
                    if (errors.keywords) setErrors((prev) => ({ ...prev, keywords: undefined }));
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ex.: Melquiades Uberlândia"
                  className="flex-1 h-9"
                />
                <Button type="button" variant="secondary" onClick={addKeyword} size="sm" className="h-9 px-3">
                  Adicionar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateExample}
                  size="sm"
                  disabled={aiLoading}
                  className="h-9 px-3 gap-1 border-primary/40 text-primary hover:bg-primary/10"
                  title="Gerar exemplo com IA"
                >
                  {aiLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  IA
                </Button>
              </div>
              {errors.keywords ? (
                <p className="text-[11px] text-destructive">{errors.keywords}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  É o que o cliente escreve no WhatsApp para cair neste parceiro.
                  Prefira nome + cidade (único). Evite "energia", "desconto", "oi" — isso pega lead errado.
                </p>
              )}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {keywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="gap-1 text-[11px] h-6 px-2">
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
                <div className="p-2 rounded-md bg-primary/5 border border-primary/20 space-y-1 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/80 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Exemplo IA
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={generateExample}
                      disabled={aiLoading}
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
                    >
                      {aiLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-foreground/90 leading-snug italic">"{aiExample}"</p>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="partner-qr-phrase" className="text-xs">
                  Frase QR Code{" "}
                  <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <HelpHint
                  size={12}
                  title="Frase permanente do parceiro"
                  summary="Muda a mensagem do WhatsApp sem reimprimir o banner"
                  details={
                    "Salve aqui a frase padrão deste parceiro. Banners/QR já impressos (link curto sem frase fixa) passam a abrir com o texto novo.\n\n" +
                    "Trocar o WhatsApp do consultor não invalida o QR — o link usa o número conectado agora."
                  }
                  example='Ex.: "Vim pelo Daniel, quero reduzir minha conta de luz"'
                />
              </div>
              <Input
                id="partner-qr-phrase"
                value={qrPhrase}
                onChange={(e) => setQrPhrase(e.target.value)}
                placeholder={buildDefaultQrPhrase(keywords[0] || keywordInput.trim())}
                className="h-9"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="px-4 sm:px-5 py-3 border-t bg-muted/30 shrink-0 flex-row justify-end gap-2 sm:space-x-2">
          <Button variant="outline" onClick={onClose} size="sm" className="min-h-10 flex-1 sm:flex-none">
            Cancelar
          </Button>
          <Button onClick={handleSubmit} size="sm" className="min-h-10 flex-1 sm:flex-none">
            {isEdit ? "Salvar" : "Criar Parceiro"}
          </Button>

        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
