export type MediaKind = "image" | "video" | "audio" | "document";

export interface PreparedMedia {
  url: string;
  kind: MediaKind;
  fileName?: string;
  mime?: string;
}

export type SpeedPreset = "safe" | "normal" | "fast" | "custom";

export interface SendConfig {
  preset: SpeedPreset;
  blockSize: number;
  blockPauseMin: number;
  intervalMinS: number;
  intervalMaxS: number;
  windowStart: string;        // "HH:mm"
  windowEnd: string;          // "HH:mm" (se < start, janela atravessa meia-noite)
  weekdaysOnly: boolean;
  scheduleAt: string | null;  // "YYYY-MM-DDTHH:mm" local time
  mediaOrder: "media_first" | "text_first" | "caption_only";
  // Novas opções Multicanal
  sendSms?: boolean;
  smsText?: string;
  makeCall?: boolean;
  callAudioClipId?: string;
  mediaItems?: PreparedMedia[]; // Adicionado para suportar múltiplas mídias
}

export interface CampaignTarget {
  id: string;
  phone: string;
  name: string;
  bill?: number;
  city?: string;
  status: "queued" | "sending" | "sent" | "failed";
  error?: string;
  sentAt?: number;
  finalMessage?: string;
}

export const PRESETS: Record<Exclude<SpeedPreset, "custom">, Pick<SendConfig, "blockSize" | "blockPauseMin" | "intervalMinS" | "intervalMaxS">> = {
  safe:   { blockSize: 15, blockPauseMin: 15, intervalMinS: 25, intervalMaxS: 45 },
  normal: { blockSize: 25, blockPauseMin: 10, intervalMinS: 18, intervalMaxS: 32 },
  fast:   { blockSize: 40, blockPauseMin: 5,  intervalMinS: 10, intervalMaxS: 20 },
};

export const DEFAULT_CONFIG: SendConfig = {
  preset: "normal",
  ...PRESETS.normal,
  windowStart: "08:00",
  windowEnd: "20:00",
  weekdaysOnly: false,
  scheduleAt: null,
  mediaOrder: "media_first",
  sendSms: false,
  smsText: "",
  makeCall: false,
  callAudioClipId: "",
  mediaItems: [],
};
