// Crítico de qualidade por IA — portado de vendedora/critico.ts antes de
// apagar a vendedora. Valida resposta antes de enviar.

import { chat } from "./gateway.ts";
import type { CriticoOutput, PerfilOutput, PlannerOutput } from "./types.ts";

const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você é o controle de qualidade de uma vendedora de IA da iGreen Energy. Recebe a mensagem que ela quer enviar ao lead e decide se aprova.

Regras (REPROVAR se viola QUALQUER uma):
1. > 3 linhas não-vazias OU > 600 caracteres
2. Promete vídeo, áudio, link, PDF, retorno futuro ("te ligo amanhã", "vou consultar e volto")
3. Promete obra, painel solar, visita técnica
4. Frases proibidas: "como posso te ajudar", "me conta mais", "estou à disposição"
5. Não tem fechamento (pergunta neutra, oferta de esclarecer mais, ou ponte ao próximo passo). NÃO exige pedir cadastro — preferir fechamento profissional sem pressão.
6. Tom desalinhado com o perfil do lead (ex: efusivo demais com lead irritado, infantil com cético)
7. Repete saudação quando já tem histórico
8. **TRAVA DA ETAPA**: Se a etapa é 'valor', a mensagem DEVE perguntar o valor em R$ — NÃO pode pedir foto/doc/e-mail. Se a etapa é 'simulacao', DEVE apresentar a faixa 8-20% + número — NÃO pode pedir foto. Se a etapa é 'foto_conta', DEVE pedir a foto. Se a etapa é 'nome', DEVE perguntar o nome — sem pedir outra coisa.
9. **USO DO NOME**: Se o nome do lead foi informado no contexto, a mensagem DEVE usar o nome pelo menos uma vez. (Exceto na 1ª mensagem antes do nome existir.)
10. **CAPTURA**: Se o plano pediu capturar um campo X (ex: 'valor_conta'), a pergunta da mensagem DEVE ser sobre X.

Devolva APENAS JSON:
{ "aprovado": true|false, "problemas": ["..."], "sugestao": "texto corrigido se reprovar (curto, 1-3 linhas, fechamento neutro — sem empurrar cadastro)" }`;

export async function criticar(args: {
  texto: string;
  perfil: PerfilOutput;
  jaTemHistorico: boolean;
  plano?: PlannerOutput;
  nomeLead?: string | null;
}): Promise<CriticoOutput> {
  const user = `# Perfil do lead
${JSON.stringify(args.perfil)}

# Plano atual
${args.plano ? JSON.stringify({ etapa: args.plano.etapa_atual, jogada: args.plano.proxima_jogada, capturar: args.plano.info_a_capturar }) : "(sem plano)"}

# Nome do lead (já capturado)
${args.nomeLead || "(ainda não)"}

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
  } catch (e) {
    return { aprovado: false, problemas: [`critico_falhou:${(e as Error).message.slice(0,80)}`] };
  }
}
