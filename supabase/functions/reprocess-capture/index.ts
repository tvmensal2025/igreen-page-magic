// Reprocess capture: roda OCR sob demanda numa mídia que o cliente JÁ enviou.
// Usado quando o consultor clica em "Captura conta" / "Captura documento" e
// queremos reaproveitar o arquivo que está em customer.last_inbound_media_url
// (ou electricity_bill_photo_url / document_front_url).
//
// NÃO envia mensagem ao cliente. Apenas preenche os campos do customer para
// que o card "Dados lidos da CONTA / DOCUMENTO" apareça no painel com os
// botões SIM / EDITAR / NÃO (ou "Pedir ao cliente").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ocrContaEnergia, ocrDocumentoFrenteVerso } from "../_shared/ocr.ts";
import { buscarCepPorEndereco } from "../_shared/utils.ts";

type Kind = "bill" | "doc";

interface Body {
  customerId: string;
  kind: Kind;
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function urlToBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { mime: m[1], base64: m[2] };
      return null;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
    }
    const base64 = btoa(binary);
    const mime = res.headers.get("content-type") || "application/octet-stream";
    return { base64, mime };
  } catch (e) {
    console.warn("[reprocess-capture] urlToBase64 failed:", (e as Error).message);
    return null;
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

    if (body.kind === "bill") {
      const url = (customer as any).electricity_bill_photo_url
        || (customer as any).last_inbound_media_url;
      if (!url) return json({ ok: false, error: "no_file_to_reprocess" }, 400);

      const dl = await urlToBase64(url);
      if (!dl) return json({ ok: false, error: "download_failed" }, 502);

      const mediaMsg = { mimetype: dl.mime };
      const ocrData = await ocrContaEnergia(url, geminiApiKey, dl.base64, mediaMsg);
      if (!ocrData.sucesso || !ocrData.dados) {
        return json({ ok: false, error: "ocr_failed", detail: ocrData.erro || "" }, 200);
      }
      const d = ocrData.dados;
      const confianca = typeof d.confianca === "number" ? d.confianca : 80;

      if (d.nome) updates.bill_holder_name = String(d.nome).trim();
      if (!customer.name && d.nome) {
        updates.name = String(d.nome).trim();
        updates.name_source = "ocr_conta";
      }
      updates.address_street = d.endereco || customer.address_street || "";
      updates.address_number = d.numero || customer.address_number || "";
      updates.address_neighborhood = d.bairro || customer.address_neighborhood || "";
      updates.address_city = d.cidade || customer.address_city || "";
      updates.address_state = d.estado || customer.address_state || "";
      updates.distribuidora = d.distribuidora || customer.distribuidora || "";
      {
        const inst = String(d.numeroInstalacao || "").replace(/\D/g, "");
        if (inst.length >= 7) updates.numero_instalacao = inst;
      }
      {
        const cepClean = String(d.cep || "").replace(/\D/g, "");
        if (cepClean.length === 8) updates.cep = cepClean;
      }
      if (!updates.cep && updates.address_city && updates.address_state && updates.address_street) {
        const cepBuscado = await buscarCepPorEndereco(updates.address_state, updates.address_city, updates.address_street);
        if (cepBuscado) updates.cep = cepBuscado;
      }
      updates.ocr_confianca = confianca;
      const valorParsed = d.valorConta ? parseFloat(String(d.valorConta).replace(",", ".")) : 0;
      if (valorParsed >= 30) updates.electricity_bill_value = valorParsed;

      // Salva a URL como bill photo (se ainda não foi)
      if (!customer.electricity_bill_photo_url) {
        updates.electricity_bill_photo_url = url;
      }

      // Limpa confirmação anterior pra forçar o card aparecer de novo se foi reprocessado
      updates.bill_data_confirmed_at = null;
      updates.bill_data_confirmation_by = null;
      // Sinaliza que o lead está em fase de coleta da conta
      updates.conversation_step = "confirmando_dados_conta";

      await supabase.from("customers").update(updates).eq("id", customer.id);
      return json({ ok: true, kind: "bill", confianca, fields: updates });
    }

    if (body.kind === "doc") {
      const frenteUrl = (customer as any).document_front_url
        || (customer as any).last_inbound_media_url;
      const versoUrl = (customer as any).document_back_url || null;
      if (!frenteUrl) return json({ ok: false, error: "no_file_to_reprocess" }, 400);

      const frenteDl = await urlToBase64(frenteUrl);
      if (!frenteDl) return json({ ok: false, error: "download_failed" }, 502);
      const versoDl = versoUrl ? await urlToBase64(versoUrl) : null;

      // Detecta o tipo de documento pra escolher o prompt certo (CNH x RG).
      // Antes era fixo "RG_NOVO", o que fazia o OCR de CNH sair errado (campos
      // trocados/posições diferentes). CNH = sem verso ("nao_aplicavel") ou
      // document_type contendo "cnh".
      const isCnh =
        String((customer as any).document_back_url || "") === "nao_aplicavel" ||
        String((customer as any).document_type || "").toLowerCase().includes("cnh");
      const tipoDoc = isCnh ? "CNH" : "RG_NOVO";

      const ocrData = await ocrDocumentoFrenteVerso(
        frenteUrl,
        // CNH não tem verso — não passa versoUrl pra IA não tentar ler RG no verso.
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
      if (!customer.name && d.nome) {
        updates.name = String(d.nome).trim();
        updates.name_source = "ocr_doc";
      }
      if (d.cpf) updates.cpf = String(d.cpf).replace(/\D/g, "");
      if (d.rg) updates.rg = d.rg;
      if (d.dataNascimento) updates.data_nascimento = d.dataNascimento;
      if (d.nomeMae) updates.nome_mae = d.nomeMae;
      if (!customer.document_front_url) updates.document_front_url = frenteUrl;

      updates.doc_data_confirmed_at = null;
      updates.doc_data_confirmation_by = null;
      updates.conversation_step = "confirmando_dados_doc";

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
