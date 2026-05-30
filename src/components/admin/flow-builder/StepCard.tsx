import { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  GripVertical, Pencil, Trash2, Copy, AlertTriangle,
  Mic, Image as ImageIcon, Video, MessageSquare, ScanLine, Sparkles, ArrowRight,
} from "lucide-react";
import { Step, STEP_TYPE_OPTIONS, getButtons, resolveGotoLabel, renderVarsPreview, isOcrStep, isAiAnswerStep } from "./flowTypes";

interface Props {
  step: Step;
  steps: Step[];
  selected: boolean;
  mediaCount?: { audio: number; image: number; video: number };
  /** Quando true, mostra as linhas de conexão para os passos destino */
  showConnections?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Clique numa linha de conexão → seleciona o passo destino */
  onJumpTo?: (stepId: string) => void;
}

export default function StepCard({
  step, steps, selected, mediaCount, showConnections, onSelect, onEdit, onDelete, onDuplicate, onJumpTo,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const typeMeta = STEP_TYPE_OPTIONS.find((t) => t.value === step.step_type) ?? STEP_TYPE_OPTIONS[0];
  const buttons = getButtons(step);
  const warnings = buildWarnings(step, steps);
  const previewText = renderVarsPreview(step.message_text).slice(0, 80);

  // Destinos únicos das transitions (para as linhas de conexão)
  const connectionTargets = step.transitions
    .filter((t) => t.goto_step_id)
    .map((t) => {
      const dest = steps.find((s) => s.id === t.goto_step_id);
      const trigger = t.trigger_phrases[0] || t.trigger_intent || "→";
      return { stepId: t.goto_step_id!, dest, trigger };
    })
    .filter((c, i, arr) => arr.findIndex((x) => x.stepId === c.stepId) === i); // dedupe

  // Destino do fallback (se goto)
  const fallbackTarget = step.fallback?.mode === "goto" && step.fallback.goto_step_id
    ? steps.find((s) => s.id === step.fallback.goto_step_id)
    : null;

  // Próximo por posição (quando sem transitions e sem fallback goto)
  const sequenceNext = connectionTargets.length === 0 && !fallbackTarget
    ? steps.find((s) => s.is_active && s.position === step.position + 1)
    : null;

  const hasConnections = showConnections && (connectionTargets.length > 0 || !!fallbackTarget || !!sequenceNext);

  return (
    <div ref={setNodeRef} style={style} className="relative" id={`step-card-${step.id}`}>
      {/* ── Card principal ── */}
      <div
        onClick={onSelect}
        className={cn(
          "group relative cursor-pointer rounded-xl border bg-card p-3 transition-all hover:border-primary/40",
          selected && "border-primary ring-2 ring-primary/20",
          !step.is_active && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <button
            type="button"
            className="mt-1 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label="Arrastar passo"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Posição + ícone */}
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-base">
            {typeMeta.emoji}
          </div>

          {/* Conteúdo */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{step.position}</span>
              <h4 className="truncate text-sm font-semibold">{step.title}</h4>
              {step.position === 1 && (
                <Badge className="h-5 bg-primary/15 text-[10px] text-primary hover:bg-primary/15">
                  Início
                </Badge>
              )}
              {!step.is_active && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  inativo
                </Badge>
              )}
            </div>

            {previewText && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {previewText}
                {(step.message_text?.length ?? 0) > 80 && "…"}
              </p>
            )}

            {/* Badges */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isAiAnswerStep(step) && (
                <Badge
                  variant="secondary"
                  className="h-5 gap-1 text-[10px] bg-purple-500/15 text-purple-600 dark:text-purple-300"
                >
                  <Sparkles className="h-3 w-3" />
                  IA livre · Gemini
                </Badge>
              )}
              {!isAiAnswerStep(step) && (() => {
                const ocr = isOcrStep(step);
                if (!ocr) return null;
                const on = step.auto_detect_doc_type !== false;
                return (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "h-5 gap-1 text-[10px]",
                      on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <ScanLine className="h-3 w-3" />
                    {on ? `OCR ${ocr === "conta" ? "conta" : "documento"}` : "OCR desligado"}
                  </Badge>
                );
              })()}
              {mediaCount && mediaCount.audio > 0 && <MediaBadge icon={Mic} count={mediaCount.audio} />}
              {mediaCount && mediaCount.image > 0 && <MediaBadge icon={ImageIcon} count={mediaCount.image} />}
              {mediaCount && mediaCount.video > 0 && <MediaBadge icon={Video} count={mediaCount.video} />}
              {buttons.length > 0 && (
                <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
                  <MessageSquare className="h-3 w-3" />
                  {buttons.length} botão{buttons.length > 1 ? "ões" : ""}
                </Badge>
              )}
              {step.transitions.length > 0 && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {step.transitions.length} regra{step.transitions.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {/* Próximos destinos (resumo inline das transitions — visível sem showConnections) */}
            {!showConnections && step.transitions.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {step.transitions.slice(0, 3).map((t, i) => {
                  const dest = resolveGotoLabel(steps, t);
                  const trigger = t.trigger_phrases[0] || t.trigger_intent;
                  return (
                    <div key={i} className="flex items-center gap-1 text-[11px]">
                      <span className="truncate text-muted-foreground">"{trigger}" →</span>
                      <span
                        className={cn(
                          "truncate",
                          dest.missing ? "text-destructive font-medium" : "text-foreground/80",
                        )}
                      >
                        {dest.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="mt-2 flex items-start gap-1 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{warnings[0]}{warnings.length > 1 ? ` (+${warnings.length - 1})` : ""}</span>
              </div>
            )}
          </div>

          {/* Ações */}
          <TooltipProvider delayDuration={300}>
            <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Editar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Duplicar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Remover</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Linhas de conexão: pergunta → resposta ── */}
      {hasConnections && (
        <div className="relative ml-10 mt-0.5 space-y-0.5 pb-1">
          {/* Linha vertical que conecta ao próximo card */}
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border/60" />

          {/* Transitions com goto_step_id */}
          {connectionTargets.map((c) => (
            <button
              key={c.stepId}
              type="button"
              onClick={(e) => { e.stopPropagation(); onJumpTo?.(c.stepId); }}
              className={cn(
                "relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px]",
                "hover:bg-primary/5 transition-colors",
                c.dest && !c.dest.is_active && "opacity-50",
              )}
            >
              {/* Linha horizontal saindo da vertical */}
              <div className="absolute left-3 top-1/2 h-px w-3 bg-border/60" />
              <div className={cn(
                "ml-4 h-1.5 w-1.5 shrink-0 rounded-full",
                c.dest ? "bg-primary/70" : "bg-destructive/70",
              )} />
              <span className="shrink-0 text-muted-foreground">
                "{c.trigger.slice(0, 18)}{c.trigger.length > 18 ? "…" : ""}"
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <span className={cn(
                "truncate font-medium",
                !c.dest ? "text-destructive" : "text-foreground/80",
              )}>
                {c.dest ? `#${c.dest.position} ${c.dest.title}` : "⚠ Passo removido"}
              </span>
            </button>
          ))}

          {/* Fallback goto */}
          {fallbackTarget && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onJumpTo?.(fallbackTarget.id); }}
              className="relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-primary/5 transition-colors"
            >
              <div className="absolute left-3 top-1/2 h-px w-3 bg-border/60" />
              <div className="ml-4 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" />
              <span className="shrink-0 text-muted-foreground">fallback</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <span className="truncate font-medium text-foreground/80">
                #{fallbackTarget.position} {fallbackTarget.title}
              </span>
            </button>
          )}

          {/* Sequência por posição (sem transitions nem fallback goto) */}
          {sequenceNext && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onJumpTo?.(sequenceNext.id); }}
              className="relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-primary/5 transition-colors"
            >
              <div className="absolute left-3 top-1/2 h-px w-3 bg-border/60" />
              <div className="ml-4 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="shrink-0 text-muted-foreground">sequência</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <span className="truncate font-medium text-foreground/80">
                #{sequenceNext.position} {sequenceNext.title}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MediaBadge({ icon: Icon, count }: { icon: any; count: number }) {
  return (
    <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
      <Icon className="h-3 w-3" />
      {count}
    </Badge>
  );
}

function buildWarnings(step: Step, steps: Step[]): string[] {
  const w: string[] = [];
  for (const t of step.transitions) {
    if (!t.goto_step_id && !t.goto_special) {
      w.push(`Regra "${t.trigger_phrases[0] || t.trigger_intent}" sem destino`);
      continue;
    }
    if (t.goto_step_id) {
      const s = steps.find((x) => x.id === t.goto_step_id);
      if (!s) w.push("Regra aponta para passo removido");
      else if (!s.is_active) w.push(`Regra aponta para "${s.title}" (inativo)`);
    }
  }
  const buttons = getButtons(step);
  for (const b of buttons) {
    const hasTransition = step.transitions.some(
      (t) =>
        t.trigger_phrases.includes(b.title) ||
        t.trigger_phrases.includes(b.id) ||
        t.trigger_intent === b.id,
    );
    if (!hasTransition) w.push(`Botão "${b.title}" sem regra de destino`);
  }
  return w;
}
