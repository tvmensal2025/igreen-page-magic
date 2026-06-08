// WebRTC helper. Requester (consultor) é o offerer; operador apenas escuta e responde.
//
// Auditoria 2 — robustez:
//   - Fases explícitas via onStage (não só strings opacas).
//   - Operador idempotente: ignora offer duplicada quando já conectado.
//   - Requester nunca cria offer fora de signalingState=="stable".
//   - Retry reenvia a localDescription existente (sem createOffer novo).
//   - ICE buffering preservado.
//   - TURN opcional via VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS.

import { supabase } from "@/integrations/supabase/client";

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
  low:    { frameRate: 8,  scaleResolutionDownBy: 2,   maxBitrate: 500_000 },
};

/** Aplica perfil de qualidade ao primeiro sender de vídeo da peer connection (lado do consultor). */
export async function applyVideoQuality(pc: RTCPeerConnection, level: QualityLevel) {
  const sender = pc.getSenders().find(s => s.track?.kind === "video");
  if (!sender) return;
  const profile = QUALITY_PROFILES[level];
  try { await sender.track?.applyConstraints({ frameRate: profile.frameRate } as MediaTrackConstraints); } catch {}
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  params.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy;
  if (profile.maxBitrate) params.encodings[0].maxBitrate = profile.maxBitrate;
  params.encodings[0].maxFramerate = profile.frameRate;
  try { await sender.setParameters(params); } catch (e) { console.warn("[rtc] setParameters", e); }
}

/** FPS recebido (operador) a partir de getStats(). */
export async function getInboundVideoFps(pc: RTCPeerConnection): Promise<number | null> {
  try {
    const stats = await pc.getStats();
    let fps: number | null = null;
    stats.forEach((r: any) => {
      if (r.type === "inbound-rtp" && r.kind === "video" && typeof r.framesPerSecond === "number") {
        fps = r.framesPerSecond;
      }
    });
    return fps;
  } catch { return null; }
}

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

function buildIceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrl = (import.meta as any).env?.VITE_TURN_URL as string | undefined;
  const turnUser = (import.meta as any).env?.VITE_TURN_USER as string | undefined;
  const turnPass = (import.meta as any).env?.VITE_TURN_PASS as string | undefined;
  if (turnUrl) {
    list.push({ urls: turnUrl, username: turnUser, credential: turnPass });
  }
  return list;
}

const RTC_CONFIG: RTCConfiguration = { iceServers: buildIceServers() };

export type SignalEvent =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "ready" }
  | { type: "bye" };

export function signalChannel(sessionId: string, role: "operator" | "requester") {
  const channelName = `support:${sessionId}:rtc`;
  const channel = supabase.channel(channelName, { config: { broadcast: { self: false, ack: true } } });

  const subscribed = new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
    });
  });

  const send = (ev: SignalEvent) =>
    channel.send({ type: "broadcast", event: "signal", payload: { ...ev, from: role } });

  const onSignal = (handler: (ev: SignalEvent & { from: string }) => void) => {
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      if (!payload || payload.from === role) return;
      handler(payload as SignalEvent & { from: string });
    });
  };

  const close = () => supabase.removeChannel(channel);
  return { subscribed, send, onSignal, close };
}

function makeIceBuffer(pc: RTCPeerConnection) {
  const queue: RTCIceCandidateInit[] = [];
  let remoteSet = false;
  return {
    push(c: RTCIceCandidateInit) {
      if (remoteSet) pc.addIceCandidate(c).catch(e => console.warn("[rtc] addIce fail", e));
      else queue.push(c);
    },
    async flush() {
      remoteSet = true;
      while (queue.length) {
        const c = queue.shift()!;
        try { await pc.addIceCandidate(c); } catch (e) { console.warn("[rtc] addIce queued fail", e); }
      }
    },
  };
}

