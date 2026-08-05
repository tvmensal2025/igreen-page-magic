import { formatBrazilPhone } from "@/lib/phone";

/**
 * Formata telefone BR para rodapé do flyer (+55 (DD) …).
 *
 * Delega ao canônico `formatBrazilPhone`, que normaliza ANTES de formatar.
 * A versão anterior só fatiava os dígitos: `553484314317` (celular gravado sem
 * o nono dígito) virava "+55 (34) 8431-4317" — número que não existe — enquanto
 * o QR do mesmo flyer apontava para `5534984314317`. Papel impresso não tem
 * conserto, então o rodapé precisa completar o 9 igual ao resto do sistema.
 */
export function formatFlyerPhoneDisplay(phone: string): string {
  return formatBrazilPhone(phone);
}
