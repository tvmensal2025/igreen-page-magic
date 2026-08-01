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
  /** Quando true, esconde botões de reconexão/reset (número em revisão manual). */
  fatalLocked?: boolean;
  fatalReason?: number | null;
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
          className={`h-full rounded-full transition-all duration-1000 ${isLow ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-mono ${isLow ? "text-destructive" : "text-muted-foreground"}`}>
        {secondsLeft}s
      </span>
    </div>
  );
}

function HealthBadge({ health, timeouts }: { health: OperationalHealth; timeouts: number }) {
  const config: Record<OperationalHealth, { label: string; color: string; icon: React.ReactNode }> = {
    healthy: { label: "Operacional", color: "bg-primary/15 text-primary border-primary/25", icon: <CheckCircle2 className="w-3 h-3" /> },
    degraded: { label: "Instável", color: "bg-warning/15 text-warning border-warning/25", icon: <AlertTriangle className="w-3 h-3" /> },
    recovering: { label: "Recuperando", color: "bg-info/15 text-info border-info/25", icon: <RefreshCw className="w-3 h-3 animate-spin" /> },
    needs_qr: { label: "Aguardando QR", color: "bg-primary/15 text-primary border-primary/25", icon: <QrCode className="w-3 h-3" /> },
    reset_recommended: { label: "Reset recomendado", color: "bg-destructive/15 text-destructive border-destructive/25", icon: <AlertTriangle className="w-3 h-3" /> },
    resetting: { label: "Resetando...", color: "bg-warning/15 text-warning border-warning/25", icon: <RotateCcw className="w-3 h-3 animate-spin" /> },
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
                <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              ) : isError ? (
                <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
              ) : isWarning || isTimer ? (
                <Clock className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
              ) : isQr ? (
                <QrCode className="w-3.5 h-3.5 text-info mt-0.5 shrink-0" />
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
  fatalLocked = false,
  fatalReason = null,
  onConnect,
  onDisconnect,
  onReconnect,
  onRefreshQr,
  onSafeReset,
}: ConnectionPanelProps) {
  const [qrExpired, setQrExpired] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // ⚠️ Anti-spam: pedir QR várias vezes em poucos segundos é interpretado
  // pelo WhatsApp como comportamento de bot. Cooldown 30s (era 10s).
  const [refreshCooldownLeft, setRefreshCooldownLeft] = useState(0);
  const refreshDisabled = isLoading || refreshCooldownLeft > 0 || fatalLocked;
  const handleSafeRefresh = async () => {
    if (refreshDisabled || !onRefreshQr || fatalLocked) return;
    setRefreshCooldownLeft(30);
    try { await onRefreshQr(); } finally { /* cooldown corre independente */ }
  };
  useEffect(() => {
    if (refreshCooldownLeft <= 0) return;
    const t = setInterval(() => setRefreshCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [refreshCooldownLeft]);
  const showDiagnostic = connectionLog.length > 0 && (isLoading || error || connectionStatus === "connecting" || operationalHealth !== "healthy");
  const isAutoReconnecting = isLoading && connectionLog.some((l) => l.includes("🔄"));
  // Reset só em degradação grave — Conectar NÃO deve destruir sessão.
  const showResetButton = !fatalLocked && onSafeReset && (operationalHealth === "reset_recommended" || consecutiveTimeouts >= 5);
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
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/20">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />

      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-heading font-bold text-foreground text-lg">Conexão WhatsApp</h3>
            <p className="text-xs text-muted-foreground">Escaneie o código uma vez. Depois o painel libera sozinho.</p>
          </div>
          <HealthBadge health={operationalHealth} timeouts={consecutiveTimeouts} />
        </div>

        {/* Whapi Super Admin — connected via Whapi Cloud, no QR needed */}
        {isWhapi && connectionStatus === "connected" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-xl bg-primary/5 border border-primary/15">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
                  <Wifi className="w-6 h-6 text-primary" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary/100 border-2 border-card flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    Conectado
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
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border border-primary/10">
              {operationalHealth === "resetting" ? (
                <RotateCcw className="w-8 h-8 text-warning animate-spin" />
              ) : isAutoReconnecting ? (
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
              ) : (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
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
                  className="gap-2 text-xs text-warning border-warning/20 hover:bg-warning/5 hover:border-warning/30 hover:text-warning"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Resetar Conexão
                </Button>
              )}
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                variant="ghost"
                size="sm"
                className="gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/5"
              >
                <WifiOff className="w-3.5 h-3.5" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {showErrorState && (
          <div className="flex flex-col items-center justify-center py-8 gap-5">
            <div className="w-full rounded-xl bg-destructive/5 border border-destructive/20 px-5 py-4 text-center backdrop-blur-sm">
              <p className="text-sm text-destructive font-medium">{error}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button onClick={onConnect} variant="outline" className="gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all" disabled={isLoading}>
                <RefreshCw className="w-4 h-4" /> Tentar novamente
              </Button>
              {!!instanceName && (
                <Button
                  onClick={() => setShowDisconnectConfirm(true)}
                  variant="outline"
                  className="gap-2 rounded-xl text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 hover:text-destructive"
                >
                  <WifiOff className="w-4 h-4" /> Desconectar / trocar chip
                </Button>
              )}
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  className="gap-2 rounded-xl text-warning border-warning/20 hover:bg-warning/5 hover:border-warning/30 hover:text-warning"
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
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-warning/20 border border-warning/30 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-warning" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-base font-heading font-bold text-foreground">WhatsApp desconectado</p>
              <p className="text-sm text-muted-foreground max-w-xs">Conecte seu WhatsApp para começar a enviar mensagens personalizadas</p>
            </div>
            <Button onClick={onConnect} className="gap-2 rounded-xl px-6 h-11 text-sm font-bold shadow-lg shadow-green-500/10 hover:shadow-green-500/20 transition-all" style={{ background: "var(--gradient-green)" }} data-tour="wa-conectar">
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
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-destructive/20 border border-destructive/30 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-1.5 max-w-md">
              {fatalLocked ? (
                <>
                  <p className="text-base font-heading font-bold text-foreground">Aguarde um instante</p>
                  <p className="text-sm text-muted-foreground">
                    Precisamos confirmar se este número está ok no WhatsApp do celular.
                    Por enquanto <strong>não escaneie</strong> o código. Peça ao suporte para liberar,
                    ou use <strong>Trocar número</strong> se for outro chip.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-heading font-bold text-foreground">Vamos conectar de novo</p>
                  <p className="text-sm text-muted-foreground">
                    É o mesmo WhatsApp de sempre. Toque em conectar e escaneie o código <strong>uma vez</strong>.
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {!fatalLocked && (
                <Button onClick={onConnect} variant="outline" className="gap-2 rounded-xl px-6 h-11 border-primary/30 hover:bg-primary/5 hover:border-primary/50 transition-all" data-tour="wa-conectar">
                  <QrCode className="w-4 h-4" /> Conectar WhatsApp
                </Button>
              )}
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                variant="outline"
                className="gap-2 rounded-xl px-6 h-11 text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 hover:text-destructive"
              >
                <WifiOff className="w-4 h-4" /> Trocar número
              </Button>
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  className="gap-2 rounded-xl px-6 h-11 text-warning border-warning/20 hover:bg-warning/5 hover:border-warning/30 hover:text-warning"
                >
                  <RotateCcw className="w-4 h-4" /> Recomeçar conexão
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Connecting — waiting for QR */}
        {showConnectingWithoutQr && (
          <div className="flex flex-col items-center justify-center py-10 gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border border-primary/10">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <p className="text-base font-heading font-bold text-foreground">Aguardando QR Code</p>
              <p className="text-sm text-muted-foreground">
                {operationalHealth === "degraded"
                  ? "Quase lá — o código aparece em alguns segundos."
                  : "Estamos gerando o código. Fique nesta tela."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {onRefreshQr && (
                <Button
                  onClick={handleSafeRefresh}
                  variant="outline"
                  disabled={refreshDisabled}
                  className="gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshCooldownLeft > 0 ? "" : ""}`} />
                  {refreshCooldownLeft > 0 ? `Aguarde ${refreshCooldownLeft}s` : "Atualizar agora"}
                </Button>
              )}
              {showResetButton && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-xl text-warning border-warning/20 hover:bg-warning/5 hover:border-warning/30 hover:text-warning"
                >
                  <RotateCcw className="w-4 h-4" /> Resetar
                </Button>
              )}
              <Button
                onClick={() => setShowDisconnectConfirm(true)}
                variant="ghost"
                size="sm"
                className="gap-2 rounded-xl text-destructive hover:bg-destructive/5 hover:text-destructive transition-all"
              >
                <WifiOff className="w-4 h-4" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Connecting — QR code */}
        {showConnectingWithQr && (
          <div className="flex flex-col items-center justify-center py-8 gap-5">
            <div className={`relative rounded-2xl border-2 ${qrExpired ? "border-destructive/30 opacity-40" : "border-primary/20"} bg-white p-4 shadow-xl shadow-green-500/5 transition-all`}>
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-56 h-56 sm:w-64 sm:h-64"
              />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary/15 border border-primary/25 backdrop-blur-sm">
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                  {qrExpired ? "Expirado" : "Escaneie"}
                </span>
              </div>
            </div>

            {qrGeneratedAt && !qrExpired && (
              <QrTimer generatedAt={qrGeneratedAt} onExpired={handleQrExpired} />
            )}

            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${qrExpired ? "bg-warning" : "bg-primary"} animate-pulse`} />
              <p className="text-sm text-muted-foreground font-medium">
                {qrExpired ? "Código expirou — toque em Atualizar (uma vez)" : "Aguardando você escanear..."}
              </p>
            </div>

            {onRefreshQr && (
              <Button
                onClick={handleSafeRefresh}
                variant="ghost"
                size="sm"
                disabled={refreshDisabled}
                className="gap-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {refreshCooldownLeft > 0 ? `Aguarde ${refreshCooldownLeft}s` : "Atualizar código"}
              </Button>
            )}

            <Button
              onClick={() => setShowDisconnectConfirm(true)}
              variant="ghost"
              size="sm"
              className="gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/5"
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-xl bg-primary/5 border border-primary/15">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
                  <Wifi className="w-6 h-6 text-primary" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary/100 border-2 border-card flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    Conectado
                  </span>
                </div>
                {phoneNumber && <p className="text-sm text-muted-foreground mt-1">{phoneNumber}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowDisconnectConfirm(true)} variant="outline" size="sm" className="gap-2 rounded-xl text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 hover:text-destructive transition-all">
                <WifiOff className="w-4 h-4" /> Desconectar / trocar chip
              </Button>
            </div>
          </div>
        )}

        {/* Diagnostic panel */}
        {showDiagnostic && <DiagnosticPanel logs={connectionLog} />}
        {instanceName && !isWhapi && <InstanceHealth instanceName={instanceName} />}
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
              className="bg-destructive/100 hover:bg-destructive text-white"
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
              <Shield className="w-5 h-5 text-warning" />
              Resetar Conexão com Segurança?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Isso <strong>desvincula o chip e pede QR de novo</strong>. Só use se o suporte pedir ou a sessão estiver irrecuperável.
                Vários resets seguidos <strong>podem bloquear o número no WhatsApp</strong>.
              </p>
              <div className="rounded-lg bg-secondary/80 p-3 text-xs space-y-1">
                <p className="font-bold text-foreground">O que acontece:</p>
                <p>1. A sessão atual é encerrada (logout)</p>
                <p>2. A instância é removida e recriada com o <strong>mesmo nome</strong></p>
                <p>3. Um QR novo aparece — escaneie <strong>uma vez</strong></p>
              </div>
              <p className="text-xs text-muted-foreground">
                Preferível: botão <strong>Reconectar (mesma sessão)</strong>, que não desvincula o chip.
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
              className="bg-warning/100 hover:bg-warning text-white gap-2"
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
