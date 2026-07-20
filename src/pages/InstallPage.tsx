import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Smartphone, Share, Plus, CheckCircle2, Download, Apple, Chrome } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | "desktop" | "unknown";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/windows|macintosh|linux/.test(ua)) return "desktop";
  return "unknown";
}

export default function InstallPage() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;
    setInstalled(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 public-page-safe-bottom">
      <Card className="w-full max-w-md p-5 sm:p-6 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Smartphone className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Instalar iGreen no celular</h1>
          <p className="text-sm text-muted-foreground">
            Tenha o app na tela de início, abre rápido e funciona até offline.
          </p>
        </div>

        {installed && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-primary">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">App já instalado neste dispositivo.</p>
          </div>
        )}

        {!installed && platform === "ios" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Apple className="w-4 h-4" /> No iPhone / iPad (Safari)
            </div>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
              <li className="flex items-start gap-2 -ml-5 pl-5">
                Toque no botão <Share className="inline w-4 h-4 mx-1" /> <strong>Compartilhar</strong> na barra inferior.
              </li>
              <li>
                Role e selecione <strong className="text-foreground">Adicionar à Tela de Início</strong>{" "}
                <Plus className="inline w-4 h-4 ml-1" />.
              </li>
              <li>Confirme em <strong className="text-foreground">Adicionar</strong>.</li>
            </ol>
          </div>
        )}

        {!installed && platform === "android" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Chrome className="w-4 h-4" /> No Android (Chrome)
            </div>
            {deferred ? (
              <Button onClick={handleInstall} size="lg" className="w-full gap-2">
                <Download className="w-4 h-4" /> Instalar agora
              </Button>
            ) : (
              <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
                <li>Abra o menu (⋮) no canto superior direito.</li>
                <li>
                  Toque em <strong className="text-foreground">Instalar app</strong> ou{" "}
                  <strong className="text-foreground">Adicionar à tela inicial</strong>.
                </li>
                <li>Confirme em <strong className="text-foreground">Instalar</strong>.</li>
              </ol>
            )}
          </div>
        )}

        {!installed && platform === "desktop" && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">No computador (Chrome / Edge)</div>
            {deferred ? (
              <Button onClick={handleInstall} size="lg" className="w-full gap-2">
                <Download className="w-4 h-4" /> Instalar app
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Procure o ícone <Download className="inline w-4 h-4 mx-1" /> na barra de endereço
                ou abra o menu do navegador → <strong className="text-foreground">Instalar iGreen</strong>.
              </p>
            )}
          </div>
        )}

        {!installed && platform === "unknown" && (
          <p className="text-sm text-muted-foreground">
            Abra esta página no navegador do seu celular e use a opção
            "Adicionar à tela de início".
          </p>
        )}

        <div className="pt-2 border-t border-border text-center">
          <a href="/admin" className="text-sm text-primary hover:underline inline-flex items-center min-h-11 px-3">
            Voltar para o painel
          </a>
        </div>
      </Card>
    </div>
  );
}
