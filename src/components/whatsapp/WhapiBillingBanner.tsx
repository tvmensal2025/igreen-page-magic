import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, AlertTriangle } from "lucide-react";
import type { WhapiReasonCode } from "@/hooks/useWhapiHealth";

interface Props {
  enabled: boolean;
  /** Reusa o health do WhatsAppTab — evita segundo poller de whapi-proxy. */
  reasonCode?: WhapiReasonCode;
  helpUrl?: string | null;
}

/**
 * Banner global mostrado no topo do WhatsApp Tab quando o canal Whapi
 * está bloqueado por falta de pagamento ou foi removido no painel.
 * Visível em qualquer sub-aba (Dashboard, Conversas, Envio em massa, etc.)
 * para o Super Admin não perder tempo trocando token quando o problema é financeiro.
 */
export function WhapiBillingBanner({ enabled, reasonCode = null, helpUrl = null }: Props) {
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
            ? "Canal WhatsApp bloqueado por falta de pagamento."
            : "Canal WhatsApp foi removido no painel."}
        </b>{" "}
        {isUnpaid
          ? "Renove no painel Whapi para voltar a enviar."
          : "Verifique o canal no painel Whapi."}
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-[11px]">
        <a href={url} target="_blank" rel="noopener noreferrer">
          Abrir painel <ExternalLink className="h-3 w-3" />
        </a>
      </Button>
    </div>
  );
}
