/**
 * Contratos de tipo do Cérebro IA (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seção "Components and Interfaces".
 *
 * REÚSO (Requisito 1.3, 1.4, 17.1): este arquivo NUNCA duplica tipos que já
 * existem no motor determinístico. Ele apenas REFERENCIA os tipos públicos de
 * `engine/types.ts` (via `import type`) e descreve, por cima deles, os
 * contratos das peças novas do Cérebro (N1 a N8).
 *
 * Nenhuma função vive aqui — apenas tipos e interfaces. As peças do núcleo
 * importam estes contratos para que cada uma possa ser testada de forma
 * isolada (Requisito 7.4).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Reúso dos tipos do motor (engine v3) — nunca duplicar ───────────────────
//
// Importamos `type` apenas; o Cérebro fica SEMPRE por fora do `runEngine`
// (que é função pura). Estes são os contratos reais já definidos e testados
// em `engine/types.ts`.
import type {
  BotFlowStep,
  ChannelCapabilities,
  CustomerSnapshot,
  DeferredAction,
  EngineOutput,
  InboundEvent,
  OutboundMessage,
} from "../engine/types.ts";

// Reexportamos a superfície que as peças do Cérebro consomem, para que elas
// importem tudo a partir de `cerebro/tipos.ts` sem alcançar `engine/types.ts`
// diretamente.
export type {
  BotFlowStep,
  ChannelCapabilities,
  CustomerSnapshot,
  DeferredAction,
  EngineOutput,
  InboundEvent,
  OutboundMessage,
};

// ─── N2 — Entendimento ───────────────────────────────────────────────────────

/**
 * Conjunto PEQUENO e FECHADO de intenções comerciais (Requisito 4.1, 4.5).
 * Evita catálogo amplo de intenções (ideia: Botpress). Qualquer mensagem que
 * não caia em uma destas é classificada como `indefinido` (Requisito 4.4).
 */
export type IntencaoComercial =
  | "demonstrar_interesse"
  | "pedir_simulacao"
  | "levantar_objecao"
  | "pedir_humano"
  | "desistir"
  | "indefinido";

/**
 * Tipo da objeção classificada quando o cliente levanta uma (Requisito 4.3).
 * Conjunto fechado, ajustável conforme os padrões observados em sombra.
 */
export type TipoObjecao =
  | "preco"
  | "desconfianca"
  | "sem_tempo"
  | "ja_tem_solucao"
  | "nao_entendeu"
  | "outro";

/**
 * Dados de cadastro citados na mensagem do cliente (Requisito 4.2). Extraídos
 * REUSANDO os extratores existentes (`captureExtractors.ts`,
 * `vendedora/extractors.ts`); aqui só descrevemos o formato consolidado.
 * Campos ausentes ficam indefinidos — nunca preenchidos por suposição.
 */
export interface DadosExtraidos {
  nome?: string;
  valorConta?: number;
  email?: string;
  /** Outros campos extraídos, mantidos crus para o Decisor/Estado tratarem. */
  outros?: Record<string, unknown>;
}

/** Entrada da peça N2 (Entendimento). */
export interface EntradaEntendimento {
  inboundText: string;
  historico: string[];
  estado: CustomerSnapshot;
}

/** Saída da peça N2 (Entendimento). */
export interface ResultadoEntendimento {
  intencao: IntencaoComercial;
  dados: DadosExtraidos;
  objecao?: TipoObjecao;
}

// ─── N8 — Estado / Memória ───────────────────────────────────────────────────

/**
 * Camadas de memória separadas (Requisito 20.1): sessão (resumo da conversa
 * atual), perfil (dados estáveis), operacional (cadastro/pendências) e a base
 * de conteúdo institucional (consultada via RAG, fora deste objeto).
 */
export interface MemoriaEmCamadas {
  /** Resumo da conversa atual (reusa `conversation_summary`). */
  sessao: string | null;
  /** Dados estáveis do cliente (reusa campos do cliente). */
  perfil: Record<string, unknown>;
  /** Cadastro, pendências e próximos passos. */
  operacional: Record<string, unknown>;
}

