// Templates determinísticos por etapa — última linha de defesa quando o writer
// micro de um handler falha duas vezes na validação estrutural.
//
// Mantemos duas variantes por etapa para reduzir robotização quando o fallback
// é acionado em sequência. A escolha é pseudo-aleatória por timestamp.

import type { Etapa } from "./types.ts";

type Pair = [string, string];

const TEMPLATES: Record<Etapa, Pair> = {
  interesse: [
    `Olá! 😊 Aqui é da *iGreen Energy*. Você passa a pagar *menos* todo mês na conta de luz, sem obra e sem trocar de distribuidora ⚡\nPosso te chamar como?`,
    `Oi! Aqui é da *iGreen Energy* ⚡ Te ajudo a economizar todo mês na conta de luz, sem obra nenhuma.\nQual o seu nome?`,
  ],
  nome: [
    `Pra eu te atender direitinho, qual o seu nome?`,
    `Antes da gente seguir, posso te chamar como?`,
  ],
  valor: [
    `Show{n}! Qual o *valor médio* da sua conta de luz?`,
    `Beleza{n}! Quanto vem em média a sua conta de luz por mês?`,
  ],
  simulacao: [
    `{n_prefix}com base no seu valor, o desconto fica entre *8% e 20%* ao mês ⚡\nFaz sentido pra você?`,
    `{n_prefix}seu desconto entra na faixa de *8% a 20%* todo mês na conta ⚡\nPosso seguir com o cadastro?`,
  ],
  foto_conta: [
    `{n_prefix_perfeito}me manda a *foto da sua conta de luz* 📷`,
    `{n_prefix_perfeito}preciso da *foto da última conta de luz* 📷 pode mandar aqui?`,
  ],
  doc: [
    `Agora preciso da foto da *frente do seu RG ou CNH* 📄`,
    `Falta pouco! Me manda a foto da *frente do RG ou CNH* 📄`,
  ],
  email: [
    `Pra finalizar, qual o seu melhor *e-mail* 📧?`,
    `Última info: me passa seu melhor *e-mail* 📧 pra travar seu cadastro?`,
  ],
  confirmacao: [
    `{n_prefix}posso seguir com seu cadastro agora?`,
    `{n_prefix}fechado seguir com seu cadastro?`,
  ] as Pair,
  finalizando: [
    `{n_prefix_virgula}tá tudo certo pra finalizar seu cadastro. Posso seguir?`,
    `{n_prefix_virgula}tenho tudo que preciso aqui. Finalizo seu cadastro?`,
  ],
  pos_cadastro: [
    `Cadastro feito{n}! Em breve te mando os próximos passos ✅`,
    `Pronto{n}! Já segui com seu cadastro. Em instantes te aviso os próximos passos ✅`,
  ],
};

function fill(tpl: string, nome: string | null | undefined): string {
  const n = nome ? `, *${nome}*` : "";
  const nPrefix = nome ? `${nome}, ` : "";
  const nPrefixPerfeito = nome ? `Perfeito, *${nome}*! ` : "";
  const nPrefixVirgula = nome ? `${nome}, ` : "";
  return tpl
    .replaceAll("{n_prefix_perfeito}", nPrefixPerfeito)
    .replaceAll("{n_prefix_virgula}", nPrefixVirgula)
    .replaceAll("{n_prefix}", nPrefix)
    .replaceAll("{n}", n);
}

export function templatePorEtapa(etapa: Etapa | "confirmacao", nome?: string | null): string {
  const pair = TEMPLATES[etapa as Etapa] || TEMPLATES["interesse"];
  const idx = Date.now() % 2;
  return fill(pair[idx], nome ?? null);
}

/** Validações estruturais por etapa — usadas pelos handlers antes do retry. */
export function validateReply(etapa: Etapa | "confirmacao", text: string): boolean {
  const s = String(text || "").trim();
  if (!s) return false;
  if (s.length > 600) return false;
  switch (etapa) {
    case "nome":
      return /\?/.test(s) && /nome|chamar/i.test(s);
    case "valor":
      return /\?/.test(s) && /(valor|conta|luz|R\$)/i.test(s);
    case "simulacao":
      return /8/.test(s) && /20/.test(s) && /%/.test(s) && /\?/.test(s);
    case "confirmacao":
      return /\?/.test(s);
    case "foto_conta":
      return /(foto|📷)/i.test(s) && /(conta|luz)/i.test(s);
    case "doc":
      return /(rg|cnh|doc|📄|documento)/i.test(s);
    case "email":
      return /(e-?mail|📧)/i.test(s) && /\?/.test(s);
    case "finalizando":
      return /\?/.test(s);
    case "pos_cadastro":
      return /(cadastro|pronto|✅)/i.test(s);
    case "interesse":
      return /\?/.test(s);
    default:
      return s.length > 0;
  }
}
