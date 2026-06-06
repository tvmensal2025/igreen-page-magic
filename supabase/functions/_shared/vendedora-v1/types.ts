// Tipos compartilhados da Vendedora v1.

// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

export type Etapa =
  | "interesse"
  | "nome"
  | "valor"
  | "simulacao"
  | "foto_conta"
  | "doc"
  | "email"
  | "finalizando"
  | "pos_cadastro";

export type Perfil = "cetico" | "interessado" | "comprador" | "indeciso" | "reclamao";
export type Sentimento = "positivo" | "neutro" | "negativo" | "irritado";
export type Urgencia = "alta" | "media" | "baixa";

export interface PerfilOutput {
  perfil: Perfil;
  sentimento: Sentimento;
  urgencia: Urgencia;
  temperatura: number; // 0-100
  sinais_compra: string[];
  sinais_perda: string[];
}

export interface PlannerOutput {
  etapa_atual: Etapa;
  proxima_jogada: string;
  tom: string;
  info_a_capturar: string[];
  objecao_a_tratar: string | null;
  deve_pedir_humano: boolean;
  deve_agendar_followup: boolean;
  razao_da_jogada: string;
}

export interface FluxoBState {
  etapa: Etapa;
  perfil?: Perfil | null;
  objecoes_tratadas: string[];
  info: Record<string, string>;
  tentativas_etapa: number;
  ultima_jogada?: string | null;
  temperatura_max?: number;
  ultimo_perfil?: PerfilOutput | null;
  /** Marcador interno — campos que o webhook injetou nesta call (conta, doc) */
  midia_recebida?: { conta?: boolean; doc_frente?: boolean; doc_verso?: boolean };
  /** V2: flags determinísticas que destravam transições */
  simulacao_apresentada?: boolean;
  interesse_confirmado?: boolean;
  cadastro_finalizado?: boolean;
  abertura_feita?: boolean;
}

export interface MemoryBlock {
  fatos_confirmados: string[];
  estado_atual: string;
}

export interface RagChunk {
  source: "faq" | "winning";
  title: string;
  content: string;
  similarity: number;
}

export interface CriticoOutput {
  aprovado: boolean;
  problemas: string[];
  sugestao?: string;
}

export const DEFAULT_STATE: FluxoBState = {
  etapa: "interesse",
  perfil: null,
  objecoes_tratadas: [],
  info: {},
  tentativas_etapa: 0,
  ultima_jogada: null,
  temperatura_max: 0,
  ultimo_perfil: null,
  simulacao_apresentada: false,
  interesse_confirmado: false,
  cadastro_finalizado: false,
};

export const ETAPAS_ORDER: Etapa[] = [
  "interesse","nome","valor","simulacao","foto_conta","doc","email","finalizando","pos_cadastro",
];
