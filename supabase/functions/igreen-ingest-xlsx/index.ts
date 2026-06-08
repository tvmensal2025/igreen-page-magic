// igreen-ingest-xlsx
// Recebe os arquivos .xlsx exportados pelos botoes "Exportar Excel" do portal
// /mapa-clientes e /mapa-rede. Faz parse, upsert em customers e consultant_network.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

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

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseXlsx(b64: string): Record<string, unknown>[] {
  if (!b64) return [];
  const bytes = b64ToUint8(b64);
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });
}

const safeStr = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
const safeNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".").replace("%", ""));
  return isNaN(n) ? null : n;
};
const safeInt = (v: unknown): number | null => {
  const n = safeNum(v);
  return n == null ? null : Math.round(n);
};
// dd/mm/yyyy → yyyy-mm-dd (Postgres date). Aceita também ISO já formatado.
const parseDateBR = (v: unknown): string | null => {
  const s = safeStr(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
};
// Limpa devolutiva: remove prefixos "caminhoarquivo:", "caminhoarquivodoc1:", etc.
const cleanDevolutiva = (v: unknown): string | null => {
  const s = safeStr(v);
  if (!s) return null;
  return s
    .replace(/caminho[a-z0-9]*\s*:\s*/gi, "")
    .replace(/\s*,\s+/g, " | ")
    .replace(/\s{2,}/g, " ")
    .trim() || null;
};

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  const lowerMap: Record<string, unknown> = {};
  for (const k of Object.keys(row)) lowerMap[k.toLowerCase().trim()] = row[k];
  for (const k of keys) {
    const v = lowerMap[k.toLowerCase().trim()];
    if (v != null && v !== "") return v;
  }
  return null;
}

function normalizePhone(raw: unknown): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return "";
}

