/**
 * N10 — Registro de decisão em modo sombra (pt-BR). Tarefa 8.1.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça "N10 — Métricas de sombra".
 * Requisitos: 3.1, 3.2, 3.4 (e reúso de tabela — 17.3).
 *
 * O QUE FAZ
 * ---------
 * A cada turno em Modo_Sombra, grava UMA linha em `ai_decisions` contendo:
 *   - o passo/ação decidido pelo CÉREBRO (resultado do N1 — `ResultadoCerebro`);
 *   - o passo/ação do SISTEMA ATUAL no MESMO turno (informado por quem chama);
 *   - uma FLAG DE COINCIDÊNCIA entre os dois (Requisito 3.4).
 *
 * COMO COMPARA (Requisito 3.4 + definição objetiva de N10)
 * --------------------------------------------------------
 * A coincidência compara PASSO/AÇÃO — NUNCA o texto exato da mensagem (que é
 * subjetivo). Coincide quando, no mesmo turno, o próximo passo E a ação
 * determinística (responder, pedir foto/OCR, finalizar/portal, OTP, handoff)
 * são os mesmos nos dois lados.
 *
 * REÚSO DA TABELA (Requisito 17.3)
 * --------------------------------
 * NÃO cria tabela equivalente. Reusa `ai_decisions` (que já existe) mapeando os
 * campos para colunas reais:
 *   - `phase`          → marca o modo sombra do Cérebro (`cerebro_sombra`);
 *   - `source`         → origem da decisão (`cerebro_dark`);
 *   - `tool_called`    → ação determinística decidida pelo Cérebro;
 *   - `step_before`    → passo atual (antes do turno) na visão do Cérebro;
 *   - `step_after`     → próximo passo decidido pelo Cérebro;
 *   - `intent_detected`→ intenção comercial do turno;
 *   - `suppressed`     → `true` (em sombra NADA é enviado ao cliente);
 *   - `reply_sent`     → `null` (em sombra não há mensagem enviada);
 *   - `ai_output`      → objeto de comparação completo + a FLAG `coincide`.
 * Como `ai_decisions` não tem coluna booleana de coincidência, a flag vive no
 * campo JSON existente `ai_output` (preferir campo existente a criar coluna —
 * Requisito 17).
 *
 * INTEGRAÇÃO (Tarefa 9 — modo sombra no webhook)
 * ----------------------------------------------
 * Esta peça é PURA quanto a I/O de rede: recebe o `supabase` por parâmetro e só
 * faz um `insert`. A N1/webhook chamará `registrarDecisaoSombra(...)` quando
 * `flow_engine_v3 = dark`. NÃO é ligada no webhook agora (só a estrutura).
 *
 * SEGURANÇA
 * ---------
 * Best-effort: nunca lança. Uma falha de gravação não pode derrubar o turno
 * (mesmo espírito de `_shared/ai-decisions.ts`). Em erro, devolve `ok: false`
 * mas ainda informa a flag de coincidência calculada.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AcaoCadastroDeferida,
  DecisaoCerebro,
  ResultadoCerebro,
} from "./tipos.ts";

/**
 * Ação determinística de um turno, normalizada para comparação entre o Cérebro
 * e o sistema atual. É o vocabulário ÚNICO usado na flag de coincidência.
 *   - `responder`      → enviar uma mensagem de texto ao cliente;
 *   - `ocr`            → pedir/processar foto (conta ou documento);
 *   - `portal_submit`  → enviar/finalizar cadastro no portal;
 *   - `otp_submit`     → validar OTP;
 *   - `handoff`        → transferir para atendente humano;
 *   - `nenhuma`        → nada a fazer neste turno.
 */
export type AcaoTurno =
  | "responder"
  | "ocr"
  | "portal_submit"
  | "otp_submit"
  | "handoff"
  | "nenhuma";

/**
 * Resumo passo/ação de um turno — a unidade de comparação de N10. Ambos os
 * lados (Cérebro e sistema atual) são reduzidos a este formato antes de
 * comparar. `passo` é o identificador do próximo passo/etapa (normalizado por
 * quem chama, para que os vocabulários sejam comparáveis); `acao` é a ação
 * determinística.
 */
export interface ResumoDecisaoTurno {
  /** Próximo passo/etapa decidido no turno (id ou rótulo). `null` se nenhum. */
  passo: string | null;
  /** Ação determinística decidida no turno. */
  acao: AcaoTurno;
}

/** Entrada do registrador de decisão em sombra. */
export interface EntradaRegistroDecisao {
  supabase: SupabaseClient;
  consultantId: string;
  customerId: string;
  /** Decisão completa do Cérebro neste turno (saída do N1 — Orquestrador). */
  decisaoCerebro: ResultadoCerebro;
  /**
   * Passo/ação que o SISTEMA ATUAL produziu no MESMO turno. Quem chama (a
   * N1/webhook em modo sombra) normaliza a saída do sistema atual para este
   * formato, de modo que os passos sejam comparáveis.
   */
  decisaoSistemaAtual: ResumoDecisaoTurno;
  /** Texto cru recebido do cliente (auditoria). Opcional. */
  inboundText?: string | null;
  /** Canal do webhook que originou o turno. Opcional. */
  channel?: "evolution" | "whapi" | null;
  /** Latência do turno em milissegundos. Opcional. */
  latencyMs?: number | null;
}

/** Resultado do registro: status da gravação + flag de coincidência calculada. */
export interface ResultadoRegistroDecisao {
  /** `true` se a linha foi gravada em `ai_decisions`. */
  ok: boolean;
  /** Flag de coincidência calculada (Requisito 3.4), independente de `ok`. */
  coincide: boolean;
}

