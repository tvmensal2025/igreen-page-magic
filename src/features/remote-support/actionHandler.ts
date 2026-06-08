import type { RemoteCommand, CommandResult } from "./types";
import { logAction } from "./api";
import { applyVideoQuality, type QualityLevel } from "./screenShare";

const PROTECTED_SELECTOR = "[data-remote-support-banner]";

// ===== Estado compartilhado (pausa + peer ref para qualidade) =====
let _paused = false;
let _peerForQuality: RTCPeerConnection | null = null;
const _pauseListeners = new Set<(p: boolean) => void>();

export function setRemoteControlPaused(p: boolean) {
  _paused = p;
  _pauseListeners.forEach(fn => fn(p));
}
export function isRemoteControlPaused() { return _paused; }
export function onRemoteControlPauseChange(fn: (p: boolean) => void) {
  _pauseListeners.add(fn);
  return () => _pauseListeners.delete(fn);
}
export function setActivePeerForQuality(pc: RTCPeerConnection | null) { _peerForQuality = pc; }



function isProtected(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest?.(PROTECTED_SELECTOR);
}

/** Converte coordenadas normalizadas (0..1) em px do viewport. */
function toViewportXY(cmd: RemoteCommand): { x: number; y: number } {
  const x = Math.max(0, Math.min(1, cmd.x ?? 0)) * window.innerWidth;
  const y = Math.max(0, Math.min(1, cmd.y ?? 0)) * window.innerHeight;
  return { x, y };
}

function elAt(x: number, y: number): Element | null {
  // elementsFromPoint (plural) deixa "perfurar" overlays transparentes/decorativos.
  // Procuramos o primeiro elemento que NÃO seja protegido e que tenha pointer-events
  // efetivos. Se todos forem protegidos, devolve null.
  const stack = (document as any).elementsFromPoint?.(x, y) as Element[] | undefined;
  const list = stack && stack.length ? stack : [document.elementFromPoint(x, y)].filter(Boolean) as Element[];
  for (const candidate of list) {
    if (!candidate) continue;
    if (isProtected(candidate)) return null; // banner do suporte é sagrado
    try {
      const style = getComputedStyle(candidate as Element);
      if (style.pointerEvents === "none") continue;
    } catch { /* ignore */ }
    return normalizeInteractiveTarget(candidate);
  }
  return null;
}

// Memoriza última posição do mouse para refoco em comandos `key`.
let _lastMouseX = 0;
let _lastMouseY = 0;

const INTERACTIVE_SEL = [
  "button", "a[href]", "input", "textarea", "select", "label",
  "[role='button']", "[role='link']", "[role='menuitem']",
  "[role='option']", "[role='tab']", "[role='checkbox']",
  "[role='radio']", "[role='switch']", "[role='combobox']",
  "[role='treeitem']", "[contenteditable='true']",
  "[data-radix-collection-item]", "[data-state]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Sobe a árvore a partir do alvo do `elementFromPoint` até achar o elemento
 * interativo mais próximo. Resolve o caso clássico em que o ponteiro caiu em
 * um `<span>` ou `<svg>` filho de um botão/Radix trigger, e o clique sintético
 * no filho era ignorado pelo handler do pai.
 */
function normalizeInteractiveTarget(el: Element): Element {
  const closest = (el as HTMLElement).closest?.(INTERACTIVE_SEL);
  return closest ?? el;
}

function dispatchMouse(type: string, el: Element, x: number, y: number, button = 0) {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button, buttons: type === "mouseup" || type === "click" ? 0 : 1,
  });
  el.dispatchEvent(ev);
}

/** Dispara PointerEvent quando suportado — essencial para Radix/shadcn (Select, Dropdown, Dialog, Slider…). */
function dispatchPointer(type: string, el: Element, x: number, y: number, button = 0, isDown = false) {
  if (typeof PointerEvent === "undefined") return;
  try {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button, buttons: isDown ? 1 : 0,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      width: 1, height: 1, pressure: isDown ? 0.5 : 0,
    });
    el.dispatchEvent(ev);
  } catch { /* fallback silencioso */ }
}

function focusable(el: Element | null): HTMLElement | null {
  if (!el) return null;
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement && (cur.tabIndex >= 0 || /^(input|textarea|select|button|a)$/i.test(cur.tagName) || cur.isContentEditable)) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return el instanceof HTMLElement ? el : null;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function typeChar(ch: string) {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    const next = active.value.slice(0, start) + ch + active.value.slice(end);
    setInputValue(active, next);
    const pos = start + ch.length;
    try { active.setSelectionRange(pos, pos); } catch {}
  } else if (active.isContentEditable) {
    document.execCommand("insertText", false, ch);
  }
}