function mapStatus(a?: string | null): string {
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

function buildCustomerRecord(r: Record<string, unknown>): Record<string, unknown> | null {
  const phoneRaw = pick(r, "Celular", "celular", "Telefone", "telefone", "WhatsApp", "phone");
  let phone = normalizePhone(phoneRaw);
  let placeholder = false;
  const codigo = safeStr(pick(r, "Código", "Codigo", "codigoCliente", "codigoIgreen", "ID", "Cód"));
  if (!phone || phone.length < 12) {
    const fb = codigo || safeStr(pick(r, "Instalação", "Instalacao", "numeroInstalacao"));
    if (!fb) return null;
    phone = `sem_celular_${String(fb).replace(/\D/g, "")}`;
    placeholder = true;
  }
  const rec: Record<string, unknown> = {
    phone_whatsapp: phone,
    customer_origin: "igreen_sync",
    phone_contact_confirmed: false,
  };
  const name = safeStr(pick(r, "Nome do Cliente", "Nome", "Cliente", "nomeCliente", "name"));
  if (name) rec.name = name;
  const statusRaw = safeStr(pick(r, "Andamento", "Status", "andamento"));

  // Datas iGreen (define aprovado se vier Data Validado ou Data Ativo)
  const dCadastro = parseDateBR(pick(r, "Data Cadastro", "data cadastro", "dataCadastro"));
  const dAtivo = parseDateBR(pick(r, "Data Ativo", "data ativo", "dataAtivo"));
  const dValidado = parseDateBR(pick(r, "Data Validado", "data validado", "dataValidado"));
  if (dCadastro) rec.data_cadastro_igreen = dCadastro;
  if (dAtivo) rec.data_ativo_igreen = dAtivo;
  if (dValidado) rec.data_validado_igreen = dValidado;

  if (placeholder) {
    rec.status = "contato_incompleto";
  } else if (dValidado || dAtivo) {
    rec.status = "approved";
  } else {
    rec.status = mapStatus(statusRaw);
  }

  const cpf = safeStr(pick(r, "CPF", "Documento", "cpf"));
  if (cpf) rec.cpf = String(cpf).replace(/\D/g, "");
  const email = safeStr(pick(r, "E-mail", "Email", "email"));
  if (email) rec.email = email;
  const city = safeStr(pick(r, "Cidade", "Município", "Municipio"));
  if (city) rec.address_city = city;
  const state = safeStr(pick(r, "UF", "Estado"));
  if (state) rec.address_state = String(state).toUpperCase();
  const dist = safeStr(pick(r, "Distribuidora"));
  if (dist) rec.distribuidora = dist;
  if (statusRaw) rec.andamento_igreen = statusRaw;
  const dev = cleanDevolutiva(pick(r, "Devolutiva"));
  if (dev) rec.devolutiva = dev;
  if (codigo) rec.igreen_code = codigo;
  const cons = safeNum(pick(r, "Consumo Médio", "Consumo Medio", "consumoMedio"));
  if (cons != null) rec.media_consumo = cons;
  const desc = safeNum(pick(r, "Desconto", "Desconto Cliente", "descontoCliente"));
  if (desc != null) rec.desconto_cliente = desc;
  const inst = safeStr(pick(r, "Instalação", "Instalacao", "Nº Instalação", "numeroInstalacao"));
  if (inst) rec.numero_instalacao = inst;

  // Licenciado (CRÍTICO para Top Licenciado)
  const licName = safeStr(pick(r, "Licenciado", "licenciado", "Nome Licenciado"));
  if (licName) rec.registered_by_name = licName;
  const licCode = safeInt(pick(r, "Código Licenciado", "Codigo Licenciado", "codigoLicenciado", "Cod Licenciado"));
  if (licCode != null && licCode > 0) rec.registered_by_igreen_id = licCode;

  // Demais campos
  const nivel = safeInt(pick(r, "Nível", "Nivel", "Level"));
  if (nivel != null) rec.nivel_licenciado = nivel;
  const dNasc = parseDateBR(pick(r, "Data Nascimento", "Nascimento", "dataNascimento"));
  if (dNasc) rec.data_nascimento = dNasc;
  const cashback = safeStr(pick(r, "Cashback"));
  if (cashback) rec.cashback_igreen = cashback;
  const statusFin = safeStr(pick(r, "Status Financeiro", "statusFinanceiro"));
  if (statusFin) rec.status_financeiro = statusFin;
  const assCliente = safeStr(pick(r, "Assinatura Cliente"));
  if (assCliente) rec.assinatura_cliente_status = assCliente;
  const assIgreen = safeStr(pick(r, "Assinatura iGreen", "Assinatura Igreen"));
  if (assIgreen) rec.assinatura_igreen_status = assIgreen;
  const linkAss = safeStr(pick(r, "Link Assinatura", "linkAssinatura"));
  if (linkAss) rec.link_assinatura = linkAss;
  const obs = safeStr(pick(r, "Observação", "Observacao"));
  if (obs) rec.observacao_igreen = obs;

  return rec;
}

function buildNetworkRecord(r: Record<string, unknown>, mesRef: string): Record<string, unknown> | null {
  const codigo = safeStr(pick(r, "ID", "Código", "Codigo", "Cód", "codigo"));
  if (!codigo) return null;
  return {
    codigo_igreen: codigo,
    nivel: safeInt(pick(r, "Nível", "Nivel", "Level")),
    nome: safeStr(pick(r, "Nome", "Consultor", "Nome do Consultor")),
    patrocinador_codigo: safeStr(pick(r, "Patrocinador", "Patrocinador Código", "Cod Patrocinador")),
    celular: safeStr(pick(r, "Celular", "Telefone", "WhatsApp")),
    cidade: safeStr(pick(r, "Cidade", "Município")),
    uf: (() => { const s = safeStr(pick(r, "UF", "Estado")); return s ? s.toUpperCase() : null; })(),
    graduacao: safeStr(pick(r, "Graduação", "Graduacao", "Cargo")),
    // Planilha usa "GP Qualificável" / "GI Qualificável" (singular, com acento)
    gp_qualificados: safeNum(pick(r, "GP Qualificável", "GP Qualificavel", "GP Qualificados", "GP")),
    gl_qualificados: safeNum(pick(r, "GI Qualificável", "GI Qualificavel", "GI Qualificados", "GL Qualificados", "GI", "GL")),
    // Extras
    _gt_qualificavel: safeNum(pick(r, "GT Qualificável", "GT Qualificavel")),
    _bonificavel: safeNum(pick(r, "Bonificável", "Bonificavel")),
    _green_points_ano: safeNum(pick(r, "Green Points 2026", "Green Points 2025", "Green Points Ano")),
    _gp_mes: safeNum(pick(r, "GP junho", "GP mes", "GP Mês")),
    _gi_mes: safeNum(pick(r, "GI junho", "GI mes", "GI Mês")),
    _green_points_mes: safeNum(pick(r, "Green Points junho", "Green Points mes")),
    _data_nascimento: parseDateBR(pick(r, "Data Nascimento", "Nascimento")),
    _data_ativo: parseDateBR(pick(r, "Data Ativo")),
    _graduacao_expansao: safeStr(pick(r, "Graduação Expansão", "Graduacao Expansao")),
    _licenciados_diretos: safeInt(pick(r, "Licenciados Diretos")),
    _licenciados_diretos_ativos: safeInt(pick(r, "Licenciados Diretos Ativos")),
    _clientes_ativos: safeInt(pick(r, "Clientes Ativos")),
    _pro: safeStr(pick(r, "PRO")),
    _green_telecom_mes: safeNum(pick(r, "Green Telecom junho", "Green Telecom mes")),
    _livre_mes: safeNum(pick(r, "Livre junho", "Livre mes")),
    _placas_mes: safeNum(pick(r, "Placas junho", "Placas mes")),
    _club_mes: safeNum(pick(r, "Club junho", "Club mes")),
    _expansao_mes: safeNum(pick(r, "Expansão junho", "Expansao junho", "Expansão mes")),
    mes_ref: mesRef,
    raw_json: r,
    source: "igreen_extension_xlsx",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = req.headers.get("x-pairing-token") || "";
    if (!token) {
      return new Response(JSON.stringify({ error: "missing_pairing_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.revoked_at) {
      return new Response(JSON.stringify({ error: "token_revoked" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "token_expired" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    await supabase.from("igreen_extension_tokens")
      .update({ last_used_at: new Date().toISOString(), last_used_ip: ip })
      .eq("id", tokenRow.id);

    const body = await req.json().catch(() => ({}));
    const consultantId = tokenRow.consultant_id as string;
    const result: Record<string, unknown> = { ok: true };

    // Helper: detecta a "cara" de uma planilha pelas colunas, para evitar
    // que um arquivo de rede seja ingerido como clientes (ou vice-versa).
    const detectKind = (rows: Record<string, unknown>[]): "clientes" | "rede" | "unknown" => {
      if (!rows.length) return "unknown";
      const cols = new Set(Object.keys(rows[0]).map((k) => k.toLowerCase().trim()));
      const has = (...keys: string[]) => keys.some((k) => cols.has(k.toLowerCase()));
      const clientesScore = (has("celular", "telefone", "whatsapp") ? 1 : 0)
        + (has("andamento", "status") ? 1 : 0)
        + (has("distribuidora") ? 1 : 0)
        + (has("nome do cliente", "cliente") ? 1 : 0);
      const redeScore = (has("patrocinador", "cod patrocinador", "patrocinador código") ? 2 : 0)
        + (has("graduação", "graduacao", "cargo") ? 1 : 0)
        + (has("nível", "nivel", "level") ? 1 : 0)
        + (has("gp qualificados", "gl qualificados", "gp", "gl") ? 1 : 0);
      if (redeScore > clientesScore) return "rede";
      if (clientesScore > 0) return "clientes";
      return "unknown";
    };

    // --- CLIENTES ---
    const clientesB64 = typeof body?.clientes_b64 === "string" ? body.clientes_b64 : "";
    if (clientesB64) {
      let rows: Record<string, unknown>[] = [];
      try { rows = parseXlsx(clientesB64); }
      catch (e) { result.clientes_parse_error = e instanceof Error ? e.message : String(e); }
      const detected = detectKind(rows);
      if (detected === "rede") {
        result.clientes = { received: rows.length, processed: 0, upserted: 0, errors: 0, skipped: rows.length, swapped: true, message: "arquivo trocado: enviado planilha de rede no campo clientes" };
        rows = [];
      }
      const seen = new Set<string>();
      const recs: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const r of rows) {
        const rec = buildCustomerRecord(r);
        if (!rec?.phone_whatsapp) { skipped++; continue; }
        let phone = String(rec.phone_whatsapp);
        if (seen.has(phone)) {
          const icode = safeStr(pick(r, "Código", "Codigo", "codigoCliente"));
          if (!icode) continue;
          phone = `${phone}_${icode}`;
          rec.phone_whatsapp = phone;
        }
        seen.add(phone);
        rec.consultant_id = consultantId;
        recs.push(rec);
      }
      const phones = recs.map((r) => String(r.phone_whatsapp));
      const codes = recs.map((r) => safeStr(r.igreen_code)).filter(Boolean) as string[];
      // Carrega existentes por phone+consultant
      const existingByPhone = new Map<string, { id: string; conversation_step: string | null; phone_whatsapp: string }>();
      for (let i = 0; i < phones.length; i += 200) {
        const chunk = phones.slice(i, i + 200);
        const { data } = await supabase.from("customers")
          .select("id, phone_whatsapp, conversation_step")
          .eq("consultant_id", consultantId)
          .in("phone_whatsapp", chunk);
        for (const e of (data || []) as Array<{ id: string; phone_whatsapp: string; conversation_step: string | null }>) {
          existingByPhone.set(e.phone_whatsapp, e);
        }
      }
      // Carrega existentes por igreen_code (para encontrar registros com phone_whatsapp placeholder
      // que agora têm celular real — RECUPERA TELEFONE)
      const existingByCode = new Map<string, { id: string; conversation_step: string | null; phone_whatsapp: string }>();
      for (let i = 0; i < codes.length; i += 200) {
        const chunk = codes.slice(i, i + 200);
        const { data } = await supabase.from("customers")
          .select("id, phone_whatsapp, conversation_step, igreen_code")
          .eq("consultant_id", consultantId)
          .in("igreen_code", chunk);
        for (const e of (data || []) as Array<{ id: string; phone_whatsapp: string; conversation_step: string | null; igreen_code: string }>) {
          existingByCode.set(e.igreen_code, e);
        }
      }
      // Resolve cada rec -> registro existente (prefere phone, depois código)
      const resolveExisting = (r: Record<string, unknown>) => {
        const byPhone = existingByPhone.get(String(r.phone_whatsapp));
        if (byPhone) return byPhone;
        const code = safeStr(r.igreen_code);
        return code ? existingByCode.get(code) : undefined;
      };
      for (const r of recs) {
        r.is_test_lead = false;
        r.is_sandbox = false;
        const ex = resolveExisting(r);
        if (ex && ex.conversation_step && ex.conversation_step !== "complete") delete r.status;
      }
      const computePending = (rec: Record<string, unknown>): string => {
        const andamento = String(rec.andamento_igreen || "").toLowerCase();
        const status = String(rec.status || "").toLowerCase();
        if (/reprov|cancel/.test(andamento) || ["rejected", "cancelled", "canceled"].includes(status)) return "reprovado";
        if (andamento.includes("devolutiva") || status === "devolutiva") return "devolutiva";
        return "aprovado";
      };
      const errorsDetail: Array<{ phone: string; codigo: string | null; motivo: string }> = [];
      let upserted = 0, errors = 0, phoneRecovered = 0;
      const lastError: { msg?: string } = {};
      // UPDATE existentes (NUNCA toca pos_venda_stage / pending — sao decisao do consultor)
      const newRecs: Record<string, unknown>[] = [];
      for (const r of recs) {
        const ex = resolveExisting(r);
        if (!ex) { newRecs.push(r); continue; }
        const patch: Record<string, unknown> = { ...r };
        delete patch.consultant_id;
        delete patch.is_test_lead; delete patch.is_sandbox;
        delete patch.customer_origin; delete patch.phone_contact_confirmed;
        // RECUPERAR TELEFONE: se o registro existente tem placeholder e o XLSX trouxe número real,
        // substituir o phone_whatsapp. Caso contrário, NÃO mexer no phone (já estava certo).
        const newPhone = String(r.phone_whatsapp);
        const oldPhone = ex.phone_whatsapp;
        const newIsReal = !newPhone.startsWith("sem_celular_");
        const oldIsPlaceholder = oldPhone.startsWith("sem_celular_");
        if (newIsReal && oldIsPlaceholder) {
          // mantém phone_whatsapp no patch para atualizar
          phoneRecovered++;
        } else {
          delete patch.phone_whatsapp;
        }
        const { error } = await supabase.from("customers").update(patch).eq("id", ex.id);
        if (error) {
          errors++; lastError.msg = error.message;
          if (errorsDetail.length < 50) errorsDetail.push({ phone: String(r.phone_whatsapp), codigo: (r.igreen_code as string) || null, motivo: error.message });
          console.error("customers update", error.message);
        } else upserted++;
      }
      // INSERT novos em lotes — parqueia em "espera" + pending_stage
      for (const r of newRecs) {
        r.pos_venda_stage = "espera";
        r.pos_venda_manual = true;
        r.pos_venda_pending_stage = computePending(r);
      }
      for (let i = 0; i < newRecs.length; i += 100) {
        const batch = newRecs.slice(i, i + 100);
        const { data, error } = await supabase.from("customers").insert(batch).select("id");
        if (error) {
          lastError.msg = error.message;
          console.error("customers insert batch", error.message);
          for (const row of batch) {
            const { data: one, error: e2 } = await supabase.from("customers").insert(row).select("id");
            if (e2) {
              errors++; lastError.msg = e2.message;
              if (errorsDetail.length < 50) errorsDetail.push({ phone: String(row.phone_whatsapp), codigo: (row.igreen_code as string) || null, motivo: e2.message });
            } else upserted += one?.length || 0;
          }
        } else upserted += data?.length || 0;
      }
      if (!(result.clientes as { swapped?: boolean } | undefined)?.swapped) {
        result.clientes = { received: rows.length, processed: recs.length, upserted, errors, skipped, phone_recovered: phoneRecovered, last_error: lastError.msg || null, errors_detail: errorsDetail };
      }
    }

    // --- REDE ---
    const redeB64 = typeof body?.rede_b64 === "string" ? body.rede_b64 : "";
    const mesRef = safeStr(body?.mes_ref) || new Date().toISOString().slice(0, 7);
    if (redeB64) {
      let rows: Record<string, unknown>[] = [];
      try { rows = parseXlsx(redeB64); }
      catch (e) { result.rede_parse_error = e instanceof Error ? e.message : String(e); }
      const detected = detectKind(rows);
      if (detected === "clientes") {
        result.rede = { received: rows.length, processed: 0, upserted: 0, errors: 0, skipped: rows.length, swapped: true, message: "arquivo trocado: enviado planilha de clientes no campo rede" };
        rows = [];
      }
      const recs: Record<string, unknown>[] = [];
      let skipped = 0;
      const seen = new Set<string>();
      for (const r of rows) {
        const rec = buildNetworkRecord(r, mesRef);
        if (!rec) { skipped++; continue; }
        const key = String(rec.codigo_igreen);
        if (seen.has(key)) continue;
        seen.add(key);
        rec.consultant_id = consultantId;
        recs.push(rec);
      }
      let upserted = 0, errors = 0;
      for (let i = 0; i < recs.length; i += 100) {
        const batch = recs.slice(i, i + 100);
        const { data, error } = await supabase.from("consultant_network")
          .upsert(batch, { onConflict: "consultant_id,codigo_igreen", ignoreDuplicates: false })
          .select("id");
        if (error) { console.error("network upsert", error); errors += batch.length; }
        else upserted += data?.length || 0;
      }
      // Espelha em network_members (tabela usada pelo painel "Rede")
      let nmUpserted = 0, nmErrors = 0;
      const nmRecs: Record<string, unknown>[] = [];
      for (const r of recs) {
        const igreenId = parseInt(String(r.codigo_igreen).replace(/\D/g, ""), 10);
        if (!Number.isFinite(igreenId) || igreenId <= 0) continue;
        const sponsor = r.patrocinador_codigo ? parseInt(String(r.patrocinador_codigo).replace(/\D/g, ""), 10) : null;
        nmRecs.push({
          consultant_id: consultantId,
          igreen_id: igreenId,
          name: r.nome || `Consultor ${igreenId}`,
          phone: r.celular || null,
          sponsor_id: Number.isFinite(sponsor as number) && (sponsor as number) > 0 ? sponsor : null,
          nivel: r.nivel ?? null,
          cidade: r.cidade || null,
          uf: r.uf || null,
          graduacao: r.graduacao || null,
          gp: r.gp_qualificados ?? null,
          gi: r.gl_qualificados ?? null,
        });
      }
      for (let i = 0; i < nmRecs.length; i += 100) {
        const batch = nmRecs.slice(i, i + 100);
        const { data, error } = await supabase.from("network_members")
          .upsert(batch, { onConflict: "consultant_id,igreen_id", ignoreDuplicates: false })
          .select("id");
        if (error) { console.error("network_members upsert", error.message); nmErrors += batch.length; }
        else nmUpserted += data?.length || 0;
      }
      if (!(result.rede as { swapped?: boolean } | undefined)?.swapped) {
        result.rede = { received: rows.length, processed: recs.length, upserted, errors, skipped, network_members_upserted: nmUpserted, network_members_errors: nmErrors };
      }
    }

    await supabase.from("settings").upsert(
      { key: `last_igreen_ext_sync_${consultantId}`, value: new Date().toISOString() },
      { onConflict: "key" },
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("igreen-ingest-xlsx error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
