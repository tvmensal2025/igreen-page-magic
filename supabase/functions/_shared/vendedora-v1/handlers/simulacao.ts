// Handler: simulacao — apresenta a faixa de desconto 8-20%.
// Usa RAG + perfil quando disponíveis para calibrar tom.

import { microWrite } from "./_micro-writer.ts";
import type { Handler } from "./_types.ts";

export const simulacaoHandler: Handler = async (ctx) => {
  const valor = Number(ctx.customer?.electricity_bill_value || 0);
  const valorFmt = valor > 0 ? `R$ ${valor.toFixed(2).replace(".", ",")}` : "sua conta";
  const tom = ctx.perfil?.perfil === "cetico"
    ? "Tom consultivo, transparente, sem exagero."
    : ctx.perfil?.perfil === "comprador"
    ? "Tom objetivo e direto."
    : ctx.perfil?.perfil === "reclamao"
    ? "Tom empático, foco em alívio da conta."
    : "Tom leve e direto.";

  const regras = `Cite a faixa 8% a 20% explicitamente. Mencione ${valorFmt} quando fizer sentido. Termine com pergunta tipo "faz sentido?". NÃO peça foto. NÃO peça documento. ${tom}`;

  const { text, modelUsed } = await microWrite({
    etapa: "simulacao",
    representante: ctx.representante,
    nomeLead: ctx.nomeLead,
    tarefa: "Apresente o desconto entre 8% e 20% ao mês na conta de luz, com base no valor já informado.",
    regrasExtras: regras,
    historyMsgs: ctx.historyMsgs,
    inboundText: ctx.inboundText,
  });

  return {
    reply: text,
    updates: {},
    stateUpdates: { simulacao_apresentada: true },
    toolsApplied: [],
    modelUsed,
  };
};
