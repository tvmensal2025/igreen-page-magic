// =============================================================================
// Remote Support — Action Handler (lado do consultor / requester)
// =============================================================================
// Executa comandos remotos enviados pelo operador via DataChannel.
//
// Correções v3:
//   - Wheel: normaliza deltaMode (LINE → pixels) antes de aplicar.
//   - toViewportXY: usa innerWidth/Height do próprio window (viewport CSS).
//   - Comandos "key": refoco robusto mesmo após fechar modais Radix.
//   - Protected selector cobre qualquer elemento filho do banner.
// =============================================================================

import type { RemoteCommand, CommandResult } from "./types";
import { logAction } from "./api";
import { applyVideoQuality, type QualityLevel } from "./screenShare";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PROTECTED_SELECTOR = "[data-remote-support-banner]";

/** Pixels por linha/página ao normalizar deltaMode LINE/PAGE. */
const PIXELS_PER_LINE = 40;
const PIXELS_PER_PAGE = 400;

const INTERACTIVE_SEL = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='combobox']",
  "[role='treeitem']",
  "[contenteditable='true']",
  "[data-radix-collection-item]",
  "[data-state]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// ---------------------------------------------------------------------------
// Estado global do módulo
// ---------------------------------------------------------------------------

let _paused = false;
let _peerForQuality: RTCPeerConnection | null = null;
let _lastMouseX = 0;
let _lastMouseY = 0;
const _pauseListeners = new Set<(paused: boolean) => void>();

export function setRemoteControlPaused(paused: boolean): void {
  _paused = paused;
  _pauseListeners.forEach(fn => fn(paused));
}

export function isRemoteControlPaused(): boolean {
  return _paused;
}

export function onRemoteControlPauseChange(fn: (paused: boolean) => void): () => void {
  _pauseListeners.add(fn);
  return () => _pauseListeners.delete(fn);
}

export function setActivePeerForQuality(pc: RTCPeerConnection | null): void {
  _peerForQuality = pc;
}

// ---------------------------------------------------------------------------
// Helpers — DOM
// ---------------------------------------------------------------------------

function isProtected(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest?.(PROTECTED_SELECTOR);
}

/**
 * Converte coordenadas normalizadas (0..1) em pixels CSS do viewport.
 * As coordenadas são sempre relativas ao viewport CSS (window.inner*),
 * independente do DPR — o mapeamento de DPR é responsabilidade do overlay.
 */
function toViewportXY(cmd: RemoteCommand): { x: number; y: number } {
  const x = Math.max(0, Math.min(1, cmd.x ?? 0)) * window.innerWidth;
  const y = Math.max(0, Math.min(1, cmd.y ?? 0)) * window.innerHeight;
  return { x, y };
}

/**
 * Retorna o elemento interativo mais apropriado na posição (x, y).
 * Usa elementsFromPoint para "perfurar" overlays transparentes e
 * sobe para o ancestral interativo mais próximo.
 */
function elAt(x: number, y: number): Element | null {
  const stack =
    (document.elementsFromPoint?.(x, y) as Element[] | undefined) ??
    [document.elementFromPoint(x, y)].filter(Boolean) as Element[];

  for (const candidate of stack) {
    if (!candidate) continue;
    if (isProtected(candidate)) return null;

    try {
      const style = getComputedStyle(candidate);
      if (style.pointerEvents === "none") continue;
    } catch { /* ignora */ }

    return normalizeInteractiveTarget(candidate);
  }
  return null;
}

/**
 * Sobe a árvore DOM a partir do elemento encontrado pelo hit-test até
 * achar o ancestral interativo mais próximo.
 *
 * Resolve o caso clássico: o ponteiro cai em um <span> ou <svg> filho
 * de um <button> / Radix trigger e o click sintético no filho era ignorado.
 */
function normalizeInteractiveTarget(el: Element): Element {
  return (el as HTMLElement).closest?.(INTERACTIVE_SEL) ?? el;
}

function focusable(el: Element | null): HTMLElement | null {
  if (!el) return null;
  let cur: Element | null = el;
  while (cur) {
    if (
      cur instanceof HTMLElement &&
      (cur.tabIndex >= 0 ||
        /^(input|textarea|select|button|a)$/i.test(cur.tagName) ||
        cur.isContentEditable)
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return el instanceof HTMLElement ? el : null;
}

// ---------------------------------------------------------------------------
// Helpers — Eventos sintéticos
// ---------------------------------------------------------------------------

function dispatchMouse(
  type: string, el: Element,
  x: number, y: number,
  button = 0,
): void {
  const isUp = type === "mouseup" || type === "click";
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button, buttons: isUp ? 0 : 1,
  }));
}

