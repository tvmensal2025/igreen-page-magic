import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
  Zap,
  Target,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string | null;
  defaultVariant?: string;
  onCreated?: (flowId: string) => void;
}

type RenderStyle = "buttons" | "text-numbered" | "list-interactive";
type AiProvider = "google" | "openai" | "none";
type AiProfile = "accuracy" | "balanced" | "fast";

interface BlockOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  defaultEnabled: boolean;
  recommended?: boolean;
}

const BLOCKS: BlockOption[] = [
  {
    id: "pedir_conta_ocr",
    label: "Pedir conta de luz + OCR",
    description: "Captura imagem ou PDF da conta. OCR extrai distribuidora, valor e número de instalação automaticamente.",
    emoji: "📸",
    defaultEnabled: true,
    recommended: true,
  },
  {
    id: "pedir_documento_ocr",
    label: "Pedir documento + OCR",
    description: "Captura RG/CNH com auto-detecção. Extrai nome, CPF e data de nascimento automaticamente.",
    emoji: "🪪",
    defaultEnabled: true,
    recommended: true,
  },
  {
    id: "confirmar_email",
    label: "Pedir e-mail",
    description: "Captura e-mail com validação. Necessário para envio do contrato pelo portal.",
    emoji: "📧",
    defaultEnabled: false,
  },
  {
    id: "confirmar_telefone",
    label: "Confirmar telefone",
    description: "Pergunta se o WhatsApp é o telefone de contato. Botão Sim / Quero outro.",
    emoji: "📱",
    defaultEnabled: false,
  },
  {
    id: "duvidas_ia",
    label: "Bloco de dúvidas com IA",
    description: "Lead pode tirar dúvidas livremente. IA responde com base no conhecimento da iGreen.",
    emoji: "🤖",
    defaultEnabled: true,
    recommended: true,
  },
  {
    id: "finalizar_cadastro",
    label: "Finalizar cadastro (portal)",
    description: "Envia tudo ao portal da iGreen. Lead recebe SMS/OTP. Selfie via link.",
    emoji: "🎯",
    defaultEnabled: true,
  },
];

const AI_PROFILE_DESCRIPTIONS: Record<AiProfile, { label: string; sub: string; icon: any }> = {
  accuracy: {
    label: "Precisão máxima",
    sub: "Gemini 3.1 Pro / GPT-5.5 — respostas mais inteligentes, menos alucinação. Recomendado para vendas complexas.",
    icon: Target,
  },
  balanced: {
    label: "Equilibrado (default)",
    sub: "Gemini 3.5 Flash / GPT-5 — bom custo-benefício, latência baixa. Funciona bem para a maioria dos casos.",
    icon: Sparkles,
  },
  fast: {
    label: "Rápido e barato",
    sub: "Gemini 2.5 Flash-Lite — resposta em <1s, custo mínimo. Use quando volume é alto e dúvidas são simples.",
    icon: Zap,
  },
};

