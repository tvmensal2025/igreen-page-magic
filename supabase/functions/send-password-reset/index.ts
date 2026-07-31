// =============================================================================
// send-password-reset — link de recuperação de senha enviado via Resend
// =============================================================================
// Por que existe: o SMTP padrão do Supabase limita a poucos e-mails por hora,
// então os consultores simplesmente não recebiam o link. Aqui geramos o link
// oficial (auth.admin.generateLink) e enviamos com nosso próprio domínio pelo
// Resend, sem depender do SMTP embutido.
//
// Resposta é SEMPRE genérica ({ ok: true }) para não permitir enumeração de
// e-mails cadastrados. Falhas reais ficam nos logs.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { buildCors } from "../_shared/cors.ts";

const FROM = Deno.env.get("RESEND_FROM") || "iGreen <nao-responda@igreen.cloud>";

/** Só aceitamos redirect para origens nossas. */
const ALLOWED_REDIRECT_HOSTS = [
  "igreen.cloud",
  "www.igreen.cloud",
  "igreen-page-magic.lovable.app",
];

function isAllowedRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    if (u.protocol !== "https:") return false;
    if (ALLOWED_REDIRECT_HOSTS.includes(u.hostname)) return true;
    return /\.(lovable\.app|lovableproject\.com|lovable\.dev)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// Rate limit simples por e-mail (por instância): 3 pedidos a cada 15 min.
const attempts = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > 3;
}

function emailHtml(link: string): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f6f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e8e3;">
        <tr><td style="background:#0f7b3f;padding:24px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.5px;">iGreen</span>
        </td></tr>
        <tr><td style="padding:32px 28px 8px 28px;">
          <h1 style="margin:0 0 12px 0;font-size:20px;color:#12241a;">Redefinir sua senha</h1>
          <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4a544c;">
            Recebemos um pedido para redefinir a senha da sua conta iGreen.
            Clique no botão abaixo para criar uma nova senha. O link vale por 1 hora.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#0f7b3f;">
            <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Criar nova senha</a>
          </td></tr></table>
          <p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:#7a857c;">
            Se o botão não funcionar, copie e cole este endereço no navegador:<br>
            <span style="word-break:break-all;color:#0f7b3f;">${link}</span>
          </p>
          <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#7a857c;">
            Abra o link no <strong>mesmo aparelho</strong> em que pediu a troca.
            Se não foi você, pode ignorar este e-mail — nada muda.
          </p>
        </td></tr>
        <tr><td style="padding:24px 28px 28px 28px;">
          <hr style="border:none;border-top:1px solid #eef1ee;margin:0 0 14px 0;">
          <p style="margin:0;font-size:12px;color:#9aa39b;">iGreen · Energia por assinatura · igreen.cloud</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      // Front faz fallback para o fluxo nativo do Supabase.
      return json({ ok: false, error: "resend_not_configured" }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const redirectTo = String(body?.redirectTo ?? "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }
    if (!redirectTo || !isAllowedRedirect(redirectTo)) {
      return json({ ok: false, error: "invalid_redirect" }, 400);
    }
    if (rateLimited(email)) {
      return json({ ok: true, throttled: true });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error || !data?.properties?.action_link) {
      // E-mail inexistente cai aqui — resposta genérica de propósito.
      console.warn("[send-password-reset] generateLink falhou:", error?.message ?? "sem link");
      return json({ ok: true });
    }

    const link = data.properties.action_link;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: "Redefinir sua senha — iGreen",
        html: emailHtml(link),
        text:
          `Redefinir sua senha na iGreen\n\nAbra o link abaixo para criar uma nova senha (vale por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`,
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      console.error(`[send-password-reset] Resend falhou [${res.status}]: ${detail}`);
      return json({ ok: false, error: "send_failed", status: res.status, details: detail }, res.status);
    }

    console.log(`[send-password-reset] link enviado para ${email}`);
    return json({ ok: true });
  } catch (e) {
    console.error("[send-password-reset] erro:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
