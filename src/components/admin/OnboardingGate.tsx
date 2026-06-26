import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Save, AlertCircle } from "lucide-react";
import type { ConsultantForm } from "@/hooks/useAdminAuth";
import { validateBrazilPhone, normalizeBrazilPhone } from "@/lib/phone";

interface OnboardingGateProps {
  form: ConsultantForm;
  saving: boolean;
  onFormChange: (updates: Record<string, string>) => void;
  onSave: (e: React.FormEvent) => void;
  children: React.ReactNode;
}

type FieldErrors = Partial<Record<"name" | "igreen_id" | "phone" | "notification_phone" | "assistant_name" | "gender", string>>;

// Campos opcionais ficam apenas como avisos (não bloqueiam o painel).
// O painel libera com o mínimo: nome + ID iGreen.
function validate(form: ConsultantForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name?.trim() || form.name.trim().length < 3) errors.name = "Digite seu nome completo";
  const igreen = (form.igreen_id || "").replace(/\D/g, "");
  if (!igreen || igreen.length < 4) errors.igreen_id = "ID iGreen inválido (mínimo 4 dígitos)";
  // Soft warnings (não bloqueiam) — telefone/IA/gênero podem ser preenchidos depois na aba Dados.
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
  return out;
}

function isComplete(form: ConsultantForm) {
  return Object.keys(blockingErrors(form)).length === 0;
}

export function OnboardingGate({ form, saving, onFormChange, onSave, children }: OnboardingGateProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const errors = useMemo(() => validate(form), [form]);
  const blocking = useMemo(() => blockingErrors(form), [form]);
  const complete = Object.keys(blocking).length === 0;

  if (complete) return <>{children}</>;

  const showErr = (key: keyof FieldErrors) => (submitAttempted || touched[key]) ? errors[key] : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (Object.keys(blocking).length > 0) return;
    onSave(e);
  };


  return (
    <>
      <div aria-hidden="true" className="pointer-events-none opacity-30 blur-sm">
        {children}
      </div>

      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 overflow-y-auto">
        <form
          onSubmit={handleSubmit}
          className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 sm:p-8 space-y-5 shadow-2xl my-8"
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-heading font-bold text-foreground">Bem-vindo ao iGreen!</h2>
            <p className="text-sm text-muted-foreground">
              Preencha os campos abaixo para liberar o painel. Levam menos de 1 minuto.
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
                  onFormChange({ name: newName, license: slug });
                }}
                placeholder="Seu nome"
                className="bg-secondary border-border"
              />
            </Field>

            <Field label="ID iGreen" error={showErr("igreen_id")}>
              <Input
                value={form.igreen_id}
                onBlur={() => setTouched((t) => ({ ...t, igreen_id: true }))}
                onChange={(e) => {
                  const id = e.target.value.replace(/\D/g, "").slice(0, 10);
                  onFormChange({
                    igreen_id: id,
                    cadastro_url: id ? `https://digital.igreenenergy.com.br/?id=${id}&sendcontract=true` : "",
                    licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : "",
                  });
                }}
                placeholder="ex: 126928"
                inputMode="numeric"
                className="bg-secondary border-border"
              />
            </Field>

            <Field
              label="WhatsApp principal (recebe os clientes interessados dos anúncios)"
              error={showErr("phone")}
              hint="Use o mesmo número que está conectado no Evolution. Formato: DDD + 9 + 8 dígitos."
            >
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
                <Input
                  value={form.phone.replace(/^55/, "")}
                  onBlur={() => {
                    setTouched((t) => ({ ...t, phone: true }));
                    // Normaliza ao sair do campo (adiciona 9 se faltar, etc.)
                    const norm = normalizeBrazilPhone(form.phone);
                    if (norm && norm !== form.phone) onFormChange({ phone: norm });
                  }}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                    onFormChange({ phone: raw ? `55${raw}` : "" });
                  }}
                  placeholder="11989000650"
                  inputMode="numeric"
                  className="bg-secondary border-border rounded-l-none"
                />
              </div>
            </Field>

            <Field
              label="WhatsApp para alertas (novos clientes interessados + atendimento)"
              error={showErr("notification_phone")}
            >
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
                <Input
                  value={form.notification_phone.replace(/^55/, "")}
                  onBlur={() => {
                    setTouched((t) => ({ ...t, notification_phone: true }));
                    const norm = normalizeBrazilPhone(form.notification_phone);
                    if (norm && norm !== form.notification_phone) onFormChange({ notification_phone: norm });
                  }}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                    onFormChange({ notification_phone: raw ? `55${raw}` : "" });
                  }}
                  placeholder="11989000650"
                  inputMode="numeric"
                  className="bg-secondary border-border rounded-l-none"
                />
              </div>
            </Field>

            <Field label="Nome da sua assistente virtual (a IA que vai atender os clientes)" error={showErr("assistant_name")}>
              <Input
                value={form.assistant_name}
                onBlur={() => setTouched((t) => ({ ...t, assistant_name: true }))}
                onChange={(e) => onFormChange({ assistant_name: e.target.value })}
                placeholder="ex: Camila"
                className="bg-secondary border-border"
              />
              <p className="text-xs text-muted-foreground">
                A IA vai se apresentar assim: "Oi! Aqui é a {form.assistant_name?.trim() || "Camila"}, assistente virtual {form.gender === "consultora" ? "da" : "do"} {form.name?.trim() || "(você)"}".
              </p>
            </Field>

            <Field label="Você é consultor ou consultora?" error={showErr("gender")}>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { onFormChange({ gender: "consultor" }); setTouched((t) => ({ ...t, gender: true })); }}
                  className={`h-11 rounded-xl border text-sm font-medium transition ${form.gender === "consultor" ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary text-muted-foreground"}`}
                >
                  Consultor
                </button>
                <button
                  type="button"
                  onClick={() => { onFormChange({ gender: "consultora" }); setTouched((t) => ({ ...t, gender: true })); }}
                  className={`h-11 rounded-xl border text-sm font-medium transition ${form.gender === "consultora" ? "border-primary bg-primary/15 text-foreground" : "border-border bg-secondary text-muted-foreground"}`}
                >
                  Consultora
                </button>
              </div>
            </Field>
          </div>

          {submitAttempted && Object.keys(errors).length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Corrija os campos destacados acima para liberar o painel.</span>
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
