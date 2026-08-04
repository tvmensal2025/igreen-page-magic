import type { PreparedMedia } from "./types";

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
  // F12/F16: Ao disparar, o que fazer com o lead?
  // 'handoff' (default): pausa bot + atribui ao humano por 48h
  // 'grupo_a': joga o lead no início do funil automático de cadastro
  afterSendAction?: "handoff" | "grupo_a";
}

export type SpeedPreset = "safe" | "normal" | "fast" | "custom";

export interface PreparedMedia {
  url: string;
  kind: "image" | "video" | "audio" | "document";
  fileName?: string;
}

export interface CampaignTarget {
  id?: string; // id no banco (customer_id)
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
  ...PRESETS.normal,
  windowStart: "08:00",
  windowEnd: "20:00",
  weekdaysOnly: true,
  blockSize: 10,
  blockPauseMin: 2,
  mediaItems: [],
  mediaOrder: "media_first",
  afterSendAction: "handoff",
};