function dispatchPointer(
  type: string, el: Element,
  x: number, y: number,
  button = 0,
  isDown = false,
): void {
  if (typeof PointerEvent === "undefined") return;
  try {
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button, buttons: isDown ? 1 : 0,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      width: 1, height: 1, pressure: isDown ? 0.5 : 0,
    }));
  } catch { /* fallback silencioso em browsers antigos */ }
}

// ---------------------------------------------------------------------------
// Helpers — Inputs
// ---------------------------------------------------------------------------

function setInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);

  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function typeChar(ch: string): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end   = active.selectionEnd   ?? active.value.length;
    const next  = active.value.slice(0, start) + ch + active.value.slice(end);
    setInputValue(active, next);
    const pos = start + ch.length;
    try { active.setSelectionRange(pos, pos); } catch { /* ignora */ }
  } else if (active.isContentEditable) {
    document.execCommand("insertText", false, ch);
  }
}

function backspace(): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end   = active.selectionEnd   ?? active.value.length;

    if (start === end && start > 0) {
      const next = active.value.slice(0, start - 1) + active.value.slice(end);
      setInputValue(active, next);
      try { active.setSelectionRange(start - 1, start - 1); } catch { /* ignora */ }
    } else if (start !== end) {
      const next = active.value.slice(0, start) + active.value.slice(end);
      setInputValue(active, next);
      try { active.setSelectionRange(start, start); } catch { /* ignora */ }
    }
  } else if (active.isContentEditable) {
    document.execCommand("delete", false);
  }
}

/**
 * Normaliza deltaY/deltaX de acordo com o deltaMode retornado pelo browser.
 * Resolve o bug em trackpads Firefox que entregam DOM_DELTA_LINE (mode=1).
 */
function normalizeDelta(delta: number, mode: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return delta * PIXELS_PER_LINE;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * PIXELS_PER_PAGE;
  return delta; // DOM_DELTA_PIXEL — sem conversão
}

// ---------------------------------------------------------------------------
// Executor principal
// ---------------------------------------------------------------------------