// Operator: subscreve, anuncia ready, responde offer (idempotente).
export async function createOperatorPeer(
  sessionId: string,
  onStream: (s: MediaStream) => void,
  onDataChannelOpen: (dc: RTCDataChannel) => void,
  onDataMessage: (msg: string) => void,
  onStage?: (s: RtcStage, info?: string) => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "operator");
  const ice = makeIceBuffer(pc);
  let dc: RTCDataChannel | null = null;
  let answered = false;

  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onopen = () => {
      onStage?.("datachannel-open");
      dc && onDataChannelOpen(dc);
    };
    dc.onmessage = (ev) => onDataMessage(typeof ev.data === "string" ? ev.data : "");
  };
  pc.ontrack = (e) => {
    onStage?.("stream-received");
    onStream(e.streams[0]);
  };
  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") onStage?.("connected");
    else if (s === "failed") onStage?.("failed", "pc.connectionState=failed");
    else if (s === "closed") onStage?.("closed");
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "checking") onStage?.("ice-checking");
  };

  sig.onSignal(async (ev) => {
    try {
      if (ev.type === "offer") {
        // idempotente: aceita offer enquanto não respondemos OU se for renegociação após stable
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
        onStage?.("closed", "peer bye");
      }
    } catch (e: any) {
      console.warn("[rtc][operator] signal error", e);
      onStage?.("failed", e?.message || String(e));
    }
  });

  await sig.subscribed;
  onStage?.("subscribed");
  onStage?.("waiting-share");
  // Anuncia presença; requester usa para reenviar a offer já existente.
  await sig.send({ type: "ready" });

  return {
    pc,
    get dc() { return dc; },
    sig,
    close: () => { try { sig.send({ type: "bye" }); } catch {} pc.close(); sig.close(); },
  };
}

// Requester: getDisplayMedia, espera ready (ou já tem subscribed), envia offer.
export async function createRequesterPeer(
  sessionId: string,
  onDataMessage: (msg: string, reply: (s: string) => void) => void,
  onClose: () => void,
  onStage?: (s: RtcStage, info?: string) => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "requester");
  const ice = makeIceBuffer(pc);

  const dc = pc.createDataChannel("cmd");
  dc.onopen = () => onStage?.("datachannel-open");
  dc.onmessage = (ev) => onDataMessage(
    typeof ev.data === "string" ? ev.data : "",
    (s) => dc.readyState === "open" && dc.send(s),
  );

  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") onStage?.("connected");
    if (["failed", "closed", "disconnected"].includes(s)) {
      onStage?.(s === "failed" ? "failed" : "closed", `pc.connectionState=${s}`);
      onClose();
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "checking") onStage?.("ice-checking");
  };

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 } as MediaTrackConstraints,
    audio: false,
  });
  stream.getTracks().forEach(t => {
    pc.addTrack(t, stream);
    t.addEventListener("ended", onClose);
  });

  // Envia offer apenas se signalingState=="stable". Reenvio reaproveita localDescription.
  const sendOffer = async () => {
    try {
      if (pc.signalingState === "stable") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sig.send({ type: "offer", sdp: offer });
        onStage?.("offer-sent");
      } else if (pc.localDescription) {
        await sig.send({ type: "offer", sdp: pc.localDescription });
        onStage?.("offer-sent", "resent");
      }
    } catch (e: any) {
      console.warn("[rtc][requester] sendOffer fail", e);
      onStage?.("failed", e?.message || String(e));
    }
  };

  sig.onSignal(async (ev) => {
    try {
      if (ev.type === "ready") {
        await sendOffer();           // se já tem localDescription, só reenvia
      } else if (ev.type === "answer") {
        if (pc.signalingState !== "have-local-offer") return; // ignora answer fora de fase
        await pc.setRemoteDescription(ev.sdp);
        await ice.flush();
        onStage?.("answer-received");
      } else if (ev.type === "ice") {
        ice.push(ev.candidate);
      } else if (ev.type === "bye") {
        onClose();
      }
    } catch (e: any) {
      console.warn("[rtc][requester] signal error", e);
      onStage?.("failed", e?.message || String(e));
    }
  });

  await sig.subscribed;
  onStage?.("subscribed");
  await sendOffer();

  // Reenvio periódico até receber answer; só reenvia a SDP local (sem renegociar).
  const retry = setInterval(async () => {
    if (pc.signalingState === "have-local-offer" && pc.localDescription) {
      try { await sig.send({ type: "offer", sdp: pc.localDescription }); } catch {}
    } else if (pc.signalingState === "stable" && pc.connectionState !== "connected") {
      // nada — esperando ICE finalizar
    } else {
      clearInterval(retry);
    }
  }, 3000);

  return {
    pc, sig, stream, dc,
    close: () => {
      clearInterval(retry);
      try { sig.send({ type: "bye" }); } catch {}
      stream.getTracks().forEach(t => t.stop());
      pc.close(); sig.close();
    },
  };
}
