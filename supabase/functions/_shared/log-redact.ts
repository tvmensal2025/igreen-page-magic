// log-redact.ts — Utilitários de mascaramento de PII para logs (LGPD).
//
// Objetivo: nunca gravar conteúdo de mensagens, telefones completos ou
// e-mails de clientes em `console.*`. Os webhooks de WhatsApp recebem
// payloads com dados pessoais; estes helpers permitem manter logs úteis
// para debug (estrutura, tamanho, tipo) sem expor o conteúdo.
//
// Funções puras e sem dependências — seguras para usar em qualquer ponto.

/**
 * Mascara um telefone preservando DDI+DDD (4 primeiros) e os 2 últimos
 * dígitos. Ex: "5511987654321" -> "5511*******21". Entrada não-numérica
 * é retornada como "[tel]".
 */
export function maskPhone(input: unknown): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "[tel]";
  const head = digits.slice(0, 4);
  const tail = digits.slice(-2);
  return `${head}${"*".repeat(Math.max(0, digits.length - 6))}${tail}`;
}

/**
 * Não loga o conteúdo de uma mensagem — apenas seu tamanho. Mantém o
 * sinal de "havia texto" sem revelar o que o cliente escreveu.
 */
export function maskMessageText(input: unknown): string {
  const s = input == null ? "" : String(input);
  if (!s) return "[vazio]";
  return `[texto: ${s.length} chars]`;
}

/**
 * Redige PII dentro de uma string arbitrária:
 *   - e-mails -> [email]
 *   - sequências de 8+ dígitos (telefones/CPF/etc) -> [num]
 * Use quando precisar logar uma string que pode conter dados do cliente.
 */
export function redactPII(input: unknown): string {
  let s = input == null ? "" : String(input);
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  s = s.replace(/\d[\d.\-\s]{6,}\d/g, "[num]");
  return s;
}

/**
 * Resumo seguro de um payload de webhook (Whapi/Evolution). Em vez de
 * `JSON.stringify(body)` (que vaza telefone + texto), retorna apenas
 * metadados estruturais úteis para debug.
 */
export function summarizeWebhookBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    return { type: typeof body };
  }
  const b = body as Record<string, any>;
  const out: Record<string, unknown> = {};
  // Chaves estruturais comuns nos dois provedores.
  if ("event" in b) out.event = typeof b.event === "object" ? Object.keys(b.event ?? {}) : b.event;
  if ("type" in b) out.type = b.type;
  if ("channel_id" in b) out.channel_id = b.channel_id;
  if ("instance" in b) out.instance = b.instance;
  if ("event_type" in b) out.event_type = b.event_type;

  // Contagem de mensagens (Whapi: messages[]; Evolution: data{}).
  const msgs = Array.isArray(b.messages) ? b.messages : null;
  if (msgs) {
    out.messagesCount = msgs.length;
    out.messageTypes = Array.from(new Set(msgs.map((m: any) => m?.type ?? "?")));
    out.fromMe = msgs.map((m: any) => Boolean(m?.from_me));
  }
  if (b.data && typeof b.data === "object") {
    out.dataKeys = Object.keys(b.data);
    if (b.data?.messageType) out.messageType = b.data.messageType;
  }
  out.topLevelKeys = Object.keys(b);
  return out;
}
