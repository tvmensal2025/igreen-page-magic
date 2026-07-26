/**
 * Implantar número WhatsApp Cloud na WABA da Página da plataforma (CTWA).
 *
 * Actions:
 *   status | create | request_code | verify_and_register | save_for_me | save_official
 *
 * Auth: JWT de qualquer consultor logado.
 * - save_official (plataforma): só SuperAdmin
 * - create/verify: consultor grava em consultant_ad_settings; se já tiver phone_id, bloqueia (única vez) salvo force + SuperAdmin
 */
import { authConsultant, corsHeaders } from "../_shared/fb-graph.ts";
import {
  assertSuperAdmin,
  createWabaPhoneNumber,
  discoverPlatformWabaId,
  digitsOf,
  generateTwoStepPin,
  listWabaPhones,
  loadConsultantWaLock,
  loadPlatformTokenAndPage,
  normalizeBrWaDigits,
  registerWaPhone,
  requestWaVerificationCode,
  saveConsultantWa,
  savePlatformOfficialWa,
  verifyWaCode,
} from "../_shared/platform-wa-register.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const LIMIT_HINT =
  "Limite Meta (portfólio Business): começa em 2 números registrados; sobe para 20 após verificação do negócio ou limite de mensagens 2.000. Adicionar um número novo NÃO invalida os que já estão na WABA.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await authConsultant(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const isSa = await assertSuperAdmin(auth.id);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status").trim();
    const force = body?.force === true && isSa;

    const platform = await loadPlatformTokenAndPage();
    if (!platform.ok) return json({ error: platform.error }, platform.status);

    const { token, pageId, pageName, pixelId, row } = platform;

    const wabaDiscovery = await discoverPlatformWabaId(pageId, token);
    if (!wabaDiscovery?.id) {
      return json({
        error:
          "A Página da plataforma não tem WABA Cloud API vinculada. Vincule uma WABA Cloud à Página uma vez (Business Suite) e reconecte o Facebook aceitando WhatsApp Business Management.",
        page_id: pageId,
        page_name: pageName,
        pixel_id: pixelId,
        hint: "page_backed (app WhatsApp) não serve para cadastrar número pela API.",
        limit_hint: LIMIT_HINT,
      }, 400);
    }
    const wabaId = wabaDiscovery.id;
    const numbers = await listWabaPhones(wabaId, token);
    const mine = await loadConsultantWaLock(auth.id);

    if (action === "status" || action === "limits") {
      // Probe Business: verificação + contagem de números em todas as WABAs acessíveis
      const businessesProbe: Array<Record<string, unknown>> = [];
      let totalPhonesAcrossBusiness = 0;
      let anyBusinessVerified = false;
      const meBiz = await fetch(
        `https://graph.facebook.com/v21.0/me/businesses?fields=id,name,verification_status,created_time`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then((r) => r.json()).catch(() => ({}));
      const bizRows = Array.isArray(meBiz?.data) ? meBiz.data : [];
      for (const b of bizRows) {
        const bid = String(b?.id || "");
        if (!bid) continue;
        // Meta usa valores como "verified" | "not_verified" | "pending" etc.
        const vStatus = String(b?.verification_status || "unknown");
        if (vStatus.toLowerCase() === "verified") anyBusinessVerified = true;

        let phoneCount = 0;
        const phoneSamples: Array<{ waba_id: string; id: string; display: string }> = [];
        for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
          const wr = await fetch(
            `https://graph.facebook.com/v21.0/${bid}/${kind}?fields=id,name`,
            { headers: { Authorization: `Bearer ${token}` } },
          ).then((r) => r.json()).catch(() => ({}));
          const wabas = Array.isArray(wr?.data) ? wr.data : [];
          for (const w of wabas) {
            const wid = String(w?.id || "");
            if (!wid) continue;
            const pr = await fetch(
              `https://graph.facebook.com/v21.0/${wid}/phone_numbers?fields=display_phone_number,code_verification_status,verified_name`,
              { headers: { Authorization: `Bearer ${token}` } },
            ).then((r) => r.json()).catch(() => ({}));
            const phones = Array.isArray(pr?.data) ? pr.data : [];
            phoneCount += phones.length;
            for (const p of phones.slice(0, 10)) {
              phoneSamples.push({
                waba_id: wid,
                id: String(p.id),
                display: String(p.display_phone_number || ""),
              });
            }
          }
        }
        totalPhonesAcrossBusiness += phoneCount;
        businessesProbe.push({
          id: bid,
          name: b?.name || null,
          verification_status: vStatus,
          phone_numbers_count: phoneCount,
          phone_samples: phoneSamples,
        });
      }

      // Limite documentado Meta: 2 inicial; 20 se business verified OU messaging limit 2k.
      // Não há endpoint público confiável para "pedir aumento" — é automático.
      const inferredCap = anyBusinessVerified ? 20 : 2;
      const increasePossibleViaApi = false;
      const increaseHow =
        anyBusinessVerified
          ? "Business já verificado → teto típico 20. Acima de 20 só via Meta Direct Support (Enterprise), não via API."
          : "Para ir de 2→20: conclua verificação do Business no Meta Business Suite (ou atinja limite de mensagens 2.000). Não existe pedido de aumento via API.";

      return json({
        ok: true,
        action: action === "limits" ? "limits" : "status",
        page_id: pageId,
        page_name: pageName,
        pixel_id: pixelId,
        waba_id: wabaId,
        waba_via: wabaDiscovery.via,
        numbers,
        numbers_count: numbers.length,
        numbers_on_page_waba: numbers.length,
        businesses: businessesProbe,
        total_phone_numbers_visible: totalPhonesAcrossBusiness,
        any_business_verified: anyBusinessVerified,
        inferred_max_phone_numbers_per_business: inferredCap,
        limit_initial: 2,
        limit_verified: 20,
        limit_hint: LIMIT_HINT,
        increase_via_api: increasePossibleViaApi,
        increase_how: increaseHow,
        mine: {
          locked: mine.locked,
          digits: mine.digits,
          phone_number_id: mine.phone_number_id,
        },
        official: {
          waba_id: row.waba_id || null,
          whatsapp_destination_number: row.whatsapp_destination_number || null,
          whatsapp_phone_number_id: row.whatsapp_phone_number_id || null,
          whatsapp_phone_number_display: row.whatsapp_phone_number_display || null,
          whatsapp_registered_at: row.whatsapp_registered_at || null,
        },
        is_super_admin: isSa,
      });
    }

    if (action === "save_official") {
      if (!isSa) {
        return json({ error: "Apenas SuperAdmin grava o número oficial da plataforma." }, 403);
      }
      const phoneNumberId = String(body?.phone_number_id || "").replace(/\D/g, "");
      if (!phoneNumberId) return json({ error: "phone_number_id obrigatório." }, 400);
      const match = numbers.find((n) => n.id === phoneNumberId);
      if (!match) {
        return json({
          error: "Este phone_number_id não está na WABA da Página. Cadastre o número primeiro (create + SMS).",
        }, 400);
      }
      await savePlatformOfficialWa({
        wabaId,
        phoneNumberId: match.id,
        digits: match.digits,
        display: match.display,
      });
      await saveConsultantWa({
        consultantId: auth.id,
        wabaId,
        phoneNumberId: match.id,
        digits: match.digits,
      });
      return json({
        ok: true,
        saved: true,
        waba_id: wabaId,
        phone_number_id: match.id,
        digits: match.digits,
        display: match.display,
        message: "Número oficial da plataforma gravado. Campanhas CTWA podem usar este destino.",
        limit_hint: LIMIT_HINT,
      });
    }

    if (action === "save_for_me") {
      if (mine.locked && !force) {
        return json({
          error:
            "Você já cadastrou um número CTWA (única vez). Se precisar trocar, peça ao SuperAdmin.",
          mine,
        }, 409);
      }
      const phoneNumberId = String(body?.phone_number_id || "").replace(/\D/g, "");
      if (!phoneNumberId) return json({ error: "phone_number_id obrigatório." }, 400);
      const match = numbers.find((n) => n.id === phoneNumberId);
      if (!match) {
        return json({ error: "Número não está na WABA da Página." }, 400);
      }
      await saveConsultantWa({
        consultantId: auth.id,
        wabaId,
        phoneNumberId: match.id,
        digits: match.digits,
      });
      // Preenche oficial da plataforma só se ainda vazio
      if (!row.whatsapp_phone_number_id) {
        await savePlatformOfficialWa({
          wabaId,
          phoneNumberId: match.id,
          digits: match.digits,
          display: match.display,
        });
      }
      return json({
        ok: true,
        step: "done",
        saved: true,
        waba_id: wabaId,
        phone_number_id: match.id,
        digits: match.digits,
        display: match.display,
        message: "Número vinculado à sua conta para anúncios CTWA.",
        limit_hint: LIMIT_HINT,
      });
    }

    if (action === "create") {
      if (mine.locked && !force) {
        return json({
          error:
            "Você já cadastrou um número CTWA (única vez). Troca só com SuperAdmin.",
          mine,
          limit_hint: LIMIT_HINT,
        }, 409);
      }

      const norm = normalizeBrWaDigits(String(body?.phone || body?.number || ""));
      if (!norm.ok) return json({ error: norm.error }, 400);
      const verifiedName = String(body?.verified_name || "iGreen Energy").trim() || "iGreen Energy";

      const existing = numbers.find((n) => {
        const a = digitsOf(n.digits);
        const b = norm.digits;
        return a === b || a.endsWith(norm.national) || b.endsWith(n.digits.slice(-8));
      });

      let phoneNumberId = existing?.id || "";
      let created = false;

      if (!phoneNumberId) {
        const createdRes = await createWabaPhoneNumber({
          wabaId,
          token,
          national: norm.national,
          verifiedName,
        });
        if (!createdRes.ok) {
          return json({
            error: createdRes.error,
            limit_hint: LIMIT_HINT,
            numbers_count: numbers.length,
          }, 400);
        }
        phoneNumberId = createdRes.phone_number_id;
        created = true;
      }

      const verStatus = String(existing?.code_verification_status || "").toUpperCase();
      if (existing && verStatus === "VERIFIED") {
        await saveConsultantWa({
          consultantId: auth.id,
          wabaId,
          phoneNumberId: existing.id,
          digits: existing.digits,
        });
        if (!row.whatsapp_phone_number_id || isSa) {
          await savePlatformOfficialWa({
            wabaId,
            phoneNumberId: existing.id,
            digits: existing.digits,
            display: existing.display,
          });
        }
        return json({
          ok: true,
          step: "done",
          created: false,
          already_on_waba: true,
          skipped_sms: true,
          phone_number_id: existing.id,
          waba_id: wabaId,
          digits: existing.digits,
          display: existing.display,
          message: "Número já verificado na WABA — vinculado à sua conta sem SMS.",
          page_id: pageId,
          pixel_id: pixelId,
          limit_hint: LIMIT_HINT,
        });
      }

      const codeRes = await requestWaVerificationCode({ phoneNumberId, token, method: "SMS" });
      if (!codeRes.ok) {
        return json({
          error: codeRes.error,
          phone_number_id: phoneNumberId,
          created,
          waba_id: wabaId,
          digits: norm.digits,
          already_on_waba: Boolean(existing),
          limit_hint: LIMIT_HINT,
        }, 400);
      }

      return json({
        ok: true,
        step: "awaiting_sms",
        created,
        already_on_waba: Boolean(existing),
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        digits: norm.digits,
        display: existing?.display || `+${norm.digits}`,
        message: existing
          ? "Número já estava na WABA. Enviamos um SMS de verificação — digite o código."
          : "Número criado na WABA. Enviamos um SMS — digite o código recebido no chip.",
        limit_hint: LIMIT_HINT,
      });
    }

    if (action === "request_code") {
      const phoneNumberId = String(body?.phone_number_id || "").replace(/\D/g, "");
      if (!phoneNumberId) return json({ error: "phone_number_id obrigatório." }, 400);
      const method = body?.method === "VOICE" ? "VOICE" as const : "SMS" as const;
      const codeRes = await requestWaVerificationCode({ phoneNumberId, token, method });
      if (!codeRes.ok) return json({ error: codeRes.error }, 400);
      return json({
        ok: true,
        step: "awaiting_sms",
        phone_number_id: phoneNumberId,
        method,
        message: method === "VOICE"
          ? "Ligação com código solicitada. Digite o código quando atender."
          : "SMS reenviado. Digite o código recebido.",
      });
    }

    if (action === "verify_and_register") {
      if (mine.locked && !force) {
        return json({
          error: "Você já cadastrou um número CTWA (única vez).",
          mine,
        }, 409);
      }

      const phoneNumberId = String(body?.phone_number_id || "").replace(/\D/g, "");
      const code = String(body?.code || "").replace(/\D/g, "");
      if (!phoneNumberId) return json({ error: "phone_number_id obrigatório." }, 400);
      if (code.length < 4) return json({ error: "Informe o código SMS recebido." }, 400);

      const verified = await verifyWaCode({ phoneNumberId, token, code });
      if (!verified.ok) return json({ error: verified.error }, 400);

      const pin = generateTwoStepPin();
      const registered = await registerWaPhone({ phoneNumberId, token, pin });
      if (!registered.ok) return json({ error: registered.error }, 400);

      const refreshed = await listWabaPhones(wabaId, token);
      const match = refreshed.find((n) => n.id === phoneNumberId);
      const digits = match?.digits || digitsOf(body?.digits) || "";
      const display = match?.display || (digits ? `+${digits}` : phoneNumberId);

      if (!digits) {
        return json({
          error: "Registro ok na Meta, mas não conseguimos ler o display do número. Use save_for_me depois.",
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          two_step_pin: pin,
        }, 400);
      }

      await saveConsultantWa({
        consultantId: auth.id,
        wabaId,
        phoneNumberId,
        digits,
      });
      if (!row.whatsapp_phone_number_id || isSa) {
        await savePlatformOfficialWa({
          wabaId,
          phoneNumberId,
          digits,
          display,
        });
      }

      return json({
        ok: true,
        step: "done",
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        digits,
        display,
        two_step_pin: pin,
        message:
          "Número verificado e registrado. Gravado na sua conta para CTWA (cadastro único). Guarde o PIN de 2 etapas se a Meta pedir de novo.",
        page_id: pageId,
        pixel_id: pixelId,
        limit_hint: LIMIT_HINT,
      });
    }


    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});
