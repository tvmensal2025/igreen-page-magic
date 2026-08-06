/**
 * Textos/horário do aviso "boleto chegou" (editável sem redeploy).
 * Copy leigo: sem a palavra "PDF".
 * Produto: só aviso + iGreen Club (empresa já manda o boleto no Zap).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BoletoNotifyConfig = {
  id: string;
  sync_enabled: boolean;
  cron_hour_brt: number;
  cron_daily: boolean;
  audio_script: string;
  wa_text: string;
  button_boleto_label: string;
  button_enabled: boolean;
  doc_caption: string;
};

/** Apps oficiais iGreen Club (canônico: worker-club/APP-LINKS-CLIENTE.md). */
export const IGREEN_CLUB_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect";
export const IGREEN_CLUB_APP_STORE_URL =
  "https://apps.apple.com/br/app/igreen-club/id6444493340";

/** Corpo do áudio (abertura “Olá, Nome! Tudo bem?” é prefixada no envio). */
export const DEFAULT_BOLETO_AUDIO_BODY =
  "seu boleto de energia do mês já está disponível. A iGreen cuida do envio oficial do boleto — e o lugar mais seguro e completo para você acompanhar tudo é o aplicativo iGreen Club. Lá você confere a fatura, o vencimento e ainda aproveita descontos em farmácias, restaurantes, cinemas e milhares de parceiros. Baixa o app, entra com o seu acesso e fica tranquilo. Qualquer dúvida, é só responder aqui.";

export const DEFAULT_BOLETO_NOTIFY_CONFIG: BoletoNotifyConfig = {
  id: "global",
  sync_enabled: true,
  cron_hour_brt: 8,
  cron_daily: true,
  audio_script: DEFAULT_BOLETO_AUDIO_BODY,
  wa_text: `{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚

Valor: *R$ {{valor}}*
Vencimento: *{{vencimento}}*

A iGreen cuida do envio oficial do boleto. Aqui o nosso recado é te lembrar e te levar ao lugar mais completo: o app *iGreen Club* — fatura, vencimento e descontos em farmácia, restaurantes e milhares de parceiros.

📱 *Baixe o app:*

🤖 *Android — Play Store:*
{{link_play}}

🍎 *iPhone — App Store:*
{{link_appstore}}

Seu acesso no Club:
{{link_club}}

Qualquer dúvida, responde aqui 💚`,
  button_boleto_label: "Receber boleto",
  button_enabled: false,
  doc_caption: "Segue seu boleto. O lugar oficial continua no app iGreen Club 👆",
};

/** Remove CTA legado de botão/arquivo do corpo (configs antigas). */
export function stripBoletoButtonCta(waText: string): string {
  return String(waText || "")
    .split("\n")
    .filter((line) => !/(toque|clique|digite|responda)[^\n]*\b(receber\s+boleto|\*1\*)\b/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function useBoletoNotifyConfig() {
  return useQuery({
    queryKey: ["boleto-notify-config"],
    staleTime: 30_000,
    queryFn: async (): Promise<BoletoNotifyConfig> => {
      const { data, error } = await supabase
        .from("boleto_notify_config" as never)
        .select("*")
        .eq("id", "global")
        .maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_BOLETO_NOTIFY_CONFIG, ...(data as object || {}) } as BoletoNotifyConfig;
    },
  });
}

export function useUpdateBoletoNotifyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<BoletoNotifyConfig>) => {
      const { error } = await supabase
        .from("boleto_notify_config" as never)
        .upsert(
          {
            id: "global",
            ...patch,
            // Produto: nunca religar o botão de arquivo pelo card.
            button_enabled: false,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "id" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boleto-notify-config"] }),
  });
}
