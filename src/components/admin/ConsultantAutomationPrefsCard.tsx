import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useConsultantAutomationPrefs } from "@/hooks/useConsultantAutomationPrefs";
import { ConsultantAutomationPrefsModal } from "@/components/admin/ConsultantAutomationPrefsModal";
import { toast } from "sonner";

type Props = {
  consultantId: string;
};

export function ConsultantAutomationPrefsCard({ consultantId }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const { draft, setPack, loading, saving, save, packs, hasOff, error } =
    useConsultantAutomationPrefs(consultantId);

  const onSave = async () => {
    const ok = await save();
    if (ok) toast.success("Automações atualizadas");
    else toast.error(error || "Falha ao salvar");
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Minhas automações</CardTitle>
              <CardDescription>
                Opt-in do seu painel. Desligado = zero envio automático aos seus leads.
              </CardDescription>
            </div>
            {hasOff && (
              <Badge variant="secondary" className="shrink-0">
                Algo desativado
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            packs.map((p) => {
              const on = !!draft[p.field];
              return (
                <div key={p.pack} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {p.title}
                      {!on && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          Desativado
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.help}</p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => setPack(p.field, v)}
                    aria-label={p.title}
                  />
                </div>
              );
            })
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" disabled={saving || loading} onClick={() => void onSave()}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModalOpen(true)}>
              Abrir modal completo
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConsultantAutomationPrefsModal
        consultantId={consultantId}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
