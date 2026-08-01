/** Helpers compartilhados: highlight do tour geral e do GuideCoach. */

export type TargetRect = { top: number; left: number; width: number; height: number };
export type CardPlacement = "bottom" | "right" | "left" | "top";

export type GuideTargetHit = {
  element: HTMLElement;
  matchedSelector: string;
  /** Soft = Ajuda/FAB/menu lateral — NÃO travar o locate nisso. */
  soft: boolean;
};

export const TARGET_PADDING = 8;
export const LOCATE_ATTEMPTS = 48;
export const LOCATE_INTERVAL_MS = 220;
export const CARD_RESERVE_BOTTOM = 280;
export const CARD_WIDTH = 420;

export function isMenuSelector(selector: string | null | undefined): boolean {
  return !!selector && selector.includes("menu-");
}

export function isSidebarWhole(selector: string | null | undefined): boolean {
  return !!selector && selector.includes("menu-lateral");
}

/** Fallbacks genéricos — nunca “confiar” neles enquanto o alvo real pode ainda montar. */
export function isSoftGuideFallback(selector: string | null | undefined): boolean {
  if (!selector) return true;
  return (
    selector.includes("guide-entry") ||
    selector.includes("help-fab") ||
    selector.includes("menu-lateral")
  );
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function computeHighlight(rect: DOMRect, selector: string | null | undefined): TargetRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menu = isMenuSelector(selector);
  const wholeSidebar = isSidebarWhole(selector);

  const rawTop = rect.top - TARGET_PADDING;
  const rawLeft = rect.left - TARGET_PADDING;
  const rawWidth = rect.width + TARGET_PADDING * 2;
  const rawHeight = rect.height + TARGET_PADDING * 2;

  const maxHighlight = menu
    ? vh - 16
    : Math.max(160, vh - CARD_RESERVE_BOTTOM - 24);

  const top = clamp(rawTop, 8, vh - 24);
  const left = clamp(rawLeft, 8, vw - 24);
  let width = Math.min(rawWidth, vw - left - 8);
  let height = Math.min(rawHeight, maxHighlight, vh - top - 8);

  if (wholeSidebar) {
    const sideRoom = vw >= 900 ? CARD_WIDTH + 32 : 16;
    width = Math.min(rawWidth, Math.max(120, vw - left - sideRoom));
    const bottomReserve = vw < 720 ? CARD_RESERVE_BOTTOM : 8;
    height = Math.min(rawHeight, vh - top - bottomReserve);
  }

  if (menu && !wholeSidebar) {
    height = Math.min(Math.max(rawHeight, rect.height + TARGET_PADDING * 2), vh - top - 8);
    width = Math.min(Math.max(rawWidth, 160), vw - left - 8);
  }

  return { top, left, width: Math.max(40, width), height: Math.max(40, height) };
}

export function computeCardPlacement(target: TargetRect | null, selector: string | null | undefined): CardPlacement {
  if (!target) return "bottom";
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menu = isMenuSelector(selector);

  if (menu && vw >= 720) {
    const rightSpace = vw - (target.left + target.width);
    if (rightSpace >= CARD_WIDTH + 24) return "right";
  }

  const belowSpace = vh - (target.top + target.height);
  if (belowSpace < CARD_RESERVE_BOTTOM && target.top > CARD_RESERVE_BOTTOM + 24) return "top";

  // Alvo na metade inferior: card embaixo cobre o destaque — sobe.
  if (target.top + target.height > vh * 0.55 && target.top > CARD_RESERVE_BOTTOM + 24) return "top";

  if (!menu && target.left > vw * 0.55 && target.left - 24 >= CARD_WIDTH) return "left";

  return "bottom";
}

