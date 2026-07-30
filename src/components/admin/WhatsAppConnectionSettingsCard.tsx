import { useState } from "react";
import { CheckCircle2, Loader2, QrCode, Smartphone, WifiOff } from "lucide-react";
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
import { formatBrazilPhone } from "@/lib/phone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWhapiHealth } from "@/hooks/useWhapiHealth";
import type { ConnectionStatus } from "@/types/whatsapp";

interface Props {
  isWhapi: boolean;
  connectionStatus: ConnectionStatus;
  phoneNumber: string | null;
  isLoading?: boolean;
  /** Só consulta saúde Whapi enquanto o sheet de Configurações está aberto. */
  healthEnabled?: boolean;
  onDisconnect: () => Promise<void>;
  /** Fecha Configurações e só abre a aba WhatsApp (sem logout/QR). */
  onGoWhatsApp?: () => void;
  /** Fecha Configurações e abre a aba WhatsApp para escanear o QR (trocar chip). */
  onGoConnectAnother: () => void;
}

/**
 * Card em Configurações: desconectar o Zap e conectar outro número.
 * Evolution → logout/delete instância · Whapi → logout do canal.
 */
export function WhatsAppConnectionSettingsCard({
  isWhapi,
  connectionStatus,
  phoneNumber,
  isLoading,
  healthEnabled = true,
  onDisconnect,
  onGoWhatsApp,
  onGoConnectAnother,
}: Props) {
  const { toast } = useToast();
  const whapiHealth = useWhapiHealth(isWhapi && healthEnabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const connected = isWhapi
    ? whapiHealth.status === "AUTH"
    : connectionStatus === "connected";
  const phoneLabel = phoneNumber ? formatBrazilPhone(phoneNumber) : null;

  const runDisconnect = async () => {
    setBusy(true);
    try {
      if (isWhapi) {
        const { data, error } = await supabase.functions.invoke("whapi-proxy", {
          body: { action: "logout", payload: {} },
        });
        if (error || data?.error) {
          throw new Error(error?.message || data?.error || "Falha ao desconectar");
        }
        await whapiHealth.refresh();
      } else {
        await onDisconnect();
      }
      toast({
        title: "WhatsApp desconectado",
        description: "Agora você pode conectar outro número.",
        duration: 3500,
      });
      setConfirmOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: "Não foi possível desconectar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/15">
          <Smartphone className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-bold text-foreground">WhatsApp</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Desconecte para trocar de chip ou conectar outro número.
          </p>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
          connected
            ? "border-emerald-500/25 bg-emerald-500/5 text-foreground"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        {connected ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <WifiOff className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">
          {connected
            ? phoneLabel
              ? `Conectado · ${phoneLabel}`
              : "Conectado"
            : isWhapi && whapiHealth.status === "QR"
              ? "Aguardando QR"
              : "Desconectado"}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {connected ? (
          <Button
            type="button"
            variant="outline"
            className="gap-2 text-destructive border-destructive/25 hover:bg-destructive/5 hover:text-destructive"
            disabled={busy || isLoading}
            onClick={() => setConfirmOpen(true)}
          >
            {busy || isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            Desconectar / trocar chip
          </Button>
        ) : null}

        <Button
          type="button"
          variant={connected ? "ghost" : "default"}
          className="gap-2"
          disabled={busy || isLoading}
          onClick={() => {
            // Conectado: só navega. Desconectado: pede QR.
            // Nunca chamar reauth/logout só por “abrir” a aba.
            if (connected) (onGoWhatsApp ?? onGoConnectAnother)();
            else onGoConnectAnother();
          }}
          style={!connected ? { background: "var(--gradient-green)" } : undefined}
        >
          <QrCode className="h-4 w-4" />
          {connected ? "Abrir WhatsApp" : "Conectar WhatsApp"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso encerra a sessão neste painel para você poder conectar outro número.
              O WhatsApp no celular não é apagado. Depois use{" "}
              <strong>Conectar WhatsApp</strong> e escaneie o QR com o chip novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void runDisconnect();
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sim, desconectar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
