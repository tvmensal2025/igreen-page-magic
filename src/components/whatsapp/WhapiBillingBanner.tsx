import { useWhapiHealth } from "@/hooks/useWhapiHealth";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, AlertTriangle } from "lucide-react";

interface Props {
  enabled: boolean;
}

/**
 * Banner global mostrado no topo do WhatsApp Tab quando o canal Whapi
 * está bloqueado por falta de pagamento ou foi removido no painel.
 * Visível em qualquer sub-aba (Dashboard, Conversas, Envio em massa, etc.)
 * para o Super Admin não perder tempo trocando token quando o problema é financeiro.
 */
export function WhapiBillingBanner({ enabled }: Props) {
  const { reasonCode, helpUrl } = useWhapiHealth(enabled);
  if (!enabled) return null;
  if (reasonCode !== "unpaid" && reasonCode !== "channel_not_found") return null;

  const isUnpaid = reasonCode === "unpaid";
  const url = helpUrl || (isUnpaid ? "https://panel.whapi.cloud/billing" : "https://panel.whapi.cloud");

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 border-b text-xs ${
        isUnpaid
          ? "bg-destructive/10 border-destructive/30 text-destructive"
          : "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300"
      }`}
    >
      {isUnpaid ? (
        <CreditCard className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <b>
          {isUnpaid
            ? "Canal WhatsApp (iGreen Chat) bloqueado por falta de pagamento."
            : "Canal iGreen Chat foi removido no painel."}
        </b>{" "}
        <span className="opacity-80">
          {isUnpaid
            ? "Nenhuma mensagem será enviada até regularizar a cobrança."
            : "Crie um canal novo e atualize o token."}
        </span>
      </div>
      <Button
        size="sm"
        variant={isUnpaid ? "destructive" : "outline"}
        onClick={() => window.open(url, "_blank")}
        className="shrink-0"
      >
        <ExternalLink className="h-3.5 w-3.5 mr-1" />
        {isUnpaid ? "Abrir billing" : "Abrir painel"}
      </Button>
    </div>
  );
}
