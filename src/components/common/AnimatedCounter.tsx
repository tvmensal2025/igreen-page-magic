import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  target: number;
  suffix?: string;
  /** Classe aplicada ao número. Por padrão usa o utilitário `.stat-number` do design system. */
  className?: string;
  /** Duração da animação em ms (desktop). Mobile aplica o valor final direto. */
  duration?: number;
}

/**
 * Contador que anima de 0 até `target` quando entra no viewport.
 * Em mobile (ou sem IntersectionObserver) o valor final é aplicado direto,
 * evitando jank. Respeita `prefers-reduced-motion` ao pular a animação.
 *
 * Consolidado a partir de cópias idênticas que existiam em HeroSection,
 * LicHeroSection e CRMLandingPage.
 */
const AnimatedCounter = ({
  target,
  suffix = "",
  className = "stat-number",
  duration = 2000,
}: AnimatedCounterProps) => {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isMobileViewport =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;

    const startAnimation = () => {
      if (hasAnimatedRef.current) return;
      hasAnimatedRef.current = true;

      if (isMobileViewport || prefersReducedMotion) {
        setCount(target);
        return;
      }

      let start = 0;
      const step = (timestamp: number) => {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        setCount(Math.floor(progress * target));
        if (progress < 1) requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    };

    if (typeof IntersectionObserver === "undefined" || isMobileViewport) {
      startAnimation();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [target, duration]);

  return (
    <div ref={ref} className="stat-block">
      <div className={className}>
        {count.toLocaleString("pt-BR")}
        {suffix}
      </div>
    </div>
  );
};

export default AnimatedCounter;
