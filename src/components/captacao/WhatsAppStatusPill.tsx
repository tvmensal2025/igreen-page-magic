/**
 * Pílula de status da conexão do WhatsApp.
 * Deixa CLARO quando o WhatsApp está desconectado — antes a falha de envio
 * acontecia em silêncio. Verde = conectado; âmbar = desconectado.
 * No mobile conectado: só o dot (economiza faixa do cockpit).
 */
import { WifiOff } from "lucide-react";

interface Props {
  connected: boolean;
}

export function WhatsAppStatusPill({ connected }: Props) {
  if (connected) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-1 sm:px-2.5 text-[11px] font-medium text-primary shrink-0"
        title="WhatsApp conectado"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="hidden sm:inline">Conectado</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-1 sm:px-2.5 text-[11px] font-medium text-warning shrink-0"
      title="WhatsApp desconectado"
    >
      <WifiOff className="h-3 w-3" />
      <span className="sm:hidden">Desconectado</span>
      <span className="hidden sm:inline">WhatsApp desconectado</span>
    </span>
  );
}
