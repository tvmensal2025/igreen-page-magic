export type SpeedPreset = "safe" | "normal" | "fast" | "custom";

export interface PreparedMedia {
  url: string;
  kind: "image" | "video" | "audio" | "document";
  fileName?: string;
}

export interface SendConfig {
  preset: SpeedPreset;
  intervalMinS: number;
  intervalMaxS: number;
  windowStart: string;
  windowEnd: string;
  weekdaysOnly: boolean;
  blockSize: number;
  blockPauseMin: number;
  mediaItems?: PreparedMedia[];
  mediaOrder?: "text_first" | "media_first" | "caption_only";
  scheduleAt?: string | null;
  // Multichannel additions
  sendSms?: boolean;
  smsText?: string;
  makeCall?: boolean;
  callAudioClipId?: string;
  // F12/F16: Ao disparar, o que fazer com o lead?
  afterSendAction?: "handoff" | "grupo_a";
}

export interface CampaignTarget {
  /**
   * Id da linha na origem: `customers.id` quando o disparo começa da tela,
   * `bulk_campaign_targets.id` quando é retomada do banco. NÃO use para
   * atualizar `customers` — use `customerId`.
   */
  id?: string;
  /** `customers.id` resolvido. Usado no gate DNC e no handoff/Grupo A. */
  customerId?: string;
  phone: string;
  name?: string;
  bill?: number;
  city?: string;
  status: "queued" | "sending" | "sent" | "failed";
  error?: string;
  finalMessage?: string;
  sentAt?: number;
}

export const PRESETS: Record<Exclude<SpeedPreset, "custom">, Partial<SendConfig>> = {
  safe: {
    blockSize: 15,
    blockPauseMin: 15,
    intervalMinS: 25,
    intervalMaxS: 45,
  },
  normal: {
    blockSize: 25,
    blockPauseMin: 10,
    intervalMinS: 18,
    intervalMaxS: 32,
  },
  fast: {
    blockSize: 40,
    blockPauseMin: 5,
    intervalMinS: 12,
    intervalMaxS: 22,
  },
};

export const DEFAULT_CONFIG: SendConfig = {
  preset: "normal",
  intervalMinS: 18,
  intervalMaxS: 32,
  windowStart: "08:00",
  windowEnd: "20:00",
  weekdaysOnly: true,
  blockSize: 10,
  blockPauseMin: 2,
  mediaItems: [],
  mediaOrder: "media_first",
  afterSendAction: "handoff",
};
