// WebRTC helper. Requester (consultor) é o offerer; operador apenas escuta e responde.
//
// Auditoria 2026-06-08 — correções aplicadas:
//   1) ICE buffering: candidatos chegando antes de setRemoteDescription são enfileirados
//      e drenados depois (antes apenas falhavam num try/catch vazio → conexão incompleta).
//   2) Handshake "operator-ready": operador, ao subscrever, anuncia presença.
//      Requester espera por esse anúncio antes de emitir offer; se já tiver subscrito
//      antes do operador, também reenvia a offer ao receber "operator-ready". Elimina a
//      race do broadcast (sem buffer de entrega).
//   3) Telemetria: callbacks opcionais `onState` para o caller mostrar o que está acontecendo.

import { supabase } from "@/integrations/supabase/client";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export type SignalEvent =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "ready" }      // operador anuncia que já está pronto a receber offer
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

// Drena candidatos ICE que chegaram antes de setRemoteDescription.
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

// Operator side: subscreve, anuncia "ready" e responde offers.
export async function createOperatorPeer(
  sessionId: string,
  onStream: (s: MediaStream) => void,
  onDataChannelOpen: (dc: RTCDataChannel) => void,
  onDataMessage: (msg: string) => void,
  onState?: (s: string) => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "operator");
  const ice = makeIceBuffer(pc);
  let dc: RTCDataChannel | null = null;

  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onopen = () => dc && onDataChannelOpen(dc);
    dc.onmessage = (ev) => onDataMessage(typeof ev.data === "string" ? ev.data : "");
  };
  pc.ontrack = (e) => onStream(e.streams[0]);
  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => onState?.(pc.connectionState);
  pc.oniceconnectionstatechange = () => onState?.(`ice:${pc.iceConnectionState}`);

  sig.onSignal(async (ev) => {
    if (ev.type === "offer") {
      await pc.setRemoteDescription(ev.sdp);
      await ice.flush();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sig.send({ type: "answer", sdp: answer });
    } else if (ev.type === "ice") {
      ice.push(ev.candidate);
    } else if (ev.type === "bye") {
      onState?.("bye");
    }
  });

  await sig.subscribed;
  onState?.("subscribed");
  // Anuncia presença para o requester que talvez já esteja pronto para mandar offer.
  await sig.send({ type: "ready" });

  return {
    pc,
    get dc() { return dc; },
    sig,
    close: () => { try { sig.send({ type: "bye" }); } catch {} pc.close(); sig.close(); },
  };
}

// Requester side: getDisplayMedia, espera operador "ready", manda offer.
export async function createRequesterPeer(
  sessionId: string,
  onDataMessage: (msg: string, reply: (s: string) => void) => void,
  onClose: () => void,
  onState?: (s: string) => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "requester");
  const ice = makeIceBuffer(pc);

  const dc = pc.createDataChannel("cmd");
  dc.onmessage = (ev) => onDataMessage(
    typeof ev.data === "string" ? ev.data : "",
    (s) => dc.readyState === "open" && dc.send(s),
  );

  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    onState?.(pc.connectionState);
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) onClose();
  };
  pc.oniceconnectionstatechange = () => onState?.(`ice:${pc.iceConnectionState}`);

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 } as MediaTrackConstraints,
    audio: false,
  });
  stream.getTracks().forEach(t => {
    pc.addTrack(t, stream);
    t.addEventListener("ended", onClose);
  });

  let offerSent = false;
  const sendOffer = async () => {
    if (offerSent) return;
    offerSent = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sig.send({ type: "offer", sdp: offer });
    onState?.("offer-sent");
  };

  sig.onSignal(async (ev) => {
    if (ev.type === "ready") {
      // Operador acabou de subscrever — (re)envia a offer.
      offerSent = false;
      await sendOffer();
    } else if (ev.type === "answer") {
      await pc.setRemoteDescription(ev.sdp);
      await ice.flush();
    } else if (ev.type === "ice") {
      ice.push(ev.candidate);
    } else if (ev.type === "bye") {
      onClose();
    }
  });

  await sig.subscribed;
  onState?.("subscribed");
  // Manda offer já — se o operador ainda não estiver pronto, ele responderá ao
  // próprio "ready" dele e nós reenviamos a offer.
  await sendOffer();

  // Retry de segurança: se em 3s não chegou answer, reenvia offer.
  const retry = setTimeout(async () => {
    if (pc.signalingState === "have-local-offer") {
      offerSent = false;
      try { await sendOffer(); } catch {}
    }
  }, 3000);

  return {
    pc, sig, stream, dc,
    close: () => {
      clearTimeout(retry);
      try { sig.send({ type: "bye" }); } catch {}
      stream.getTracks().forEach(t => t.stop());
      pc.close(); sig.close();
    },
  };
}
