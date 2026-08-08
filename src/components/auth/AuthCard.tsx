import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./auth-motion.css";

type AuthCardProps = {
  children: ReactNode;
  className?: string;
  /** Liga borda shine (estilo Magic UI, CSS puro) */
  shine?: boolean;
};

/**
 * Card glass compartilhado das telas de autenticação.
 */
export function AuthCard({ children, className, shine = true }: AuthCardProps) {
  return (
    <div className="relative">
      <div
        className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-3xl blur-xl opacity-50 pointer-events-none"
        aria-hidden
      />
      <div
        className={cn(
          "relative bg-card/80 backdrop-blur-xl p-5 sm:p-8 rounded-2xl border border-border shadow-xl w-full",
          shine && "auth-shine-border",
          className,
        )}
      >
        <div
          className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent z-[1]"
          aria-hidden
        />
        <div className="relative z-[1]">{children}</div>
      </div>
    </div>
  );
}
