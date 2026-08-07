/**
 * Textos/horário do aviso "boleto chegou" (editável sem redeploy).
 * Copy leigo: sem a palavra "PDF".
 * Toggles: áudio / texto; botão arquivo opcional; apps Android/iOS sempre.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  doDaConsultor,
  oAConsultor,
  possessiveConsultantFallback,
  resolveAssistantDisplayName,
  resolveConsultantRoleGender,
  firstNameFromPublicConsultant,
} from "@/lib/consultantPublicLabel";

export type BoletoImagePosition = "first" | "after_audio" | "after_text" | "last";

export const BOLETO_IMAGE_POSITION_LABELS: Array<{
  value: BoletoImagePosition;
  label: string;
}> = [
  { value: "first", label: "Primeiro (antes do áudio)" },
  { value: "after_audio", label: "Depois do áudio" },
  { value: "after_text", label: "Depois do texto" },
  { value: "last", label: "Por último (depois dos apps)" },
];

export type BoletoNotifyConfig = {
  id: string;
  sync_enabled: boolean;
  cron_hour_brt: number;
  cron_daily: boolean;
  audio_script: string;
  wa_text: string;
  send_audio: boolean;
  send_text: boolean;
  send_image: boolean;
  image_url: string | null;
  image_caption: string;
  image_position: BoletoImagePosition;
  button_boleto_label: string;
  button_enabled: boolean;
  doc_caption: string;
};

/** Apps oficiais iGreen Club (canônico: worker-club/APP-LINKS-CLIENTE.md). */
export const IGREEN_CLUB_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect";
export const IGREEN_CLUB_APP_STORE_URL =
  "https://apps.apple.com/br/app/igreen-club/id6444493340";

export const BOLETO_APP_ANDROID_BUTTON_ID = "boleto_app_android";
export const BOLETO_APP_IOS_BUTTON_ID = "boleto_app_ios";

/**
 * Corpo do áudio. Abertura canônica “Olá, Nome! Tudo bem?” é prefixada no envio.
 * {{assistente}} = IA do consultor · {{posse_consultor}} / {{chamar_consultor}} = nome dele.
 */
export const DEFAULT_BOLETO_AUDIO_BODY =
  `Aqui é {{assistente}}, assistente virtual {{posse_consultor}}, e estou passando com uma notícia importante: o seu boleto de energia deste mês já está disponível!

A iGreen realiza o envio oficial do boleto, mas o jeito mais seguro, rápido e completo de acompanhar tudo é pelo aplicativo iGreen Club.

Acesse o app para conferir a sua fatura, a data de vencimento e aproveitar descontos especiais em farmácias, restaurantes, cinemas e milhares de estabelecimentos parceiros.

E olha que notícia incrível: hoje, já somos mais de oitocentas mil pessoas economizando com a iGreen! É muita gente economizando junto!

Se precisar de ajuda, é só chamar {{chamar_consultor}}. Até mais!`;

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

Qualquer dúvida, responde aqui 💚`,
  send_audio: true,
  send_text: true,
  send_image: false,
  image_url: null,
  image_caption: "",
  image_position: "first",
  button_boleto_label: "Receber boleto",
  button_enabled: false,
  doc_caption: "Segue seu boleto. O lugar oficial continua no app iGreen Club 👆",
};

export function normalizeBoletoImagePosition(raw: unknown): BoletoImagePosition {
  const s = String(raw || "").trim().toLowerCase();
  return BOLETO_IMAGE_POSITION_LABELS.some((p) => p.value === s)
    ? (s as BoletoImagePosition)
    : "first";
}

/** Só https — o WhatsApp precisa baixar a imagem. */
export function normalizeBoletoImageUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return /^https:\/\/\S+$/i.test(s) ? s : null;
}

export function shouldSendBoletoImage(
  cfg: Pick<BoletoNotifyConfig, "send_image" | "image_url">,
): boolean {
  return cfg.send_image === true && !!normalizeBoletoImageUrl(cfg.image_url);
}

/** Espelha `_shared/boleto-notify.ts`: boleto quitado não gera aviso. */
export function isBoletoStatusPago(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("pago") ||
    s.includes("baixad") ||
    s.includes("liquidad") ||
    s.includes("quitad")
  );
}

/** Espelha `_shared/boleto-notify.ts`: acesso pelo e-mail, nunca link com id. */
export function normalizeClubAccessEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

export function buildClubAccessLine(emailAcesso?: string | null): string {
  const email = normalizeClubAccessEmail(emailAcesso);
  if (email) return `Seu acesso é o e-mail *${email}*`;
  return "Para entrar, use o e-mail do seu cadastro.";
}

export function buildAppStoreButtonsPrompt(emailAcesso?: string | null): string {
  return `📱 *Baixe o iGreen Club* — qual celular você usa?

