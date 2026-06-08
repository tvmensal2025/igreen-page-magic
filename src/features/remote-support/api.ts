import { supabase } from "@/integrations/supabase/client";
import type { SupportSession } from "./types";

export async function requestSupport(): Promise<SupportSession> {
  const { data, error } = await supabase.functions.invoke("remote-support-request", { body: {} });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.session;
}

export async function operatorRequest(requesterId: string): Promise<SupportSession> {
  const { data, error } = await supabase.functions.invoke("remote-support-operator-request", {
    body: { requester_id: requesterId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.session;
}

export async function acceptSession(sessionId: string) {
  const { data, error } = await supabase.functions.invoke("remote-support-accept", {
    body: { session_id: sessionId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function rotateCode(sessionId: string): Promise<{ code: string; rotates_at: string }> {
  const { data, error } = await supabase.functions.invoke("remote-support-rotate-code", {
    body: { session_id: sessionId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function verifyCode(sessionId: string, code: string) {
  const { data, error } = await supabase.functions.invoke("remote-support-verify-code", {
    body: { session_id: sessionId, code },
  });
  if (error) throw error;
  if (data?.error) {
    const err = new Error(data.error) as Error & { attempts_left?: number };
    err.attempts_left = data.attempts_left;
    throw err;
  }
  return data;
}

export async function endSession(sessionId: string, reason?: string) {
  const { data, error } = await supabase.functions.invoke("remote-support-end", {
    body: { session_id: sessionId, reason },
  });
  if (error) throw error;
  return data;
}

export async function logAction(
  sessionId: string,
  actor: "operator" | "requester" | "system",
  action: string,
  target?: string | null,
  payload?: Record<string, unknown> | null,
) {
  try {
    await (supabase as any).from("remote_support_logs").insert({
      session_id: sessionId, actor, action, target: target ?? null, payload: payload ?? null,
    });
  } catch (e) {
    console.warn("[remote-support] log failed", e);
  }
}

