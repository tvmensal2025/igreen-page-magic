// Resposta DIRETA do FAQ (sem LLM) para o Fluxo B IA.
//
// Quando a mensagem do cliente casa com um gatilho/intenção cadastrado em
// `bot_flow_qa_triggers`, devolvemos o `text_response` EXATO da base — sem
// gerar texto pela IA. Isso:
//   1) Reduz custo (zero chamada de LLM nesse turno).
//   2) Garante congruência (a resposta é sempre a oficial, sem variação nem
//      números inventados).
//
// Só é usado para mensagens de TEXTO. Mídia (foto da conta), botões e
// saudações de abertura continuam indo pelo LLM (que controla o avanço do
// fluxo e os marcadores [PEDIR_FOTO_CONTA]/[FINALIZAR_CADASTRO]).

const STOPWORDS = new Set([
  "nao", "sim", "ok", "oi", "ola", "eai", "opa", "e", "a", "o", "de", "da",
  "do", "que", "pra", "para", "com", "meu", "minha", "um", "uma", "isso",
]);

// Gatilhos de UMA palavra que, isolados, casam contextos errados com frequência
// (ex.: "anos" em "tenho 30 anos"; "sair" em "vou sair agora"; "data" em "que
// data é hoje"). Não removemos da base — apenas ignoramos no match DIRETO, pra
// não responder a intenção errada. Quando aparecem, o LLM cuida com contexto.
const GATILHOS_GENERICOS_IGNORADOS = new Set([
  "anos", "data", "sair", "região", "regiao", "prazo", "obra",
]);

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Casa uma frase-gatilho contra a mensagem do cliente. Mesma lógica do knowledge-lookup. */
function phraseMatches(phraseRaw: string, messageRaw: string): boolean {
  const phrase = normalizeText(phraseRaw);
  const message = normalizeText(messageRaw);
  if (!phrase || phrase.length < 2 || !message) return false;
  if (message === phrase) return true;
  const singleWord = !phrase.includes(" ");
  if (singleWord) {
    if (STOPWORDS.has(phrase)) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(message);
  }
  // Frase com várias palavras. Gatilhos genéricos formados só por stopwords
  // (ex.: "quem é") NÃO devem casar por conteúdo — geram falso positivo
  // ("quem é o dono" casaria "Nunca ouvi falar"). Exige ao menos 1 palavra
  // significativa.
  const palavrasSignificativas = phrase.split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (palavrasSignificativas.length === 0) {
    // Só casa se a mensagem for praticamente idêntica ao gatilho.
    return message === phrase;
  }
  if (phrase.length >= 8 && message.includes(phrase)) return true;
  // Mensagem curta contida na frase-gatilho (ex.: "é golpe" vs "isso é golpe?").
  return message.length <= 12 && phrase.includes(message);
}

export type RespostaDireta = {
  texto: string;
  intentName: string;
  triggerMatched: string;
};

/** Substitui {{nome}} pelo primeiro nome do cliente (ou remove com elegância). */
function aplicarNome(texto: string, nome: string | null): string {
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  if (primeiro) {
    return texto.replace(/\{\{\s*nome\s*\}\}/gi, primeiro);
  }
  // Sem nome: ", {{nome}}" / " {{nome}}" somem; "{{nome}}" vira "você".
  return texto
    .replace(/,?\s*\{\{\s*nome\s*\}\}/gi, "")
    .replace(/\{\{\s*nome\s*\}\}/gi, "você");
}

/**
 * Procura uma resposta direta no FAQ do consultor. Retorna `null` quando não
 * há match confiável (aí o caller cai no LLM normalmente).
 */
export async function buscarRespostaDiretaFaq(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  consultantId: string | null | undefined,
  inboundText: string | null,
  customerName: string | null,
): Promise<RespostaDireta | null> {
  const pergunta = String(inboundText || "").trim();
  // Mensagens muito curtas/genéricas (oi, ok, sim) não devem casar FAQ.
  if (pergunta.length < 3) return null;
  if (!consultantId) return null;

  try {
    // 1) Flows ativos do consultor.
    const { data: flows } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true);
    const flowIds = ((flows as Array<{ id: string }>) || []).map((f) => f.id);
    if (flowIds.length === 0) return null;

    // 2) QAs com resposta (ignora aberturas).
    const { data: qaRows } = await supabase
      .from("bot_flow_qa")
      .select("id, intent_name, text_response, is_opening")
      .in("flow_id", flowIds)
      .eq("is_opening", false);
    const qas = ((qaRows as Array<{ id: string; intent_name: string; text_response: string | null; is_opening: boolean }>) || [])
      .filter((q) => q.text_response && String(q.text_response).trim().length > 0);
    if (qas.length === 0) return null;

    const qaById = new Map(qas.map((q) => [q.id, q]));

    // 3) Gatilhos desses QAs.
    const { data: triggers } = await supabase
      .from("bot_flow_qa_triggers")
      .select("qa_id, phrase")
      .in("qa_id", qas.map((q) => q.id));

    const lista = (triggers as Array<{ qa_id: string; phrase: string }>) || [];

    // Pontua cada gatilho que casa e escolhe o de MAIOR especificidade.
    // Especificidade = nº de palavras significativas do gatilho (gatilho com
    // mais palavras é mais específico) e, como desempate, o comprimento.
    // Isso evita que um gatilho curto e genérico ("quem é") roube uma pergunta
    // mais específica ("quem é o dono", que casa o gatilho "dono").
    const candidatos: Array<{ qa_id: string; phrase: string; score: number; intent: string }> = [];
    for (const t of lista) {
      const qa = qaById.get(t.qa_id);
      if (!qa) continue;
      if (GATILHOS_GENERICOS_IGNORADOS.has(normalizeText(t.phrase))) continue;
      if (!phraseMatches(t.phrase, pergunta)) continue;
      const norm = normalizeText(t.phrase);
      const palavras = norm.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
      const score = palavras.length * 100 + norm.length;
      candidatos.push({ qa_id: t.qa_id, phrase: t.phrase, score, intent: qa.intent_name });
    }
    if (candidatos.length === 0) return null;

    candidatos.sort((a, b) => b.score - a.score);
    const melhor = candidatos[0];

    // ─── Anti-ambiguidade ────────────────────────────────────────────────
    // Se o melhor empata em score com outro candidato de INTENÇÃO diferente
    // (ex.: "multa" casa "Fidelidade/multa" E "E se eu atrasar"; "quanto tempo"
    // casa duas intenções), não há como ter certeza de qual responder. Nesse
    // caso NÃO respondemos direto — caímos no LLM, que usa o histórico para
    // desambiguar. Evita mandar a resposta errada com cara de oficial.
    const empatados = candidatos.filter((c) => c.score === melhor.score);
    const intencoesEmpatadas = new Set(empatados.map((c) => c.intent));
    if (intencoesEmpatadas.size > 1) {
      console.log(`[fluxo-b-ia] FAQ ambíguo (${[...intencoesEmpatadas].join(" / ")}) — caindo no LLM`);
      return null;
    }

    const qa = qaById.get(melhor.qa_id)!;
    const texto = aplicarNome(String(qa.text_response), customerName);
    if (!texto.trim()) return null;

    return { texto, intentName: qa.intent_name, triggerMatched: melhor.phrase };
  } catch (_e) {
    // Fail-open: qualquer erro → null (segue para o LLM).
    return null;
  }
}
