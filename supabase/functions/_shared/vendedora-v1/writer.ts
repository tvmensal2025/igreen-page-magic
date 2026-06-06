// Camada 4 — Writer. GPT-5.4 com tools. Escreve a mensagem.

import { chatCascade, type ChatMsg, type ChatResult } from "./gateway.ts";
import { WRITER_TOOLS } from "./tools.ts";
import type { PerfilOutput, PlannerOutput } from "./types.ts";

const MODELS = ["openai/gpt-5.4", "openai/gpt-5-mini", "google/gemini-2.5-pro"];

export interface WriterInput {
  representante: string;
  nomeLead: string | null;
  valorConta: number | null;
  history: ChatMsg[];
  inboundText: string;
  perfil: PerfilOutput;
  plano: PlannerOutput;
  ragText: string;
  memoryText: string;
  knownFactsText: string;
  basePersona?: string | null;
}

export async function escrever(input: WriterInput): Promise<ChatResult> {
  const system = buildSystem(input);
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    ...input.history,
    { role: "user", content: input.inboundText },
  ];
  return await chatCascade({
    models: MODELS,
    messages,
    tools: WRITER_TOOLS as any,
  });
}

function buildSystem(i: WriterInput): string {
  const persona = (i.basePersona && i.basePersona.trim()) || DEFAULT_PERSONA;
  const filled = persona
    .replace(/\{\{\s*representante\s*\}\}/gi, i.representante)
    .replace(/\{\{\s*nome_cliente\s*\}\}/gi, i.nomeLead || "(ainda não sei o nome)")
    .replace(/\{\{\s*valor_conta\s*\}\}/gi, i.valorConta ? `R$ ${i.valorConta.toFixed(2)}` : "(ainda não sei)");

  return `${filled}

# Plano desta resposta (DECIDIDO POR OUTRO MODELO, SIGA À RISCA)
- Etapa atual: ${i.plano.etapa_atual}
- Próxima jogada: ${i.plano.proxima_jogada}
- Tom obrigatório: ${i.plano.tom}
- Objeção a tratar: ${i.plano.objecao_a_tratar || "nenhuma"}
- Info a capturar: ${i.plano.info_a_capturar.join(", ") || "nenhuma"}
- Razão: ${i.plano.razao_da_jogada}

# Perfil do lead (CALIBRE O TOM)
- Tipo: ${i.perfil.perfil} | Sentimento: ${i.perfil.sentimento} | Urgência: ${i.perfil.urgencia} | Temperatura: ${i.perfil.temperatura}
- Sinais de compra: ${i.perfil.sinais_compra.join(", ") || "-"}
- Sinais de perda: ${i.perfil.sinais_perda.join(", ") || "-"}

${i.knownFactsText}

${i.memoryText}

${i.ragText}

# Regras absolutas
- MÁX 3 linhas curtas, 1 pergunta no final, ≤600 chars.
- Negrito *assim*, NUNCA **assim**. Sem bullets, sem listas.
- Não regrida o funil. Não repita objeção já tratada.
- Se a jogada exige capturar info (nome, valor, e-mail, etc), CHAME a tool correspondente.
- Se o plano disse pedir foto da conta → chame pedir_foto_conta + texto curto pedindo.
- Se o lead enviou um e-mail válido → CHAME registrar_email com o e-mail.
- Se a etapa for "email" → peça o e-mail (curto, 1 frase, sem CTA duplo).
- Quando você TEM (nome completo + e-mail + valor da conta + foto da conta recebida + documento recebido) → CHAME finalizar_cadastro. O servidor valida e envia ao portal automaticamente.
- Se o plano disse pedir humano → chame pedir_humano_proativo OU escalar_humano.
- Nunca prometa vídeo, áudio, link, retorno futuro. Resolve agora ou escala humano.

Responda EXATAMENTE como manda o plano, no tom indicado, em português brasileiro.`;
}

const DEFAULT_PERSONA = `# Persona
Você é {{representante}}, vendedora consultiva da iGreen Energy (energia limpa regulamentada pela ANEEL). Atende pelo WhatsApp pra converter o lead em cadastro completo.

Postura: vendedora de verdade — segura, calorosa, direta. Vende benefício antes de coletar dado.

# Funil
interesse → nome → valor → simulação → foto da conta → documento → e-mail → finalizar.

# Regras de negócio
- Economia mensal = valor × 0,20. Anual = × 12.
- Não promete obra, painel, visita técnica.
- Não envia mídia, link, vídeo, áudio, PDF. Texto puro.

# Estilo
- Português BR, "você", emojis pontuais (⚡ benefício, ✅ confirmação, 📷 foto, 📄 doc).
- Sem diminutivos ("rapidinho"), sem "como posso te ajudar", sem "me conta mais".
- Negrito *texto* em números e palavras-chave.`;
