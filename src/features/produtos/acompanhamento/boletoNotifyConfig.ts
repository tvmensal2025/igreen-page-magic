/**
 * Textos/horário do aviso "boleto chegou" (editável sem redeploy).
 * Copy leigo: sem a palavra "PDF".
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
  "seu boleto de energia do mês já está ativo e disponível. Estou colocando um atalho aqui e é o boleto normal da iGreen. Mas o melhor lugar para conferir é o aplicativo iGreen Club — lá você vê a fatura e ainda vê os locais com descontos em farmácias, restaurantes, cinemas e milhares de parceiros. Abre o app, confere com calma, e se tiver dúvida, responde aqui.";

export const DEFAULT_BOLETO_NOTIFY_CONFIG: BoletoNotifyConfig = {
  id: "global",
  sync_enabled: true,
  cron_hour_brt: 8,
  cron_daily: true,
  audio_script: DEFAULT_BOLETO_AUDIO_BODY,
  wa_text: `{{saudacao}}seu boleto de *{{mes}}* já está disponível 💚

Valor: *R$ {{valor}}*
Vencimento: *{{vencimento}}*

O lugar oficial é o app *iGreen Club* — lá você vê a fatura e os descontos (farmácia e parceiros).

📱 *Baixe o app no seu celular:*

🤖 *Android — Play Store:*
{{link_play}}

🍎 *iPhone — App Store:*
{{link_appstore}}

Seu acesso no Club:
{{link_club}}

Se quiser o boleto aqui no Zap, toque em *Receber boleto* (ou digite *1*).`,
  button_boleto_label: "Receber boleto",
  button_enabled: true,
  doc_caption: "Segue seu boleto. O lugar oficial continua no app iGreen Club 👆",
};

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
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "id" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boleto-notify-config"] }),
  });
}
