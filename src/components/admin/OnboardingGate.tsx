import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sparkles, Save, AlertCircle, Bot, MessageSquareText } from "lucide-react";
import type { ConsultantForm } from "@/hooks/useAdminAuth";
import { normalizeBrazilPhone, validateBrazilPhone } from "@/lib/phone";
import { buildClubCadastroUrl } from "@/lib/clubCadastroUrl";

interface OnboardingGateProps {
  form: ConsultantForm;
  saving: boolean;
  onFormChange: (updates: Record<string, string>) => void;
  // Retorna `true` quando o save gravou os dados com sucesso, `false` quando
  // falhou. O gate usa esse retorno para só fechar DEPOIS de salvar de verdade.
  onSave: (e: React.FormEvent) => boolean | Promise<boolean>;
  children: React.ReactNode;
}

type FieldErrors = Partial<Record<"name" | "igreen_id" | "phone" | "notification_phone" | "assistant_name" | "gender", string>>;

// Painel libera com: nome + ID iGreen + WhatsApp + nome da IA + consultor/consultora.
// WhatsApp é obrigatório: a IA atende nesse número e o recado do QR do banner abre nele.
function validate(form: ConsultantForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name?.trim() || form.name.trim().length < 3) errors.name = "Digite seu nome completo";
  const igreen = (form.igreen_id || "").replace(/\D/g, "");
  if (!igreen || igreen.length < 4) errors.igreen_id = "ID iGreen inválido (mínimo 4 dígitos)";
  const ia = (form.assistant_name || "").trim();
  if (!ia || ia.length < 2) errors.assistant_name = "Digite o nome da sua IA (ex.: Yasmin, Sol)";
  if (form.gender !== "consultor" && form.gender !== "consultora") {
    errors.gender = "Escolha Consultor ou Consultora";
  }
  const phoneDigits = String(form.phone || "").replace(/\D/g, "");
  if (!phoneDigits || phoneDigits.length < 10) {
    errors.phone = "Digite o WhatsApp com DDD — é o número da IA e do recado do banner";
  } else {
    const phoneV = validateBrazilPhone(form.phone);
    if (!phoneV.valid) errors.phone = phoneV.message || "WhatsApp inválido";
  }
  const notifV = validateBrazilPhone(form.notification_phone);
  if (form.notification_phone && !notifV.valid) errors.notification_phone = notifV.message || "Telefone inválido";
  return errors;
}

// Campos críticos bloqueiam o gate (inclui WhatsApp).
function blockingErrors(form: ConsultantForm): FieldErrors {
  const e = validate(form);
  const out: FieldErrors = {};
  if (e.name) out.name = e.name;
  if (e.igreen_id) out.igreen_id = e.igreen_id;
  if (e.phone) out.phone = e.phone;
  if (e.assistant_name) out.assistant_name = e.assistant_name;
  if (e.gender) out.gender = e.gender;
  return out;
}

function isComplete(form: ConsultantForm) {
  return Object.keys(blockingErrors(form)).length === 0;
}

