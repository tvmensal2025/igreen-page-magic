/**
 * Pílula de status da conexão do WhatsApp.
 * Deixa CLARO quando o WhatsApp está desconectado — antes a falha de envio
 * acontecia em silêncio. Verde = conectado; âmbar = desconectado.
 */
import { Wifi, WifiOff } from "lucide-react";

interface Props {
  connected: boolean;
}

export function WhatsAppStatusPill({ connected }: Props) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Conectado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
      <WifiOff className="h-3 w-3" />
      WhatsApp desconectado
    </span>
  );
}
