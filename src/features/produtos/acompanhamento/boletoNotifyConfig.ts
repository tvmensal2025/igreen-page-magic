/**
 * Textos/horário do aviso "boleto chegou" (editável sem redeploy).
 * Copy leigo: sem a palavra "PDF".
 * Toggles: áudio / texto; botão arquivo opcional; apps Android/iOS sempre.
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
  send_audio: boolean;
  send_text: boolean;
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

A iGreen cuida do envio oficial do boleto. Aqui o nosso recado é te lembrar e te levar ao lugar mais completo: o app *iGreen Club*.

Seu acesso no Club:
{{link_club}}

Qualquer dúvida, responde aqui 💚`,
  send_audio: true,
  send_text: true,
  button_boleto_label: "Receber boleto",
  button_enabled: false,
  doc_caption: "Segue seu boleto. O lugar oficial continua no app iGreen Club 👆",
};

/** Espelha `supabase/functions/_shared/boleto-notify.ts`. */
export function buildAppStoreInviteMessage(linkClub?: string | null): string {
  const club = String(linkClub || "https://club.igreenenergy.com.br/").trim();
  return `📱 *Baixe o iGreen Club no celular:*

🤖 *Android — Play Store:*
${IGREEN_CLUB_PLAY_STORE_URL}

🍎 *iPhone — App Store:*
${IGREEN_CLUB_APP_STORE_URL}

Seu acesso no Club:
${club}`;
}

export function buildBoletoButtonPrompt(buttonLabel?: string | null): string {
  const label = String(buttonLabel || "Receber boleto").trim() || "Receber boleto";
  return `Quer o boleto aqui no Zap? É só tocar em *${label}* 👇`;
}

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
      const row = (data || {}) as Partial<BoletoNotifyConfig>;
      return {
        ...DEFAULT_BOLETO_NOTIFY_CONFIG,
        ...row,
        send_audio: row.send_audio !== false,
        send_text: row.send_text !== false,
        button_enabled: row.button_enabled === true,
      };
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
