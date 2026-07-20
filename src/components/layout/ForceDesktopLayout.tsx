import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renderiza os filhos como se a viewport fosse de desktop (1280px por padrão)
 * e, em telas menores, encolhe visualmente com `transform: scale(...)` de modo
 * que o layout de PC caiba na largura real do dispositivo — sem quebrar grids,
 * cards ou tabelas que dependem de espaço horizontal.
 *
 * Uso: envolver painéis administrativos densos (ex.: Conversão) que só fazem
 * sentido em modo desktop mesmo quando abertos pelo celular.
 */
interface Props {
  children: ReactNode;
  /** Largura virtual usada como "desktop base". Padrão 1280. */
  minWidth?: number;
  /** Só aplica quando a viewport real for menor que este valor. Padrão 1024. */
  activateBelow?: number;
}

export function ForceDesktopLayout({
  children,
  minWidth = 1280,
  activateBelow = 1024,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [innerHeight, setInnerHeight] = useState<number | null>(null);
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === "undefined" ? minWidth : window.innerWidth,
  );

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      const w = window.innerWidth;
      setViewportW(w);
      if (w < activateBelow) {
        setScale(w / minWidth);
      } else {
        setScale(1);
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [minWidth, activateBelow]);

  // Reflete a altura escalada no wrapper para não sobrar/faltar espaço vertical.
  useEffect(() => {
    if (!innerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setInnerHeight(h);
    });
    ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, []);

  const active = viewportW < activateBelow;

  if (!active) {
    return <>{children}</>;
  }

  return (
    <div
      ref={wrapperRef}
      className="w-full overflow-hidden"
      style={{ height: innerHeight ? innerHeight * scale : undefined }}
    >
      <div
        ref={innerRef}
        style={{
          width: minWidth,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default ForceDesktopLayout;