export function OnboardingGate({ form, saving, onFormChange, onSave, children }: OnboardingGateProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Só libera o painel depois de clicar em "Liberar painel" e o save gravar.
  // Sem auto-save: preencher os campos NÃO fecha o modal.
  const [releasedBySave, setReleasedBySave] = useState(false);
  // Snapshot no 1º render: se já vinha completo do banco, não reexibe o gate.
  // NÃO reavalia quando o form muda depois (evita fechar no meio da digitação / loop).
  const initiallyCompleteRef = useRef<boolean | null>(null);
  if (initiallyCompleteRef.current === null) {
    initiallyCompleteRef.current = isComplete(form);
  }
  // Travas anti-loop: submit em voo + save já concluído nesta sessão.
  const saveInFlightRef = useRef(false);

  const errors = useMemo(() => validate(form), [form]);
  const blocking = useMemo(() => blockingErrors(form), [form]);
  const complete = Object.keys(blocking).length === 0;
  // Botão só libera depois de digitar os 3 campos; `saving` trava clique duplo.
  const canSubmit = complete && !saving;

  const applyChange = (updates: Record<string, string>) => {
    // Qualquer digitação invalida o “já completo no mount”: agora só libera com save.
    initiallyCompleteRef.current = false;
    onFormChange(updates);
  };

  const doSave = async (e: React.FormEvent): Promise<boolean> => {
    if (saveInFlightRef.current || releasedBySave) return releasedBySave;
    saveInFlightRef.current = true;
    try {
      const ok = await onSave(e);
      if (ok) setReleasedBySave(true);
      return ok;
    } finally {
      saveInFlightRef.current = false;
    }
  };

  // Já completo no banco no 1º render e sem digitação → entra no painel.
  // Se incompleto ou digitou → fica no modal até clicar em Liberar painel com sucesso.
  if (releasedBySave) return <>{children}</>;
  if (initiallyCompleteRef.current) return <>{children}</>;

  const showErr = (key: keyof FieldErrors) => (submitAttempted || touched[key]) ? errors[key] : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || saveInFlightRef.current || releasedBySave) return;
    if (!complete) {
      setSubmitAttempted(true);
      return;
    }
    await doSave(e);
  };

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none opacity-30 blur-sm select-none">
        {children}
      </div>

      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-gate-title"
        data-tour-blocker="onboarding-gate"
        onKeyDown={(e) => {
          // Não fecha com Escape — só com salvar.
          if (e.key === "Escape") e.preventDefault();
        }}
      >
        <form
          onSubmit={handleSubmit}
          className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 sm:p-8 space-y-5 shadow-2xl my-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h2 id="onboarding-gate-title" className="text-xl font-heading font-bold text-foreground">
              Bem-vindo ao iGreen!
            </h2>
            <p className="text-sm text-muted-foreground">
              Preencha nome, ID iGreen, WhatsApp, nome da IA e se você é{" "}
              <strong>consultor ou consultora</strong>. Sem WhatsApp o banner não
              abre conversa e a IA não tem número para atender.
            </p>
          </div>

          <div className="space-y-3">
            <Alert className="border-primary/20 bg-primary/5 text-left">
              <Bot className="h-4 w-4 text-primary" />
              <AlertTitle className="text-sm">Para que serve a IA?</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                A IA (ex.: Yasmin, Sol) atende o lead{" "}
                <strong>no seu WhatsApp</strong>. Ela responde dúvidas, pede a
                conta de luz e conduz o cadastro — no mesmo número do banner.
              </AlertDescription>
            </Alert>
            <Alert className="border-primary/20 bg-primary/5 text-left">
              <MessageSquareText className="h-4 w-4 text-primary" />
              <AlertTitle className="text-sm">O que é o recado do QR?</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                É a <strong>mensagem pronta</strong> que aparece no WhatsApp
                quando alguém aponta a câmera no banner. Sem número cadastrado, o
                QR não sabe para quem mandar o recado.
              </AlertDescription>
            </Alert>
          </div>

          <div className="space-y-4">
            <Field label="Nome completo" error={showErr("name")}>
              <Input
                value={form.name}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                onChange={(e) => {
                  const newName = e.target.value;
                  const slug = newName.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
                  applyChange({ name: newName, license: slug });
                }}
                placeholder="Seu nome"
                autoComplete="name"
                className="bg-secondary border-border"
              />
            </Field>

            <Field
              label="Você é"
              error={showErr("gender")}
              hint='Define se o áudio diz "do Rafael" ou "da Sirlene".'
            >
              <ToggleGroup
                type="single"
                value={form.gender || ""}
                onValueChange={(v) => {
                  setTouched((t) => ({ ...t, gender: true }));
                  if (v === "consultor" || v === "consultora") applyChange({ gender: v });
                }}
                className="grid w-full grid-cols-2 gap-2"
              >
                <ToggleGroupItem
                  value="consultor"
                  className="h-11 rounded-xl border border-border data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                >
                  Consultor
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="consultora"
                  className="h-11 rounded-xl border border-border data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                >
                  Consultora
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field label="ID iGreen" error={showErr("igreen_id")} hint="Número do seu cadastro na iGreen (4 a 10 dígitos).">
              <Input
                value={form.igreen_id}
                onBlur={() => setTouched((t) => ({ ...t, igreen_id: true }))}
                onChange={(e) => {
                  const id = e.target.value.replace(/\D/g, "").slice(0, 10);
                  applyChange({
                    igreen_id: id,
                    cadastro_url: id ? `https://digital.igreenenergy.com.br/?id=${id}&sendcontract=true` : "",
                    licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : "",
                    club_cadastro_url: buildClubCadastroUrl(id),
                  });
                }}
                placeholder="ex: 126928"
                inputMode="numeric"
                autoComplete="off"
                className="bg-secondary border-border"
              />
            </Field>

            <Field
              label="Seu WhatsApp (com DDD)"
              error={showErr("phone")}
              hint="Número onde a IA atende e onde o recado do QR do banner abre. Pode ser o mesmo do chip Whapi."
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">+55</span>
                <Input
                  value={String(form.phone || "").replace(/\D/g, "").replace(/^55/, "")}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  onChange={(e) => {
                    const local = e.target.value.replace(/\D/g, "").slice(0, 11);
                    applyChange({
                      phone: local ? normalizeBrazilPhone(local) : "",
                    });
                  }}
                  placeholder="34999999999"
                  inputMode="tel"
                  autoComplete="tel"
                  className="bg-secondary border-border"
                />
              </div>
            </Field>

            <Field
              label="Nome da sua IA"
              error={showErr("assistant_name")}
              hint="Como a assistente se apresenta no WhatsApp. Pode ser o mesmo nome de outra conta (reaproveita áudio)."
            >
              <Input
                value={form.assistant_name}
                onBlur={() => setTouched((t) => ({ ...t, assistant_name: true }))}
                onChange={(e) => applyChange({ assistant_name: e.target.value.slice(0, 20) })}
                placeholder="Ex.: Yasmin, Sol, Ana…"
                maxLength={20}
                autoComplete="off"
                className="bg-secondary border-border"
              />
            </Field>
          </div>

          {!complete && (
            <p className="text-xs text-muted-foreground text-center">
              Preencha nome, consultor/consultora, ID iGreen, WhatsApp e o nome da IA para liberar.
            </p>
          )}

          {submitAttempted && !complete && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Ainda faltam dados. Inclua nome, consultor ou consultora, ID iGreen,
                WhatsApp e o nome da sua IA.
              </span>
            </div>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full h-12 text-base font-bold rounded-xl gap-2"
            style={{ background: "var(--gradient-green)" }}
          >
            <Save className="w-5 h-5" />
            {saving ? "Salvando..." : "Liberar painel"}
          </Button>
        </form>
      </div>
    </>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}