export async function executeCommand(
  sessionId: string,
  cmd: RemoteCommand,
): Promise<CommandResult> {
  try {
    // Log apenas comandos relevantes (evita spam de mouseMove/wheel/ping)
    if (cmd.kind !== "mouseMove" && cmd.kind !== "wheel" && cmd.kind !== "ping" && cmd.kind !== "viewportInfo") {
      console.debug("[remote-support][exec]", cmd.kind, cmd);
      logAction(
        sessionId, "operator", `cmd:${cmd.kind}`,
        cmd.selector ?? cmd.url ?? null,
        cmd as Record<string, unknown>,
      ).catch(() => { /* log é melhor esforço */ });
    }

    // Atualiza última posição para refoco em comandos `key`
    if (
      (cmd.kind === "mouseMove" || cmd.kind === "mouseClick" || cmd.kind === "mouseDown") &&
      cmd.x != null && cmd.y != null
    ) {
      _lastMouseX = Math.max(0, Math.min(1, cmd.x)) * window.innerWidth;
      _lastMouseY = Math.max(0, Math.min(1, cmd.y)) * window.innerHeight;
    }

    // Comandos permitidos mesmo quando o controle está pausado
    const ALWAYS_ALLOWED: RemoteCommand["kind"][] = ["ping", "qualityChange", "viewportInfo"];
    if (_paused && !ALWAYS_ALLOWED.includes(cmd.kind)) {
      return { id: cmd.id, ok: false, error: "paused_by_user" };
    }

    // -----------------------------------------------------------------------
    switch (cmd.kind) {

      // --- Ping / heartbeat ---
      case "ping":
        return { id: cmd.id, ok: true, data: { pong: true, ts: Date.now() } };

      // --- Metadados do viewport (apenas acusa recebimento) ---
      case "viewportInfo":
        // Processado diretamente pelo operador em SessionWorkbench.
        // Aqui não há nada a executar no lado do consultor.
        return { id: cmd.id, ok: true };

      // --- Navegação ---
      case "navigate": {
        if (!cmd.url) throw new Error("url required");
        const u = new URL(cmd.url, window.location.origin);
        if (u.origin === window.location.origin) {
          window.location.href = u.toString();
        } else {
          window.open(u.toString(), "_blank", "noopener,noreferrer");
        }
        return { id: cmd.id, ok: true };
      }

      case "reload":
        setTimeout(() => window.location.reload(), 250);
        return { id: cmd.id, ok: true };

      case "back":
        history.back();
        return { id: cmd.id, ok: true };

      case "forward":
        history.forward();
        return { id: cmd.id, ok: true };

      // --- Selector-based (legado) ---
      case "click": {
        const el = document.querySelector<HTMLElement>(cmd.selector ?? "");
        if (!el) throw new Error(`element not found: ${cmd.selector}`);
        if (isProtected(el)) throw new Error("element is protected");
        el.click();
        return { id: cmd.id, ok: true };
      }

      case "fill": {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(cmd.selector ?? "");
        if (!el) throw new Error(`element not found: ${cmd.selector}`);
        if (isProtected(el)) throw new Error("element is protected");
        setInputValue(el, cmd.value ?? "");
        return { id: cmd.id, ok: true };
      }

      case "scrollTo": {
        const el = document.querySelector(cmd.selector ?? "");
        if (!el) throw new Error(`element not found: ${cmd.selector}`);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return { id: cmd.id, ok: true };
      }

      // =====================================================================
      // Controle por coordenadas
      // =====================================================================

      case "mouseMove": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (el) {
          dispatchPointer("pointermove", el, x, y, 0, false);
          dispatchMouse("mousemove", el, x, y, 0);
        }
        return { id: cmd.id, ok: true };
      }

      case "mouseDown": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element at position" };
        dispatchPointer("pointerdown", el, x, y, cmd.button ?? 0, true);
        dispatchMouse("mousedown",     el, x, y, cmd.button ?? 0);
        return { id: cmd.id, ok: true };
      }

      case "mouseUp": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element at position" };
        dispatchPointer("pointerup", el, x, y, cmd.button ?? 0, false);
        dispatchMouse("mouseup",     el, x, y, cmd.button ?? 0);
        return { id: cmd.id, ok: true };
      }

      case "mouseClick": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element at position" };

        const button = cmd.button ?? 0;

        // Foca antes de disparar — Radix Select/Combobox depende de foco para abrir
        const focusEl = focusable(el);
        if (focusEl) {
          try { focusEl.focus({ preventScroll: true }); } catch {
            try { focusEl.focus(); } catch { /* ignora */ }
          }
        }

        // Sequência completa: pointer + mouse + click
        dispatchPointer("pointerover",  el, x, y, button, false);
        dispatchPointer("pointerenter", el, x, y, button, false);
        dispatchPointer("pointerdown",  el, x, y, button, true);
        dispatchMouse("mousedown",      el, x, y, button);
        dispatchPointer("pointerup",    el, x, y, button, false);
        dispatchMouse("mouseup",        el, x, y, button);

        const clickEv = new MouseEvent("click", {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: y, screenX: x, screenY: y, button,
        });
        const notCancelled = el.dispatchEvent(clickEv);

        // Garante ativação de links/botões que usam .click() nativo
        if (
          notCancelled &&
          (el instanceof HTMLAnchorElement ||
           el instanceof HTMLButtonElement ||
           (el as HTMLElement).getAttribute?.("role") === "button")
        ) {
          try { (el as HTMLElement).click(); } catch { /* ignora */ }
        }

        return { id: cmd.id, ok: true };
      }

      case "mouseDblClick": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element at position" };

        const button = cmd.button ?? 0;

        // Dois cliques completos + dblclick
        for (let i = 0; i < 2; i++) {
          dispatchPointer("pointerdown", el, x, y, button, true);
          dispatchMouse("mousedown",     el, x, y, button);
          dispatchPointer("pointerup",   el, x, y, button, false);
          dispatchMouse("mouseup",       el, x, y, button);
          dispatchMouse("click",         el, x, y, button);
        }
        dispatchMouse("dblclick", el, x, y, button);

        return { id: cmd.id, ok: true };
      }

      case "contextMenu": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element at position" };

        dispatchPointer("pointerdown", el, x, y, 2, true);
        el.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true,
          clientX: x, clientY: y,
          button: 2,
        }));
        dispatchPointer("pointerup", el, x, y, 2, false);

        return { id: cmd.id, ok: true };
      }

      case "wheel": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y) ?? document.scrollingElement ?? document.body;

        // Normaliza deltas: o operador envia os valores brutos do WheelEvent
        // incluindo o deltaMode. Convertemos para pixels aqui.
        const deltaMode = (cmd as RemoteCommand & { deltaMode?: number }).deltaMode ?? WheelEvent.DOM_DELTA_PIXEL;
        const dy = normalizeDelta(cmd.dy ?? 0, deltaMode);
        const dx = normalizeDelta(cmd.dx ?? 0, deltaMode);

        // Dispara o WheelEvent para que handlers JS da página reajam
        el.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true,
          clientX: x, clientY: y,
          deltaX: dx, deltaY: dy,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }));

        // Scroll programático como garantia (para containers sem listener)
        let scroller: Element | null = el as Element;
        while (scroller && scroller !== document.documentElement) {
          const style = getComputedStyle(scroller);
          if (
            /(auto|scroll|overlay)/.test(style.overflowY) &&
            scroller.scrollHeight > scroller.clientHeight
          ) break;
          if (
            /(auto|scroll|overlay)/.test(style.overflowX) &&
            scroller.scrollWidth > scroller.clientWidth
          ) break;
          scroller = scroller.parentElement;
        }

        if (scroller && scroller !== document.documentElement) {
          scroller.scrollBy({ left: dx, top: dy, behavior: "auto" });
        } else {
          window.scrollBy(dx, dy);
        }

        return { id: cmd.id, ok: true };
      }

      case "key": {
        // Refoca o elemento sob o último cursor antes de despachar a tecla.
        // Evita perder o keystroke quando o foco migrou (ex: modal Radix fechando).
        let target = document.activeElement as HTMLElement | null;

        if (!target || target === document.body || target === document.documentElement) {
          const under = elAt(_lastMouseX, _lastMouseY);
          const f = focusable(under);
          if (f) {
            try { f.focus({ preventScroll: true }); } catch {
              try { f.focus(); } catch { /* ignora */ }
            }
            target = f;
          }
        }

        if (!target) target = document.body;
        if (isProtected(target)) throw new Error("element is protected");

        const init: KeyboardEventInit = {
          key: cmd.key ?? "",
          code: cmd.code ?? cmd.key ?? "",
          bubbles: true,
          cancelable: true,
          ctrlKey:  !!cmd.ctrl,
          shiftKey: !!cmd.shift,
          altKey:   !!cmd.alt,
          metaKey:  !!cmd.meta,
        };

        target.dispatchEvent(new KeyboardEvent("keydown",  init));
        target.dispatchEvent(new KeyboardEvent("keypress", init));

        // Comportamento padrão de edição
        if (cmd.key === "Backspace") {
          backspace();
        } else if (cmd.key === "Enter") {
          if (target instanceof HTMLTextAreaElement) {
            typeChar("\n");
          } else {
            const form = target.closest("form");
            const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
            submit?.click();
          }
        } else if (cmd.key === "Tab") {
          // Tab nativo — deixa o browser gerenciar o foco
        } else if (
          cmd.key &&
          cmd.key.length === 1 &&
          !cmd.ctrl && !cmd.meta && !cmd.alt
        ) {
          typeChar(cmd.key);
        }

        target.dispatchEvent(new KeyboardEvent("keyup", init));
        return { id: cmd.id, ok: true };
      }

      case "type": {
        const txt = cmd.value ?? "";
        for (const ch of txt) typeChar(ch);
        return { id: cmd.id, ok: true };
      }

      // --- Qualidade ---
      case "qualityChange": {
        const level = (cmd.value as QualityLevel) || "auto";
        if (_peerForQuality) await applyVideoQuality(_peerForQuality, level);
        return { id: cmd.id, ok: true, data: { level } };
      }

      // --- Não implementado ---
      case "openTab":
      case "closeTab":
        throw new Error("Requer extensão do browser v1.5+");

      default: {
        const exhaustive: never = cmd.kind;
        throw new Error(`Comando desconhecido: ${exhaustive}`);
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { id: cmd.id, ok: false, error };
  }
}
