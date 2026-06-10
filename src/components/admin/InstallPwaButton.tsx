import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pwa_install_dismissed_at";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

export function InstallPwaButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isInIframe() || isStandalone()) return;

    // Respeita dismiss recente
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    const expired = !dismissedAt || Date.now() - dismissedAt > DISMISS_DAYS * 24 * 60 * 60 * 1000;
    if (!expired) return;

    // iOS: sempre mostra (não tem beforeinstallprompt)
    if (isIOS() && isMobile()) {
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installed = () => { setVisible(false); setDeferred(null); };
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!visible) return null;

  async function handleClick() {
    if (isIOS()) { setShowIosHelp(true); return; }
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
      setDeferred(null);
    } else {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setVisible(false);
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  return (
    <>
      <Button
        onClick={handleClick}
        size="sm"
        variant="outline"
        className="gap-1.5 rounded-xl border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 px-2 sm:px-3 h-8 sm:h-9 group relative"
        title="Instalar app no celular"
      >
        <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        <span className="hidden sm:inline text-xs font-bold">Instalar app</span>
        <span
          onClick={dismiss}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Dispensar"
        >
          <X className="w-2.5 h-2.5" />
        </span>
      </Button>

      <Dialog open={showIosHelp} onOpenChange={setShowIosHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar no iPhone</DialogTitle>
            <DialogDescription>
              Em 2 toques o iGreen vira um app na sua tela inicial.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
              <span className="pt-0.5">
                Toque no botão <Share className="inline w-4 h-4 mx-1 text-info" /> <strong>Compartilhar</strong> (parte de baixo do Safari).
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
              <span className="pt-0.5">
                Role para baixo e toque em <Plus className="inline w-4 h-4 mx-1" /> <strong>Adicionar à Tela de Início</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
              <span className="pt-0.5">Toque em <strong>Adicionar</strong> no canto superior direito. Pronto! 🎉</span>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground mt-2">
            Dica: use o <strong>Safari</strong> (não funciona no Chrome do iPhone).
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
