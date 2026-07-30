import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, RefreshCw, Smartphone, Shield, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@/types/whatsapp";

interface Props {
  /** Canal pronto — se true, o gate não aparece. */
  open: boolean;
  isWhapi?: boolean;
  connectionStatus: ConnectionStatus;
  qrCode: string | null;
  isLoading: boolean;
  error: string | null;
  fatalLocked?: boolean;
  phoneNumber?: string | null;
  /** Whapi: status textual opcional (AUTH / QR / …). */
  whapiStatusLabel?: string | null;
  whapiQrImage?: string | null;
  onConnect: () => Promise<void> | void;
  onRefreshQr?: () => Promise<void> | void;
  onWhapiReauth?: () => Promise<void> | void;
}

/**
 * Tela única antes do chat: só QR / conectar.
 * Linguagem para leigo — sem “Evolution”, sem jargão técnico.
 */
export function WhatsAppConnectGate({
  open,
  isWhapi = false,
  connectionStatus,
  qrCode,
  isLoading,
  error,
  fatalLocked = false,
  phoneNumber,
  whapiStatusLabel,
  whapiQrImage,
  onConnect,
  onRefreshQr,
  onWhapiReauth,
}: Props) {
  const startedRef = useRef(false);
  const [refreshCooldown, setRefreshCooldown] = useState(0);

  useEffect(() => {
    if (!open || fatalLocked || isWhapi) return;
    if (startedRef.current) return;
    if (connectionStatus === "connected") return;
    if (qrCode) return;
    startedRef.current = true;
    void onConnect();
  }, [open, fatalLocked, isWhapi, connectionStatus, qrCode, onConnect]);

  useEffect(() => {
    if (!open) startedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (refreshCooldown <= 0) return;
    const t = setInterval(() => setRefreshCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [refreshCooldown]);

  const displayQr = isWhapi ? whapiQrImage : qrCode;
  const showingQr = !!displayQr && !fatalLocked;
  const connecting = !fatalLocked && !showingQr && (isLoading || connectionStatus === "connecting");

  const handleRefresh = async () => {
    if (refreshCooldown > 0 || fatalLocked) return;
    setRefreshCooldown(30);
    if (isWhapi) await onWhapiReauth?.();
    else await onRefreshQr?.();
  };

  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center bg-background p-4 sm:p-6 ${
        open ? "" : "hidden"
      }`}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="px-5 pt-6 pb-4 text-center space-y-2 border-b border-border/60 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-primary" />
          </div>
          <h2 className="font-heading text-lg font-bold text-foreground">Conectar WhatsApp</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Escaneie o código com o celular. Depois disso, conversas e envios liberam sozinhos.
          </p>
        </div>

        <div className="p-5 space-y-5">
          {fatalLocked ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-center space-y-3">
              <Shield className="w-8 h-8 text-amber-600 dark:text-amber-400 mx-auto" />
              <p className="text-sm font-semibold text-foreground">Aguarde um instante</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Precisamos confirmar se este número está ok no WhatsApp do celular.
                Por enquanto <strong>não escaneie</strong> o código. Peça ao suporte para liberar,
                ou use <strong>Trocar número</strong> se for outro chip.
              </p>
            </div>
          ) : showingQr ? (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl border-2 border-primary/20 bg-white p-3 shadow-sm">
                <img
                  src={
                    displayQr!.startsWith("data:") || displayQr!.startsWith("http")
                      ? displayQr!
                      : `data:image/png;base64,${displayQr}`
                  }
                  alt="Código para conectar o WhatsApp"
                  className="w-56 h-56 sm:w-64 sm:h-64"
                />
              </div>
              <ol className="text-left text-sm text-muted-foreground space-y-1.5 w-full max-w-xs">
                <li>1. Abra o WhatsApp no celular</li>
                <li>2. Toque em <strong className="text-foreground">Aparelhos conectados</strong></li>
                <li>3. Escaneie o código acima <strong className="text-foreground">uma vez</strong></li>
              </ol>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={refreshCooldown > 0 || isLoading}
                onClick={() => void handleRefresh()}
                className="gap-2 text-xs text-muted-foreground"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {refreshCooldown > 0 ? `Novo código em ${refreshCooldown}s` : "Código sumiu? Atualizar"}
              </Button>
            </div>
          ) : connecting ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">Preparando o código…</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Isso leva só alguns segundos. Fique nesta tela.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6">
              <WifiOff className="w-10 h-10 text-muted-foreground/70" />
              <p className="text-sm text-muted-foreground text-center">
                {error
                  ? "Não deu certo agora. Tente de novo — é seguro."
                  : isWhapi
                    ? "Seu WhatsApp ainda não está ligado nesta conta."
                    : "Pronto para conectar seu WhatsApp."}
              </p>
              {error && (
                <p className="text-xs text-destructive/90 text-center max-w-sm">{error}</p>
              )}
              <Button
                type="button"
                className="gap-2 rounded-xl px-6 h-11 font-semibold"
                style={{ background: "var(--gradient-green)" }}
                disabled={isLoading}
                onClick={() => void (isWhapi ? onWhapiReauth?.() : onConnect())}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4" />
                )}
                Mostrar código
              </Button>
            </div>
          )}

          {phoneNumber && !fatalLocked && (
            <p className="text-center text-[11px] text-muted-foreground/80">
              Número em uso: {phoneNumber}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