export function menuSelectorFromHref(href: string | null | undefined): string | null {
  if (!href || href.startsWith("http")) return null;
  try {
    const url = new URL(href, "https://igreen.local");
    const path = url.pathname;
    if (path.includes("/meta-ads")) return '[data-tour="menu-central-anuncios"]';
    if (path.includes("/motor") || path.includes("/reaquecimento") || path.includes("/agendamentos-central")) {
      return '[data-tour="menu-agendamentos"]';
    }
    if (path.includes("/solar") || path.includes("/solar-design")) return '[data-tour="menu-produtos"]';
    if (path.includes("/conhecimento") || path.includes("/fluxos") || path.includes("/fluxo-b") || path.includes("/saude-bot")) {
      return '[data-tour="menu-whatsapp"]';
    }
    if (path === "/ajuda" || path.startsWith("/ajuda")) return '[data-tour="menu-ajuda"]';
    if (path.includes("settings") || path.includes("config")) return '[data-tour="menu-config"]';

    const tab = url.searchParams.get("tab");
    if (!tab || tab === "dashboard") return '[data-tour="dashboard"], [data-tour="menu-dashboard"]';
    const known = new Set([
      "crm", "crm-clientes", "crm-analise", "conversao", "clientes", "financeiro", "produtos",
      "captacao", "parceiros", "whatsapp", "agendamentos", "central-anuncios",
      "links", "materiais", "audio-studio", "voz", "academy",
      "venda-plataforma", "lucro-plataforma",
    ]);
    if (known.has(tab)) return `[data-tour="menu-${tab}"]`;
    return '[data-tour="dashboard"], [data-tour="menu-dashboard"]';
  } catch {
    return null;
  }
}

/**
 * Cadeia em 3 níveis:
 * - preferred: seletor do passo + expansões (painel / Mais)
 * - secondary: menu da rota (só no fim — senão trava no menu cedo demais)
 * - soft: Ajuda/FAB (nunca travar cedo)
 */
export function buildGuideSelectorChain(
  selector: string | null | undefined,
  route?: string | null,
): { preferred: string[]; secondary: string[]; soft: string[] } {
  const preferred: string[] = [];
  const secondary: string[] = [];
  const soft: string[] = [];
  const push = (list: string[], s: string | null | undefined) => {
    const v = (s || "").trim();
    if (!v || preferred.includes(v) || secondary.includes(v) || soft.includes(v) || list.includes(v)) return;
    list.push(v);
  };

  const parts = (selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (isSoftGuideFallback(part)) push(soft, part);
    else push(preferred, part);
  }

  for (const part of [...preferred]) {
    const m = part.match(/data-tour="wa-tab-([^"]+)"/);
    if (m) {
      const key = m[1];
      if (key !== "mais" && key !== "conversas") {
        push(preferred, `[data-tour="wa-panel-${key}"]`);
        push(preferred, '[data-tour="wa-tab-mais"]');
      }
    }
    const panel = part.match(/data-tour="wa-panel-([^"]+)"/);
    if (panel) {
      push(preferred, `[data-tour="wa-tab-${panel[1]}"]`);
    }
  }

  const menu = menuSelectorFromHref(route || undefined);
  // Menu só é preferred se o passo já aponta menu; senão secondary (último recurso hard)
  if (menu && parts.some((p) => p.includes("menu-"))) {
    push(preferred, menu);
  } else {
    push(secondary, menu);
  }

  push(soft, '[data-tour="guide-entry"]');
  push(soft, '[data-tour="help-fab"]');
  push(soft, '[data-tour="menu-lateral"]');
  return { preferred, secondary, soft };
}

/** Elemento realmente utilizável para highlight (viewport + não oculto). */
export function isElementTourVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Fora da viewport (ex.: sidebar mobile translate-x-full)
  if (rect.right < 4 || rect.bottom < 4 || rect.left > vw - 4 || rect.top > vh - 4) return false;

  let node: HTMLElement | null = el;
  while (node) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (node.classList.contains("-translate-x-full")) return false;
    node = node.parentElement;
  }
  return true;
}

