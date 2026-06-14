import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const adsButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[hsl(var(--ads-emerald))] text-white hover:bg-[hsl(var(--ads-emerald-2))] shadow-sm",
        secondary:
          "border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] text-[hsl(var(--ads-text))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]",
        ghost:
          "text-[hsl(var(--ads-muted))] hover:text-[hsl(var(--ads-emerald-2))] hover:bg-[hsl(var(--ads-emerald)/.08)]",
        nav: "relative text-[hsl(var(--ads-muted))] hover:text-[hsl(var(--ads-emerald-2))] hover:bg-[hsl(var(--ads-emerald)/.08)] data-[active=true]:text-white data-[active=true]:bg-[var(--ads-gradient-emerald,hsl(var(--ads-emerald)))]",
        cta: "ads-cta-primary",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-md [&_svg]:size-3.5",
        md: "h-9 px-4 text-sm rounded-md [&_svg]:size-4",
        nav: "h-8 px-3.5 text-[0.8125rem] rounded-[0.625rem] [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface AdsButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof adsButtonVariants> {
  asChild?: boolean;
  active?: boolean;
}

const AdsButton = React.forwardRef<HTMLButtonElement, AdsButtonProps>(
  ({ className, variant, size, asChild = false, active, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-active={active ? "true" : undefined}
        className={cn(adsButtonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
AdsButton.displayName = "AdsButton";

export { AdsButton, adsButtonVariants };
