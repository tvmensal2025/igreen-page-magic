import { useEffect, type RefObject } from "react";

/**
 * Reveal ao rolar com UM único IntersectionObserver para a página inteira.
 *
 * Por que um observer só: cada observer custa memória e trabalho na thread
 * principal. Em vez de um por card, varremos os `[data-reveal]` dentro do
 * container e usamos o mesmo observer para todos — mais barato no celular.
 *
 * Regras de segurança:
 * - O estado inicial (invisível) é aplicado por CSS que só vale quando este
 *   hook marca `data-reveal-ready="true"`. Se o JS falhar, nada fica escondido.
 * - `prefers-reduced-motion` pula tudo: marca visível e sai.
 * - Cada elemento é desobservado após entrar (não reanima ao rolar de volta).
 */
export function useReveal(containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Sem suporte a observer ou usuário pediu menos movimento: entrega estático.
    if (prefersReduced || typeof IntersectionObserver === "undefined") return;

    root.dataset.revealReady = "true";

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      // rootMargin negativo embaixo: só anima quando o elemento realmente
      // entrou na área de leitura, não no instante em que raspa a borda.
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" },
    );

    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));

    // Escalona o delay dentro de cada grupo para o conteúdo "cascatear".
    // Teto de 5 passos: mais que isso vira espera, não elegância.
    const groups = new Map<Element, number>();
    for (const el of targets) {
      const parent = el.parentElement ?? root;
      const index = groups.get(parent) ?? 0;
      groups.set(parent, index + 1);
      if (index > 0) el.style.transitionDelay = `${Math.min(index, 5) * 60}ms`;
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [containerRef]);
}

/**
 * `true` depois que a pessoa rolou além do limite informado.
 * Usado para revelar o dock de CTA no mobile só quando o hero já saiu de vista
 * (antes disso o CTA do hero já está visível e a barra só atrapalharia).
 */
export function useScrolledPast(threshold: number, onChange: (past: boolean) => void) {
  useEffect(() => {
    let current = false;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const past = window.scrollY > threshold;
      if (past !== current) {
        current = past;
        onChange(past);
      }
    };

    // rAF throttle: o listener de scroll não faz trabalho nenhum além de
    // agendar. Evita layout thrashing em celular intermediário.
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(evaluate);
    };

    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold, onChange]);
}
