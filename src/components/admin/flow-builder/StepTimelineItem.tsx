// Timeline numerada vertical — o item da Lista (construtor principal do fluxo).
// Cada item = bolinha numerada ancorada num trilho vertical + card com a
// mensagem do passo + um bloco "Saídas" que mostra, de forma unificada e
// legível, TODAS as ramificações do passo: botões, palavras-chave e o
// caminho padrão — cada uma com o destino resolvido e clicável.
//
// As saídas vêm de `getStepExits` (flowExits.ts), que junta o que antes
// estava espalhado em `captures._buttons` + `transitions` + `fallback`.

import { CSSProperties, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Pencil, Trash2, Copy, AlertTriangle, ArrowRight, CornerDownRight,
  Mic, Image as ImageIcon, Video, MessageSquare, ScanLine, Sparkles, MousePointerClick, Hash,
  ChevronUp, ChevronDown, HelpCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Step, STEP_TYPE_OPTIONS, getButtons, renderVarsPreview,
  isOcrStep, isAiAnswerStep,
} from "./flowTypes";
import { getStepExits, type StepExit, type ExitKind } from "./flowExits";

interface Props {
  step: Step;
  steps: Step[];
  selected: boolean;
  isStart: boolean;
  isLast: boolean;
  pulse?: boolean;
  mediaCount?: { audio: number; image: number; video: number };
  consultantName?: string;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onJumpTo?: (stepId: string) => void;
  /** Abre o inspetor já na aba "Regras & Botões" para editar as saídas. */
  onEditExits?: () => void;
}

export default function StepTimelineItem({
  step, steps, selected, isStart, isLast, pulse, mediaCount, consultantName,
  onSelect, onEdit, onDelete, onDuplicate, onJumpTo, onEditExits,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const typeMeta = STEP_TYPE_OPTIONS.find((t) => t.value === step.step_type) ?? STEP_TYPE_OPTIONS[0];
  const buttons = getButtons(step);
  const previewText = renderVarsPreview(step.message_text, consultantName).slice(0, 90);
  const warnings = buildWarnings(step, steps);

  // Saídas unificadas (botão / palavra-chave / padrão → destino).
  const exits = getStepExits(step, steps);

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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground/50 hover:text-primary"
                  aria-label="O que este passo faz?"
                  title="O que este passo faz?"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" className="w-72 text-xs" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1.5 font-semibold mb-1">
                  <span>{typeMeta.emoji}</span>
                  <span>{typeMeta.label}</span>
                </div>
                <p className="text-muted-foreground leading-snug">{typeMeta.hint}</p>
                <p className="mt-2 text-[10px] text-muted-foreground/70">
                  Dica: clique no passo para abrir o editor e ajustar texto, mídias e regras.
                </p>
              </PopoverContent>
            </Popover>
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
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {previewText}
              {(step.message_text?.length ?? 0) > 90 && "…"}
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
            {buttons.length > 0 && <MiniBadge icon={MessageSquare} label={buttons.length === 1 ? "1 botão" : `${buttons.length} botões`} />}
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

        {/* ── Saídas do passo (botão / palavra-chave / padrão → destino) ── */}
        <ExitsBlock
          exits={exits}
          onJumpTo={onJumpTo}
          onEditExits={onEditExits ?? onEdit}
        />
      </div>
    </div>
  );
}

/**
 * Bloco "Saídas" — lista unificada de para onde o passo pode ir. Mostra o
 * gatilho (o que o lead faz) → o destino resolvido. Clicar numa saída que
 * leva a outro passo navega até ele; o botão de lápis abre o editor de regras.
 *
 * Quando há muitas saídas (botões + palavras-chave), colapsa as excedentes
 * atrás de um "ver mais" para a lista não virar uma parede de linhas em
 * fluxos grandes. A saída "padrão" fica SEMPRE visível (é o caminho garantido
 * quando nada casa), independente do colapso.
 */
const EXITS_COLLAPSE_THRESHOLD = 5;

function ExitsBlock({
  exits, onJumpTo, onEditExits,
}: {
  exits: StepExit[];
  onJumpTo?: (stepId: string) => void;
  onEditExits: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Separa a saída padrão (sempre visível) das demais (botões/palavras-chave).
  const defaultExit = exits.find((e) => e.kind === "default");
  const branchExits = exits.filter((e) => e.kind !== "default");

  const collapsible = branchExits.length > EXITS_COLLAPSE_THRESHOLD;
  const visibleBranches = expanded || !collapsible
    ? branchExits
    : branchExits.slice(0, EXITS_COLLAPSE_THRESHOLD);
  const hiddenCount = branchExits.length - visibleBranches.length;

  return (
    <div className="ml-2 mt-1 space-y-0.5 border-l border-dashed border-border/60 pl-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Saídas
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEditExits(); }}
          className="text-[9px] text-muted-foreground/60 underline-offset-2 hover:text-primary hover:underline"
        >
          editar
        </button>
      </div>
      {visibleBranches.map((exit) => (
        <ExitRow key={exit.id} exit={exit} onJumpTo={onJumpTo} />
      ))}
      {collapsible && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-muted-foreground/70 hover:bg-primary/5 hover:text-primary"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              ver menos
            </>
          ) : (
            <>
              <ChevronDown className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              ver mais {hiddenCount} {hiddenCount === 1 ? "saída" : "saídas"}
            </>
          )}
        </button>
      )}
      {/* A saída padrão fica sempre visível, abaixo das ramificações. */}
      {defaultExit && <ExitRow key={defaultExit.id} exit={defaultExit} onJumpTo={onJumpTo} />}
    </div>
  );
}

const EXIT_KIND_META: Record<ExitKind, { icon: LucideIcon; tone: string; srLabel: string }> = {
  button: { icon: MousePointerClick, tone: "text-blue-600 dark:text-blue-300", srLabel: "Botão" },
  keyword: { icon: Hash, tone: "text-amber-600 dark:text-amber-400", srLabel: "Palavra-chave" },
  default: { icon: CornerDownRight, tone: "text-muted-foreground", srLabel: "Padrão" },
};

function ExitRow({ exit, onJumpTo }: { exit: StepExit; onJumpTo?: (stepId: string) => void }) {
  const meta = EXIT_KIND_META[exit.kind];
  const Icon = meta.icon;
  const canJump = !!exit.destStep && !!onJumpTo;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canJump) onJumpTo!(exit.destStep!.id);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canJump}
      title={
        exit.kind === "default"
          ? `Caminho padrão → ${exit.destLabel}`
          : `${meta.srLabel} "${exit.label}" → ${exit.destLabel}`
      }
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-colors",
        canJump ? "hover:bg-primary/5" : "cursor-default",
      )}
    >
      <Icon className={cn("h-3 w-3 shrink-0", meta.tone)} aria-hidden="true" />
      <span className={cn("min-w-0 max-w-[45%] shrink-0 truncate", exit.kind === "default" ? "italic text-muted-foreground" : "text-foreground/80")}>
        {exit.kind === "default" ? "padrão" : exit.label}
      </span>
      <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" aria-hidden="true" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium",
          exit.missing ? "text-destructive" : exit.destStep ? "text-foreground/85" : "text-muted-foreground",
        )}
      >
        {exit.destLabel}
      </span>
    </button>
  );
}

function MiniBadge({ icon: Icon, label, className }: { icon: LucideIcon; label: string; className?: string }) {
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
