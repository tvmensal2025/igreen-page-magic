// =============================================================================
// Remote Support — WebRTC / Screen Share
// =============================================================================
// Requester (consultor) = offerer, envia vídeo + cria DataChannel.
// Operator (super-admin) = answerer, recebe vídeo + controla via DataChannel.
//
// Correções v3:
//   - Requester envia viewportInfo logo após DataChannel abrir.
//   - TURN servers opcionais via env.
//   - ICE buffering robusto.
//   - Retry de offer sem renegociar (só reenvia localDescription).
//   - Operador idempotente em offers duplicadas.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { RequesterViewport } from "./types";

// ---------------------------------------------------------------------------
// Qualidade de vídeo
// ---------------------------------------------------------------------------

export type QualityLevel = "auto" | "high" | "medium" | "low";

export interface QualityProfile {
  frameRate: number;
  scaleResolutionDownBy: number;
  maxBitrate?: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  auto:   { frameRate: 15, scaleResolutionDownBy: 1,   maxBitrate: 1_500_000 },
  high:   { frameRate: 24, scaleResolutionDownBy: 1,   maxBitrate: 2_500_000 },
  medium: { frameRate: 15, scaleResolutionDownBy: 1.5, maxBitrate: 1_200_000 },
  low:    { frameRate: 8,  scaleResolutionDownBy: 2,   maxBitrate:   500_000 },
};

/**
 * Aplica perfil de qualidade ao sender de vídeo (lado do consultor).
 * Silenciosamente ignora erros — o browser pode não suportar todos os params.
 */
export async function applyVideoQuality(
  pc: RTCPeerConnection,
  level: QualityLevel,
): Promise<void> {
  const sender = pc.getSenders().find(s => s.track?.kind === "video");
  if (!sender) return;

  const profile = QUALITY_PROFILES[level];

  // Tenta aplicar constraint de frameRate na track
  try {
    await sender.track?.applyConstraints({ frameRate: profile.frameRate } as MediaTrackConstraints);
  } catch { /* ignorado — track pode não aceitar */ }

  // Aplica bitrate e resolução via RTCRtpEncodingParameters
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;
  params.encodings[0].maxFramerate = profile.frameRate;
  if (profile.maxBitrate) {
    params.encodings[0].maxBitrate = profile.maxBitrate;
  }

  try {
    await sender.setParameters(params);
  } catch (e) {
    console.warn("[rtc] setParameters failed (non-critical):", e);
  }
}

/**
 * Retorna o FPS recebido no lado do operador via getStats().
 * Retorna null se não disponível.
 */
export async function getInboundVideoFps(pc: RTCPeerConnection): Promise<number | null> {
  try {
    const stats = await pc.getStats();
    let fps: number | null = null;
    stats.forEach((r: RTCStats & Record<string, unknown>) => {
      if (
        r.type === "inbound-rtp" &&
        r["kind"] === "video" &&
        typeof r["framesPerSecond"] === "number"
      ) {
        fps = r["framesPerSecond"] as number;
      }
    });
    return fps;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estágios da conexão
// ---------------------------------------------------------------------------

export type RtcStage =
  | "idle"
  | "subscribed"
  | "waiting-share"
  | "offer-sent"
  | "offer-received"
  | "answer-sent"
  | "answer-received"
  | "ice-checking"
  | "connected"
  | "stream-received"
  | "datachannel-open"
  | "failed"
  | "closed";

// ---------------------------------------------------------------------------
// ICE Servers
// ---------------------------------------------------------------------------

function buildIceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrl  = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_TURN_URL;
  const turnUser = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_TURN_USER;
  const turnPass = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_TURN_PASS;

  if (turnUrl) {
    list.push({ urls: turnUrl, username: turnUser, credential: turnPass });
  }

  return list;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 10,
};

/**
 * Tempo de tolerância (ms) antes de encerrar quando a conexão entra em
 * "disconnected". Redes Wi-Fi/4G oscilam por 2-5s com frequência; encerrar
 * imediatamente forçaria reconexões desnecessárias. A spec do WebRTC trata
 * "disconnected" como estado potencialmente transitório.
 */
const RECONNECT_GRACE_MS = 6_000;

// ---------------------------------------------------------------------------
// Canal de sinalização (Supabase Realtime Broadcast)
// ---------------------------------------------------------------------------

export type SignalEvent =
  | { type: "offer";  sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice";    candidate: RTCIceCandidateInit }
  | { type: "ready" }
  | { type: "bye" };

export function signalChannel(sessionId: string, role: "operator" | "requester") {
  const channelName = `support:${sessionId}:rtc`;
  const channel = supabase.channel(channelName, {
    // Canal privado: a entrada é autorizada por RLS em `realtime.messages`,
    // garantindo que apenas participantes da sessão (requester/operator/super
    // admin) possam enviar/receber a sinalização WebRTC. Evita MITM/injeção
    // de ICE por terceiros que descubram o sessionId.
    config: { private: true, broadcast: { self: false, ack: true } },
  });

  const subscribed = new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`Signal channel ${status}`));
      }
    });
  });

  const send = (ev: SignalEvent) =>
    channel.send({
      type: "broadcast",
      event: "signal",
      payload: { ...ev, from: role },
    });

  const onSignal = (handler: (ev: SignalEvent & { from: string }) => void) => {
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      if (!payload || payload.from === role) return;
      handler(payload as SignalEvent & { from: string });
    });
  };

  const close = () => supabase.removeChannel(channel);

  return { subscribed, send, onSignal, close };
}

