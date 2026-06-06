// Templates V2 — fallbacks determinísticos + validador estrutural.
import type { Etapa } from "./types.ts";

export const TRAVA_POR_ETAPA: Record<Etapa, string> = {
  interesse: "Faça a ABERTURA: apresentação curta + benefício (pagar menos sem obra) + pergunte 'posso te chamar como?'. PROIBIDO pedir valor/foto/doc/e-mail.",
  nome: "Pergunte o NOME do lead. 1 pergunta. PROIBIDO pedir outra coisa.",
  valor: "Pergunte o VALOR MÉDIO DA CONTA EM R$. PROIBIDO pedir foto/doc/e-mail nem dar simulação ainda.",
  simulacao: "Apresente faixa *8% a 20%* + número (valor × 0,20) + pergunta consultiva tipo 'faz sentido?'. PROIBIDO pedir foto/doc/e-mail.",
  foto_conta: "Peça a foto da conta de luz 📷. PROIBIDO pedir doc/e-mail.",
  doc: "Peça a foto da frente do RG ou CNH 📄. PROIBIDO pedir e-mail.",
  email: "Peça o e-mail do lead 📧. PROIBIDO pedir outras coisas.",
  finalizando: "Confirme os dados de forma curta e diga que vai finalizar.",
  pos_cadastro: "Agradeça e diga que vai mandar os próximos passos. PROIBIDO pedir mais dados.",
};

export function fallbackPorEtapa(etapa: Etapa, nome?: string | null, valor?: number | null): string {
  const n = nome ? `, *${nome}*` : "";
  switch (etapa) {
    case "interesse": return `Olá! 😊 Aqui é da *iGreen Energy*. Você passa a pagar *menos* todo mês na conta de luz, sem obra e sem trocar de distribuidora ⚡\nPosso te chamar como?`;
    case "nome":      return `Pra eu te atender direitinho, qual o seu nome?`;
    case "valor":     return `Show${n}! Qual o *valor médio* da sua conta de luz?`;
    case "simulacao": {
      const eco = valor ? ` Daria cerca de *R$ ${(valor * 0.2).toFixed(0)}/mês* de economia.` : "";
      return `${nome ? `${nome}, com base no seu valor, ` : "Com base no seu valor, "}o desconto fica *entre 8% e 20%* ao mês ⚡${eco}\nFaz sentido pra você?`;
    }
    case "foto_conta":  return `${nome ? `Perfeito${n}! ` : ""}Me manda a *foto da sua conta de luz* 📷`;
    case "doc":         return `Agora preciso da foto da *frente do seu RG ou CNH* 📄`;
    case "email":       return `Pra finalizar, qual o seu melhor *e-mail* 📧?`;
    case "finalizando": return `${nome ? `${nome}, ` : ""}tá tudo certo pra finalizar seu cadastro. Posso seguir?`;
    case "pos_cadastro":return `Cadastro feito${n}! Em breve te mando os próximos passos ✅`;
  }
}

/** Validador estrutural barato — pega problemas óbvios sem chamar LLM. */
export function validarResposta(texto: string, etapa: Etapa, nomeLead: string | null): { ok: boolean; motivo?: string } {
  const t = String(texto || "").trim();
  if (!t) return { ok: false, motivo: "vazio" };
  if (t.length > 600) return { ok: false, motivo: "longo" };
  const linhas = t.split("\n").filter((l) => l.trim()).length;
  if (linhas > 4) return { ok: false, motivo: "muitas_linhas" };
  if (/\b(te ligo|te retorno|volto amanh|envio um v[ií]deo|mando o link|mando o pdf)\b/i.test(t)) {
    return { ok: false, motivo: "promessa_proibida" };
  }
  if (/como posso te ajudar|me conta mais|estou [aà] disposi/i.test(t)) {
    return { ok: false, motivo: "frase_proibida" };
  }

  // Travas por etapa — heurística simples mas eficaz
  if (etapa === "nome" && !/\?$|\?\s/m.test(t)) return { ok: false, motivo: "nome_sem_pergunta" };
  if (etapa === "valor" && !/valor|conta|r\$|quanto|paga/i.test(t)) return { ok: false, motivo: "valor_fora_de_tema" };
  if (etapa === "simulacao" && !/8\s*%|20\s*%|desconto|economia|r\$/i.test(t)) return { ok: false, motivo: "simulacao_sem_numero" };
  if (etapa === "foto_conta" && !/foto|conta|📷|imagem/i.test(t)) return { ok: false, motivo: "foto_fora_de_tema" };
  if (etapa === "doc" && !/rg|cnh|documento|📄/i.test(t)) return { ok: false, motivo: "doc_fora_de_tema" };
  if (etapa === "email" && !/e-?mail|📧|@/i.test(t)) return { ok: false, motivo: "email_fora_de_tema" };

  // Usa nome se tem histórico
  if (nomeLead && etapa !== "interesse" && !new RegExp(nomeLead.split(/\s+/)[0], "i").test(t)) {
    // Não bloqueia — só penaliza, mas mantém ok=true (handler pode reescrever)
  }
  return { ok: true };
}
