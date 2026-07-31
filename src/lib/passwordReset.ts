// =============================================================================
// passwordReset — envio do link de recuperação de senha
// =============================================================================
// Caminho principal: edge function `send-password-reset` (Resend + domínio
// igreen.cloud), que não sofre o limite de poucos e-mails/hora do SMTP padrão
// do Supabase.
// Fallback automático: se o Resend não estiver configurado ou a função falhar,
// usamos o fluxo nativo `resetPasswordForEmail` — nada quebra.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

export type ResetDelivery = "resend" | "supabase";

export async function sendPasswordResetEmail(email: string): Promise<ResetDelivery> {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Informe seu e-mail.");
  const redirectTo = `${window.location.origin}/reset-password`;

  try {
    const { data, error } = await supabase.functions.invoke("send-password-reset", {
      body: { email: trimmed, redirectTo },
    });
    if (!error && (data as { ok?: boolean } | null)?.ok) return "resend";
    console.warn("[passwordReset] edge indisponível, usando fluxo nativo", error);
  } catch (err) {
    console.warn("[passwordReset] edge falhou, usando fluxo nativo", err);
  }

  const { error: nativeError } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
  if (nativeError) throw nativeError;
  return "supabase";
}
