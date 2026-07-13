// Popup de "saúde do fluxo" — revisão guiada antes de uma ação importante
// (publicar na galeria, por exemplo). Mostra, em português claro e sem jargão,
// tudo que pode dar errado, agrupado por gravidade, com o passo afetado e um
// atalho para abrir o passo. Se está tudo certo, mostra um estado de sucesso.
//
// Filosofia: "estar do lado do usuário ensinando". Cada item explica o que vai
// acontecer e como arrumar. Erros graves bloqueiam a ação; avisos só alertam.
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, ShieldCheck } from "lucide-react";
import type { FlowValidation, FlowWarning } from "./useFlowValidation";
import type { Step } from "./flowTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validation: FlowValidation;
  steps: Step[];
  /** Título da ação que vai acontecer ao confirmar (ex.: "Publicar na galeria"). */
  actionLabel: string;
  /** Chamado quando o usuário confirma mesmo com avisos (ou sem problemas). */
  onConfirm: () => void;
  /** Abre o passo no inspetor para o usuário corrigir. */
  onJumpToStep?: (stepId: string) => void;
}

/** Título humano de cada tipo de problema. */
const KIND_TITLE: Record<string, string> = {
  empty_message: "Mensagem em branco",
  unresolved_var: "Informação que não existe",
  var_before_capture: "Informação usada cedo demais",
  goto_no_wait: "Pergunta que não espera resposta",
  media_missing: "Mídia não anexada",
  flow_no_ending: "Fluxo sem final",
  too_many_buttons: "Opções demais",
  button_no_rule: "Botão sem destino",
  transition_no_dest: "Regra sem destino",
  transition_dest_missing: "Destino apagado",
  transition_dest_inactive: "Destino desligado",
  orphan_step: "Passo isolado",
  loop_detected: "Passo em loop",
  ocr_without_confirm: "Foto sem confirmação",
  ai_no_buttons: "IA sem botões",
  ai_no_humano_exit: "IA sem saída para humano",
  conversion_step_no_cta: "Passo de conversão sem botão",
  activate_to_sim_path: "Ativar → caminho de simulação",
  activate_skips_conta: "Ativar pulando a conta de cadastro",
};

export default function FlowHealthDialog({
  open, onOpenChange, validation, steps, actionLabel, onConfirm, onJumpToStep,
}: Props) {
  const errors = validation.warnings.filter((w) => w.level === "error");
  const warns = validation.warnings.filter((w) => w.level === "warn");
  const stepTitle = (id: string) => {
    const s = steps.find((x) => x.id === id);
    return s ? `#${s.position} ${s.title}` : "passo";
  };
  const clean = errors.length === 0 && warns.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Revisão do fluxo
          </DialogTitle>
          <DialogDescription>
            {clean
              ? "Conferi tudo e o fluxo está saudável. Pode seguir com segurança."
              : "Antes de continuar, dei uma conferida no fluxo. Veja o que encontrei:"}
          </DialogDescription>
        </DialogHeader>

        {clean ? (
          <div className="grid place-items-center gap-3 py-8 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
              <CheckCircle2 className="h-9 w-9 text-primary" />
            </div>
            <p className="text-sm font-medium">Tudo certo com este fluxo!</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Nenhum problema encontrado. As mensagens, perguntas e finalização
              estão coerentes.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-3">
            <div className="space-y-4">
              {errors.length > 0 && (
                <Section
                  icon={<XCircle className="h-4 w-4 text-destructive" />}
                  title={`${errors.length} ${errors.length === 1 ? "problema grave" : "problemas graves"} (precisa corrigir)`}
                  items={errors}
                  tone="error"
                  kindTitle={KIND_TITLE}
                  stepTitle={stepTitle}
                  onJumpToStep={onJumpToStep}
                  onOpenChange={onOpenChange}
                />
              )}
              {warns.length > 0 && (
                <Section
                  icon={<AlertTriangle className="h-4 w-4 text-warning" />}
                  title={`${warns.length} ${warns.length === 1 ? "ponto de atenção" : "pontos de atenção"}`}
                  items={warns}
                  tone="warn"
                  kindTitle={KIND_TITLE}
                  stepTitle={stepTitle}
                  onJumpToStep={onJumpToStep}
                  onOpenChange={onOpenChange}
                />
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {clean ? "Voltar" : "Vou corrigir antes"}
          </Button>
          <Button
            onClick={() => { onOpenChange(false); onConfirm(); }}
            disabled={errors.length > 0}
            title={errors.length > 0 ? "Corrija os problemas graves primeiro" : undefined}
          >
            {clean ? actionLabel : `Continuar mesmo assim · ${actionLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon, title, items, tone, kindTitle, stepTitle, onJumpToStep, onOpenChange,
}: {
  icon: React.ReactNode;
  title: string;
  items: FlowWarning[];
  tone: "error" | "warn";
  kindTitle: Record<string, string>;
  stepTitle: (id: string) => string;
  onJumpToStep?: (stepId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {items.map((w) => (
          <div
            key={w.id}
            className={`rounded-lg border p-3 ${
              tone === "error"
                ? "border-destructive/30 bg-destructive/5"
                : "border-warning/30 bg-warning/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{kindTitle[w.kind] ?? "Atenção"}</span>
              {onJumpToStep && (
                <button
                  type="button"
                  onClick={() => { onOpenChange(false); onJumpToStep(w.stepId); }}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {stepTitle(w.stepId)} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{w.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