/** Estado consolidado lido pela peça N8, com as camadas de memória. */
export interface EstadoCerebro {
  snapshot: CustomerSnapshot;
  memoria: MemoriaEmCamadas;
}

/** Entrada de leitura da peça N8. */
export interface EntradaLeituraEstado {
  supabase: SupabaseClient;
  customerId: string;
}

/**
 * Entrada de escrita campo a campo da peça N8 (Requisito 5.2): apenas os
 * campos presentes em `patch` são alterados, preservando os demais.
 */
export interface EntradaEscritaEstado {
  supabase: SupabaseClient;
  customerId: string;
  patch: Partial<CustomerSnapshot>;
}

/** Confirmação de escrita da peça N8. */
export interface ConfirmacaoEscritaEstado {
  ok: boolean;
  /** Campos efetivamente alterados nesta escrita. */
  camposAlterados: string[];
}

// ─── N3 — Decisor de Passo ───────────────────────────────────────────────────

/**
 * Padrão de reparo aplicado pelo Decisor quando o cliente foge do passo
 * esperado (Requisito 6.5, 6.6, 6.7). Ideia: padrões CALM (`patterns.yml`).
 */
export type TipoReparo =
  | "correcao_dado"
  | "duvida_fora_de_hora"
  | "cancelamento";

/**
 * Tipos de `DeferredAction` que representam o PIPELINE DE CADASTRO
 * (Requisito 6.1): OCR da conta/documento, envio ao portal e validação de OTP.
 * São exatamente as ações que o dispatcher existente (`_shared/dispatcher/` +
 * hooks de OCR/portal/OTP) sabe executar. O Cérebro NUNCA executa OCR nem
 * chama o worker do portal por conta própria — apenas REPASSA estas ações.
 * As demais (`ai_answer`/`ai_decide`) são tratadas pela escrita (N4), não aqui.
 */
export type TipoAcaoCadastro = "ocr" | "portal_submit" | "otp_submit";

/** Entrada da peça N3 (Decisor de Passo). */
export interface EntradaDecisor {
  supabase: SupabaseClient;
  customerId: string;
  inbound: InboundEvent;
  entendimento: ResultadoEntendimento;
  capabilities: ChannelCapabilities;
}

/**
 * Saída da peça N3. A ORDEM dos passos vem sempre do `runEngine`
 * (Requisito 6.1, 6.2): `passoAtual`/`proximoPasso` derivam de
 * `bot_flow_steps`; `acaoDeterministica` é o que o motor já produz (incluindo
 * `DeferredAction` para OCR/portal/OTP, repassada ao dispatcher existente).
 *
 * REPASSE DO PIPELINE DE CADASTRO (Tarefa 4.4 — Requisito 6.1): quando o motor
 * produz uma `DeferredAction` de cadastro (`ocr`, `portal_submit`,
 * `otp_submit`), o Decisor a EXPÕE em `acaoCadastro` — JÁ EXTRAÍDA e tipada —
 * para que a N1 (Orquestrador) a encaminhe ao dispatcher EXISTENTE. A peça N3
 * permanece PURA quanto ao despacho: ela não executa OCR/portal/OTP; só
 * sinaliza o que deve ser despachado. Quando o turno não tem ação de cadastro
 * (ou a deferred é `ai_answer`/`ai_decide`, tratada por N4), `acaoCadastro`
 * fica indefinida.
 */
export interface ResultadoDecisor {
  passoAtual: BotFlowStep | null;
  proximoPasso: BotFlowStep | null;
  /** Saída bruta do motor determinístico, repassada sem reescrever. */
  acaoDeterministica: EngineOutput;
  /**
   * Ação do pipeline de cadastro (`ocr`/`portal_submit`/`otp_submit`) extraída
   * de `acaoDeterministica.deferred` para a N1 repassar ao dispatcher. NUNCA
   * executada aqui (Requisito 6.1). Indefinida quando não há ação de cadastro.
   */
  acaoCadastro?: AcaoCadastroDeferida;
  /** Reparo aplicado neste turno, se houve. */
  reparo?: TipoReparo;
}

