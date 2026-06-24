import { ExternalLink, Copy, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LinkCardProps {
  emoji: string;
  title: string;
  description: string;
  url: string;
  onCopy: (url: string) => void;
  previewUrl: string;
}

export function LinkCard({ emoji, title, description, url, onCopy, previewUrl }: LinkCardProps) {
  return (
    <div className="group relative bg-card rounded-2xl border border-border p-3 sm:p-6 transition-all duration-300 hover:border-primary/20 hover:shadow-lg overflow-hidden">
      {/* Subtle hover gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-base sm:text-lg ring-1 ring-primary/20 group-hover:scale-110 transition-transform duration-300">
              {emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-heading font-bold text-foreground text-sm sm:text-base leading-tight">{title}</h3>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
            </div>
          </div>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary transition-all shrink-0 p-1.5 rounded-lg hover:bg-primary/10">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <code className="flex-1 min-w-0 bg-secondary/50 dark:bg-secondary px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-xl text-primary text-[11px] sm:text-sm break-all font-mono border border-border/50 leading-snug">
            {url.replace("https://", "")}
          </code>
          <Button size="sm" variant="outline" onClick={() => onCopy(url)} className="gap-1.5 shrink-0 rounded-xl hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all h-9 px-2.5 sm:px-3" aria-label="Copiar">
            <Copy className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Copiar</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

