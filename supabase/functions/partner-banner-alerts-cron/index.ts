/**
 * partner-banner-alerts-cron
 * A cada ~15 min: parceiros com banner_alert_threshold > 0 e N leads em 24h
 * >= limiar → avisa o consultor (WA). Dedup via banner_alert_last_at (~24h).
 *
 * Opt-in por parceiro (0 = off). Não é envio em massa genérico.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-internal-secret, x-service-secret",
      },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cronAuth = await assertCronAuth(req, supabase as any);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason);

  const sinceIso = new Date(Date.now() - COOLDOWN_MS).toISOString();

  const { data: partners, error } = await supabase
    .from("referral_partners")
    .select(
      "id, nome, consultant_id, banner_alert_threshold, banner_alert_last_at, notification_phone, short_code",
    )
    .eq("is_active", true)
    .gt("banner_alert_threshold", 0)
    .limit(200);

  if (error) {
    console.error("[partner-banner-alerts] list failed", error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const list = (partners || []) as Array<{
    id: string;
    nome: string | null;
    consultant_id: string;
    banner_alert_threshold: number;
    banner_alert_last_at: string | null;
    notification_phone: string | null;
    short_code: string | null;
  }>;

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const p of list) {
    if (sent >= MAX_PER_RUN) break;
    checked += 1;

    const last = p.banner_alert_last_at
      ? new Date(p.banner_alert_last_at).getTime()
      : 0;
    if (last && Date.now() - last < COOLDOWN_MS) {
      skipped += 1;
      continue;
    }

    const threshold = Math.max(1, Math.floor(Number(p.banner_alert_threshold) || 0));

    const { count, error: cErr } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("referral_partner_id", p.id)
      .or(
        `referral_detected_at.gte.${sinceIso},and(referral_detected_at.is.null,created_at.gte.${sinceIso})`,
      );

    if (cErr) {
      console.warn("[partner-banner-alerts] count failed", p.id, cErr.message);
      continue;
    }

    const leads24h = Number(count || 0);
    if (leads24h < threshold) {
      skipped += 1;
      continue;
    }

    const { data: cons } = await supabase
      .from("consultants")
      .select("phone, notification_phone")
      .eq("id", p.consultant_id)
      .maybeSingle();

    const consultantPhone = String(
      (cons as { notification_phone?: string | null; phone?: string | null } | null)
        ?.notification_phone ||
        (cons as { phone?: string | null } | null)?.phone ||
        "",
    ).trim();

    if (!consultantPhone) {
      details.push({ partner_id: p.id, ok: false, reason: "consultant_no_phone" });
      skipped += 1;
      continue;
    }

    const partnerLabel = String(p.nome || "Parceiro").trim();
    const text = [
      `📊 *Alerta de banners — ${partnerLabel}*`,
      ``,
      `Nas últimas 24h este parceiro gerou *${leads24h} lead(s)*.`,
      `Limiar configurado: *${threshold}*.`,
      p.short_code ? `Código: \`${p.short_code}\`` : null,
      ``,
      `Revise na Central de Banners → Parceiros.`,
    ]
      .filter(Boolean)
      .join("\n");

    const ok = await sendRawToNumber(p.consultant_id, consultantPhone, text);
    if (!ok) {
      details.push({ partner_id: p.id, ok: false, reason: "send_failed", leads24h });
      continue;
    }

    await supabase
      .from("referral_partners")
      .update({ banner_alert_last_at: new Date().toISOString() })
      .eq("id", p.id);

    // Espelho opcional no telefone do parceiro (se tiver).
    const partnerPhone = String(p.notification_phone || "").trim();
    if (partnerPhone) {
      const partnerText = [
        `📊 *Seus banners estão bombando!*`,
        ``,
        `Nas últimas 24h você gerou *${leads24h} lead(s)* (meta ${threshold}).`,
        `Continue divulgando o QR — o atendimento automático segue com você.`,
      ].join("\n");
      await sendRawToNumber(p.consultant_id, partnerPhone, partnerText);
    }

    sent += 1;
    details.push({ partner_id: p.id, ok: true, leads24h, threshold });
  }

  return Response.json({
    ok: true,
    checked,
    sent,
    skipped,
    details: details.slice(0, 20),
  });
});
