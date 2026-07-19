/**
 * Timeline Multicanal — cards compactos.
 */
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CheckCircle2, Link2, Pencil } from "lucide-react";
import type { CadenceTemplate } from "@/lib/multichannelCadenceTexts";
import { getTemplate } from "@/lib/multichannelCadenceTexts";

const CHANNEL_META: Record<
  CadenceTemplate["channel"],
  { emoji: string; label: string }
> = {
  whatsapp_text: { emoji: "💬", label: "texto" },
  whatsapp_buttons: { emoji: "🔘", label: "botões" },
  whatsapp_audio: { emoji: "🎧", label: "áudio" },
  sms: { emoji: "📱", label: "sms" },
  call_script: { emoji: "📞", label: "ligação" },
  system: { emoji: "ℹ️", label: "info" },
};

type Props = {
  position: number;
  template: CadenceTemplate;
  previewText: string;
  selected: boolean;
  isLast: boolean;
  approved: boolean;
  buttonCount: number;
  segmentCount: number;
  onSelect: () => void;
  onEdit: () => void;
  /** Abre o passo pai (toques OCR retry ligados). */
  onJumpLinked?: (key: string) => void;
};

export function CadenceTimelineItem({
  position,
  template,
  previewText,
  selected,
  isLast,
  approved,
  buttonCount,
  segmentCount,
  onSelect,
  onEdit,
  onJumpLinked,
}: Props) {
  const meta = CHANNEL_META[template.channel] ?? CHANNEL_META.whatsapp_text;
  const linkedParent = template.linkedToStepKey
    ? getTemplate(template.linkedToStepKey)
    : null;

  return (
    <div className="relative flex gap-2.5">
      <div className="relative flex w-6 shrink-0 flex-col items-center">
        {!isLast && (
          <div className="absolute left-1/2 top-6 h-[calc(100%+0.5rem)] w-px -translate-x-1/2 bg-border/70" />
        )}
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "relative z-10 grid h-6 w-6 place-items-center rounded-full border text-[10px] font-semibold transition-all",
            selected
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border/80 bg-background text-muted-foreground hover:border-primary/50",
          )}
          title={`#${position}`}
        >
          {position}
        </button>
      </div>

      <div className="min-w-0 flex-1 pb-2.5">
        <div
          role="button"
          tabIndex={0}
          onClick={onEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onEdit();
            }
          }}
          className={cn(
            "group relative cursor-pointer rounded-lg border bg-card/90 px-3 py-2.5 transition-all hover:border-primary/35 hover:bg-card",
            selected && "border-primary/60 bg-primary/[0.04] shadow-sm ring-1 ring-primary/15",
            !approved && "opacity-75",
          )}
        >
          <div className="flex items-center gap-1.5 pr-7">
            <span className="text-sm leading-none">{meta.emoji}</span>
            <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
              {template.title}
            </h4>
            {approved ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35" />
            )}
          </div>

          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {template.timing}
            <span className="text-muted-foreground/50"> · {meta.label}</span>
            {segmentCount > 0 && (
              <span className="text-muted-foreground/50"> · {segmentCount} cortes</span>
            )}
            {buttonCount > 0 && (
              <span className="text-muted-foreground/50">
                {" "}
                · {buttonCount} botão{buttonCount > 1 ? "ões" : ""}
              </span>
            )}
          </p>

          {previewText && (
            <p className="mt-1 line-clamp-1 text-[11px] leading-snug text-muted-foreground/90">
              {previewText}
            </p>
          )}

          {linkedParent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJumpLinked?.(linkedParent.key);
              }}
              className="mt-1.5 flex w-full items-center gap-1 rounded-md border border-dashed border-border/60 px-1.5 py-1 text-left text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Link2 className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">
                Ligado a {linkedParent.title}
              </span>
            </button>
          )}

          <TooltipProvider delayDuration={200}>
            <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Editar</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
