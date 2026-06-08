import type { RemoteCommand, CommandResult } from "./types";
import { logAction } from "./api";

const PROTECTED_SELECTOR = "[data-remote-support-banner]";

function isProtected(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest?.(PROTECTED_SELECTOR);
}

export async function executeCommand(sessionId: string, cmd: RemoteCommand): Promise<CommandResult> {
  try {
    await logAction(sessionId, "operator", `cmd:${cmd.kind}`, cmd.selector || cmd.url || null, cmd as never);
    switch (cmd.kind) {
      case "ping":
        return { id: cmd.id, ok: true, data: { pong: true } };

      case "navigate": {
        if (!cmd.url) throw new Error("url required");
        const u = new URL(cmd.url, window.location.origin);
        if (u.origin === window.location.origin) {
          window.location.href = u.toString();
        } else {
          window.open(u.toString(), "_blank", "noopener");
        }
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
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
        setter?.call(el, cmd.value ?? "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
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

      case "back":
        history.back();
        return { id: cmd.id, ok: true };

      case "forward":
        history.forward();
        return { id: cmd.id, ok: true };

      case "openTab":
      case "closeTab":
        // Requer extensão — bridge não obrigatória nesta versão
        throw new Error("requires browser extension v1.5+");

      default:
        throw new Error(`unknown command: ${(cmd as RemoteCommand).kind}`);
    }
  } catch (e: any) {
    return { id: cmd.id, ok: false, error: e?.message || String(e) };
  }
}