function backspace() {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    if (start === end && start > 0) {
      const next = active.value.slice(0, start - 1) + active.value.slice(end);
      setInputValue(active, next);
      try { active.setSelectionRange(start - 1, start - 1); } catch {}
    } else if (start !== end) {
      const next = active.value.slice(0, start) + active.value.slice(end);
      setInputValue(active, next);
      try { active.setSelectionRange(start, start); } catch {}
    }
  } else if (active.isContentEditable) {
    document.execCommand("delete", false);
  }
}

export async function executeCommand(sessionId: string, cmd: RemoteCommand): Promise<CommandResult> {
  try {
    // log apenas comandos relevantes (evita spam de mouseMove)
    if (cmd.kind !== "mouseMove" && cmd.kind !== "wheel" && cmd.kind !== "ping") {
      // eslint-disable-next-line no-console
      console.log("[remote-support][exec]", cmd.kind, cmd);
      logAction(sessionId, "operator", `cmd:${cmd.kind}`, cmd.selector || cmd.url || null, cmd as never).catch(() => {});
    }

    // Atualiza última posição para refoco em comandos `key`.
    if ((cmd.kind === "mouseMove" || cmd.kind === "mouseClick" || cmd.kind === "mouseDown") && cmd.x != null && cmd.y != null) {
      _lastMouseX = Math.max(0, Math.min(1, cmd.x)) * window.innerWidth;
      _lastMouseY = Math.max(0, Math.min(1, cmd.y)) * window.innerHeight;
    }

    // Comandos sempre permitidos mesmo em pausa
    const ALWAYS_ALLOWED: RemoteCommand["kind"][] = ["ping", "qualityChange"];
    if (_paused && !ALWAYS_ALLOWED.includes(cmd.kind)) {
      return { id: cmd.id, ok: false, error: "paused_by_user" };
    }

    switch (cmd.kind) {
      case "ping":
        return { id: cmd.id, ok: true, data: { pong: true } };

      case "navigate": {
        if (!cmd.url) throw new Error("url required");
        const u = new URL(cmd.url, window.location.origin);
        if (u.origin === window.location.origin) window.location.href = u.toString();
        else window.open(u.toString(), "_blank", "noopener");
        return { id: cmd.id, ok: true };
      }

      case "click": {
        const el = document.querySelector(cmd.selector || "") as HTMLElement | null;
        if (!el) throw new Error("element not found");
        if (isProtected(el)) throw new Error("element is protected");
        el.click();
        return { id: cmd.id, ok: true };
      }

      case "fill": {
        const el = document.querySelector(cmd.selector || "") as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) throw new Error("element not found");
        if (isProtected(el)) throw new Error("element is protected");
        setInputValue(el, cmd.value ?? "");
        return { id: cmd.id, ok: true };
      }

      case "scrollTo": {
        const el = document.querySelector(cmd.selector || "");
        if (!el) throw new Error("element not found");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return { id: cmd.id, ok: true };
      }

      case "reload":
        setTimeout(() => window.location.reload(), 250);
        return { id: cmd.id, ok: true };

      case "back": history.back(); return { id: cmd.id, ok: true };
      case "forward": history.forward(); return { id: cmd.id, ok: true };

      // ===== Controle por coordenadas =====
      case "mouseMove": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (el) {
          dispatchPointer("pointermove", el, x, y, cmd.button ?? 0, false);
          dispatchMouse("mousemove", el, x, y, cmd.button ?? 0);
        }
        return { id: cmd.id, ok: true };
      }

      case "mouseDown": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element" };
        dispatchPointer("pointerdown", el, x, y, cmd.button ?? 0, true);
        dispatchMouse("mousedown", el, x, y, cmd.button ?? 0);
        return { id: cmd.id, ok: true };
      }
      case "mouseUp": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element" };
        dispatchPointer("pointerup", el, x, y, cmd.button ?? 0, false);
        dispatchMouse("mouseup", el, x, y, cmd.button ?? 0);
        return { id: cmd.id, ok: true };
      }

      case "mouseClick": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element" };
        const button = cmd.button ?? 0;
        // Foca elementos editáveis E também triggers de combobox/select (Radix)
        // que dependem de foco para abrir corretamente.
        const focusEl = focusable(el);
        if (focusEl) {
          try { focusEl.focus({ preventScroll: true } as FocusOptions); } catch { try { focusEl.focus(); } catch {} }
        }
        // sequência completa de pointer + mouse + click
        dispatchPointer("pointerover", el, x, y, button, false);
        dispatchPointer("pointerenter", el, x, y, button, false);
        dispatchPointer("pointerdown", el, x, y, button, true);
        dispatchMouse("mousedown", el, x, y, button);
        dispatchPointer("pointerup", el, x, y, button, false);
        dispatchMouse("mouseup", el, x, y, button);
        const clickEv = new MouseEvent("click", {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: y, screenX: x, screenY: y, button,
        });
        const notCancelled = el.dispatchEvent(clickEv);
        if (notCancelled && (el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement || (el as HTMLElement).getAttribute?.("role") === "button")) {
          try { (el as HTMLElement).click(); } catch {}
        }
        return { id: cmd.id, ok: true };
      }

      case "mouseDblClick": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element" };
        const button = cmd.button ?? 0;
        dispatchPointer("pointerdown", el, x, y, button, true);
        dispatchMouse("mousedown", el, x, y, button);
        dispatchPointer("pointerup", el, x, y, button, false);
        dispatchMouse("mouseup", el, x, y, button);
        dispatchMouse("click", el, x, y, button);
        dispatchPointer("pointerdown", el, x, y, button, true);
        dispatchMouse("mousedown", el, x, y, button);
        dispatchPointer("pointerup", el, x, y, button, false);
        dispatchMouse("mouseup", el, x, y, button);
        dispatchMouse("click", el, x, y, button);
        dispatchMouse("dblclick", el, x, y, button);
        return { id: cmd.id, ok: true };
      }

      case "contextMenu": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y);
        if (!el) return { id: cmd.id, ok: false, error: "no element" };
        dispatchPointer("pointerdown", el, x, y, 2, true);
        el.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
        }));
        dispatchPointer("pointerup", el, x, y, 2, false);
        return { id: cmd.id, ok: true };
      }

      case "wheel": {
        const { x, y } = toViewportXY(cmd);
        const el = elAt(x, y) || document.scrollingElement || document.body;
        const dy = cmd.dy ?? 0;
        const dx = cmd.dx ?? 0;
        // Tenta wheel event nativo; também faz scroll programático como garantia.
        el.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy,
        }));
        let scroller: Element | null = el as Element;
        while (scroller && scroller !== document.body) {
          const style = getComputedStyle(scroller);
          if (/(auto|scroll|overlay)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
          scroller = scroller.parentElement;
        }
        (scroller || window).scrollBy?.({ left: dx, top: dy, behavior: "auto" } as ScrollToOptions);
        if (!scroller) window.scrollBy(dx, dy);
        return { id: cmd.id, ok: true };
      }

      case "key": {
        const target = (document.activeElement as HTMLElement) || document.body;
        if (isProtected(target)) throw new Error("element is protected");
        const init: KeyboardEventInit = {
          key: cmd.key || "", code: cmd.code || cmd.key || "",
          bubbles: true, cancelable: true,
          ctrlKey: !!cmd.ctrl, shiftKey: !!cmd.shift, altKey: !!cmd.alt, metaKey: !!cmd.meta,
        };
        target.dispatchEvent(new KeyboardEvent("keydown", init));
        target.dispatchEvent(new KeyboardEvent("keypress", init));
        // Comportamento default para teclas de edição
        if (cmd.key === "Backspace") backspace();
        else if (cmd.key === "Enter") {
          if (target instanceof HTMLTextAreaElement) typeChar("\n");
          else if (target instanceof HTMLElement) {
            const form = target.closest("form");
            (form?.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.click();
          }
        } else if (cmd.key && cmd.key.length === 1 && !cmd.ctrl && !cmd.meta && !cmd.alt) {
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

      case "qualityChange": {
        const level = (cmd.value as QualityLevel) || "auto";
        if (_peerForQuality) await applyVideoQuality(_peerForQuality, level);
        return { id: cmd.id, ok: true, data: { level } };
      }

      case "openTab":
      case "closeTab":
        throw new Error("requires browser extension v1.5+");

      default:
        throw new Error(`unknown command: ${(cmd as RemoteCommand).kind}`);
    }
  } catch (e: any) {
    return { id: cmd.id, ok: false, error: e?.message || String(e) };
  }
}