export default function CreateFlowFromTemplateDialog({
  open,
  onOpenChange,
  consultantId,
  defaultVariant = "A",
  onCreated,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);

  // Step 1: identidade
  const [flowName, setFlowName] = useState("");
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D">(
    defaultVariant === "E" ? "A" : (defaultVariant || "A"),
  );

  // Step 2: estilo + IA
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("buttons");
  const [aiProvider, setAiProvider] = useState<AiProvider>("google");
  const [aiProfile, setAiProfile] = useState<AiProfile>("balanced");

  // Step 3: blocos
  const [enabledBlocks, setEnabledBlocks] = useState<Record<string, boolean>>(
    Object.fromEntries(BLOCKS.map((b) => [b.id, b.defaultEnabled])),
  );

  // Existing variants check
  const [existingVariants, setExistingVariants] = useState<string[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);

  useEffect(() => {
    if (!open || !consultantId) return;
    setStep(1);
    setFlowName(`Fluxo ${defaultVariant === "E" ? "A" : defaultVariant}`);
    setVariant(defaultVariant === "E" ? "A" : (defaultVariant || "A"));
    setRenderStyle("buttons");
    setAiProvider("google");
    setAiProfile("balanced");
    setEnabledBlocks(Object.fromEntries(BLOCKS.map((b) => [b.id, b.defaultEnabled])));
    setLoadingVariants(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("bot_flows")
        .select("variant")
        .eq("consultant_id", consultantId)
        .eq("is_active", true);
      setExistingVariants(((data as any[]) || []).map((r) => String(r.variant)));
      setLoadingVariants(false);
    })();
  }, [open, consultantId, defaultVariant]);

  const blockedVariant = useMemo(
    () => existingVariants.includes(variant),
    [existingVariants, variant],
  );

  const enabledBlockIds = useMemo(
    () =>
      BLOCKS.filter((b) => enabledBlocks[b.id]).map((b) => b.id),
    [enabledBlocks],
  );

  const summaryWarnings = useMemo(() => {
    const w: string[] = [];
    if (!enabledBlockIds.includes("finalizar_cadastro")) {
      w.push("Bloco 'Finalizar cadastro' será adicionado automaticamente — sem ele o lead não chega ao portal.");
    }
    if (renderStyle === "list-interactive" && variant !== "D") {
      w.push("Lista interativa só funciona em fluxos via Whapi (variante D). Em A/B/C cai em texto numerado.");
    }
    if (aiProvider !== "none" && enabledBlockIds.includes("duvidas_ia") === false) {
      w.push("Você ativou IA mas não incluiu o bloco de dúvidas — a IA não vai ser usada.");
    }
    return w;
  }, [enabledBlockIds, renderStyle, variant, aiProvider]);

  async function handleCreate() {
    if (!consultantId) return;
    if (!flowName.trim()) {
      toast.error("Nome do fluxo é obrigatório");
      return;
    }
    if (blockedVariant) {
      toast.error(`Já existe fluxo ativo na variante ${variant}. Desative antes.`);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("flow-from-template", {
        body: {
          consultantId,
          config: {
            flowName,
            variant,
            renderStyle,
            aiProvider,
            blocks: BLOCKS.map((b) => ({
              id: b.id,
              enabled: enabledBlocks[b.id] || false,
            })),
          },
        },
      });
      if (error) throw error;
      const out = data as { ok?: boolean; flow_id?: string; warnings?: string[]; media_requirements?: any[] };
      if (!out?.ok || !out.flow_id) {
        throw new Error("Edge Function não retornou flow_id");
      }
      toast.success(`Fluxo criado! Variante ${variant} com ${enabledBlockIds.length} blocos.`);
      if (out.warnings?.length) {
        out.warnings.forEach((w) => toast.warning(w));
      }
      // Atualiza preferência de IA do consultor (perfil)
      try {
        await supabase
          .from("consultants")
          .update({ ai_profile: aiProfile, ai_provider_pref: aiProvider === "none" ? "google" : aiProvider } as any)
          .eq("id", consultantId);
      } catch (_) { /* coluna pode não existir ainda */ }

      onCreated?.(out.flow_id);
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("flow_already_exists")) {
        toast.error(`Já existe fluxo ativo na variante ${variant}. Desative ou exclua antes de criar um novo.`);
      } else {
        toast.error("Erro ao criar fluxo: " + msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const totalBlocks = enabledBlockIds.length + (enabledBlockIds.includes("finalizar_cadastro") ? 0 : 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Criar fluxo a partir de template
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Passo 1 de 3: identidade do fluxo"}
            {step === 2 && "Passo 2 de 3: estilo e inteligência artificial"}
            {step === 3 && "Passo 3 de 3: blocos do fluxo"}
          </DialogDescription>
        </DialogHeader>

        {/* progress dots */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 w-12 rounded-full transition-colors ${
                step >= n ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <ScrollArea className="max-h-[480px] pr-3">
          {step === 1 && (
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label htmlFor="flow-name">Nome do fluxo</Label>
                <Input
                  id="flow-name"
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  placeholder="Ex: Fluxo principal de vendas"
                  maxLength={80}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">
                  Aparece no painel admin para você identificar. O cliente nunca vê.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Variante (A/B/C/D)</Label>
                <RadioGroup
                  value={variant}
                  onValueChange={(v) => setVariant(v as any)}
                  className="grid grid-cols-4 gap-2"
                  disabled={busy}
                >
                  {(["A", "B", "C", "D"] as const).map((v) => {
                    const taken = existingVariants.includes(v);
                    return (
                      <label
                        key={v}
                        className={`relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 transition-colors ${
                          variant === v
                            ? "border-primary bg-primary/5"
                            : "hover:border-muted-foreground/30"
                        } ${taken ? "opacity-50" : ""}`}
                      >
                        <RadioGroupItem value={v} className="sr-only" />
                        <span className="text-xl font-bold">{v}</span>
                        {taken && (
                          <Badge variant="secondary" className="text-[9px]">
                            Em uso
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </RadioGroup>
                <p className="text-[11px] text-muted-foreground">
                  Variantes permitem A/B testing. Cada lead recebe uma variante.{" "}
                  {loadingVariants ? "Verificando..." : `Ativas: ${existingVariants.join(", ") || "nenhuma"}.`}
                </p>
                {blockedVariant && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      A variante <strong>{variant}</strong> já tem um fluxo ativo. Desative ou exclua antes.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5 py-2">
              <div className="space-y-3">
                <Label>Estilo de opções</Label>
                <RadioGroup
                  value={renderStyle}
                  onValueChange={(v) => setRenderStyle(v as RenderStyle)}
                  className="space-y-2"
                  disabled={busy}
                >
                  {[
                    {
                      v: "buttons" as const,
                      label: "🔘 Botões interativos (até 3)",
                      sub: "Cliente vê botões clicáveis. Funciona em Evolution e Whapi.",
                    },
                    {
                      v: "list-interactive" as const,
                      label: "📋 Lista interativa (até 10)",
                      sub: "Menu suspenso com várias opções. Só funciona via Whapi (variante D).",
                    },
                    {
                      v: "text-numbered" as const,
                      label: "1️⃣ Texto numerado",
                      sub: "'1. Sim 2. Não 3. Talvez' — funciona em qualquer canal, sem limite.",
                    },
                  ].map((opt) => (
                    <label
                      key={opt.v}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        renderStyle === opt.v
                          ? "border-primary bg-primary/5"
                          : "hover:border-muted-foreground/30"
                      }`}
                    >
                      <RadioGroupItem value={opt.v} className="mt-1" />
                      <div className="flex-1">
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground">{opt.sub}</div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Bot className="h-4 w-4" /> Provedor de IA
                </Label>
                <RadioGroup
                  value={aiProvider}
                  onValueChange={(v) => setAiProvider(v as AiProvider)}
                  className="grid grid-cols-3 gap-2"
                  disabled={busy}
                >
                  {[
                    { v: "google" as const, label: "Google Gemini", sub: "Padrão, mais barato" },
                    { v: "openai" as const, label: "OpenAI GPT", sub: "Mais latência baixa" },
                    { v: "none" as const, label: "Sem IA", sub: "Só caminho fixo" },
                  ].map((opt) => (
                    <label
                      key={opt.v}
                      className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors ${
                        aiProvider === opt.v
                          ? "border-primary bg-primary/5"
                          : "hover:border-muted-foreground/30"
                      }`}
                    >
                      <RadioGroupItem value={opt.v} className="sr-only" />
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.sub}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {aiProvider !== "none" && (
                <div className="space-y-3">
                  <Label>Perfil de qualidade</Label>
                  <RadioGroup
                    value={aiProfile}
                    onValueChange={(v) => setAiProfile(v as AiProfile)}
                    className="space-y-2"
                    disabled={busy}
                  >
                    {(["accuracy", "balanced", "fast"] as const).map((p) => {
                      const cfg = AI_PROFILE_DESCRIPTIONS[p];
                      const Icon = cfg.icon;
                      return (
                        <label
                          key={p}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                            aiProfile === p
                              ? "border-primary bg-primary/5"
                              : "hover:border-muted-foreground/30"
                          }`}
                        >
                          <RadioGroupItem value={p} className="mt-1" />
                          <Icon className="mt-0.5 h-4 w-4 text-primary" />
                          <div className="flex-1">
                            <div className="font-medium">{cfg.label}</div>
                            <div className="text-[11px] text-muted-foreground">{cfg.sub}</div>
                          </div>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 py-2">
              <Label>Blocos do fluxo</Label>
              <p className="text-[11px] text-muted-foreground">
                Marque os blocos que vai usar. Você pode editar textos e adicionar mídias depois.
              </p>
              <div className="space-y-2">
                {BLOCKS.map((b) => (
                  <label
                    key={b.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      enabledBlocks[b.id]
                        ? "border-primary bg-primary/5"
                        : "hover:border-muted-foreground/30"
                    }`}
                  >
                    <Checkbox
                      checked={enabledBlocks[b.id]}
                      onCheckedChange={(v) =>
                        setEnabledBlocks((prev) => ({ ...prev, [b.id]: !!v }))
                      }
                      className="mt-0.5"
                      disabled={busy}
                    />
                    <span className="text-xl">{b.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{b.label}</span>
                        {b.recommended && (
                          <Badge variant="secondary" className="text-[9px]">
                            Recomendado
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{b.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              {summaryWarnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-1">
                    {summaryWarnings.map((w, i) => (
                      <div key={i} className="text-[11px]">
                        • {w}
                      </div>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Vai criar fluxo <strong>{flowName}</strong> na variante <strong>{variant}</strong> com{" "}
                  <strong>{totalBlocks}</strong> blocos. Estilo:{" "}
                  <strong>
                    {renderStyle === "buttons"
                      ? "botões"
                      : renderStyle === "list-interactive"
                      ? "lista"
                      : "texto numerado"}
                  </strong>
                  . IA: <strong>{aiProvider === "none" ? "desligada" : aiProvider}</strong>
                  {aiProvider !== "none" && (
                    <>
                      {" / "}
                      perfil <strong>{aiProfile}</strong>
                    </>
                  )}
                  .
                </AlertDescription>
              </Alert>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => (s - 1) as any)}
                disabled={busy}
              >
                Voltar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => (s + 1) as any)}
                disabled={busy || (step === 1 && (blockedVariant || !flowName.trim()))}
              >
                Avançar
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={busy || enabledBlockIds.length === 0}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar fluxo
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