${buildClubAccessLine(emailAcesso)}

Toque no botão 👇`;
}

export function buildAppStoreNumberedMessage(emailAcesso?: string | null): string {
  return `📱 *Baixe o iGreen Club — escolha seu celular:*

*1.* 🤖 *Android* (Play Store)
${IGREEN_CLUB_PLAY_STORE_URL}

*2.* 🍎 *iPhone* (App Store)
${IGREEN_CLUB_APP_STORE_URL}

${buildClubAccessLine(emailAcesso)}

_Digite *1* ou *2*, ou toque no link._`;
}

export function boletoAppStoreChoiceOptions(): Array<{ id: string; title: string }> {
  return [
    { id: BOLETO_APP_ANDROID_BUTTON_ID, title: "Android" },
    { id: BOLETO_APP_IOS_BUTTON_ID, title: "iPhone" },
  ];
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

/** Espelha a edge: IA + nome do consultor dono. */
export function resolveBoletoAudioConsultantVars(opts: {
  assistantName?: string | null;
  consultantName?: string | null;
  consultantDisplayName?: string | null;
  consultantGender?: string | null;
}): { assistente: string; posse_consultor: string; chamar_consultor: string } {
  const assistente = resolveAssistantDisplayName(opts.assistantName);
  const gender = resolveConsultantRoleGender(
    opts.consultantGender,
    opts.consultantName || opts.consultantDisplayName,
  );
  const first = firstNameFromPublicConsultant(
    opts.consultantName,
    opts.consultantDisplayName,
  );
  const doDa = doDaConsultor(gender);
  const oA = oAConsultor(gender);
  if (first) {
    return {
      assistente,
      posse_consultor: `${doDa} ${first}`,
      chamar_consultor: `${oA} ${first}`,
    };
  }
  const posse = possessiveConsultantFallback(gender);
  return {
    assistente,
    posse_consultor: `${doDa} ${posse}`,
    chamar_consultor: posse,
  };
}

export function renderBoletoAudioBody(
  audioBody: string,
  vars: { assistente: string; posse_consultor: string; chamar_consultor: string },
): string {
  return String(audioBody || DEFAULT_BOLETO_AUDIO_BODY)
    .replace(/\{\{assistente\}\}/gi, vars.assistente)
    .replace(/\{\{posse_consultor\}\}/gi, vars.posse_consultor)
    .replace(/\{\{chamar_consultor\}\}/gi, vars.chamar_consultor)
    .replace(/\{\{consultor\}\}/gi, vars.chamar_consultor)
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
        send_image: row.send_image === true,
        image_url: normalizeBoletoImageUrl(row.image_url),
        image_caption: String(row.image_caption || ""),
        image_position: normalizeBoletoImagePosition(row.image_position),
        button_enabled: row.button_enabled === true,
      };
    },
  });
}

export function useUpdateBoletoNotifyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<BoletoNotifyConfig>) => {
      const payload = {
        id: "global",
        ...DEFAULT_BOLETO_NOTIFY_CONFIG,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      const { data: updated, error: updErr } = await supabase
        .from("boleto_notify_config" as never)
        .update(payload as never)
        .eq("id", "global")
        .select("id");
      if (updErr) throw updErr;
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        const { error: insErr } = await supabase
          .from("boleto_notify_config" as never)
          .insert(payload as never);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boleto-notify-config"] }),
  });
}
