import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Save } from "lucide-react";
import type { ConsultantForm } from "@/hooks/useAdminAuth";

interface OnboardingGateProps {
  form: ConsultantForm;
  saving: boolean;
  onFormChange: (updates: Record<string, string>) => void;
  onSave: (e: React.FormEvent) => void;
  children: React.ReactNode;
}

function isComplete(form: ConsultantForm) {
  return (
    !!form.name?.trim() &&
    !!form.igreen_id?.trim() &&
    !!form.phone?.replace(/\D/g, "") &&
    !!form.notification_phone?.replace(/\D/g, "")
  );
}

export function OnboardingGate({ form, saving, onFormChange, onSave, children }: OnboardingGateProps) {
  const complete = isComplete(form);

  if (complete) return <>{children}</>;

  return (
    <>
      {/* Render children behind so layout stays consistent, but block interaction */}
      <div aria-hidden="true" className="pointer-events-none opacity-30 blur-sm">
        {children}
      </div>

      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 overflow-y-auto">
        <form
          onSubmit={onSave}
          className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 sm:p-8 space-y-5 shadow-2xl my-8"
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-heading font-bold text-foreground">Bem-vindo ao iGreen!</h2>
            <p className="text-sm text-muted-foreground">
              Preencha os 4 campos abaixo para liberar o painel. Levam menos de 1 minuto.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ob-name" className="text-sm text-muted-foreground">Nome completo</Label>
              <Input
                id="ob-name"
                value={form.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  const slug = newName.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
                  onFormChange({ name: newName, license: slug });
                }}
                placeholder="Seu nome"
                className="bg-secondary border-border"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ob-igreen" className="text-sm text-muted-foreground">ID iGreen</Label>
              <Input
                id="ob-igreen"
                value={form.igreen_id}
                onChange={(e) => {
                  const id = e.target.value;
                  onFormChange({
                    igreen_id: id,
                    cadastro_url: id ? `https://digital.igreenenergy.com.br/?id=${id}&sendcontract=true` : "",
                    licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : "",
                  });
                }}
                placeholder="ex: 126928"
                className="bg-secondary border-border"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ob-phone" className="text-sm text-muted-foreground">WhatsApp principal (recebe os clientes interessados dos anúncios)</Label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
                <Input
                  id="ob-phone"
                  value={form.phone.replace(/^55/, "")}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                    onFormChange({ phone: raw ? `55${raw}` : "" });
                  }}
                  placeholder="11989000650"
                  className="bg-secondary border-border rounded-l-none"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ob-notif" className="text-sm text-muted-foreground">WhatsApp para alertas (novos clientes interessados + atendimento)</Label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">+55</span>
                <Input
                  id="ob-notif"
                  value={form.notification_phone.replace(/^55/, "")}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                    onFormChange({ notification_phone: raw ? `55${raw}` : "" });
                  }}
                  placeholder="11989000650"
                  className="bg-secondary border-border rounded-l-none"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ao salvar, seu WhatsApp principal será ativado automaticamente como destino dos anúncios do Facebook.
              </p>
            </div>
          </div>

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
