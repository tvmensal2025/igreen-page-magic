import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import BrandLogo from "@/components/common/BrandLogo";
import { cn } from "@/lib/utils";
import "./auth-motion.css";

type AuthShellProps = {
  children: ReactNode;
  /** Headline abaixo do logo */
  title: string;
  /** Subtítulo curto */
  subtitle?: string;
  className?: string;
  /** Esconde o ThemeToggle (raro) */
  hideThemeToggle?: boolean;
};

/**
 * Shell visual compartilhado de /auth e /reset-password.
 * Fundo leve (CSS) + logo marca — sem canvas/particles.
 */
export function AuthShell({
  children,
  title,
  subtitle = "Painel do Consultor iGreen Energy",
  className,
  hideThemeToggle = false,
}: AuthShellProps) {
  return (
    <div
      className={cn(
        "min-h-screen flex items-center justify-center px-4 py-10 relative overflow-x-hidden bg-background public-page-safe-bottom",
        className,
      )}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl auth-float" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl auth-float-delay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      {!hideThemeToggle && (
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
      )}

      <div className="w-full max-w-md relative z-10 space-y-7">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <BrandLogo className="w-44 drop-shadow-lg" alt="iGreen Energy" />
              <div className="absolute -inset-4 bg-primary/10 rounded-3xl blur-2xl -z-10" aria-hidden />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-heading text-foreground tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
          ) : null}
        </div>

        {children}
      </div>
    </div>
  );
}
