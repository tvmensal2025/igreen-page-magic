/**
 * Modal CTWA — cadastrar número WhatsApp Business na WABA da Página (SMS).
 * Qualquer consultor logado; cadastro único por conta (troca só SuperAdmin).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Smartphone, CheckCircle2, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Step = "number" | "sms" | "done";

type StatusPayload = {
  ok?: boolean;
  page_id?: string;
  page_name?: string | null;
  pixel_id?: string | null;
  waba_id?: string;
  numbers?: Array<{ id: string; display: string; digits: string; verified_name?: string }>;
  numbers_count?: number;
  limit_hint?: string;
  limit_initial?: number;
  limit_verified?: number;
  mine?: {
    locked?: boolean;
    digits?: string | null;
    phone_number_id?: string | null;
  };
  official?: {
    whatsapp_destination_number?: string | null;
    whatsapp_phone_number_id?: string | null;
    whatsapp_phone_number_display?: string | null;
  };
  is_super_admin?: boolean;
  error?: string;
  hint?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Chamado após sucesso — ex.: refresh preflight */
  onDone?: () => void;
};

async function invokeWa(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("facebook-platform-wa-register", {
    body,
  });
  if (error) throw new Error(error.message || "Falha na edge");
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as Record<string, unknown>;
}

export function CtwaWaImplantDialog({ open, onOpenChange, onDone }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("number");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);

  const [phone, setPhone] = useState("");
  const [verifiedName, setVerifiedName] = useState("iGreen Energy");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [digits, setDigits] = useState("");
  const [display, setDisplay] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [twoStepPin, setTwoStepPin] = useState("");
  const [ackBusiness, setAckBusiness] = useState(false);
  const [ackOnce, setAckOnce] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await invokeWa({ action: "status" });
      setStatus(data as StatusPayload);
      const mine = (data as StatusPayload).mine;
      if (mine?.locked && mine.phone_number_id) {
        setPhoneNumberId(mine.phone_number_id);
        setDigits(mine.digits || "");
        setDisplay(mine.digits ? `+${mine.digits}` : "");
        setStep("done");
      }
    } catch (e) {
      setStatus({ error: (e as Error).message });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep("number");
    setSmsCode("");
    setTwoStepPin("");
    setPhoneNumberId("");
    setAckBusiness(false);
    setAckOnce(false);
    void loadStatus();
  }, [open, loadStatus]);

  async function handleCreate() {
    if (!ackBusiness || !ackOnce) {
      toast({
        title: "Confirme os avisos",
        description: "Marque WhatsApp Business e que entende: 1 número + saldo com o Rafael.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const data = await invokeWa({
        action: "create",
        phone,
        verified_name: verifiedName,
        force: Boolean(status?.is_super_admin && status?.mine?.locked),
      });
      setPhoneNumberId(String(data.phone_number_id || ""));
      setDigits(String(data.digits || ""));
      setDisplay(String(data.display || ""));
      if (data.step === "done" || data.skipped_sms) {
        setTwoStepPin(String(data.two_step_pin || ""));
        setStep("done");
        toast({
          title: "WhatsApp CTWA pronto",
          description: String(data.message || "Vinculado sem SMS."),
        });
        await loadStatus();
        onDone?.();
        return;
      }
      setStep("sms");
      toast({
        title: "SMS enviado",
        description: String(data.message || "Digite o código recebido no chip."),
      });
    } catch (e) {
      toast({
        title: "Não foi possível cadastrar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(method: "SMS" | "VOICE" = "SMS") {
    if (!phoneNumberId) return;
    setLoading(true);
    try {
      const data = await invokeWa({
        action: "request_code",
        phone_number_id: phoneNumberId,
        method,
      });
      toast({
        title: method === "VOICE" ? "Ligação solicitada" : "SMS reenviado",
        description: String(data.message || ""),
      });
    } catch (e) {
      toast({
        title: "Falha ao reenviar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setLoading(true);
    try {
      const data = await invokeWa({
        action: "verify_and_register",
        phone_number_id: phoneNumberId,
        code: smsCode,
        digits,
        force: Boolean(status?.is_super_admin && status?.mine?.locked),
      });
      setDigits(String(data.digits || digits));
      setDisplay(String(data.display || display));
      setTwoStepPin(String(data.two_step_pin || ""));
      setStep("done");
      toast({
        title: "Número cadastrado",
        description: String(data.message || "Pronto para anúncios CTWA."),
      });
      await loadStatus();
      onDone?.();
    } catch (e) {
      toast({
        title: "Código inválido ou falha no registro",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveForMe(id: string) {
    if (!ackBusiness || !ackOnce) {
      toast({
        title: "Confirme os avisos",
        description: "Marque WhatsApp Business e que entende: 1 número + saldo com o Rafael.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const data = await invokeWa({
        action: "save_for_me",
        phone_number_id: id,
        force: Boolean(status?.is_super_admin && status?.mine?.locked),
      });
      toast({
        title: "Número vinculado",
        description: String(data.message || ""),
      });
      setDigits(String(data.digits || ""));
      setDisplay(String(data.display || ""));
      setPhoneNumberId(String(data.phone_number_id || id));
      setStep("done");
      await loadStatus();
      onDone?.();
    } catch (e) {
      toast({
        title: "Falha ao vincular",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const locked = Boolean(status?.mine?.locked);
  const canEdit = !locked || Boolean(status?.is_super_admin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-primary" />
            WhatsApp dos anúncios (CTWA)
          </DialogTitle>
          <DialogDescription>
            Cadastre o número que vai receber os clientes do anúncio. Feito uma vez por conta.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-warning/40 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-sm">Leia antes de continuar</AlertTitle>
          <AlertDescription className="text-xs space-y-1.5 mt-1">
            <p>
              Use número de <strong>WhatsApp Business</strong> (app Business). WhatsApp comum
              pessoal costuma ser rejeitado pela Meta no anúncio.
            </p>
            <p>
              Você pode conectar <strong>apenas 1 número</strong> na sua conta (cadastro único
              com SMS). Depois disso, troca só com suporte.
            </p>
            <p>
              Para <strong>anunciar</strong> é preciso ter <strong>saldo na carteira</strong>.
              Fale com o <strong>Rafael</strong> para liberar o crédito — o saldo é colocado
              manualmente.
            </p>
            <p className="text-muted-foreground">
              O chip precisa receber SMS. Número não pode estar só no WhatsApp pessoal.
            </p>
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
          {statusLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando status…
            </div>
          ) : status?.error ? (
            <p className="text-destructive">{status.error}</p>
          ) : (
            <>
              <p>
                Página: <strong>{status?.page_name || status?.page_id || "—"}</strong>
              </p>
              <p>Regra: <strong>1 WhatsApp Business</strong> por conta · saldo com o Rafael para anunciar</p>
              {status?.mine?.phone_number_id && (
                <p className="text-primary">
                  Seu número: {status.mine.digits ? `+${status.mine.digits}` : "—"}
                  {locked ? " · já cadastrado" : ""}
                </p>
              )}
            </>
          )}
          {status?.hint && <p className="text-muted-foreground">{status.hint}</p>}
        </div>

        {step === "number" && canEdit && (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ackBusiness}
                onChange={(e) => setAckBusiness(e.target.checked)}
              />
              <span>Confirmo que é número de WhatsApp Business (não o pessoal comum).</span>
            </label>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ackOnce}
                onChange={(e) => setAckOnce(e.target.checked)}
              />
              <span>Entendo que só posso conectar 1 número e que preciso de saldo (falar com o Rafael) para anunciar.</span>
            </label>

            <div className="space-y-1.5">
              <Label className="text-[11px]">Número (55 + DDD + celular)</Label>
              <Input
                placeholder="5534984314317"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Nome exibido no WhatsApp</Label>
              <Input
                value={verifiedName}
                onChange={(e) => setVerifiedName(e.target.value)}
                placeholder="iGreen Energy"
              />
            </div>

            {(status?.numbers?.length || 0) > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[11px]">Já na WABA — usar este</Label>
                <div className="flex flex-wrap gap-1.5">
                  {status!.numbers!.map((n) => (
                    <Button
                      key={n.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-[11px]"
                      disabled={loading}
                      onClick={() => void handleSaveForMe(n.id)}
                    >
                      {n.display || n.digits}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === "number" && !canEdit && (
          <p className="text-sm text-muted-foreground">
            Seu número CTWA já está cadastrado. Peça ao SuperAdmin se precisar trocar.
          </p>
        )}

        {step === "sms" && (
          <div className="space-y-3">
            <div className="text-sm">
              Código enviado para <strong>{display || digits}</strong>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              id {phoneNumberId}
            </Badge>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Código SMS</Label>
              <Input
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void handleResend("SMS")}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reenviar SMS
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void handleResend("VOICE")}>
                Ligação com código
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-primary font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Pronto para receber clientes do anúncio
            </div>
            <p className="text-sm">{display || (digits ? `+${digits}` : "—")}</p>
            <p className="text-[11px] font-mono text-muted-foreground break-all">
              phone_number_id: {phoneNumberId || status?.mine?.phone_number_id}
            </p>
            {twoStepPin && (
              <p className="text-[11px] text-muted-foreground">
                PIN 2 etapas (guarde): <strong className="text-foreground">{twoStepPin}</strong>
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "number" && canEdit && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Fechar
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={loading || !phone.trim() || !ackBusiness || !ackOnce}
              >
                {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                Cadastrar e enviar SMS
              </Button>
            </>
          )}
          {step === "number" && !canEdit && (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          )}
          {step === "sms" && (
            <>
              <Button variant="outline" onClick={() => setStep("number")} disabled={loading}>
                Voltar
              </Button>
              <Button onClick={() => void handleVerify()} disabled={loading || smsCode.replace(/\D/g, "").length < 4}>
                {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                Verificar e registrar
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => onOpenChange(false)}>Concluir</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias legado (SuperAdmin) — mesmo fluxo. */
export { CtwaWaImplantDialog as PlatformWaImplantDialog };