// ---------------------------------------------------------------------------
// DataChannel — envio seguro com backpressure
// ---------------------------------------------------------------------------

/**
 * Limite de buffer do DataChannel acima do qual paramos de enfileirar
 * mensagens não-críticas (mouseMove/wheel). Evita explosão de latência
 * em redes lentas (4G, Wi-Fi fraco).
 *
 * 256 KB é o threshold recomendado pela spec do WebRTC para considerar
 * o canal "congestionado".
 */
export const DC_BUFFER_THRESHOLD = 256 * 1024;

/**
 * Envia uma mensagem pelo DataChannel respeitando backpressure.
 *
 * - Mensagens críticas (clicks, teclas) sempre são enviadas.
 * - Mensagens descartáveis (mouseMove, wheel) são puladas quando o buffer
 *   está congestionado, evitando acúmulo de latência.
 *
 * @returns true se enviou, false se descartou por backpressure ou canal fechado.
 */
export function safeSend(
  dc: RTCDataChannel | null,
  message: string,
  options?: { droppable?: boolean },
): boolean {
  if (!dc || dc.readyState !== "open") return false;

  // Se está congestionado e a mensagem é descartável, pula
  if (options?.droppable && dc.bufferedAmount > DC_BUFFER_THRESHOLD) {
    return false;
  }

  try {
    dc.send(message);
    return true;
  } catch (e) {
    console.warn("[rtc] safeSend failed:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------

function makeIceBuffer(pc: RTCPeerConnection) {
  const queue: RTCIceCandidateInit[] = [];
  let remoteSet = false;

  return {
    push(c: RTCIceCandidateInit) {
      if (remoteSet) {
        pc.addIceCandidate(c).catch(e => console.warn("[rtc] addIceCandidate:", e));
      } else {
        queue.push(c);
      }
    },
    async flush() {
      remoteSet = true;
      const pending = queue.splice(0);
      for (const c of pending) {
        try { await pc.addIceCandidate(c); } catch (e) {
          console.warn("[rtc] addIceCandidate (queued):", e);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Operator peer — answerer
// ---------------------------------------------------------------------------

export async function createOperatorPeer(
  sessionId: string,
  onStream: (stream: MediaStream) => void,
  onDataChannelOpen: (dc: RTCDataChannel) => void,
  onDataMessage: (msg: string) => void,
  onStage?: (stage: RtcStage, info?: string) => void,
) {
  const pc  = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "operator");
  const ice = makeIceBuffer(pc);

  let dc: RTCDataChannel | null = null;
  let answered = false;

  // --- DataChannel ---
  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onopen = () => {
      onStage?.("datachannel-open");
      if (dc) onDataChannelOpen(dc);
    };
    dc.onmessage = (ev) =>
      onDataMessage(typeof ev.data === "string" ? ev.data : "");
  };

  // --- Vídeo ---
  pc.ontrack = (e) => {
    onStage?.("stream-received");
    onStream(e.streams[0]);
  };

  // --- ICE ---
  pc.onicecandidate = (e) => {
    if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() });
  };

  // --- Estado da conexão ---
  // Operador: trata "disconnected" como transitório (grace period) e tenta
  // ICE restart em "failed" antes de reportar falha definitiva.
  let opDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const clearOpDisconnectTimer = () => {
    if (opDisconnectTimer !== null) { clearTimeout(opDisconnectTimer); opDisconnectTimer = null; }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") {
      clearOpDisconnectTimer();
      onStage?.("connected");
    } else if (s === "disconnected") {
      onStage?.("ice-checking", "disconnected (aguardando reconexão)");
      clearOpDisconnectTimer();
      opDisconnectTimer = setTimeout(() => {
        if (pc.connectionState === "disconnected") {
          onStage?.("failed", "disconnected timeout");
        }
      }, RECONNECT_GRACE_MS);
    } else if (s === "failed") {
      clearOpDisconnectTimer();
      onStage?.("failed", "connectionState=failed");
    } else if (s === "closed") {
      clearOpDisconnectTimer();
      onStage?.("closed");
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "checking") onStage?.("ice-checking");
    if (pc.iceConnectionState === "failed") {
      // ICE restart automático (spec W3C)
      try { pc.restartIce(); } catch { /* ignora */ }
    }
  };

  // --- Sinalização ---
  sig.onSignal(async (ev) => {
    try {
      if (ev.type === "offer") {
        // Idempotente: aceita offer somente se ainda não respondemos
        // OU se for uma renegociação após estado stable.
        if (answered && pc.signalingState !== "stable") return;

        onStage?.("offer-received");
        await pc.setRemoteDescription(ev.sdp);
        await ice.flush();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sig.send({ type: "answer", sdp: answer });
        answered = true;
        onStage?.("answer-sent");

      } else if (ev.type === "ice") {
        ice.push(ev.candidate);

      } else if (ev.type === "bye") {
        onStage?.("closed", "peer sent bye");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[rtc][operator] signal error:", msg);
      onStage?.("failed", msg);
    }
  });

  await sig.subscribed;
  onStage?.("subscribed");
  onStage?.("waiting-share");

  // Anuncia presença ao requester para que ele reenvie a offer se já existir
  await sig.send({ type: "ready" });

  return {
    pc,
    get dc() { return dc; },
    sig,
    close: () => {
      try { sig.send({ type: "bye" }); } catch { /* ignora */ }
      pc.close();
      sig.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Requester peer — offerer + screen share
// ---------------------------------------------------------------------------

/**
 * Captura informações do viewport do consultor para envio ao operador.
 * Permite mapeamento preciso de coordenadas, inclusive em telas HiDPI.
 */
export function captureViewportInfo(
  stream: MediaStream,
): RequesterViewport {
  const videoTrack = stream.getVideoTracks()[0];
  let displaySurface: string | null = null;

  try {
    const settings = videoTrack?.getSettings() as MediaTrackSettings & { displaySurface?: string };
    displaySurface = settings?.displaySurface ?? null;
  } catch { /* getSettings pode não estar disponível */ }

  return {
    innerWidth:  window.innerWidth,
    innerHeight: window.innerHeight,
    dpr:         window.devicePixelRatio || 1,
    displaySurface,
  };
}

export async function createRequesterPeer(
  sessionId: string,
  onDataMessage: (msg: string, reply: (s: string) => void) => void,
  onClose: () => void,
  onStage?: (stage: RtcStage, info?: string) => void,
) {
  const pc  = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "requester");
  const ice = makeIceBuffer(pc);

  // --- Screen share ---
  // Solicita a aba atual quando o browser suportar (Chrome ≥107).
  // Isso melhora muito a precisão do mapeamento de coordenadas porque o vídeo
  // passa a bater pixel-a-pixel com o viewport CSS da página.
  // IMPORTANTE: getDisplayMedia DEVE ser chamado antes de criar o DataChannel
  // para garantir que `stream` esteja disponível no dc.onopen closure.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: 15,
      preferCurrentTab: true,    // Chrome ≥107
      displaySurface: "browser", // sugestão — usuário pode ignorar
    } as MediaTrackConstraints,
    audio: false,
    // Inclui a própria aba no seletor e evita troca de superfície após o share
    selfBrowserSurface: "include",
    surfaceSwitching:   "exclude",
  } as DisplayMediaStreamOptions);

  // DataChannel criado pelo offerer (requester) — após obter o stream
  // para que `stream` esteja disponível na closure do dc.onopen.
  const dc = pc.createDataChannel("cmd", { ordered: true });

  dc.onopen = () => {
    onStage?.("datachannel-open");
    // Envia metadados do viewport logo após o canal abrir.
    // O operador usa para mapear coordenadas com precisão (DPR, resolução).
    try {
      const viewport = captureViewportInfo(stream);
      dc.send(JSON.stringify({
        id: "viewport-info",
        kind: "viewportInfo",
        viewport,
      }));
    } catch (e) {
      console.warn("[rtc][requester] failed to send viewportInfo:", e);
    }
  };

  dc.onmessage = (ev) => {
    const data = typeof ev.data === "string" ? ev.data : "";
    onDataMessage(data, (s) => {
      if (dc.readyState === "open") dc.send(s);
    });
  };

  // --- ICE ---
  pc.onicecandidate = (e) => {
    if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() });
  };

  // --- Estado da conexão ---
  // Trata "disconnected" como TRANSITÓRIO (comum em Wi-Fi/4G que oscila):
  // aguarda um grace period antes de encerrar. Só "failed"/"closed" encerram.
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDisconnectTimer = () => {
    if (disconnectTimer !== null) { clearTimeout(disconnectTimer); disconnectTimer = null; }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") {
      clearDisconnectTimer();
      onStage?.("connected");
    } else if (s === "disconnected") {
      // Oscilação de rede — aguarda RECONNECT_GRACE_MS antes de desistir.
      onStage?.("ice-checking", "disconnected (aguardando reconexão)");
      clearDisconnectTimer();
      disconnectTimer = setTimeout(() => {
        if (pc.connectionState === "disconnected") {
          onStage?.("failed", "disconnected timeout");
          onClose();
        }
      }, RECONNECT_GRACE_MS);
    } else if (s === "failed") {
      clearDisconnectTimer();
      // Tenta ICE restart antes de desistir (spec W3C)
      try { pc.restartIce(); } catch { /* ignora */ }
      onStage?.("failed", "connectionState=failed");
      onClose();
    } else if (s === "closed") {
      clearDisconnectTimer();
      onStage?.("closed", "connectionState=closed");
      onClose();
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "checking") onStage?.("ice-checking");
    if (pc.iceConnectionState === "failed") {
      // ICE restart automático (spec W3C: recomendado em failed)
      try { pc.restartIce(); } catch { /* ignora */ }
    }
  };

  stream.getTracks().forEach(t => {
    pc.addTrack(t, stream);
    t.addEventListener("ended", onClose, { once: true });
  });

  // --- Offer ---
  const sendOffer = async () => {
    try {
      if (pc.signalingState === "stable") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sig.send({ type: "offer", sdp: offer });
        onStage?.("offer-sent");
      } else if (pc.localDescription) {
        // Reenvia a SDP local já criada sem renegociar
        await sig.send({ type: "offer", sdp: pc.localDescription });
        onStage?.("offer-sent", "resent");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[rtc][requester] sendOffer failed:", msg);
      onStage?.("failed", msg);
    }
  };

  sig.onSignal(async (ev) => {
    try {
      if (ev.type === "ready") {
        await sendOffer();
      } else if (ev.type === "answer") {
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(ev.sdp);
        await ice.flush();
        onStage?.("answer-received");
      } else if (ev.type === "ice") {
        ice.push(ev.candidate);
      } else if (ev.type === "bye") {
        onClose();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[rtc][requester] signal error:", msg);
      onStage?.("failed", msg);
    }
  });

  await sig.subscribed;
  onStage?.("subscribed");
  await sendOffer();

  // Reenvio periódico da offer enquanto aguarda answer (sem renegociar)
  const retryInterval = setInterval(async () => {
    if (pc.signalingState === "have-local-offer" && pc.localDescription) {
      try { await sig.send({ type: "offer", sdp: pc.localDescription }); } catch { /* ignora */ }
    } else {
      clearInterval(retryInterval);
    }
  }, 3_000);

  return {
    pc,
    sig,
    stream,
    dc,
    close: () => {
      clearInterval(retryInterval);
      try { sig.send({ type: "bye" }); } catch { /* ignora */ }
      stream.getTracks().forEach(t => t.stop());
      pc.close();
      sig.close();
    },
  };
}
