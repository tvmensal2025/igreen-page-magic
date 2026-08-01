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
import { toast } from "@/components/ui/sonner";

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
    cerebroEnabled,
    setCerebroEnabled,
    cerebroCopy,
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
  // Bloqueia o tour enquanto o 1º ack estiver pendente (mesmo antes do autoPrompt ligar).
  const blockTour = controlledOpen === undefined && !!consultantId && (loading || needsAck);

  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
  };

  const onSave = async () => {
    const ok = await save();
    if (ok) {
      toast.success("Pronto — suas escolhas foram salvas");
      handleOpenChange(false);
    } else {
      toast.error(error || "Não deu para salvar. Tente de novo.");
    }
  };

  const onLeaveOff = async () => {
    const ok = await save({ leaveAllOff: true });
    if (ok) {
      toast.message("Tudo continua desligado. Nada vai sair sozinho.");
      handleOpenChange(false);
    } else {
      toast.error(error || "Não deu para salvar. Tente de novo.");
    }
  };

  return (
    <>
      {blockTour && <div hidden data-tour-blocker="automation-prefs-pending" aria-hidden="true" />}
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        data-tour-blocker="automation-prefs"
      >
        <DialogHeader>
          <DialogTitle>Mensagens automáticas</DialogTitle>
          <DialogDescription>
            Só vale para a sua conta. Escolha o que pode sair sozinho. A IA nasce
            desligada — cada consultor tem a própria (nome da IA + o seu nome).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-3 py-1">
            {hasOff && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Tem coisa desligada. Ligue só o que você realmente quer usar.
              </p>
            )}

            <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{cerebroCopy.title}</span>
                  {!cerebroEnabled && (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      Desligado
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{cerebroCopy.help}</p>
              </div>
              <Switch
                checked={cerebroEnabled}
                onCheckedChange={setCerebroEnabled}
                aria-label={cerebroCopy.title}
              />
            </div>

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
                          Desligado
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
            Deixar tudo desligado
          </Button>
          <Button
            type="button"
            disabled={saving || loading}
            onClick={() => void onSave()}
            className="w-full sm:w-auto"
          >
            {saving ? "Salvando…" : "Salvar e continuar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