export function queryGuideTarget(selector: string | null | undefined): HTMLElement | null {
  if (!selector) return null;
  // Seletores compostos: "a, b" → tenta cada um
  if (selector.includes(",")) {
    for (const part of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      const hit = queryGuideTarget(part);
      if (hit) return hit;
    }
    return null;
  }
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const el of nodes) {
    if (el.getAttribute("data-tour-sentinel") === "1") continue; // só para click/prepare
    if (!isElementTourVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 24) continue; // ignora alvos minúsculos
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/** Para prepare/click: inclui sentinelas mobile (2×2). */
export function queryGuideClickTarget(selector: string | null | undefined): HTMLElement | null {
  if (!selector) return null;
  if (selector.includes(",")) {
    for (const part of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      const hit = queryGuideClickTarget(part);
      if (hit) return hit;
    }
    return null;
  }
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const sentinel = nodes.find((el) => el.getAttribute("data-tour-sentinel") === "1");
  if (sentinel) return sentinel;
  return queryGuideTarget(selector) || nodes[0] || null;
}

export function prepareGuideTarget(selector: string | null | undefined) {
  if (!selector) return;

  const clickIfInactive = (el: HTMLElement | null) => {
    if (!el) return;
    const state = el.getAttribute("data-state") || el.getAttribute("aria-selected") || el.getAttribute("data-active");
    if (state === "active" || state === "true") return;
    if (el.classList.contains("is-active") || el.getAttribute("aria-current") === "page") return;
    el.click();
  };

  if (selector.includes("menu-")) {
    window.dispatchEvent(new CustomEvent("igreen-open-sidebar"));
  }
  if (selector.includes("wa-criar-template") || selector.includes("wa-templates-meus")) {
    clickIfInactive(queryGuideClickTarget('[data-tour="wa-templates-meus"]'));
  }
  if (selector.includes("wa-templates-publicos")) {
    clickIfInactive(queryGuideClickTarget('[data-tour="wa-templates-publicos"]'));
  }
  for (const key of ["conversas", "templates", "agente", "envio_massa", "agendamentos", "dashboard"] as const) {
    if (selector.includes(`wa-tab-${key}`) || selector.includes(`wa-panel-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="wa-tab-${key}"]`));
    }
  }
  for (const key of ["mapa", "grupo-b", "grupo-a", "grupo-c", "agenda", "historico", "futuros", "carteira"] as const) {
    if (selector.includes(`agenda-tab-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="agenda-tab-${key}"]`));
    }
  }
  if (selector.includes("links-meus") || selector.includes("links-copiar") || selector.includes("links-panfleto")) {
    clickIfInactive(queryGuideClickTarget('[data-tour="links-meus"]'));
  }
  if (selector.includes("menu-config") || selector.includes("cfg-")) {
    window.dispatchEvent(new CustomEvent("igreen-admin-open-settings"));
  }
  for (const key of ["acompanhamento", "orcamentos", "pipeline", "catalogo"] as const) {
    if (selector.includes(`prod-tab-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="prod-tab-${key}"]`));
    }
  }
  for (const key of ["nova", "sms", "bases", "dnc", "ciclo", "textos", "historico", "painel", "ajuda"] as const) {
    if (selector.includes(`voz-tab-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="voz-tab-${key}"]`));
    }
  }
  for (const key of ["dashboard", "gallery", "templates", "campaigns", "performance", "intel", "commissions"] as const) {
    if (selector.includes(`ads-nav-${key}`)) {
      const targetKey = key === "templates" ? "gallery" : key;
      clickIfInactive(queryGuideClickTarget(`[data-tour="ads-nav-${targetKey}"]`));
    }
  }
  for (const key of ["boletos", "recebiveis", "carteira", "extrato"] as const) {
    if (selector.includes(`fin-tab-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="fin-tab-${key}"]`));
    }
  }
  if (selector.includes("materiais-tab-") || selector.includes("materiais-grid")) {
    const tab = queryGuideClickTarget(selector.includes("materiais-tab-") ? selector : '[data-tour^="materiais-tab-"]');
    clickIfInactive(tab);
  }
  for (const key of ["mutirao", "comercio", "livre"] as const) {
    if (selector.includes(`audio-tipo-${key}`)) {
      clickIfInactive(queryGuideClickTarget(`[data-tour="audio-tipo-${key}"]`));
    }
  }
  if (selector.includes("conversao-")) {
    clickIfInactive(queryGuideClickTarget('[data-tour="conversao-tab-atender"]'));
  }

  // Parceiros: força Visão geral vs aba do parceiro antes do highlight
  const parceirosOverview =
    selector.includes("parceiros-tab-overview") ||
    selector.includes("parceiros-overview") ||
    selector.includes("parceiros-podium") ||
    selector.includes("parceiros-kpis") ||
    selector.includes("parceiros-charts") ||
    selector.includes("parceiros-ranking") ||
    selector.includes("parceiros-alerta");
  if (parceirosOverview) {
    clickIfInactive(queryGuideClickTarget('[data-tour="parceiros-tab-overview"]'));
  }
  const parceirosWorkspace =
    selector.includes("parceiros-tab-partner") ||
    selector.includes("parceiros-workspace") ||
    selector.includes("parceiros-card") ||
    selector.includes("parceiros-editar") ||
    selector.includes("parceiros-qr") ||
    selector.includes("parceiros-keywords") ||
    selector.includes("parceiros-frase") ||
    selector.includes("parceiros-banners-panel") ||
    selector.includes("parceiros-link");
  if (parceirosWorkspace) {
    clickIfInactive(queryGuideClickTarget('[data-tour="parceiros-tab-partner"]'));
  }
}

