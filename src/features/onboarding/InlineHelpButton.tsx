import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export function InlineHelpButton({ title, body, ctaLabel, ctaHref }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" aria-label="Ajuda">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <div className="font-semibold mb-1">{title}</div>
        <p className="text-muted-foreground leading-relaxed">{body}</p>
        {ctaHref && (
          <a
            href={ctaHref}
            className="mt-2 inline-block text-primary hover:underline text-xs font-medium"
          >
            {ctaLabel || "Saber mais →"}
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
