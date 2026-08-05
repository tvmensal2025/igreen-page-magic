/**
 * Última barreira antes de um texto virar mensagem no WhatsApp do cliente.
 *
 * Por que existe (incidente 2026-08-04): a busca em base de conhecimento
 * (`knowledge-lookup.ts`) devolve o conteúdo da seção CRU, sem passar por LLM.
 * Uma das seções cadastradas era o próprio prompt da IA ("INTRODUÇÃO — Você é
 * a assistente virtual da iGreen Energy, especializada em ajudar licenciados…").
 * Resultado: 6 leads receberam o manual interno da assistente, e outros 4
 * receberam `{{nome}}` sem substituir, no meio da frase.
 *
 * O problema de fundo não é a seção ruim — é que qualquer texto colado no
 * admin virava mensagem sem ninguém conferir. Esta guarda inverte isso: o
 * conteúdo precisa PARECER uma resposta ao cliente para ser enviado. Quando
 * não parece, o chamador trata como "não encontrei" (segue para o LLM, para o
 * passo padrão ou para o humano) em vez de despejar texto interno no lead.
 *
 * Filosofia oposta à do detector de robô: aqui preferimos NÃO enviar em caso
 * de dúvida, porque um silêncio é recuperável e uma mensagem constrangedora
 * já chegou no celular do cliente.
 */

export type UnsafeReason =
  /** Placeholder de template que não foi substituído: `{{nome}}`, `{primeiro_nome}`. */
  | "placeholder_nao_substituido"
  /** Texto escrito para a IA, não para o cliente ("Você é a assistente…"). */
  | "instrucao_de_sistema"
  /** Sobrou estrutura de máquina: JSON, chaves do schema, marcação de papel. */
  | "formato_de_maquina";

export interface SafetyVerdict {
  safe: boolean;
  reason?: UnsafeReason;
  /** Trecho que motivou o bloqueio — vai para o log, nunca para o cliente. */
  evidence?: string;
}

const RULES: Array<{ reason: UnsafeReason; re: RegExp }> = [
  // `{{nome}}`, `{{ primeiro_nome }}`, `{{valor}}`
  { reason: "placeholder_nao_substituido", re: /\{\{\s*[\w.\-]+\s*\}\}/ },
  // `${nome}` de template literal que escapou
  { reason: "placeholder_nao_substituido", re: /\$\{\s*[\w.\-]+\s*\}/ },

  // Instrução dirigida ao modelo.
  { reason: "instrucao_de_sistema", re: /\bvoc[êe]\s+[ée]\s+(a|o|um[a]?)\s+(assistente|atendente|vendedora?|consultora?|bot|ia|agente)\b/i },
  { reason: "instrucao_de_sistema", re: /\bregras?\s+(r[íi]gidas?|do\s+sistema|obrigat[óo]rias?)\b/i },
  // Sem `\b` depois de "é": em JS a fronteira de palavra é ASCII e não casa
  // após acento.
  { reason: "instrucao_de_sistema", re: /\bsua\s+miss[ãa]o\s+[ée]\s/i },
  { reason: "instrucao_de_sistema", re: /\bresponda\s+sempre\s+em\s+portugu[êe]s\b/i },
  { reason: "instrucao_de_sistema", re: /\bnunca\s+(invente|mencione|use\s+outro\s+nome)\b/i },
  { reason: "instrucao_de_sistema", re: /^\s*(introdu[çc][ãa]o|persona|contexto|instru[çc][õo]es|system)\s*:?\s*$/im },

  // Estrutura de máquina vazando.
  { reason: "formato_de_maquina", re: /\bretorne\s+json\b/i },
  { reason: "formato_de_maquina", re: /\bshouldHandoff\b|\bconfidence\s*:\s*0?\.\d/i },
  { reason: "formato_de_maquina", re: /^\s*\{\s*"(text|role|content|type)"\s*:/m },
  { reason: "formato_de_maquina", re: /\b(role|system|assistant)\s*:\s*["'`]/i },
  { reason: "formato_de_maquina", re: /###\s*\w+[\s\S]{0,40}###\s*\w+/ },
];

/**
 * `text` é apresentável para o cliente final?
 *
 * Não julga qualidade de escrita nem tamanho — só barra o que claramente
 * pertence aos bastidores.
 */
export function checkCustomerSafeText(text: string | null | undefined): SafetyVerdict {
  const t = String(text ?? "");
  if (!t.trim()) return { safe: true };
  for (const rule of RULES) {
    const hit = rule.re.exec(t);
    if (hit) {
      return {
        safe: false,
        reason: rule.reason,
        evidence: String(hit[0] || "").slice(0, 80),
      };
    }
  }
  return { safe: true };
}

/** Atalho booleano para gates. */
export function isCustomerSafeText(text: string | null | undefined): boolean {
  return checkCustomerSafeText(text).safe;
}
