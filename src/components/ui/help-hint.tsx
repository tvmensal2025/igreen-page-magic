import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface HelpHintProps {
  title: string;
  /** Linha curta exibida no hover (desktop) */
  summary: string;
  /** Texto longo (ou JSX) exibido no clique */
  details: ReactNode;
  /** Exemplo opcional de uso real */
  example?: ReactNode;
  /** Tamanho do ícone em px (default 12) */
  size?: number;
  className?: string;
  /** Alinhamento do popover */
  align?: "start" | "center" | "end";
  /** Lado do popover */
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Ícone de ajuda (?) com tooltip no hover (desktop) e popover detalhado no clique.
 * Use ao lado de títulos, botões ou campos para explicar o que cada função faz.
 */
export function HelpHint({
  title,
  summary,
  details,
  example,
  size = 12,
  className,
  align = "start",
  side = "bottom",
}: HelpHintProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      aria-label={`Ajuda: ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors shrink-0 cursor-help",
        className,
      )}
      style={{ width: size + 6, height: size + 6 }}
    >
      <HelpCircle style={{ width: size, height: size }} />
    </button>
  );

  const content = (
    <PopoverContent
      align={align}
      side={side}
      className="w-72 p-3 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-semibold text-sm text-foreground mb-1.5 leading-tight">{title}</p>
      <p className="text-muted-foreground leading-snug whitespace-pre-line">{details}</p>
      {example && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary/80 mb-0.5">
            Exemplo
          </p>
          <p className="text-muted-foreground/90 leading-snug">{example}</p>
        </div>
      )}
    </PopoverContent>
  );

  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {content}
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side={side} align={align} className="max-w-[220px] text-xs">
            {summary}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {content}
    </Popover>
  );
}

