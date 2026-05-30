// Timeline numerada vertical — substitui o StepCard na lista lateral.
// Cada item = bolinha numerada ancorada num trilho vertical + card médio
// (3 linhas: título, preview da mensagem, badges) + setas inline clicáveis
// para os destinos do passo.

import { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Pencil, Trash2, Copy, AlertTriangle, ArrowRight,
  Mic, Image as ImageIcon, Video, MessageSquare, ScanLine, Sparkles,
} from "lucide-react";
import {
  Step, STEP_TYPE_OPTIONS, getButtons, renderVarsPreview,
  isOcrStep, isAiAnswerStep,
} from "./flowTypes";

interface Props {
  step: Step;
  steps: Step[];
  selected: boolean;
  isStart: boolean;
  isLast: boolean;
  pulse?: boolean;
  mediaCount?: { audio: number; image: number; video: number };
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onJumpTo?: (stepId: string) => void;
}

export default function StepTimelineItem({
  step, steps, selected, isStart, isLast, pulse, mediaCount,
  onSelect, onEdit, onDelete, onDuplicate, onJumpTo,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const typeMeta = STEP_TYPE_OPTIONS.find((t) => t.value === step.step_type) ?? STEP_TYPE_OPTIONS[0];
  const buttons = getButtons(step);
  const previewText = renderVarsPreview(step.message_text).slice(0, 70);
  const warnings = buildWarnings(step, steps);

  // Destinos (transitions + fallback goto + próximo por posição)
  const targets = step.transitions
    .filter((t) => t.goto_step_id)
    .map((t) => {
      const dest = steps.find((s) => s.id === t.goto_step_id);
      const trigger = t.trigger_phrases[0] || t.trigger_intent || "→";
      return { stepId: t.goto_step_id!, dest, trigger, kind: "rule" as const };
    })
    .filter((c, i, arr) => arr.findIndex((x) => x.stepId === c.stepId) === i);

  if (step.fallback?.mode === "goto" && step.fallback.goto_step_id) {
    const dest = steps.find((s) => s.id === step.fallback!.goto_step_id);
    if (dest && !targets.some((t) => t.stepId === dest.id)) {
      targets.push({ stepId: dest.id, dest, trigger: "fallback", kind: "fallback" as any });
    }
  }

  return (
    <div ref={setNodeRef} style={style} id={`step-card-${step.id}`} className="relative flex gap-3">
      {/* ── Trilho + bolinha ── */}
      <div className="relative flex w-7 shrink-0 flex-col items-center">
        {/* Trilho vertical (contínuo) */}
        {!isLast && <div className="absolute left-1/2 top-7 h-[calc(100%+0.75rem)] w-px -translate-x-1/2 bg-border" />}

        {/* Bolinha numerada — também é o drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Arrastar passo"
          className={cn(
            "relative z-10 grid h-7 w-7 cursor-grab touch-none place-items-center rounded-full border text-[11px] font-semibold transition-all active:cursor-grabbing",
            selected
              ? "border-primary bg-primary text-primary-foreground shadow-md"
              : isStart
              ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/30"
              : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
          title={`#${step.position} — arrastar para reordenar`}
        >
          {step.position}
        </button>
      </div>

      {/* ── Card ── */}
      <div className="min-w-0 flex-1 pb-3">
        <div
          onClick={onSelect}
          className={cn(
            "group relative cursor-pointer rounded-lg border bg-card p-2.5 transition-all hover:border-primary/40",
            selected && "border-primary bg-primary/5 ring-2 ring-primary/20",
            !step.is_active && "opacity-60",
            pulse && "animate-pulse ring-2 ring-primary",
          )}
        >
          {/* Linha 1: título + tipo + status */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{typeMeta.emoji}</span>
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{step.title}</h4>
            {isStart && (
              <Badge className="h-4 shrink-0 bg-primary/15 px-1.5 text-[9px] text-primary hover:bg-primary/15">
                Início
              </Badge>
            )}
            {!step.is_active && (
              <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[9px]">
                inativo
              </Badge>
            )}
            {warnings.length > 0 && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
          </div>

          {/* Linha 2: preview da mensagem */}
          {previewText && (
            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
              {previewText}
              {(step.message_text?.length ?? 0) > 70 && "…"}
            </p>
          )}

          {/* Linha 3: badges compactos */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {isAiAnswerStep(step) && (
              <MiniBadge icon={Sparkles} label="IA" className="bg-purple-500/15 text-purple-600 dark:text-purple-300" />
            )}
            {!isAiAnswerStep(step) && isOcrStep(step) && (
              <MiniBadge icon={ScanLine} label="OCR" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" />
            )}
            {mediaCount && mediaCount.audio > 0 && <MiniBadge icon={Mic} label={String(mediaCount.audio)} />}
            {mediaCount && mediaCount.image > 0 && <MiniBadge icon={ImageIcon} label={String(mediaCount.image)} />}
            {mediaCount && mediaCount.video > 0 && <MiniBadge icon={Video} label={String(mediaCount.video)} />}
            {buttons.length > 0 && <MiniBadge icon={MessageSquare} label={`${buttons.length}`} />}
            {step.transitions.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {step.transitions.length} regra{step.transitions.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Ações (visíveis no hover) */}
          <TooltipProvider delayDuration={300}>
            <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Editar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Duplicar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Remover</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        {/* Setas inline para destinos */}
        {targets.length > 0 && (
          <div className="ml-2 mt-1 space-y-0.5">
            {targets.map((t) => (
              <button
                key={`${t.kind}-${t.stepId}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); onJumpTo?.(t.stepId); }}
                className={cn(
                  "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] transition-colors",
                  "hover:bg-primary/5",
                  t.dest && !t.dest.is_active && "opacity-50",
                )}
                title={t.dest ? `Ir para #${t.dest.position} ${t.dest.title}` : "Destino removido"}
              >
                <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                <span className="shrink-0 text-muted-foreground">
                  {t.kind === "fallback" ? "fallback" : `"${t.trigger.slice(0, 14)}${t.trigger.length > 14 ? "…" : ""}"`}
                </span>
                <span className={cn(
                  "truncate font-medium",
                  !t.dest ? "text-destructive" : "text-foreground/75",
                )}>
                  {t.dest ? `→ #${t.dest.position} ${t.dest.title}` : "⚠ removido"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniBadge({ icon: Icon, label, className }: { icon: any; label: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground",
      className,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function buildWarnings(step: Step, steps: Step[]): string[] {
  const w: string[] = [];
  for (const t of step.transitions) {
    if (!t.goto_step_id && !t.goto_special) { w.push("regra sem destino"); continue; }
    if (t.goto_step_id) {
      const s = steps.find((x) => x.id === t.goto_step_id);
      if (!s) w.push("destino removido");
      else if (!s.is_active) w.push("destino inativo");
    }
  }
  return w;
}
