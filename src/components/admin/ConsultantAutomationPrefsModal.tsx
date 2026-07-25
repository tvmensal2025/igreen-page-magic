import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useConsultantAutomationPrefs } from "@/hooks/useConsultantAutomationPrefs";
import { toast } from "sonner";

type Props = {
  consultantId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Se true, abre sozinho quando ainda não houve ack. */
  autoPrompt?: boolean;
};

export function ConsultantAutomationPrefsModal({
  consultantId,
  open: controlledOpen,
  onOpenChange,
  autoPrompt = false,
}: Props) {
  const {
    draft,
    setPack,
    loading,
    saving,
    error,
    save,
    packs,
    needsAck,
    hasOff,
  } = useConsultantAutomationPrefs(consultantId);

  const autoOpen = autoPrompt && !loading && needsAck;
  const open = controlledOpen ?? autoOpen;

  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
  };

  const onSave = async () => {
    const ok = await save();
    if (ok) {
      toast.success("Preferências de automação salvas");
      handleOpenChange(false);
    } else {
      toast.error(error || "Não foi possível salvar");
    }
  };

  const onLeaveOff = async () => {
    const ok = await save({ leaveAllOff: true });
    if (ok) {
      toast.message("Automações permanecem desligadas neste painel");
      handleOpenChange(false);
    } else {
      toast.error(error || "Não foi possível salvar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Automações do seu painel</DialogTitle>
          <DialogDescription>
            Cada consultor controla o próprio envio automático. O que estiver
            desligado não dispara mensagem para os seus clientes — chat e agenda
            manual continuam liberados.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-3 py-1">
            {hasOff && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Há funções desativadas. Ligue só o que você usa de verdade.
              </p>
            )}
            {packs.map((p) => {
              const on = !!draft[p.field];
              return (
                <div
                  key={p.pack}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{p.title}</span>
                      {!on && (
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          Desativado
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.help}</p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => setPack(p.field, v)}
                    aria-label={p.title}
                  />
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving || loading}
            onClick={() => void onLeaveOff()}
            className="w-full sm:w-auto"
          >
            Deixar desligado e continuar
          </Button>
          <Button
            type="button"
            disabled={saving || loading}
            onClick={() => void onSave()}
            className="w-full sm:w-auto"
          >
            {saving ? "Salvando…" : "Salvar preferências"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
