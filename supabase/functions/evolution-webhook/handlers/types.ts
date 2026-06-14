// Shared types for evolution-webhook handlers.
// Defines the BotContext object passed through bot-flow handlers
// so we don't need to keep dozens of free variables in scope.

// Use `any` para o client do Supabase para evitar conflitos de tipos genéricos
// quando o orchestrator (index.ts) chama os handlers. Os tipos do banco são
// validados em runtime pelas queries.
// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

// deno-lint-ignore no-explicit-any
export type EvolutionSender = any;

export interface BotContext {
  // Supabase + sender
  supabase: SupabaseClient;
  sender: EvolutionSender;

  // Customer + identity
  customer: any;
  consultorId: string;
  nomeRepresentante: string;

  // Inbound message
  remoteJid: string;
  phone: string;
  messageText: string;
  buttonId: string | null;
  isFile: boolean;
  isButton: boolean;
  hasImage: boolean;
  hasDocument: boolean;
  hasAudio?: boolean;
  imageMessage: any;
  documentMessage: any;
  message: any;
  key: any;
  messageId: string;
  /**
   * Nome da instância Evolution (ex.: "ayla-igreen-prod"). Repassado para
   * `checkAndMarkProcessed` em handlers internos para garantir que a chave
   * de dedupe seja `(message_id, instance_name)` e não apenas `message_id`
   * (multi-tenant: o mesmo message_id pode aparecer em duas instâncias
   * diferentes sem que uma derrube a outra).
   */
  instanceName: string;

  // Media (resolved before bot flow)
  fileUrl: string | null;
  fileBase64: string | null;

  // Env
  geminiApiKey: string;
}

export interface BotResult {
  /** Texto a enviar. `null` = quiet hours / handler decidiu não enviar. */
  reply: string | null;
  updates: Record<string, any>;
}