/** Limite de tamanho para campos de texto (espelha `ai-decisions.ts`). */
function trunc(v: string | null | undefined, n: number): string | null {
  if (v == null) return null;
  return v.length > n ? v.slice(0, n) : v;
}

/**
 * Deriva o resumo passo/ação do Cérebro a partir do `ResultadoCerebro` (saída
 * do N1). A ação é decidida por prioridade determinística:
 *   1) `handoff`        quando o turno termina em transferência;
 *   2) ação de cadastro (`ocr`/`portal_submit`/`otp_submit`) quando o motor
 *      repassou uma `DeferredAction` de cadastro;
 *   3) `responder`      quando há mensagem aprovada para o cliente;
 *   4) `nenhuma`        caso contrário.
 * O `passo` é o próximo passo decidido pelo motor (`proximoPassoId`).
 */
export function resumirDecisaoCerebro(
  resultado: ResultadoCerebro,
): ResumoDecisaoTurno {
  const acao = acaoDoCerebro(resultado);
  return {
    passo: resultado.decisao.proximoPassoId,
    acao,
  };
}

/** Escolhe a `AcaoTurno` do Cérebro segundo a prioridade documentada acima. */
function acaoDoCerebro(resultado: ResultadoCerebro): AcaoTurno {
  if (resultado.shouldHandoff) return "handoff";
  if (resultado.acaoCadastro) return acaoCadastroParaTurno(resultado.acaoCadastro);
  if (resultado.reply && resultado.reply.trim().length > 0) return "responder";
  if (resultado.outbound && resultado.outbound.length > 0) return "responder";
  return "nenhuma";
}

/** Mapeia a `DeferredAction` de cadastro para o vocabulário de `AcaoTurno`. */
function acaoCadastroParaTurno(acao: AcaoCadastroDeferida): AcaoTurno {
  // `acao.kind` já é um de `ocr` | `portal_submit` | `otp_submit`.
  return acao.kind;
}

/**
 * Compara passo/ação dos dois lados (Requisito 3.4). Coincide quando a ação é a
 * mesma E o próximo passo é o mesmo. A comparação de passo trata `null` como um
 * valor (ambos `null` → iguais).
 */
export function decisoesCoincidem(
  cerebro: ResumoDecisaoTurno,
  sistemaAtual: ResumoDecisaoTurno,
): boolean {
  return cerebro.acao === sistemaAtual.acao &&
    cerebro.passo === sistemaAtual.passo;
}

/**
 * Grava o Registro_Decisao de sombra em `ai_decisions` (Requisitos 3.1, 3.2,
 * 3.4) reusando a tabela existente (Requisito 17.3). Best-effort: nunca lança.
 *
 * @returns `{ ok, coincide }` — `ok` indica se a linha foi gravada; `coincide`
 *   é a flag calculada (útil para métricas e testes), válida mesmo se `ok`
 *   for `false`.
 */
export async function registrarDecisaoSombra(
  entrada: EntradaRegistroDecisao,
): Promise<ResultadoRegistroDecisao> {
  const {
    supabase,
    consultantId,
    customerId,
    decisaoCerebro,
    decisaoSistemaAtual,
    inboundText,
    channel,
    latencyMs,
  } = entrada;

  const resumoCerebro = resumirDecisaoCerebro(decisaoCerebro);
  const coincide = decisoesCoincidem(resumoCerebro, decisaoSistemaAtual);
  const decisao: DecisaoCerebro = decisaoCerebro.decisao;

  // Objeto de comparação completo gravado no campo JSON existente `ai_output`
  // (Requisito 3.2 — decisão do Cérebro + saída do sistema atual; Requisito 3.4
  // — flag de coincidência). Preferimos o JSON existente a criar coluna nova.
  const aiOutput = {
    modo: "sombra" as const,
    cerebro: {
      passoAtualId: decisao.passoAtualId,
      proximoPassoId: resumoCerebro.passo,
      acao: resumoCerebro.acao,
      intencao: decisao.intencao,
      reparo: decisao.reparo ?? null,
      shouldHandoff: decisaoCerebro.shouldHandoff,
    },
    sistema_atual: {
      passo: decisaoSistemaAtual.passo,
      acao: decisaoSistemaAtual.acao,
    },
    coincide,
  };

  const row = {
    consultant_id: consultantId,
    customer_id: customerId,
    phase: "cerebro_sombra",
    source: "cerebro_dark",
    // Ação determinística do Cérebro (não o texto da mensagem — N10).
    tool_called: trunc(resumoCerebro.acao, 100),
    step_before: trunc(decisao.passoAtualId, 200),
    step_after: trunc(resumoCerebro.passo, 200),
    intent_detected: trunc(decisao.intencao, 100),
    // Em sombra NADA é enviado ao cliente (Requisito 3.3): suprimido e sem reply.
    suppressed: true,
    reply_sent: null,
    user_input: trunc(inboundText ?? null, 2000),
    latency_ms: latencyMs ?? null,
    channel: trunc(channel ?? null, 20),
    ai_output: aiOutput,
  };

  try {
    const { error } = await supabase.from("ai_decisions").insert(row);
    if (error) {
      console.warn("[cerebro/registro-decisao] insert falhou:", error.message);
      return { ok: false, coincide };
    }
    return { ok: true, coincide };
  } catch (e) {
    console.warn(
      "[cerebro/registro-decisao] erro inesperado (best-effort):",
      (e as { message?: string })?.message,
    );
    return { ok: false, coincide };
  }
}
