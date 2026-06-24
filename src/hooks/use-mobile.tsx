import * as React from "react";

const MOBILE_BREAKPOINT = 768;
/** Alinhado ao `lg:` do Tailwind e ao drawer do AppSidebar / AppTopbar. */
const LG_BREAKPOINT = 1024;

function useMatchMedia(query: string) {
  const [matches, setMatches] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return !!matches;
}

export function useIsMobile() {
  return useMatchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/** Viewport estreita do painel admin (< 1024px): sidebar drawer + layout compacto. */
export function useIsLgDown() {
  return useMatchMedia(`(max-width: ${LG_BREAKPOINT - 1}px)`);
}
