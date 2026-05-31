import { cn } from "@/lib/utils";

interface AmbientGlowProps {
  /**
   * Variante do efeito decorativo de fundo:
   * - "hero": dois orbs verdes (canto superior direito + inferior esquerdo). Usado em heroes de LP.
   * - "panel": três blobs suaves para telas de painel ultrawide (admin).
   * - "spotlight": um brilho radial central, ideal para seções de CTA.
   */
  variant?: "hero" | "panel" | "spotlight";
  className?: string;
}

/**
 * Camada decorativa de fundo reutilizável. Substitui os diversos blocos de
 * `style={{ background: 'radial-gradient(...hsl(130 100% 36%)...)' }}` que
 * estavam duplicados em HeroSection, LicHeroSection, AboutSection,
 * ReferralSection, AdvantagesSection, Admin e Auth.
 *
 * Sempre `pointer-events-none` e `aria-hidden` — puramente visual.
 */
const AmbientGlow = ({ variant = "hero", className }: AmbientGlowProps) => {
  if (variant === "panel") {
    return (
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-60", className)}
      >
        <div className="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[700px] w-[700px] rounded-full bg-emerald-500/[0.06] blur-[140px]" />
        <div className="absolute bottom-0 left-1/4 h-[500px] w-[500px] rounded-full bg-green-500/[0.05] blur-[120px]" />
      </div>
    );
  }

  if (variant === "spotlight") {
    return (
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{ background: "radial-gradient(ellipse at center, hsl(var(--primary) / 0.08), transparent 70%)" }}
      />
    );
  }

  // variant === "hero"
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div
        className="absolute -top-32 -right-32 h-[700px] w-[700px] rounded-full opacity-[0.10]"
        style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 70%)" }}
      />
      <div
        className="absolute -bottom-48 -left-32 h-[800px] w-[800px] rounded-full opacity-[0.08]"
        style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 70%)" }}
      />
      <div
        className="absolute top-1/2 left-1/2 h-[900px] w-[1100px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(ellipse, hsl(var(--primary)), transparent 65%)" }}
      />
    </div>
  );
};

export default AmbientGlow;
