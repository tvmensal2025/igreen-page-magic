import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, RefreshCw, Smartphone, Shield, WifiOff, X } from "lucide-react";
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
  /** Fecha o modal e volta ao painel (Dashboard). */
  onDismiss?: () => void;
}

/** Erros técnicos que nunca devem aparecer pro consultor. */
function isTechnicalNoise(msg: string | null | undefined): boolean {
  if (!msg) return true;
  return /outra aba|broadcastchannel|fech[ea]-a antes|qr-lock|evolution|baileys|instance/i.test(msg);
}

/**
 * Tela única antes do chat: só QR / conectar.
 * Conta nova: abre o código sozinho. Sempre dá pra fechar e voltar depois.
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
  onDismiss,
}: Props) {
  const startedRef = useRef(false);
  const retryCountRef = useRef(0);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [phase, setPhase] = useState<"idle" | "working" | "failed">("idle");

  const displayQr = isWhapi ? whapiQrImage : qrCode;
  const hasQr = !!displayQr;
  const userError = error && !isTechnicalNoise(error) ? error : null;
  const alreadyConnected =
    connectionStatus === "connected" ||
    (isWhapi && String(whapiStatusLabel || "").toUpperCase() === "AUTH");

  const startPairing = () => {
    if (alreadyConnected) return;
    setPhase("working");
    if (isWhapi) return onWhapiReauth?.();
    return onConnect();
  };

  // Conta nova / gate aberto → pede o código sozinho.
  // Se já conectado (Whapi AUTH), NÃO dispara QR.
  useEffect(() => {
    if (!open || fatalLocked) return;
    if (alreadyConnected) return;
    if (hasQr || isLoading) return;
    if (startedRef.current) return;
    startedRef.current = true;
    void startPairing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fatalLocked, isWhapi, alreadyConnected, hasQr, isLoading]);

  // Ruído técnico ("outra aba") ou falha → retry automático (máx 3).
  useEffect(() => {
    if (!open || fatalLocked || hasQr || isLoading || alreadyConnected) return;
    if (!startedRef.current) return;
    if (retryCountRef.current >= 3) {
      setPhase("failed");
      return;
    }
    // Só retenta quando houve tentativa e parou sem QR (erro ou fim do loading).
    if (!error && phase !== "working") return;
    const t = setTimeout(() => {
      retryCountRef.current += 1;
      void startPairing();
    }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fatalLocked, hasQr, isLoading, error, alreadyConnected]);

  // Se loading terminou sem QR e sem mais retries → falhou.
  useEffect(() => {
    if (!open || fatalLocked || hasQr || isLoading) return;
    if (!startedRef.current) return;
    if (retryCountRef.current >= 3) setPhase("failed");
  }, [open, fatalLocked, hasQr, isLoading]);

  useEffect(() => {
    if (hasQr) setPhase("idle");
  }, [hasQr]);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      retryCountRef.current = 0;
      setPhase("idle");
    }
  }, [open]);

  useEffect(() => {
    if (refreshCooldown <= 0) return;
    const t = setInterval(() => setRefreshCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [refreshCooldown]);

  const showingQr = hasQr && !fatalLocked;
  const connecting =
    !fatalLocked &&
    !showingQr &&
    (isLoading || phase === "working" || (startedRef.current && retryCountRef.current < 3 && phase !== "failed"));

  const handleRefresh = async () => {
    if (refreshCooldown > 0 || fatalLocked || alreadyConnected) return;
    setRefreshCooldown(30);
    setPhase("working");
    if (isWhapi) await onWhapiReauth?.();
    else await onRefreshQr?.();
  };

  const handleManualStart = () => {
    if (alreadyConnected) return;
    retryCountRef.current = 0;
    startedRef.current = true;
    setPhase("working");
    void startPairing();
  };

  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 sm:p-6 ${
        open ? "" : "hidden"
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-connect-gate-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="absolute top-3 right-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Fechar e voltar ao painel"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="px-5 pt-6 pb-4 text-center space-y-2 border-b border-border/60 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-primary" />
          </div>
          <h2 id="wa-connect-gate-title" className="font-heading text-lg font-bold text-foreground pr-8">
            Conectar WhatsApp
          </h2>
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
              {onDismiss && (
                <Button type="button" variant="outline" className="mt-1" onClick={onDismiss}>
                  Voltar ao painel
                </Button>
              )}
            </div>
          ) : showingQr ? (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl border-2 border-primary/20 bg-white p-3 shadow-sm" data-tour="wa-qr">
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
                Isso leva só alguns segundos. O código aparece sozinho — não precisa clicar.
              </p>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline mt-2"
                >
                  Agora não — voltar ao painel
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6">
              <WifiOff className="w-10 h-10 text-muted-foreground/70" />
              <p className="text-sm text-muted-foreground text-center">
                {userError
                  ? "Ainda não deu. Pode tentar de novo — é seguro."
                  : isWhapi
                    ? "Seu WhatsApp ainda não está ligado nesta conta."
                    : "Pronto para conectar seu WhatsApp."}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
                  <Button
                    type="button"
                    className="flex-1 gap-2 rounded-xl h-11 font-semibold"
                    style={{ background: "var(--gradient-green)" }}
                    disabled={isLoading}
                    onClick={handleManualStart}
                    data-tour="wa-conectar"
                  >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <QrCode className="w-4 h-4" />
                  )}
                  Mostrar código
                </Button>
                {onDismiss && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 rounded-xl h-11"
                    onClick={onDismiss}
                  >
                    Fechar
                  </Button>
                )}
              </div>
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
