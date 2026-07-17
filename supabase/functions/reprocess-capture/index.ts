// Reprocess capture: roda OCR sob demanda numa mídia que o cliente JÁ enviou.
// Usado quando o consultor anexa conta/documento na ficha (CaptureDocumentTiles)
// ou via "Usar como Conta/Documento" no chat.
//
// NÃO envia mensagem ao cliente. Apenas preenche os campos do customer para
// que o card "Dados lidos da CONTA / DOCUMENTO" apareça no painel.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ocrContaEnergia, ocrDocumentoFrenteVerso } from "../_shared/ocr.ts";
import { buscarCepPorEndereco } from "../_shared/utils.ts";
import { parseMoneyBR } from "../_shared/parse-money.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "bill" | "doc";

interface Body {
  customerId: string;
  kind: Kind;
}

/** Fontes que o consultor/cliente confirmaram — OCR não sobrescreve. */
const PROTECTED_NAME_SOURCES = new Set(["manual", "user_confirmed"]);

/**
 * OCR deve completar a ficha sobrepondo WhatsApp / número fake / nome curto.
 * Só preserva nome se a fonte for manual ou user_confirmed.
 */
function shouldApplyOcrName(customer: Record<string, any>, ocrName: string): boolean {
  const nome = String(ocrName || "").trim();
  if (!nome) return false;
  const src = String(customer.name_source || "").toLowerCase().trim();
  if (PROTECTED_NAME_SOURCES.has(src)) return false;
  const cur = String(customer.name || "").trim();
  if (!cur) return true;
  if (cur.toLowerCase() === nome.toLowerCase()) return false;
  // Número / JID fake no lugar do nome
  const digits = cur.replace(/\D/g, "");
  if (digits.length >= 8 && !/[a-zA-ZÀ-ú]/.test(cur)) return true;
  // Qualquer fonte fraca (whatsapp_profile, unknown, freeform, ocr antigo incompleto…)
  return true;
}

function applyOcrName(
  updates: Record<string, any>,
  customer: Record<string, any>,
  ocrName: string,
  source: "ocr_conta" | "ocr_doc",
) {
  const nome = String(ocrName || "").trim();
  if (!nome) return;
  if (!shouldApplyOcrName(customer, nome)) return;
  updates.name = nome;
  updates.name_source = source;
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
  }
  return btoa(binary);
}

/** Extrai bucket + path de URL do Supabase Storage (public/sign/authenticated). */
function parseSupabaseStorageUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (!m) return null;
    return {
      bucket: decodeURIComponent(m[1]),
      path: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

/**
 * Baixa mídia para OCR.
 * Bucket `whatsapp-media` é PRIVADO — fetch na URL /object/public/ falha.
 * Usa service role no Storage quando a URL for do Supabase.
 */
async function urlToBase64(
  supabase: SupabaseClient,
  url: string,
): Promise<{ base64: string; mime: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { mime: m[1], base64: m[2] };
      return null;
    }

    const parsed = parseSupabaseStorageUrl(url);
    if (parsed) {
      const { data, error } = await supabase.storage.from(parsed.bucket).download(parsed.path);
      if (error || !data) {
        console.warn(
          "[reprocess-capture] storage.download failed:",
          parsed.bucket,
          parsed.path,
          error?.message,
        );
      } else {
        const buf = new Uint8Array(await data.arrayBuffer());
        const mime = data.type || "application/octet-stream";
        return { base64: bytesToBase64(buf), mime };
      }
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[reprocess-capture] fetch failed:", res.status, url.slice(0, 120));
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "application/octet-stream";
    return { base64: bytesToBase64(buf), mime };
  } catch (e) {
    console.warn("[reprocess-capture] urlToBase64 failed:", (e as Error).message);
    return null;
  }
}

