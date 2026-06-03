import { useState, useEffect } from "react";
import { Wifi, WifiOff, Loader2, QrCode, RefreshCw, Zap, CheckCircle2, XCircle, Clock, AlertTriangle, RotateCcw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConnectionStatus } from "@/types/whatsapp";
import type { OperationalHealth } from "@/hooks/useWhatsApp";
import { InstanceHealth } from "./InstanceHealth";

interface ConnectionPanelProps {
  connectionStatus: ConnectionStatus;
  qrCode: string | null;
  qrGeneratedAt?: number | null;
  instanceName: string | null;
  phoneNumber: string | null;
  isLoading: boolean;
  error: string | null;
  connectionLog?: string[];
  operationalHealth?: OperationalHealth;
  consecutiveTimeouts?: number;
  isWhapi?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onReconnect: () => Promise<void>;
  onRefreshQr?: () => Promise<void>;
  onSafeReset?: () => Promise<void>;
}

const QR_LIFETIME_S = 45;

function QrTimer({ generatedAt, onExpired }: { generatedAt: number; onExpired: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const elapsed = Math.floor((Date.now() - generatedAt) / 1000);
    return Math.max(0, QR_LIFETIME_S - elapsed);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - generatedAt) / 1000);
      const left = Math.max(0, QR_LIFETIME_S - elapsed);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [generatedAt, onExpired]);

  const pct = (secondsLeft / QR_LIFETIME_S) * 100;
  const isLow = secondsLeft <= 10;

  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${isLow ? "bg-red-400" : "bg-green-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-mono ${isLow ? "text-red-400" : "text-muted-foreground"}`}>
        {secondsLeft}s
      </span>
    </div>
  );
}

