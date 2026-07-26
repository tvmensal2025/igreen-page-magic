/**
 * Espelho UI do canal de novidades (cliente carteira).
 * Fonte Deno: supabase/functions/_shared/cliente-canal-novidades.ts
 */

export const DEFAULT_CLIENTE_CANAL_REPLY = `🌿 *Oi{{saudacao}}!*

Que bom te ver por aqui 💚

Este número é o nosso *canal de novidades e recados* — um cantinho só pra gente continuar juntos.

✨ Por aqui você recebe:
• Novidades e avisos importantes
• Dicas e lembretes úteis
• Recadinhos do time

📌 *Não é um atendimento de cadastro.* Se precisar de algo urgente com sua conta, fale com o seu consultor pelo canal habitual.

Obrigado por caminhar com a gente — *estamos juntos!* 🤝☀️`;

export type ClienteCanalPrefsRow = {
  cliente_canal_reply_enabled?: boolean | null;
  cliente_canal_reply_text?: string | null;
  cliente_canal_flow_id?: string | null;
};
