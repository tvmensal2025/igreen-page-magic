import { useEffect, useMemo, useRef, useState } from "react";
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
  // `dirty` = o consultor mexeu em algum campo e ainda não salvou.
  // Enquanto estiver "sujo", o modal NÃO fecha só por estar válido — ele só
  // fecha depois que o save grava de verdade no banco. Sem isso, o modal
  // sumia no instante em que o último campo ficava válido (antes de salvar),
  // os dados se perdiam e o modal voltava obrigando a digitar tudo de novo.
  const [dirty, setDirty] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const errors = useMemo(() => validate(form), [form]);
  const blocking = useMemo(() => blockingErrors(form), [form]);
  const complete = Object.keys(blocking).length === 0;

  // Aplica mudanças marcando o formulário como "sujo" (tem alteração não salva).
  const applyChange = (updates: Record<string, string>) => {
    setDirty(true);
    onFormChange(updates);
  };

  // Salva e devolve se deu certo. Em caso de sucesso, limpa o "sujo" — aí o
  // modal pode fechar com segurança porque os dados já estão no banco.
  const doSave = async (e: React.FormEvent): Promise<boolean> => {
    const ok = await onSave(e);
    if (ok) setDirty(false);
    return ok;
  };

  // Auto-save: assim que os campos obrigatórios estão preenchidos e há algo
  // não salvo, grava sozinho (com um pequeno atraso pra não salvar a cada
  // tecla). É isso que faz "digitou e já fica salvo".
  useEffect(() => {
    if (!complete || !dirty || saving) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void doSave({ preventDefault() {} } as React.FormEvent);
    }, 700);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, dirty, saving]);

  // Só libera o painel quando está completo E não há alteração pendente —
  // ou seja, os dados completos já foram persistidos.
  if (complete && !dirty) return <>{children}</>;

  const showErr = (key: keyof FieldErrors) => (submitAttempted || touched[key]) ? errors[key] : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (Object.keys(blocking).length > 0) return;
    await doSave(e);
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
              Só precisamos do seu nome e ID iGreen para liberar o painel. Você completa o resto depois na aba <strong>Dados</strong>.
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
          </div>

          {submitAttempted && Object.keys(blocking).length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Preencha nome e ID iGreen para liberar o painel.</span>
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
