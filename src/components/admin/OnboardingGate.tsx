import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Save, AlertCircle } from "lucide-react";
import type { ConsultantForm } from "@/hooks/useAdminAuth";
import { validateBrazilPhone } from "@/lib/phone";
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

// Campos opcionais ficam apenas como avisos (não bloqueiam o painel).
// O painel libera com: nome + ID iGreen + nome da IA (prefs de automação vêm depois).
function validate(form: ConsultantForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name?.trim() || form.name.trim().length < 3) errors.name = "Digite seu nome completo";
  const igreen = (form.igreen_id || "").replace(/\D/g, "");
  if (!igreen || igreen.length < 4) errors.igreen_id = "ID iGreen inválido (mínimo 4 dígitos)";
  const ia = (form.assistant_name || "").trim();
  if (!ia || ia.length < 2) errors.assistant_name = "Digite o nome da sua IA (ex.: Yasmin, Sol)";
  // Soft warnings (não bloqueiam) — telefone/gênero podem ser preenchidos depois na aba Dados.
  const phoneV = validateBrazilPhone(form.phone);
  if (form.phone && !phoneV.valid) errors.phone = phoneV.message || "Telefone inválido";
  const notifV = validateBrazilPhone(form.notification_phone);
  if (form.notification_phone && !notifV.valid) errors.notification_phone = notifV.message || "Telefone inválido";
  return errors;
}

// Só os campos críticos bloqueiam o gate.
function blockingErrors(form: ConsultantForm): FieldErrors {
  const e = validate(form);
  const out: FieldErrors = {};
  if (e.name) out.name = e.name;
  if (e.igreen_id) out.igreen_id = e.igreen_id;
  if (e.assistant_name) out.assistant_name = e.assistant_name;
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
  // Se o perfil já estava completo no banco ao abrir (sem editar), não mostra o gate de novo.
  const [editedInSession, setEditedInSession] = useState(false);

  const errors = useMemo(() => validate(form), [form]);
  const blocking = useMemo(() => blockingErrors(form), [form]);
  const complete = Object.keys(blocking).length === 0;

  const applyChange = (updates: Record<string, string>) => {
    setEditedInSession(true);
    onFormChange(updates);
  };

  const doSave = async (e: React.FormEvent): Promise<boolean> => {
    const ok = await onSave(e);
    if (ok) setReleasedBySave(true);
    return ok;
  };

  // Já completo no banco e usuário não mexeu → entra no painel.
  // Se mexeu ou ainda incompleto → fica no modal até clicar em salvar com sucesso.
  if (releasedBySave) return <>{children}</>;
  if (complete && !editedInSession) return <>{children}</>;

  const showErr = (key: keyof FieldErrors) => (submitAttempted || touched[key]) ? errors[key] : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (Object.keys(blocking).length > 0) return;
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
              Precisamos do seu nome, do ID iGreen e do nome da sua IA. Clique em{" "}
              <strong>Liberar painel</strong> para continuar — o restante completa na aba{" "}
              <strong>Dados</strong>.
            </p>
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
                className="bg-secondary border-border"
              />
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
                className="bg-secondary border-border"
              />
            </Field>

            <Field
              label="Nome da sua IA"
              error={showErr("assistant_name")}
              hint="Como a assistente se apresenta no WhatsApp. É só sua — não é a IA de outro consultor."
            >
              <Input
                value={form.assistant_name}
                onBlur={() => setTouched((t) => ({ ...t, assistant_name: true }))}
                onChange={(e) => applyChange({ assistant_name: e.target.value.slice(0, 20) })}
                placeholder="Ex.: Yasmin, Sol, Ana…"
                maxLength={20}
                className="bg-secondary border-border"
              />
            </Field>
          </div>

          {submitAttempted && Object.keys(blocking).length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Preencha nome, ID iGreen e o nome da sua IA. Depois clique em Liberar painel.</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={saving}
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

// Mantido para compat externa (se algum lugar importava).
export { isComplete };
