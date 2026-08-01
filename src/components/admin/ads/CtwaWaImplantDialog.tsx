/**
 * Modal CTWA — cadastrar número WhatsApp Business na WABA da Página (SMS).
 * Cada consultor cadastra O SEU número. Atalho “já na WABA” só SuperAdmin.
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
import { toUserFacingError } from "@/lib/userFacingError";

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
  consultant_phone?: string | null;
  mine?: {
    locked?: boolean;
    digits?: string | null;
    phone_number_id?: string | null;
    matches_consultant_phone?: boolean;
    can_replace?: boolean;
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

const WA_REGISTER_FALLBACK =
  "Não foi possível concluir o cadastro do WhatsApp. Tente de novo.";

/**
 * Fetch direto (não `functions.invoke`): em non-2xx o invoke some com o body
 * e o toast vira genérico. Aqui sempre lemos o JSON da edge.
 */
async function invokeWa(body: Record<string, unknown>) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Faça login de novo para cadastrar o WhatsApp.");
  }

  const base = import.meta.env.DEV
    ? "/functions-proxy"
    : `${import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co"}/functions/v1`;
  const res = await fetch(`${base}/facebook-platform-wa-register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: String(
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo",
      ),
    },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const rawErr =
    (typeof payload.error === "string" && payload.error.trim()) ||
    (typeof payload.message === "string" && payload.message.trim()) ||
    "";

  if (!res.ok || rawErr) {
    // Edge já devolve PT; não deixar toUserFacingError trocar por fallback genérico.
    const alreadyPt =
      Boolean(rawErr) &&
      (/[áàâãéêíóôõúç]/i.test(rawErr) ||
        /^(A Meta|Este número|Token sem|Limite|Código|PIN |Use |Informe |Faça |Número)/i.test(rawErr));
    const msg = alreadyPt
      ? rawErr
      : toUserFacingError(rawErr || WA_REGISTER_FALLBACK, WA_REGISTER_FALLBACK);
    throw new Error(msg);
  }
  return payload;
}

export function CtwaWaImplantDialog({ open, onOpenChange, onDone }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("number");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  /** Usuário pediu explicitamente cadastrar/trocar o próprio número (não ficar no da plataforma). */
  const [forceOwnNumber, setForceOwnNumber] = useState(false);

  const [phone, setPhone] = useState("");
  const [verifiedName, setVerifiedName] = useState("iGreen Energy");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [digits, setDigits] = useState("");
  const [display, setDisplay] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [twoStepPin, setTwoStepPin] = useState("");
  const [ackBusiness, setAckBusiness] = useState(false);
  const [ackOnce, setAckOnce] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const loadStatus = useCallback(async (opts?: { preferOwnForm?: boolean }) => {
    setStatusLoading(true);
    try {
      const data = await invokeWa({ action: "status" });
      const payload = data as StatusPayload;
      setStatus(payload);

      const mine = payload.mine;
      const ownPhone = (payload.consultant_phone || "").replace(/\D/g, "");
      setPhone((prev) => (prev.trim() ? prev : ownPhone));

      const apiKnowsMatch = typeof mine?.matches_consultant_phone === "boolean";
      const lockedOk =
        Boolean(mine?.locked && mine.phone_number_id) &&
        (apiKnowsMatch ? mine.matches_consultant_phone === true : true);
      const wrongLock =
        Boolean(mine?.locked && mine.phone_number_id) &&
        apiKnowsMatch &&
        mine.matches_consultant_phone === false;
      const preferForm = Boolean(opts?.preferOwnForm);

      if (lockedOk && !preferForm) {
        setPhoneNumberId(mine!.phone_number_id!);
        setDigits(mine!.digits || "");
        setDisplay(mine!.digits ? `+${mine!.digits}` : "");
        setStep("done");
      } else {
        setStep("number");
        if (wrongLock) {
          setPhoneNumberId("");
          setDigits("");
          setDisplay("");
        }
      }
    } catch (e) {
      setStatus({
        error: toUserFacingError(e, "Não foi possível carregar o status do WhatsApp dos anúncios."),
      });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep("number");
    setForceOwnNumber(false);
    setSmsCode("");
    setTwoStepPin("");
    setPhoneNumberId("");
    setPhone("");
    setAckBusiness(false);
    setAckOnce(false);
    setLastError(null);
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
    setLastError(null);
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
        setForceOwnNumber(false);
        setStep("done");
        toast({
          title: "WhatsApp do anúncio pronto",
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
      const msg = toUserFacingError(
        e,
        "A Meta não aceitou o número ainda — por isso o SMS não foi enviado. Confira o número e tente de novo.",
      );
      setLastError(msg);
      toast({
        title: "Não foi possível cadastrar",
        description: msg,
        variant: "destructive",
        duration: 14000,
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
        description: toUserFacingError(e, "Não deu para reenviar o código. Aguarde e tente de novo."),
        variant: "destructive",
        duration: 12000,
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
      setForceOwnNumber(false);
      setStep("done");
      toast({
        title: "Número cadastrado",
        description: String(data.message || "Pronto para anunciar no WhatsApp."),
      });
      await loadStatus();
      onDone?.();
    } catch (e) {
      toast({
        title: "Código inválido ou falha no registro",
        description: toUserFacingError(e, "Confira o código SMS e tente de novo."),
        variant: "destructive",
        duration: 12000,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveForMe(id: string) {
    if (!status?.is_super_admin) {
      toast({
        title: "Indisponível",
        description: "Digite o seu número e valide com SMS. A lista de números da Meta é só do SuperAdmin.",
        variant: "destructive",
      });
      return;
    }
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
        force: Boolean(status?.mine?.locked),
      });
      toast({
        title: "Número vinculado",
        description: String(data.message || ""),
      });
      setDigits(String(data.digits || ""));
      setDisplay(String(data.display || ""));
      setPhoneNumberId(String(data.phone_number_id || id));
      setForceOwnNumber(false);
      setStep("done");
      await loadStatus();
      onDone?.();
    } catch (e) {
      toast({
        title: "Falha ao vincular",
        description: toUserFacingError(e, "Não foi possível vincular este número."),
        variant: "destructive",
        duration: 12000,
      });
    } finally {
      setLoading(false);
    }
  }

  const apiKnowsMatch = typeof status?.mine?.matches_consultant_phone === "boolean";
  const lockedOk =
    Boolean(status?.mine?.locked) &&
    (apiKnowsMatch ? status?.mine?.matches_consultant_phone === true : true);
  const wrongLock =
    Boolean(status?.mine?.locked) &&
    apiKnowsMatch &&
    status?.mine?.matches_consultant_phone === false;
  const showNumberForm =
    step === "number" && (!lockedOk || forceOwnNumber || Boolean(status?.is_super_admin) || wrongLock);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-primary" />
            WhatsApp dos anúncios
          </DialogTitle>
          <DialogDescription>
            Cadastre <strong>o seu</strong> número (Business) que vai receber os clientes do anúncio.
            O SMS só chega depois que a Meta aceitar o número na Página.
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
              <strong>SMS:</strong> a Meta só envia o código se o número for aceito na WABA da
              Página. Se der erro no cadastro, o SMS <strong>não</strong> chega — não é falha do
              chip.
            </p>
            <p>
              Cada consultor cadastra <strong>o próprio número</strong> (não o da plataforma).
              Depois disso, troca só com suporte.
            </p>
            <p>
              Para <strong>anunciar</strong> é preciso ter <strong>saldo na carteira</strong>.
              Fale com o <strong>Rafael</strong> para liberar o crédito.
            </p>
          </AlertDescription>
        </Alert>

        {lastError && (
          <Alert className="border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertTitle className="text-sm">Por que não cadastrou</AlertTitle>
            <AlertDescription className="text-xs">{lastError}</AlertDescription>
          </Alert>
        )}

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
              <p>
                Seu celular no cadastro:{" "}
                <strong>
                  {status?.consultant_phone ? `+${status.consultant_phone}` : "—"}
                </strong>
              </p>
              {status?.mine?.phone_number_id && (
                <p className={wrongLock ? "text-destructive" : "text-primary"}>
                  Número no anúncio: {status.mine.digits ? `+${status.mine.digits}` : "—"}
                  {lockedOk ? " · ok" : ""}
                  {wrongLock ? " · não é o seu — cadastre o seu abaixo" : ""}
                </p>
              )}
            </>
          )}
          {status?.hint && <p className="text-muted-foreground">{status.hint}</p>}
        </div>

        {wrongLock && step !== "sms" && (
          <Alert className="border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertTitle className="text-sm">Número da plataforma / outro consultor</AlertTitle>
            <AlertDescription className="text-xs">
              Foi vinculado o +{status?.mine?.digits}, que não é o do seu cadastro. Digite o{" "}
              <strong>seu</strong> WhatsApp Business e envie o SMS.
            </AlertDescription>
          </Alert>
        )}

        {showNumberForm && (
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
              <span>
                Entendo que só posso conectar 1 número (o meu) e que preciso de saldo (falar com o
                Rafael) para anunciar.
              </span>
            </label>

            <div className="space-y-1.5">
              <Label className="text-[11px]">Seu número (55 + DDD + celular)</Label>
              <Input
                placeholder="5534984314317"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
              <p className="text-[11px] text-muted-foreground">
                Prefira o mesmo número do app WhatsApp Business que você usa com o bot.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Nome exibido no WhatsApp</Label>
              <Input
                value={verifiedName}
                onChange={(e) => setVerifiedName(e.target.value)}
                placeholder="iGreen Energy"
              />
            </div>

            {status?.is_super_admin && (status?.numbers?.length || 0) > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[11px]">SuperAdmin — já cadastrado na Meta</Label>
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

        {step === "done" && !forceOwnNumber && (
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setForceOwnNumber(true);
                setStep("number");
                const own = (status?.consultant_phone || "").replace(/\D/g, "");
                if (own) setPhone(own);
              }}
            >
              Cadastrar meu número (SMS)
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {showNumberForm && (
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
          {step === "done" && !forceOwnNumber && (
            <Button onClick={() => onOpenChange(false)}>Concluir</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias legado (SuperAdmin) — mesmo fluxo. */
export { CtwaWaImplantDialog as PlatformWaImplantDialog };