function applyMediaConsumo(updates: Record<string, any>, d: Record<string, any>, valorParsed: number) {
  const kwhOcr = parseInt(String(d.consumoMedio || "").replace(/\D/g, ""), 10);
  const valor = Number(valorParsed || updates.electricity_bill_value || 0);
  let ratioOk = true;
  if (!isNaN(kwhOcr) && kwhOcr >= 50 && valor >= 30) {
    const ratio = valor / kwhOcr;
    ratioOk = ratio >= 0.70 && ratio <= 1.60;
    if (!ratioOk) {
      updates.ocr_consumo_rejeitado = true;
      updates.ocr_consumo_original = kwhOcr;
    }
  }
  if (ratioOk && !isNaN(kwhOcr) && kwhOcr >= 50 && kwhOcr <= 5000) {
    updates.media_consumo = kwhOcr;
  } else if (valor >= 30) {
    updates.media_consumo = Math.max(100, Math.min(2000, Math.round(valor / 1.10)));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: consultor dono ou super_admin
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.customerId || !body?.kind) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("id", body.customerId)
      .maybeSingle();
    if (!customer) return json({ ok: false, error: "customer_not_found" }, 404);

    if (customer.consultant_id !== userId) {
      const { data: isAdmin } = await supabase.rpc("is_super_admin", { _user_id: userId });
      if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";
    if (!geminiApiKey) return json({ ok: false, error: "no_gemini_key" }, 500);

    const updates: Record<string, any> = {};
    const isManualCapture = String((customer as any).capture_mode || "") === "manual";

    if (body.kind === "bill") {
      const url = (customer as any).electricity_bill_photo_url
        || (customer as any).last_inbound_media_url;
      if (!url) return json({ ok: false, error: "no_file_to_reprocess" }, 400);

      const dl = await urlToBase64(supabase, url);
      if (!dl) return json({ ok: false, error: "download_failed" }, 502);

      const mediaMsg = { mimetype: dl.mime };
      const ocrData = await ocrContaEnergia(url, geminiApiKey, dl.base64, mediaMsg);
      if (!ocrData.sucesso || !ocrData.dados) {
        return json({ ok: false, error: "ocr_failed", detail: ocrData.erro || "" }, 200);
      }
      const d = ocrData.dados;
      const confianca = typeof d.confianca === "number" ? d.confianca : 80;

      if (d.nome) updates.bill_holder_name = String(d.nome).trim();
      if (d.nome) applyOcrName(updates, customer as any, String(d.nome), "ocr_conta");
      if (d.endereco) updates.address_street = String(d.endereco).trim();
      if (d.numero) updates.address_number = String(d.numero).trim();
      if (d.bairro) updates.address_neighborhood = String(d.bairro).trim();
      if (d.cidade) updates.address_city = String(d.cidade).trim();
      if (d.estado) updates.address_state = String(d.estado).trim();
      if (d.distribuidora) updates.distribuidora = String(d.distribuidora).trim();
      {
        const inst = String(d.numeroInstalacao || "").replace(/\D/g, "");
        if (inst.length >= 7) updates.numero_instalacao = inst;
      }
      {
        const cepClean = String(d.cep || "").replace(/\D/g, "");
        if (cepClean.length === 8) updates.cep = cepClean;
      }
      if (!updates.cep && updates.address_city && updates.address_state && updates.address_street) {
        const cepBuscado = await buscarCepPorEndereco(
          updates.address_state,
          updates.address_city,
          updates.address_street,
        );
        if (cepBuscado) updates.cep = cepBuscado;
      }
      updates.ocr_confianca = confianca;
      const valorParsed = parseMoneyBR(d.valorConta) ?? 0;
      if (valorParsed >= 30) updates.electricity_bill_value = valorParsed;
      applyMediaConsumo(updates, d, valorParsed);

      // Salva a URL como bill photo (se ainda não foi)
      if (!customer.electricity_bill_photo_url) {
        updates.electricity_bill_photo_url = url;
      }

      // Limpa confirmação anterior pra forçar o card aparecer de novo se foi reprocessado
      updates.bill_data_confirmed_at = null;
      updates.bill_data_confirmation_by = null;
      // Modo manual: consultor controla o passo — não muda conversation_step
      // (evita motor/bot reagir a "confirmando_dados_conta").
      if (!isManualCapture) {
        updates.conversation_step = "confirmando_dados_conta";
      }

      await supabase.from("customers").update(updates).eq("id", customer.id);
      return json({ ok: true, kind: "bill", confianca, fields: updates });
    }

    if (body.kind === "doc") {
      const frenteUrl = (customer as any).document_front_url
        || (customer as any).last_inbound_media_url;
      const versoUrl = (customer as any).document_back_url || null;
      if (!frenteUrl) return json({ ok: false, error: "no_file_to_reprocess" }, 400);

      const frenteDl = await urlToBase64(supabase, frenteUrl);
      if (!frenteDl) return json({ ok: false, error: "download_failed" }, 502);
      const versoDl = versoUrl && versoUrl !== "nao_aplicavel"
        ? await urlToBase64(supabase, versoUrl)
        : null;

      // Detecta o tipo de documento pra escolher o prompt certo (CNH x RG).
      const isCnh =
        String((customer as any).document_back_url || "") === "nao_aplicavel" ||
        String((customer as any).document_type || "").toLowerCase().includes("cnh");
      const tipoDoc = isCnh ? "CNH" : "RG_NOVO";

      const ocrData = await ocrDocumentoFrenteVerso(
        frenteUrl,
        isCnh ? null : versoUrl,
        tipoDoc,
        geminiApiKey,
        frenteDl.base64,
        { mimetype: frenteDl.mime },
        isCnh ? undefined : versoDl?.base64,
      );
      if (!ocrData.sucesso || !ocrData.dados) {
        return json({ ok: false, error: "ocr_failed", detail: ocrData.erro || "" }, 200);
      }
      const d = ocrData.dados;
      if (d.nome) updates.doc_holder_name = String(d.nome).trim();
      if (d.nome) applyOcrName(updates, customer as any, String(d.nome), "ocr_doc");
      if (d.cpf) updates.cpf = String(d.cpf).replace(/\D/g, "");
      if (d.rg) updates.rg = d.rg;
      if (d.dataNascimento) updates.data_nascimento = d.dataNascimento;
      if (d.nomeMae) updates.nome_mae = d.nomeMae;
      if (!customer.document_front_url) updates.document_front_url = frenteUrl;

      updates.doc_data_confirmed_at = null;
      updates.doc_data_confirmation_by = null;
      if (!isManualCapture) {
        updates.conversation_step = "confirmando_dados_doc";
      }

      await supabase.from("customers").update(updates).eq("id", customer.id);
      return json({ ok: true, kind: "doc", fields: updates });
    }

    return json({ ok: false, error: "invalid_kind" }, 400);
  } catch (e) {
    const msg = (e as Error).message || "internal_error";
    console.error("[reprocess-capture] error", msg);
    return json({ ok: false, error: "internal_error", message: msg }, 500);
  }
});