/**
 * Busca alvo preferred primeiro.
 * secondary (menu) e soft só com flags — evita travar no menu/Ajuda cedo.
 */
export function queryGuideTargetChain(
  selector: string | null | undefined,
  route?: string | null,
  opts?: { prepare?: boolean; allowSoft?: boolean; allowSecondary?: boolean },
): GuideTargetHit | null {
  const doPrepare = opts?.prepare !== false;
  const allowSoft = opts?.allowSoft === true;
  const allowSecondary = opts?.allowSecondary === true;
  const { preferred, secondary, soft } = buildGuideSelectorChain(selector, route);

  const tryList = (list: string[], softFlag: boolean): GuideTargetHit | null => {
    for (const cand of list) {
      if (doPrepare) prepareGuideTarget(cand);
      const el = queryGuideTarget(cand);
      if (el) return { element: el, matchedSelector: cand, soft: softFlag };
    }
    return null;
  };

  const preferredHit = tryList(preferred, false);
  if (preferredHit) return preferredHit;
  if (allowSecondary) {
    const sec = tryList(secondary, false);
    if (sec) return sec;
  }
  if (allowSoft) return tryList(soft, true);
  return null;
}

/** Espera frames após prepare (React aplicar setState / Suspense). */
export function waitTourFrames(frames = 2): Promise<void> {
  return new Promise((resolve) => {
    let left = frames;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function navigateAdminForGuide(
  navigate: (to: string, opts?: { replace?: boolean }) => void,
  route: string | undefined,
) {
  if (!route || route.startsWith("http") || typeof window === "undefined") return;

  const destination = new URL(route, window.location.origin);
  const target = `${destination.pathname}${destination.search}`;
  const current = `${window.location.pathname}${window.location.search}`;

  // Só dispara troca de aba Admin quando a rota É o shell /admin (não /admin/motor etc.)
  if (destination.pathname === "/admin" || destination.pathname === "/admin/") {
    const tab = destination.searchParams.get("tab") || "dashboard";
    const section = destination.searchParams.get("section") || undefined;
    const hubTab = destination.searchParams.get("hubTab") || undefined;
    const conversaoView = destination.searchParams.get("view") || undefined;
    window.dispatchEvent(
      new CustomEvent("igreen-admin-nav", {
        detail: {
          tab,
          whatsappSub: section,
          hubTab,
          conversaoView,
        },
      }),
    );
  }

  if (current !== target) {
    navigate(target);
  }
}
