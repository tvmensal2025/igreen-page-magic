// Camada 2 — Planner. Decide próxima jogada usando playbook + state machine.

import { chat } from "./gateway.ts";
import { recommendedPlay } from "./playbook.ts";
import type { Etapa, FluxoBState, PerfilOutput, PlannerOutput } from "./types.ts";

const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você é o planner de uma vendedora de IA que vende energia da iGreen pelo WhatsApp.
Sua única saída é JSON estruturado. Você NÃO escreve a mensagem — só decide a próxima jogada.

REGRAS DURAS:
1. Nunca regrida etapa do funil (ex: voltar de 'simulacao' pra 'nome').
2. Se tentativas_etapa >= 3 no mesmo passo, troque a jogada OU recomende pedir humano.
3. Se objeção apareceu, ela deve estar em objecao_a_tratar.
4. Se lead pediu humano OU temperatura subiu pra >=85 e está pronto, considere oferecer cadastro express.
5. info_a_capturar lista campos que ainda faltam (ex: ["nome","valor_conta","cidade"]).

Etapas válidas: interesse, nome, valor, simulacao, foto_conta, doc, finalizando, pos_cadastro.

Devolva APENAS este JSON:
{
  "etapa_atual": "interesse|nome|valor|simulacao|foto_conta|doc|finalizando|pos_cadastro",
  "proxima_jogada": "string curta",
  "tom": "consultivo_seguro|energetico_direto|objetivo|acolhedor_firme|empatico|leve_direto|transparente",
  "info_a_capturar": ["..."],
  "objecao_a_tratar": null,
  "deve_pedir_humano": false,
  "deve_agendar_followup": false,
  "razao_da_jogada": "string curta"
}`;

export async function planejar(args: {
  state: FluxoBState;
  perfil: PerfilOutput;
  inboundText: string;
  history: string;
  knownFacts: string[];
}): Promise<PlannerOutput> {
  const rec = recommendedPlay(args.state.etapa, args.perfil.perfil);
  const userMsg = `# Estado atual da venda
${JSON.stringify(args.state, null, 2)}

# Perfil do lead (recém calculado)
${JSON.stringify(args.perfil, null, 2)}

# Fatos confirmados
${args.knownFacts.length ? args.knownFacts.map((f) => `- ${f}`).join("\n") : "(nenhum)"}

# Jogada recomendada pelo playbook (use como referência, pode discordar)
- jogada: ${rec.jogada}
- tom: ${rec.tom}
- detalhe: ${rec.detalhe}

# Histórico recente
${args.history}

# Última mensagem do lead
${args.inboundText}

Decida a próxima jogada em JSON.`;

  const r = await chat({
    model: MODEL,
    json: true,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMsg },
    ],
  });
  try {
    const parsed = JSON.parse(r.text);
    return normalize(parsed, args.state.etapa);
  } catch {
    return {
      etapa_atual: args.state.etapa,
      proxima_jogada: rec.jogada,
      tom: rec.tom,
      info_a_capturar: [],
      objecao_a_tratar: null,
      deve_pedir_humano: false,
      deve_agendar_followup: false,
      razao_da_jogada: "fallback playbook",
    };
  }
}

const ETAPAS: Etapa[] = ["interesse","nome","valor","simulacao","foto_conta","doc","finalizando","pos_cadastro"];

function normalize(p: any, currentEtapa: Etapa): PlannerOutput {
  const etapa: Etapa = ETAPAS.includes(p?.etapa_atual) ? p.etapa_atual : currentEtapa;
  // não regredir
  const curIdx = ETAPAS.indexOf(currentEtapa);
  const newIdx = ETAPAS.indexOf(etapa);
  const final = newIdx < curIdx ? currentEtapa : etapa;
  return {
    etapa_atual: final,
    proxima_jogada: String(p?.proxima_jogada || "avancar").slice(0, 80),
    tom: String(p?.tom || "consultivo_seguro").slice(0, 40),
    info_a_capturar: Array.isArray(p?.info_a_capturar) ? p.info_a_capturar.slice(0, 6).map(String) : [],
    objecao_a_tratar: p?.objecao_a_tratar ? String(p.objecao_a_tratar).slice(0, 80) : null,
    deve_pedir_humano: !!p?.deve_pedir_humano,
    deve_agendar_followup: !!p?.deve_agendar_followup,
    razao_da_jogada: String(p?.razao_da_jogada || "").slice(0, 200),
  };
}
