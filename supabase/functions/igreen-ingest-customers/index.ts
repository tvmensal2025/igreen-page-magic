// igreen-ingest-customers
// Recebe payload de clientes da extensão Chrome do consultor.
// Autenticação via header x-pairing-token (token opaco, comparado por hash).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pairing-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return "";
}

function mapStatus(a?: string): string {
  if (!a) return "pending";
  const l = a.toLowerCase().trim();
  if (l === "validado" || l === "aprovado" || l === "ativo") return "approved";
  if (l === "devolutiva") return "devolutiva";
  if (l === "reprovado" || l === "cancelado") return "rejected";
  if (l.includes("falta assinatura")) return "awaiting_signature";
  if (l.includes("aguardando")) return "pending";
  if (l === "pendente" || l === "em análise" || l === "em analise") return "pending";
  if (l === "lead" || l === "novo") return "lead";
  return "pending";
}

const safeStr = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
const safeNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", ".").replace("%", ""));
  return isNaN(n) ? null : n;
};
function get(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k];
    const f = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
    if (f && o[f] != null && o[f] !== "") return o[f];
  }
  return null;
}

function buildRecord(c: Record<string, unknown>): Record<string, unknown> | null {
  const phoneRaw = get(c, "celular", "telefone", "phone", "whatsapp");
  let phone = normalizePhone(String(phoneRaw || ""));
  let placeholder = false;
  if (!phone || phone.length < 12) {
    const fb = safeStr(get(c, "codigoCliente", "codigo", "codigoIgreen", "id", "numeroInstalacao"));
    if (!fb) return null;
    phone = `sem_celular_${fb.replace(/\D/g, "")}`;
    placeholder = true;
  }
  const rec: Record<string, unknown> = {
    phone_whatsapp: phone,
    customer_origin: "igreen_sync",
    phone_contact_confirmed: false,
  };
  const name = safeStr(get(c, "nomeCliente", "nome", "name"));
  if (name) rec.name = name;
  const statusRaw = safeStr(get(c, "andamento", "status"));
  rec.status = placeholder ? "contato_incompleto" : mapStatus(statusRaw || undefined);
  const cpf = safeStr(get(c, "cpf", "documento"));
  if (cpf) rec.cpf = cpf.replace(/\D/g, "");
  const email = safeStr(get(c, "email"));
  if (email) rec.email = email;
  const city = safeStr(get(c, "cidade", "municipio"));
  if (city) rec.address_city = city;
  const state = safeStr(get(c, "uf", "estado"));
  if (state) rec.address_state = state.toUpperCase();
  const dist = safeStr(get(c, "distribuidora"));
  if (dist) rec.distribuidora = dist;
  const andamento = safeStr(get(c, "andamento"));
  if (andamento) rec.andamento_igreen = andamento;
  const dev = safeStr(get(c, "devolutiva"));
  if (dev) rec.devolutiva = dev;
  const icode = safeStr(get(c, "codigoIgreen", "codigoCliente", "codigo"));
  if (icode) rec.igreen_code = icode;
  const cons = safeNum(get(c, "consumoMedio", "consumo_medio"));
  if (cons != null) rec.media_consumo = cons;
  const desc = safeNum(get(c, "descontoCliente", "desconto"));
  if (desc != null) rec.desconto_cliente = desc;
  const inst = safeStr(get(c, "numeroInstalacao", "instalacao"));
  if (inst) rec.numero_instalacao = inst;
  const nasc = safeStr(get(c, "dataNascimento", "data_nascimento", "nascimento"));
  if (nasc) {
    const m = nasc.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
      rec.data_nascimento = `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(nasc)) {
      rec.data_nascimento = nasc.slice(0, 10);
    }
  }
  return rec;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);
    const isHealth = url.pathname.endsWith("/health") || url.searchParams.get("health") === "1";

    const token = req.headers.get("x-pairing-token") || "";
    if (!token) {
      return new Response(JSON.stringify({ error: "missing_pairing_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenHash = await sha256Hex(token);
    const { data: tokenRow, error: tErr } = await supabase
      .from("igreen_extension_tokens")
      .select("id, consultant_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tErr || !tokenRow) {
      return new Response(JSON.stringify({ error: "invalid_pairing_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.revoked_at) {
      return new Response(JSON.stringify({ error: "token_revoked" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "token_expired" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

    await supabase
      .from("igreen_extension_tokens")
      .update({ last_used_at: new Date().toISOString(), last_used_ip: ip })
      .eq("id", tokenRow.id);

    if (isHealth) {
      return new Response(
        JSON.stringify({ ok: true, consultant_id: tokenRow.consultant_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const customers: Record<string, unknown>[] = Array.isArray(body?.customers)
      ? body.customers
      : [];

    if (customers.length === 0) {
      return new Response(JSON.stringify({ ok: true, received: 0, upserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const consultantId = tokenRow.consultant_id as string;
    const seen = new Set<string>();
    const records: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const c of customers) {
      const rec = buildRecord(c);
      if (!rec?.phone_whatsapp) {
        skipped++;
        continue;
      }
      let phone = String(rec.phone_whatsapp);
      if (seen.has(phone)) {
        const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo"));
        if (!icode) continue;
        phone = `${phone}_${icode}`;
        rec.phone_whatsapp = phone;
      }
      seen.add(phone);
      rec.consultant_id = consultantId;
      records.push(rec);
    }

    // Protege leads em conversa
    const phones = records.map((r) => String(r.phone_whatsapp));
    const midConv = new Set<string>();
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const { data } = await supabase
        .from("customers")
        .select("phone_whatsapp, conversation_step")
        .in("phone_whatsapp", chunk)
        .not("conversation_step", "is", null);
      for (const e of (data || []) as Array<{ phone_whatsapp: string; conversation_step: string | null }>) {
        if (e.conversation_step && e.conversation_step !== "complete") midConv.add(e.phone_whatsapp);
      }
    }
    for (const r of records) if (midConv.has(String(r.phone_whatsapp))) delete r.status;

    let upserted = 0;
    let errors = 0;
    for (let i = 0; i < records.length; i += 100) {
      const batch = records.slice(i, i + 100);
      const { data, error } = await supabase
        .from("customers")
        .upsert(batch, { onConflict: "phone_whatsapp,consultant_id", ignoreDuplicates: false })
        .select("id");
      if (error) {
        console.error("upsert error", error);
        errors += batch.length;
      } else {
        upserted += data?.length || 0;
      }
    }

    await supabase
      .from("settings")
      .upsert({ key: `last_igreen_ext_sync_${consultantId}`, value: new Date().toISOString() }, { onConflict: "key" });

    return new Response(
      JSON.stringify({
        ok: true,
        received: customers.length,
        processed: records.length,
        upserted,
        errors,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("igreen-ingest-customers error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
