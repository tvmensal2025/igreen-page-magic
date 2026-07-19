// Shared types for whapi-webhook / evolution-webhook handlers.
// FONTE ÚNICA (Etapa 2 unificação): BotContext passado por bot-flow e conversational.
//
// Use `any` para o client Supabase e o sender do canal — evita conflitos de
// tipos genéricos entre orchestrators. Tipos do banco validados em runtime.

// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

// deno-lint-ignore no-explicit-any
export type ChannelSender = any;

export interface BotContext {
  supabase: SupabaseClient;
  sender: ChannelSender;

  customer: any;
  consultorId: string;
  nomeRepresentante: string;
  /** Nome da IA cadastrado em Dados (`consultants.assistant_name`). */
  nomeAssistente?: string;

  remoteJid: string;
  phone: string;
  messageText: string;
  buttonId: string | null;
  isFile: boolean;
  isButton: boolean;
  hasImage: boolean;
  hasDocument: boolean;
  /** Presente quando inbound é áudio (Evolution usa em conversational/bot-flow). */
  hasAudio?: boolean;
  imageMessage: any;
  documentMessage: any;
  message: any;
  key: any;
  messageId: string;
  /**
   * Nome da instância do canal (ex.: "whapi-superadmin", "ayla-igreen-prod").
   * Usado em dedupe `(message_id, instance_name)`.
   */
  instanceName: string;

  fileUrl: string | null;
  fileBase64: string | null;

  geminiApiKey: string;
}

export interface BotResult {
  /** Texto a enviar. `null` = quiet hours / handler decidiu não enviar. */
  reply: string | null;
  updates: Record<string, any>;
}