/**
 * `DeferredAction` do pipeline de cadastro, restringida aos tipos que o
 * dispatcher existente executa (`ocr`/`portal_submit`/`otp_submit`). É um
 * subconjunto de `DeferredAction` do motor — sem duplicar formato. Serve de
 * "envelope de repasse": a N1 recebe isto e chama o caminho existente
 * (`_shared/dispatcher/` + hooks), igual ao engine v3.
 */
export type AcaoCadastroDeferida = Extract<
  DeferredAction,
  { kind: TipoAcaoCadastro }
>;

// ─── N4 — Escritor ───────────────────────────────────────────────────────────

/** Entrada da peça N4 (Escritor). */
export interface EntradaEscritor {
  passoAtual: BotFlowStep | null;
  entendimento: ResultadoEntendimento;
  estado: EstadoCerebro;
  /** Texto recuperado da base de conteúdo via RAG. */
  ragText: string;
  memoria: MemoriaEmCamadas;
  /** Persona do consultor (reusa `ai_persona_fluxo_b`/`ai_agent_config`). */
  persona: string | null;
}

/** Saída da peça N4. O Escritor NÃO decide passo (Requisito 8.1). */
export interface ResultadoEscritor {
  texto: string;
}

// ─── N5 — Guarda de Segurança ────────────────────────────────────────────────

/** Entrada da peça N5 (Guarda de Segurança). */
export interface EntradaGuarda {
  textoProposto: string;
  passoAtual: BotFlowStep | null;
  estado: CustomerSnapshot;
}

/**
 * Saída da peça N5. Ponto ÚNICO de verificação antes do envio (Requisito 9.7):
 * pode bloquear (`aprovado = false`) ou ajustar o texto (glossário, remoção de
 * conteúdo técnico) devolvendo em `textoFinal`.
 */
export interface ResultadoGuarda {
  aprovado: boolean;
  textoFinal: string;
  motivoBloqueio?: string;
}

// ─── N1 — Orquestrador ───────────────────────────────────────────────────────

/** Entrada da porta de entrada única do Cérebro (N1). */
export interface EntradaCerebro {
  supabase: SupabaseClient;
  customerId: string;
  consultantId: string;
  inbound: InboundEvent;
  canalCapabilities: ChannelCapabilities;
}

/**
 * Decisão consolidada do turno, registrada em `ai_decisions` para comparação
 * em modo sombra (Requisito 3.1, 3.2). Não compara texto exato, e sim o
 * passo/ação decidido (ver N10 no design).
 */
export interface DecisaoCerebro {
  passoAtualId: string | null;
  proximoPassoId: string | null;
  intencao: IntencaoComercial;
  reparo?: TipoReparo;
}

/** Saída da peça N1 (Orquestrador). */
export interface ResultadoCerebro {
  /** Texto final aprovado pela Guarda (vazio quando há handoff/sombra). */
  reply: string;
  outbound: OutboundMessage[];
  stateUpdate: Partial<CustomerSnapshot>;
  shouldHandoff: boolean;
  decisao: DecisaoCerebro;
  /**
   * Ação do pipeline de cadastro (`ocr`/`portal_submit`/`otp_submit`) decidida
   * pelo motor neste turno e REPASSADA pela N1 para que QUEM CHAMAR o Cérebro
   * (o webhook futuro) acione o dispatcher EXISTENTE (`_shared/dispatcher/` +
   * hooks de OCR/portal/OTP). O Orquestrador NUNCA executa OCR/portal/OTP aqui
   * (Requisito 6.1, 16.5) — apenas compõe o resultado. Indefinida quando o
   * turno não tem ação de cadastro a despachar.
   */
  acaoCadastro?: AcaoCadastroDeferida;
}