function HealthBadge({ health, timeouts }: { health: OperationalHealth; timeouts: number }) {
  const config: Record<OperationalHealth, { label: string; color: string; icon: React.ReactNode }> = {
    healthy: { label: "Operacional", color: "bg-green-500/15 text-green-400 border-green-500/25", icon: <CheckCircle2 className="w-3 h-3" /> },
    degraded: { label: "Instável", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25", icon: <AlertTriangle className="w-3 h-3" /> },
    recovering: { label: "Recuperando", color: "bg-blue-500/15 text-blue-400 border-blue-500/25", icon: <RefreshCw className="w-3 h-3 animate-spin" /> },
    needs_qr: { label: "Aguardando QR", color: "bg-purple-500/15 text-purple-400 border-purple-500/25", icon: <QrCode className="w-3 h-3" /> },
    reset_recommended: { label: "Reset recomendado", color: "bg-red-500/15 text-red-400 border-red-500/25", icon: <AlertTriangle className="w-3 h-3" /> },
    resetting: { label: "Resetando...", color: "bg-orange-500/15 text-orange-400 border-orange-500/25", icon: <RotateCcw className="w-3 h-3 animate-spin" /> },
  };

  const c = config[health];
  if (health === "healthy") return null;

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${c.color}`}>
      {c.icon}
      {c.label}
      {timeouts > 0 && health !== "resetting" && (
        <span className="text-[9px] opacity-70">({timeouts}x)</span>
      )}
    </div>
  );
}

function DiagnosticPanel({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/50 bg-secondary/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Diagnóstico de Conexão</span>
      </div>
      <div className="max-h-[200px] overflow-y-auto p-3 space-y-1">
        {logs.map((log, i) => {
          const isSuccess = log.includes("✅");
          const isError = log.includes("❌");
          const isWarning = log.includes("⚠️");
          const isQr = log.includes("📱");
          const isRetry = log.includes("🔄");
          const isTimer = log.includes("⏳");
          const isSearch = log.includes("🔍");
          const isStep = /^\[\d{2}:\d{2}:\d{2}\] \d\/\d/.test(log);

          return (
            <div key={i} className="flex items-start gap-2">
              {isSuccess ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
              ) : isError ? (
                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
              ) : isWarning || isTimer ? (
                <Clock className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
              ) : isQr ? (
                <QrCode className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              ) : isRetry ? (
                <RefreshCw className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0 animate-spin" />
              ) : isSearch || isStep ? (
                <Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              ) : (
                <div className="w-3.5 h-3.5 flex items-center justify-center mt-0.5 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                </div>
              )}
              <span className="text-[11px] font-mono text-muted-foreground leading-relaxed">{log}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConnectionPanel({
  connectionStatus,
  qrCode,
  qrGeneratedAt,
  instanceName,
  phoneNumber,
  isLoading,
  error,
  connectionLog = [],
  operationalHealth = "healthy",
  consecutiveTimeouts = 0,
  isWhapi = false,
  onConnect,
  onDisconnect,
  onReconnect,
  onRefreshQr,
  onSafeReset,
}: ConnectionPanelProps) {
  const [qrExpired, setQrExpired] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const showDiagnostic = connectionLog.length > 0 && (isLoading || error || connectionStatus === "connecting" || operationalHealth !== "healthy");
  const isAutoReconnecting = isLoading && connectionLog.some((l) => l.includes("🔄"));
  const showResetButton = onSafeReset && (operationalHealth === "reset_recommended" || operationalHealth === "degraded" || consecutiveTimeouts >= 3);
  const showLoadingState = isLoading && !qrCode;
  const showErrorState = !showLoadingState && !isLoading && !!error;
  const showDisconnectedWithoutInstance = !showLoadingState && !showErrorState && !isLoading && connectionStatus === "disconnected" && !instanceName;
  const showDisconnectedWithInstance = !showLoadingState && !showErrorState && !isLoading && connectionStatus === "disconnected" && !!instanceName;
  const showConnectingWithoutQr = !showLoadingState && !showErrorState && connectionStatus === "connecting" && !qrCode;
  const showConnectingWithQr = !showLoadingState && !showErrorState && connectionStatus === "connecting" && !!qrCode;
  const showConnectedState = !showLoadingState && !showErrorState && !isLoading && connectionStatus === "connected";

  useEffect(() => {
    if (qrCode) setQrExpired(false);
  }, [qrCode]);

  const handleQrExpired = () => {
    // ⚠️ Não regenera QR automaticamente. Auto-refresh agressivo é
    // interpretado como comportamento de bot pelo WhatsApp e contribui
    // para banimento. Consultor precisa clicar para gerar um novo QR.
    setQrExpired(true);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-green-950/20">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 flex items-center justify-center border border-green-500/20">
            <Zap className="w-5 h-5 text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-heading font-bold text-foreground text-lg">Conexão WhatsApp</h3>
            <p className="text-xs text-muted-foreground">Conecte seu celular para enviar mensagens</p>
          </div>
          <HealthBadge health={operationalHealth} timeouts={consecutiveTimeouts} />
        </div>

        {/* Whapi Super Admin — connected via Whapi Cloud, no QR needed */}
        {isWhapi && connectionStatus === "connected" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-xl bg-green-500/5 border border-green-500/15">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 flex items-center justify-center border border-green-500/20">
                  <Wifi className="w-6 h-6 text-green-400" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-card flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-400 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    Conectado via Whapi
                  </span>
                </div>
                {phoneNumber && <p className="text-sm text-muted-foreground mt-1">{phoneNumber}</p>}
                <p className="text-xs text-muted-foreground/60 mt-0.5">Super Admin — Botões reais do WhatsApp ativados</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading / Auto-reconnecting */}
        {showLoadingState && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/15 to-green-600/5 flex items-center justify-center border border-green-500/10">
              {operationalHealth === "resetting" ? (
                <RotateCcw className="w-8 h-8 text-orange-400 animate-spin" />
              ) : isAutoReconnecting ? (
                <RefreshCw className="w-8 h-8 text-green-400 animate-spin" />
              ) : (
                <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
              )}
            </div>
            <p className="text-sm text-muted-foreground font-medium">
              {operationalHealth === "resetting"
                ? "Resetando conexão com segurança..."
                : isAutoReconnecting
                  ? "Reconectando automaticamente..."
                  : "Verificando conexão..."}
            </p>
            {isAutoReconnecting && (
              <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                O sistema está tentando restabelecer a conexão. Aguarde alguns instantes.
              </p>
            )}
            <div className="flex gap-2">
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs text-orange-400 border-orange-500/20 hover:bg-orange-500/5 hover:border-orange-500/30 hover:text-orange-400"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Resetar Conexão
                </Button>
              )}
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                variant="ghost"
                size="sm"
                className="gap-2 text-xs text-red-400 hover:text-red-400 hover:bg-red-500/5"
              >
                <WifiOff className="w-3.5 h-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {showErrorState && (
          <div className="flex flex-col items-center justify-center py-8 gap-5">
            <div className="w-full rounded-xl bg-red-500/5 border border-red-500/20 px-5 py-4 text-center backdrop-blur-sm">
              <p className="text-sm text-red-400 font-medium">{error}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={onConnect} variant="outline" className="gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all">
                <RefreshCw className="w-4 h-4" /> Tentar novamente
              </Button>
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  className="gap-2 rounded-xl text-orange-400 border-orange-500/20 hover:bg-orange-500/5 hover:border-orange-500/30 hover:text-orange-400"
                >
                  <RotateCcw className="w-4 h-4" /> Resetar Conexão
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Disconnected — no instance */}
        {showDisconnectedWithoutInstance && (
          <div className="flex flex-col items-center justify-center py-10 gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center border border-border/50">
                <WifiOff className="w-9 h-9 text-muted-foreground/60" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-base font-heading font-bold text-foreground">WhatsApp desconectado</p>
              <p className="text-sm text-muted-foreground max-w-xs">Conecte seu WhatsApp para começar a enviar mensagens personalizadas</p>
            </div>
            <Button onClick={onConnect} className="gap-2 rounded-xl px-6 h-11 text-sm font-bold shadow-lg shadow-green-500/10 hover:shadow-green-500/20 transition-all" style={{ background: "var(--gradient-green)" }}>
              <QrCode className="w-4 h-4" /> Conectar WhatsApp
            </Button>
          </div>
        )}

        {/* Disconnected — instance exists (auto-reconnect exhausted) */}
        {showDisconnectedWithInstance && (
          <div className="flex flex-col items-center justify-center py-10 gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center border border-border/50">
                <WifiOff className="w-9 h-9 text-muted-foreground/60" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-base font-heading font-bold text-foreground">Conexão perdida</p>
              <p className="text-sm text-muted-foreground max-w-xs">A reconexão automática não foi possível. Clique abaixo para reconectar.</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={onReconnect} variant="outline" className="gap-2 rounded-xl px-6 h-11 border-primary/30 hover:bg-primary/5 hover:border-primary/50 transition-all">
                <RefreshCw className="w-4 h-4" /> Reconectar
              </Button>
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  className="gap-2 rounded-xl px-6 h-11 text-orange-400 border-orange-500/20 hover:bg-orange-500/5 hover:border-orange-500/30 hover:text-orange-400"
                >
                  <RotateCcw className="w-4 h-4" /> Resetar
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Connecting — waiting for QR */}
        {showConnectingWithoutQr && (
          <div className="flex flex-col items-center justify-center py-10 gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/15 to-green-600/5 flex items-center justify-center border border-green-500/10">
              <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <p className="text-base font-heading font-bold text-foreground">Aguardando QR Code</p>
              <p className="text-sm text-muted-foreground">
                {operationalHealth === "degraded"
                  ? "O servidor está lento mas respondendo. O QR Code aparecerá assim que disponível."
                  : "O servidor WhatsApp está processando sua conexão. O QR Code aparecerá automaticamente."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {onRefreshQr && (
                <Button
                  onClick={onRefreshQr}
                  variant="outline"
                  className="gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
                >
                  <RefreshCw className="w-4 h-4" /> Atualizar agora
                </Button>
              )}
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-xl text-orange-400 border-orange-500/20 hover:bg-orange-500/5 hover:border-orange-500/30 hover:text-orange-400"
                >
                  <RotateCcw className="w-4 h-4" /> Resetar
                </Button>
              )}
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                variant="ghost"
                size="sm"
                className="gap-2 rounded-xl text-red-400 hover:bg-red-500/5 hover:text-red-400 transition-all"
              >
                <WifiOff className="w-4 h-4" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Connecting — QR code */}
        {showConnectingWithQr && (
          <div className="flex flex-col items-center justify-center py-8 gap-5">
            <div className={`relative rounded-2xl border-2 ${qrExpired ? "border-red-500/30 opacity-40" : "border-green-500/20"} bg-white p-4 shadow-xl shadow-green-500/5 transition-all`}>
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-56 h-56 sm:w-64 sm:h-64"
              />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/25 backdrop-blur-sm">
                <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">
                  {qrExpired ? "Expirado" : "Escaneie"}
                </span>
              </div>
            </div>

            {qrGeneratedAt && !qrExpired && (
              <QrTimer generatedAt={qrGeneratedAt} onExpired={handleQrExpired} />
            )}

            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${qrExpired ? "bg-yellow-400" : "bg-green-400"} animate-pulse`} />
              <p className="text-sm text-muted-foreground font-medium">
                {qrExpired ? "Renovando QR Code..." : "Aguardando leitura do QR Code..."}
              </p>
            </div>

            {onRefreshQr && (
              <Button
                onClick={onRefreshQr}
                variant="ghost"
                size="sm"
                className="gap-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Gerar novo QR
              </Button>
            )}

            <Button
              onClick={() => setShowDisconnectConfirm(true)}
              variant="ghost"
              size="sm"
              className="gap-2 text-xs text-red-400 hover:text-red-400 hover:bg-red-500/5"
            >
              <WifiOff className="w-3.5 h-3.5" /> Cancelar conexão
            </Button>

            <p className="text-xs text-muted-foreground/70 text-center max-w-[280px] leading-relaxed">
              Abra o WhatsApp → Configurações → Dispositivos Conectados → Conectar Dispositivo
            </p>
          </div>
        )}

        {/* Connected (Evolution only — Whapi has its own panel above) */}
        {showConnectedState && !isWhapi && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-xl bg-green-500/5 border border-green-500/15">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 flex items-center justify-center border border-green-500/20">
                  <Wifi className="w-6 h-6 text-green-400" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-card flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-400 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    Conectado
                  </span>
                </div>
                {phoneNumber && <p className="text-sm text-muted-foreground mt-1">{phoneNumber}</p>}
              </div>
            </div>
            <Button onClick={() => setShowDisconnectConfirm(true)} variant="outline" size="sm" className="gap-2 rounded-xl text-red-400 border-red-500/20 hover:bg-red-500/5 hover:border-red-500/30 hover:text-red-400 transition-all">
              <WifiOff className="w-4 h-4" /> Desconectar
            </Button>
          </div>
        )}

        {/* Diagnostic panel */}
        {showDiagnostic && <DiagnosticPanel logs={connectionLog} />}
      </div>

      {/* Disconnect confirmation dialog */}
      <AlertDialog open={showDisconnectConfirm} onOpenChange={setShowDisconnectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai encerrar a sessão do WhatsApp neste dispositivo. Você poderá reconectar depois escaneando um novo QR Code. Seu WhatsApp no celular <strong>não será afetado</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDisconnectConfirm(false);
                onDisconnect();
              }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Sim, desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Safe Reset confirmation dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-orange-400" />
              Resetar Conexão com Segurança?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Este processo irá <strong>remover a instância atual e criar uma nova</strong>. É recomendado quando o servidor não está respondendo após várias tentativas.
              </p>
              <div className="rounded-lg bg-secondary/80 p-3 text-xs space-y-1">
                <p className="font-bold text-foreground">O que acontece:</p>
                <p>1. A sessão WhatsApp atual será encerrada</p>
                <p>2. A instância antiga será removida</p>
                <p>3. Uma nova instância será criada</p>
                <p>4. Um novo QR Code será gerado para escanear</p>
              </div>
              <p className="text-xs text-muted-foreground">
                ⚠️ Seus contatos, templates e agendamentos <strong>não serão afetados</strong>.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowResetConfirm(false);
                onSafeReset?.();
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Sim, resetar conexão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
