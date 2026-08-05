/**
 * Freio de ping-pong: para a troca automática quando ela vira loop.
 *
 * Por que existe (caso Ethos, 2026-08-04): a URA de outra empresa reapresentava
 * o menu a cada resposta nossa e as duas máquinas trocaram ~15 mensagens em 2
 * minutos. O detector de robô (`auto-responder-detect.ts`) resolve os formatos
 * conhecidos, mas ele é uma lista de assinaturas: sempre vai existir uma URA
 * nova com texto que ninguém previu.
 *
 * Este freio não olha o TEXTO, olha o RITMO. Nenhuma conversa humana precisa de
 * oito respostas automáticas em dez minutos; quando isso acontece, ou é robô ou
 * a automação não está resolvendo o problema da pessoa. Nos dois casos a ação
 * certa é a mesma: parar de responder sozinho e chamar gente.
 *
 * Não encerra a conversa — pausa por algumas horas. Se for lead real, o
 * consultor assume; se for robô, economizamos cota e evitamos o ban.
 */

export const PING_PONG_PAUSE_REASON = "ping_pong_guard";

/** Janela e limiar calibrados no caso real (15 mensagens em 2 min). */
export const PING_PONG_WINDOW_MINUTES = 10;
export const PING_PONG_MAX_AUTO_REPLIES = 8;
export const PING_PONG_PAUSE_HOURS = 3;

export interface PingPongInput {
  /** Respostas automáticas nossas na janela (não conta envio manual do consultor). */
  autoRepliesInWindow: number;
  /** Mensagens recebidas do contato na janela. */
  inboundInWindow: number;
  /** Humano já assumiu — o freio não se aplica, quem responde é gente. */
  humanTookOver?: boolean;
  /** Bot já está pausado por outro motivo — não sobrescreve. */
  alreadyPaused?: boolean;
  /** Houve progresso real no funil na janela (mudou de passo, mandou foto, valor…). */
  progressed?: boolean;
  maxAutoReplies?: number;
}

export interface PingPongVerdict {
  brake: boolean;
  reason?: "loop_sem_progresso";
  autoReplies?: number;
}

export function decidePingPongBrake(input: PingPongInput): PingPongVerdict {
  if (input.humanTookOver || input.alreadyPaused) return { brake: false };

  // Progresso no funil significa que as respostas estão servindo para algo.
  if (input.progressed) return { brake: false };

  const limite = input.maxAutoReplies ?? PING_PONG_MAX_AUTO_REPLIES;
  const auto = Number(input.autoRepliesInWindow) || 0;
  const inbound = Number(input.inboundInWindow) || 0;

  // Exige os dois lados: só nossas mensagens (ex.: cadência) não é ping-pong.
  if (auto < limite || inbound < limite) return { brake: false };

  return { brake: true, reason: "loop_sem_progresso", autoReplies: auto };
}

/** Momento até quando o bot fica em silêncio depois do freio. */
export function pingPongPauseUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + PING_PONG_PAUSE_HOURS * 60 * 60_000).toISOString();
}

/**
 * Lê a janela recente do contato e decide. Fail-open: qualquer erro de banco
 * devolve `brake: false` — o freio nunca pode calar um lead por falha nossa.
 *
 * Calibração (30 dias, 226 contatos): com o limiar atual freia 1 conversa, e
 * é o robô da URA. Nenhum lead real entra no filtro porque quem avança no
 * cadastro muda de passo dentro da janela.
 */
export async function evaluatePingPongForCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    customerId: string;
    humanTookOver?: boolean;
    alreadyPaused?: boolean;
    now?: Date;
  },
): Promise<PingPongVerdict> {
  try {
    const now = opts.now ?? new Date();
    const desde = new Date(now.getTime() - PING_PONG_WINDOW_MINUTES * 60_000).toISOString();
    const { data, error } = await supabase
      .from("conversations")
      .select("message_direction, conversation_step")
      .eq("customer_id", opts.customerId)
      .gte("created_at", desde)
      .limit(200);
    if (error || !Array.isArray(data)) return { brake: false };

    let auto = 0;
    let inbound = 0;
    const passos = new Set<string>();
    for (const r of data as Array<{ message_direction: string; conversation_step: string | null }>) {
      if (r.message_direction === "outbound") auto++;
      else inbound++;
      if (r.conversation_step) passos.add(r.conversation_step);
    }

    return decidePingPongBrake({
      autoRepliesInWindow: auto,
      inboundInWindow: inbound,
      humanTookOver: opts.humanTookOver,
      alreadyPaused: opts.alreadyPaused,
      progressed: passos.size > 1,
    });
  } catch {
    return { brake: false };
  }
}
