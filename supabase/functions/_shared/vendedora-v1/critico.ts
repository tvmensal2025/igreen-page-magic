// Camada 5 — Crítico. Valida resposta antes de enviar.

import { chat } from "./gateway.ts";
import type { CriticoOutput, PerfilOutput } from "./types.ts";

const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você é o controle de qualidade de uma vendedora de IA da iGreen Energy. Recebe a mensagem que ela quer enviar ao lead e decide se aprova.

Regras (REPROVAR se viola QUALQUER uma):
1. > 3 linhas não-vazias OU > 600 caracteres
2. Promete vídeo, áudio, link, PDF, retorno futuro ("te ligo amanhã", "vou consultar e volto")
3. Promete obra, painel solar, visita técnica
4. Frases proibidas: "como posso te ajudar", "me conta mais", "estou à disposição"
5. Não tem CTA (pergunta ou pedido de ação) ao final
6. Tom desalinhado com o perfil do lead (ex: efusivo demais com lead irritado, infantil com cético)
7. Repete saudação quando já tem histórico

Devolva APENAS JSON:
{ "aprovado": true|false, "problemas": ["..."], "sugestao": "texto corrigido se reprovar" }`;

export async function criticar(args: {
  texto: string;
  perfil: PerfilOutput;
  jaTemHistorico: boolean;
}): Promise<CriticoOutput> {
  const user = `# Perfil do lead
${JSON.stringify(args.perfil)}

# Já houve conversa antes?
${args.jaTemHistorico ? "sim" : "não"}

# Mensagem proposta
${args.texto}`;

  try {
    const r = await chat({
      model: MODEL,
      json: true,
      temperature: 0.1,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    });
    const parsed = JSON.parse(r.text);
    return {
      aprovado: !!parsed.aprovado,
      problemas: Array.isArray(parsed.problemas) ? parsed.problemas.slice(0, 5).map(String) : [],
      sugestao: parsed.sugestao ? String(parsed.sugestao).slice(0, 800) : undefined,
    };
  } catch {
    return { aprovado: true, problemas: [] };
  }
}
