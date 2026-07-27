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
  /**
   * full = Configurações (todos os switches, padrão ligado).
   * offOnly = Dashboard (só o que está desligado; some se tudo ligado).
   */
  variant?: "full" | "offOnly";
};

export function ConsultantAutomationPrefsCard({ consultantId, variant = "full" }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const {
    draft,
    setPack,
    cerebroEnabled,
    setCerebroEnabled,
    cerebroCopy,
    loading,
    saving,
    save,
    packs,
    hasOff,
    error,
  } = useConsultantAutomationPrefs(consultantId);

  const onSave = async () => {
    const ok = await save();
    if (ok) toast.success("Pronto — suas escolhas foram salvas");
    else toast.error(error || "Não deu para salvar. Tente de novo.");
  };

  const visiblePacks =
    variant === "offOnly" ? packs.filter((p) => !draft[p.field]) : packs;
  const showCerebroRow = variant === "full" || !cerebroEnabled;

  // Dashboard limpo: se tudo ligado (incl. Cérebro), não mostra o card.
  if (variant === "offOnly" && !loading && visiblePacks.length === 0 && cerebroEnabled) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {variant === "offOnly" ? "Mensagens automáticas desligadas" : "Mensagens automáticas"}
              </CardTitle>
              <CardDescription>
                {variant === "offOnly"
                  ? "Só o que está desligado. Ligue o que quiser voltar a mandar sozinho. O restante já está ligado."
                  : "Só a sua conta. Cada consultor tem a própria IA (nome da assistente + o seu nome). A IA nasce desligada."}
              </CardDescription>
            </div>
            {hasOff && variant === "full" && (
              <Badge variant="secondary" className="shrink-0">
                Tem coisa desligada
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              {showCerebroRow && (
                <div className="flex items-start justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {cerebroCopy.title}
                      {!cerebroEnabled && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          Desligado
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{cerebroCopy.help}</p>
                  </div>
                  <Switch
                    checked={cerebroEnabled}
                    onCheckedChange={setCerebroEnabled}
                    aria-label={cerebroCopy.title}
                  />
                </div>
              )}
              {visiblePacks.map((p) => {
                const on = !!draft[p.field];
                return (
                  <div key={p.pack} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {p.title}
                        {!on && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            Desligado
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
              })}
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" disabled={saving || loading} onClick={() => void onSave()}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
            {variant === "full" && (
              <Button size="sm" variant="ghost" onClick={() => setModalOpen(true)}>
                Ver com mais detalhe
              </Button>
            )}
            {variant === "offOnly" && (
              <Button size="sm" variant="ghost" onClick={() => setModalOpen(true)}>
                Ver todas
              </Button>
            )}
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
