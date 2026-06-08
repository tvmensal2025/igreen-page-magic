// WebRTC helper. Requester is the offerer (creates data channel + media); operator answers.
// This ordering avoids a Supabase Realtime broadcast race: the operator subscribes as soon
// as the session becomes active, and the requester only emits the offer after the user
// clicks "Compartilhar tela" — by then the operator is already listening.
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
  | { type: "bye" };

export function signalChannel(sessionId: string, role: "operator" | "requester") {
  const channelName = `support:${sessionId}:rtc`;
  const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });

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
      if (payload?.from === role) return;
      handler(payload as SignalEvent & { from: string });
    });
  };

  const close = () => supabase.removeChannel(channel);

  return { subscribed, send, onSignal, close };
}

// Operator side: subscribe + wait for offer from requester, then answer.
export async function createOperatorPeer(
  sessionId: string,
  onStream: (s: MediaStream) => void,
  onDataChannelOpen: (dc: RTCDataChannel) => void,
  onDataMessage: (msg: string) => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "operator");
  let dc: RTCDataChannel | null = null;

  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onopen = () => dc && onDataChannelOpen(dc);
    dc.onmessage = (ev) => onDataMessage(typeof ev.data === "string" ? ev.data : "");
  };
  pc.ontrack = (e) => onStream(e.streams[0]);
  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };

  await sig.subscribed;
  sig.onSignal(async (ev) => {
    if (ev.type === "offer") {
      await pc.setRemoteDescription(ev.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sig.send({ type: "answer", sdp: answer });
    } else if (ev.type === "ice") {
      try { await pc.addIceCandidate(ev.candidate); } catch {}
    }
  });

  return {
    pc,
    get dc() { return dc; },
    sig,
    close: () => { try { sig.send({ type: "bye" }); } catch {} pc.close(); sig.close(); },
  };
}

// Requester side: get display media, create data channel + offer, send offer.
export async function createRequesterPeer(
  sessionId: string,
  onDataMessage: (msg: string, reply: (s: string) => void) => void,
  onClose: () => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const sig = signalChannel(sessionId, "requester");

  const dc = pc.createDataChannel("cmd");
  dc.onmessage = (ev) => onDataMessage(
    typeof ev.data === "string" ? ev.data : "",
    (s) => dc.readyState === "open" && dc.send(s),
  );

  pc.onicecandidate = (e) => { if (e.candidate) sig.send({ type: "ice", candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) onClose();
  };

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 } as MediaTrackConstraints,
    audio: false,
  });
  stream.getTracks().forEach(t => {
    pc.addTrack(t, stream);
    t.addEventListener("ended", onClose);
  });

  await sig.subscribed;
  sig.onSignal(async (ev) => {
    if (ev.type === "answer") {
      await pc.setRemoteDescription(ev.sdp);
    } else if (ev.type === "ice") {
      try { await pc.addIceCandidate(ev.candidate); } catch {}
    } else if (ev.type === "bye") onClose();
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sig.send({ type: "offer", sdp: offer });

  return {
    pc, sig, stream, dc,
    close: () => {
      try { sig.send({ type: "bye" }); } catch {}
      stream.getTracks().forEach(t => t.stop());
      pc.close(); sig.close();
    },
  };
}
