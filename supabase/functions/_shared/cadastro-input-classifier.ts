/**
 * Classificador conservador de inputs DURANTE o pipeline de cadastro.
 *
 * Cada step do cadastro tem um OBJETIVO único (capturar e-mail, confirmar
 * telefone, receber foto da conta, responder SIM/NÃO, etc.). Enquanto o lead
 * está num desses steps, o caminho determinístico (bot-flow.ts) é o ÚNICO que
 * sabe validar a resposta esperada — o Cérebro NUNCA pode interpretar o input
 * esperado e responder algo que confunda o cliente no meio da etapa.
 *
 * Esta função decide:
 *   - "expected"          → entrega ao determinístico (regra padrão, segura)
 *   - "freeform_question" → o lead claramente perguntou OUTRA coisa,
 *                            fora do objetivo do step → o Cérebro pode
 *                            responder em modo readOnly (sem mexer no estado)
 *
 * Política: default = "expected". Só vira "freeform_question" quando há sinal
 * forte de pergunta livre (texto > 3 palavras, marcador interrogativo, e SEM
 * casar com o objetivo do step). Mídia, botão, áudio e texto curto NUNCA
 * viram freeform.
 */

export type CadastroInputKind = "expected" | "freeform_question";

export interface ClassifyCadastroInputArgs {
  stepBefore: string;
  text: string | null;
  isButton: boolean;
  hasImage: boolean;
  hasDocument: boolean;
  hasAudio: boolean;
}

// Marcadores que indicam que o texto ATENDE ao objetivo do step. Se bater,
// vai ao determinístico — mesmo que esteja malformado, o handler valida e
// re-pergunta.
const STEP_OBJECTIVE: Record<string, RegExp> = {
  ask_email:                 /@|email|e-?mail|arroba/i,
  capture_email:             /@|email|e-?mail|arroba/i,
  ask_phone_confirm:         /\d{8,}|whats|telefone|n[uú]mero|celular|confirm|sim|n[aã]o/i,
  confirm_phone:             /\d{8,}|whats|telefone|n[uú]mero|celular|confirm|sim|n[aã]o/i,
  ask_phone:                 /\d{8,}|whats|telefone|n[uú]mero|celular/i,
  ask_name:                  /^[\p{L}\s'.-]{2,}$/u,
  ask_cpf:                   /\d{3}/,
  ask_rg:                    /\d{3}/,
  ask_birth_date:            /\d{2}/,
  ask_cep:                   /\d{4,5}/,
  ask_number:                /\d/,
  ask_complement:            /^[\p{L}\d\s.,'-]{1,}$/u,
  ask_installation_number:   /\d{3,}/,
  ask_distribuidora:         /[a-z]{3,}/i,
  ask_bill_value:            /\d/,
  confirmando_dados_conta:   /^(sim|nao|n[aã]o|n|s|editar|corrigir|est[aá]\s*certo|ok|ta certo|tá certo)/i,
  confirmando_dados_doc:     /^(sim|nao|n[aã]o|n|s|editar|corrigir|est[aá]\s*certo|ok|ta certo|tá certo)/i,
  confirmar_titularidade:    /^(sim|nao|n[aã]o|n|s|eu|outra|outro|terceiro|titular)/i,
  aguardando_conta:          /conta|luz|energia|foto|fatura|enviei|mandei|j[aá]\s*mandei/i,
  aguardando_doc_auto:       /doc|rg|cnh|identidade|foto|enviei|mandei/i,
  aguardando_doc_frente:     /doc|rg|cnh|identidade|frente|foto|enviei|mandei/i,
  aguardando_doc_verso:      /doc|rg|cnh|identidade|verso|foto|enviei|mandei/i,
  ask_tipo_documento:        /rg|cnh|carteira|identidade|habilita|^[1-3]$/i,
  ask_doc_frente_manual:     /doc|rg|cnh|frente|foto|enviei|mandei/i,
  ask_doc_verso_manual:      /doc|rg|cnh|verso|foto|enviei|mandei/i,
  ask_quero_cadastrar:       /^(sim|nao|n[aã]o|n|s|quero|cadastr|bora|vamos|ok|pode)/i,
  ask_finalizar:             /^(sim|nao|n[aã]o|n|s|finaliza|terminar|ok|pode|envia)/i,
  finalizando:               /^(sim|nao|n[aã]o|n|s|ok|pode)/i,
};

const QUESTION_MARK = /[?¿]/;
const QUESTION_WORDS =
  /\b(quanto|como|porqu[eê]|por\s*que|pq|quando|onde|qual|quais|posso|vou|tenho que|[eé]\s*seguro|funciona|cobra|gr[aá]tis|gratuito|desconto|valor|pre[cç]o|economia|economizo|economizar|risco|seguran[cç]a|d[uú]vida)\b/i;

/**
 * Decide se o input do lead deve ir para o determinístico (esperado) ou se é
 * uma pergunta claramente off-topic que o Cérebro pode atender (sem mexer no
 * estado do cadastro).
 *
 * Regras (nessa ordem):
 *   1. Botão, mídia, áudio, vazio → "expected".
 *   2. Texto com ≤ 3 palavras → "expected".
 *   3. Texto casa com o objetivo do step → "expected".
 *   4. Texto tem sinal forte de pergunta livre (`?` ou palavra interrogativa)
 *      → "freeform_question".
 *   5. Caso contrário → "expected" (padrão seguro).
 */
export function classifyCadastroInput(args: ClassifyCadastroInputArgs): CadastroInputKind {
  if (args.isButton || args.hasImage || args.hasDocument || args.hasAudio) {
    return "expected";
  }

  const raw = (args.text || "").trim();
  if (!raw) return "expected";

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return "expected";

  const objective = STEP_OBJECTIVE[args.stepBefore];
  if (objective && objective.test(raw)) return "expected";

  const hasQuestionMark = QUESTION_MARK.test(raw);
  const hasQuestionWord = QUESTION_WORDS.test(raw);
  if (hasQuestionMark || hasQuestionWord) return "freeform_question";

  return "expected";
}
