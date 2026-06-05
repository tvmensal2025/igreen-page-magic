import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_BASE = "https://api-voffice.igreenenergy.com.br/v1";

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return "";
}

function mapStatus(andamento: string | undefined): string {
  if (!andamento) return "pending";
  const lower = andamento.toLowerCase().trim();
  if (lower === "validado" || lower === "aprovado" || lower === "ativo") return "approved";
  if (lower === "devolutiva") return "devolutiva";
  if (lower === "reprovado" || lower === "cancelado") return "rejected";
  if (lower.includes("falta assinatura")) return "awaiting_signature";
  if (lower.includes("aguardando")) return "pending";
  if (lower === "pendente" || lower === "em análise" || lower === "em analise") return "pending";
  if (lower === "lead" || lower === "novo") return "lead";
  if (lower === "dados completos" || lower === "data_complete") return "data_complete";
  if (lower === "registrado" || lower === "registered_igreen") return "registered_igreen";
  if (lower === "contrato enviado" || lower === "contract_sent") return "contract_sent";
  return "pending";
}

function safeStr(val: unknown): string | null {
  if (val == null || val === "") return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function safeNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = parseFloat(String(val).replace(",", ".").replace("%", ""));
  return isNaN(n) ? null : n;
}

function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== "") return obj[key];
    const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    if (found && obj[found] != null && obj[found] !== "") return obj[found];
  }
  return null;
}

function cleanDevolutiva(raw: string): string {
  const cleaned = raw.replace(/caminho[a-zA-Z0-9]*:\s*/g, "");
  return cleaned.replace(/^[,\s]+|[,\s]+$/g, "").replace(/,\s*,/g, ",").trim();
}

function buildRecord(c: Record<string, unknown>): Record<string, unknown> | null {
  const phoneRaw = get(c, "celular", "telefone", "phone", "whatsapp", "Celular", "Telefone");
  let phone = normalizePhone(String(phoneRaw || ""));
  let isPlaceholderPhone = false;

  if (!phone || phone.length < 12) {
    const codigo = safeStr(get(c, "codigoCliente", "codigo", "Codigo", "Código", "codigoIgreen", "id"));
    const instalacao = safeStr(get(c, "instalacao", "numeroInstalacao", "numero_instalacao", "Instalação"));
    const fallbackId = codigo || instalacao;
    if (fallbackId) {
      phone = `sem_celular_${fallbackId.replace(/\D/g, "")}`;
      isPlaceholderPhone = true;
    } else return null;
  }

  const record: Record<string, unknown> = { phone_whatsapp: phone };
  // Marca explicitamente que veio do sync iGreen — não é lead do WhatsApp
  record.customer_origin = "igreen_sync";
  // ⚠️ Telefone NÃO foi confirmado pelo cliente — bot precisa pedir confirmação antes do portal
  record.phone_contact_confirmed = false;

  const name = safeStr(get(c, "nomeCliente", "nome", "Nome", "name", "Nome do Cliente"));
  if (name) record.name = name;

  const statusRaw = safeStr(get(c, "andamento", "Andamento", "status"));
  // Se o telefone é placeholder (sem celular real), marca como contato_incompleto
  // — bot bloqueia portal até cliente confirmar telefone real
  record.status = isPlaceholderPhone ? "contato_incompleto" : mapStatus(statusRaw || undefined);

  const cpf = safeStr(get(c, "cpf", "CPF", "documento", "Documento"));
  if (cpf) record.cpf = cpf.replace(/\D/g, "");

  const email = safeStr(get(c, "email", "Email", "E-mail"));
  if (email) record.email = email;

  const city = safeStr(get(c, "cidade", "Cidade", "municipio"));
  if (city) record.address_city = city;

  const state = safeStr(get(c, "uf", "UF", "estado"));
  if (state) record.address_state = state.toUpperCase();

  const dist = safeStr(get(c, "distribuidora", "Distribuidora"));
  if (dist) record.distribuidora = dist;

  const andamento = safeStr(get(c, "andamento", "Andamento"));
  if (andamento) record.andamento_igreen = andamento;

  const devolutiva = safeStr(get(c, "devolutiva", "Devolutiva"));
  if (devolutiva) record.devolutiva = cleanDevolutiva(devolutiva);

  const obs = safeStr(get(c, "observacaoCompartilhada", "observacao", "Observação", "obs"));
  if (obs) record.observacao = obs;

  const icode = safeStr(get(c, "codigoIgreen", "codigo", "Código"));
  if (icode) record.igreen_code = icode;

  const consumo = safeNum(get(c, "consumoMedio", "consumo_medio", "Consumo Médio"));
  if (consumo != null) record.media_consumo = consumo;

  const desc = safeNum(get(c, "descontoCliente", "desconto_cliente", "Desconto"));
  if (desc != null) record.desconto_cliente = desc;

  const dCad = safeStr(get(c, "dataCadastro", "data_cadastro", "Data Cadastro"));
  if (dCad) record.data_cadastro = dCad;

  const dAtivo = safeStr(get(c, "dataAtivo", "data_ativo", "Data Ativo"));
  if (dAtivo) record.data_ativo = dAtivo;

  const dVal = safeStr(get(c, "dataValidado", "data_validado", "Data Validado"));
  if (dVal) record.data_validado = dVal;

  const stFin = safeStr(get(c, "statusFinanceiro", "status_financeiro"));
  if (stFin) record.status_financeiro = stFin;

  const cash = safeStr(get(c, "cashback", "Cashback"));
  if (cash) record.cashback = cash;

  const nivel = safeStr(get(c, "nivel", "Nível"));
  if (nivel) record.nivel_licenciado = nivel;

  const asCl = safeStr(get(c, "assinaturaCliente", "assinatura_cliente"));
  if (asCl) record.assinatura_cliente = asCl;

  const asIg = safeStr(get(c, "assinaturaIgreen", "assinatura_igreen"));
  if (asIg) record.assinatura_igreen = asIg;

  const linkAs = safeStr(get(c, "linkAssinatura", "link_assinatura"));
  if (linkAs) record.link_assinatura = linkAs;

  const lic = safeStr(get(c, "licenciado", "Licenciado", "nomeLicenciado"));
  if (lic) record.registered_by_name = lic;

  const codLic = safeStr(get(c, "codigoLicenciado", "codigo_licenciado"));
  if (codLic) record.registered_by_igreen_id = codLic;

  const indicador = safeStr(get(c, "indicador", "Indicador", "nomeIndicador", "indicadoPor", "quemIndicou", "referredBy", "indicacao"));
  if (indicador) record.customer_referred_by_name = indicador;

  const indicadorPhone = safeStr(get(c, "telefoneIndicador", "celularIndicador", "phoneIndicador"));
  if (indicadorPhone) record.customer_referred_by_phone = normalizePhone(String(indicadorPhone));

  const inst = safeStr(get(c, "numeroInstalacao", "numero_instalacao", "Instalação"));
  if (inst) record.numero_instalacao = inst;

  const nasc = safeStr(get(c, "dataNascimento", "data_nascimento"));
  if (nasc) record.data_nascimento = nasc.substring(0, 10);

  return record;
}

// =====================================================
// syncOneConsultant — syncs a single consultant
// =====================================================
async function syncOneConsultant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  portalEmail: string,
  portalPassword: string,
  consultantId: string | null,
  mode: string,
): Promise<Record<string, unknown>> {
  const emailNorm = String(portalEmail || "").trim().toLowerCase();
  const passwordNorm = String(portalPassword || "");
  console.log(`Logging in to iGreen API for ${emailNorm} (pwd_len=${passwordNorm.length})...`);
  const browserHeaders = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Origin": "https://escritorio.igreenenergy.com.br",
    "Referer": "https://escritorio.igreenenergy.com.br/",
  };

  async function attemptLogin(): Promise<Response> {
    return await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ email: emailNorm, password: passwordNorm }),
    });
  }

  let loginRes = await attemptLogin();
  if (loginRes.status === 429 || (await loginRes.clone().text()).toLowerCase().includes("muitas tentativas")) {
    console.log("Rate limited (429). Waiting 30s before retry...");
    await new Promise((r) => setTimeout(r, 30000));
    loginRes = await attemptLogin();
  }

  if (!loginRes.ok) {
    const errText = await loginRes.text();
    console.error(`Login failed for ${emailNorm}: ${loginRes.status} - ${errText}`);
    let friendly: string;
    if (loginRes.status === 401 || loginRes.status === 403) {
      friendly = "O portal iGreen recusou o login. Os dados estão salvos, mas o portal não aceitou essa combinação. Confira se a senha foi alterada no portal e atualize na aba Dados.";
    } else if (loginRes.status === 429 || errText.toLowerCase().includes("muitas tentativas")) {
      friendly = "Portal iGreen bloqueou temporariamente por excesso de tentativas. Aguarde 1 minuto e tente de novo.";
    } else {
      friendly = `Login no portal falhou (HTTP ${loginRes.status}). Resposta: ${errText.slice(0, 200)}`;
    }
    return {
      success: false,
      email: emailNorm,
      error: friendly,
      login_status: loginRes.status,
      login_body: errText.slice(0, 200),
    };
  }

  const loginData = await loginRes.json();
  const token = loginData.accessToken || loginData.token || loginData.access_token;
  if (!token) {
    return {
      success: false,
      email: portalEmail,
      error: "Portal respondeu sem token de acesso. Avise o suporte.",
    };
  }
  console.log(`Login OK for ${portalEmail}`);

  const authHeaders = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://escritorio.igreenenergy.com.br",
    "Referer": "https://escritorio.igreenenergy.com.br/",
  };

  const consultantRes = await fetch(`${API_BASE}/consultant`, { headers: authHeaders });
  if (!consultantRes.ok) {
    return { success: false, email: portalEmail, error: "Não foi possível obter dados do consultor." };
  }

  const consultantData = await consultantRes.json();
  console.log("Consultant API response keys:", JSON.stringify(Object.keys(consultantData)));
  console.log("Consultant API response (truncated):", JSON.stringify(consultantData).substring(0, 500));

  const consultorId = consultantData.idconsultor
    || consultantData.id
    || consultantData.data?.id
    || consultantData.consultant?.id
    || consultantData.user?.id
    || consultantData.consultor?.id
    || consultantData._id
    || consultantData.data?._id
    || consultantData.uid
    || consultantData.userId
    || consultantData.user_id;

  console.log(`Consultant ID: ${consultorId}`);
  if (!consultorId) {
    return { success: false, email: portalEmail, error: "ID do consultor não encontrado" };
  }

  // === SYNC NETWORK MODE ===
  if (mode === "explore_network" || mode === "sync_network") {
    console.log("=== SYNC NETWORK MODE ===");
    try {
      // Fetch all pages of network map
      let allNetData: Record<string, unknown>[] = [];
      let page = 1;
      const perPage = 100;
      while (true) {
        const url = `${API_BASE}/network-map?page=${page}&per_page=${perPage}&limit=${perPage}`;
        console.log(`Fetching network page ${page}: ${url}`);
        const netRes = await fetch(url, { headers: authHeaders });
        if (!netRes.ok) {
          console.error(`Network fetch failed page ${page}: ${netRes.status}`);
          if (page === 1) return { success: false, email: portalEmail, error: "Não foi possível buscar o mapa de rede." };
          break;
        }

        const rawNet = await netRes.json();
        console.log(`Page ${page} raw keys:`, Object.keys(rawNet));
        
        let pageData: Record<string, unknown>[];
        if (Array.isArray(rawNet)) {
          pageData = rawNet;
        } else if (rawNet.data && Array.isArray(rawNet.data)) {
          pageData = rawNet.data;
        } else if (rawNet.results && Array.isArray(rawNet.results)) {
          pageData = rawNet.results;
        } else if (rawNet.items && Array.isArray(rawNet.items)) {
          pageData = rawNet.items;
        } else {
          // Log full structure to understand API response
          console.log(`Page ${page} full response (truncated):`, JSON.stringify(rawNet).slice(0, 2000));
          pageData = [];
        }
        
        console.log(`Page ${page}: ${pageData.length} members`);
        if (pageData.length === 0) break;
        
        allNetData = allNetData.concat(pageData);
        
        // Check pagination metadata
        const totalPages = rawNet.last_page || rawNet.totalPages || rawNet.total_pages;
        if (totalPages && page >= totalPages) break;
        if (pageData.length < perPage && !totalPages) break;
        
        page++;
        // Safety: max 20 pages
        if (page > 20) break;
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Deduplicate by igreen_id (API may return same member across pages)
      const deduped = new Map<number, Record<string, unknown>>();
      for (const m of allNetData) {
        const id = Number(m.idconsultor || m.id);
        if (id) deduped.set(id, m);
      }
      const netData = Array.from(deduped.values());
      console.log(`Network map total: ${netData.length} unique members (${allNetData.length} raw)`);

      // API returns exactly 16 fields — map them correctly
      const netRecords = netData.map((m: Record<string, unknown>) => ({
        consultant_id: consultantId,
        igreen_id: Number(m.idconsultor || m.id),
        name: String(m.nome || "Sem nome"),
        phone: normalizePhone(String(m.celular || "")),
        sponsor_id: m.idpatrocinador ? Number(m.idpatrocinador) : null,
        nivel: Number(m.nivel ?? 0),
        data_ativo: safeStr(m.data_ativo) || null,
        cidade: safeStr(m.cidade) || null,
        uf: safeStr(m.uf) || null,
        clientes_ativos: Number(m.cliativo ?? 0),
        gp: safeNum(m.gp) ?? 0,
        gi: safeNum(m.gi) ?? 0,
        qtde_diretos: Number(m.qtde_diretos ?? 0),
        inicio_rapido: safeStr(m.inicio_rapido) || null,
        diretos_inicio_rapido: Number(m.diretos_inicio_rapido ?? 0),
        diretos_mes: Number(m.diretos_mes ?? 0),
        total_pontos: safeNum(m.total_pontos) ?? 0,
        // These fields map to accumulated totals from API
        gp_total: safeNum(m.gp) ?? 0,
        gi_total: safeNum(m.gi) ?? 0,
        updated_at: new Date().toISOString(),
      }));

      // Final dedup on mapped records by igreen_id
      const uniqueRecords = new Map<number, typeof netRecords[0]>();
      for (const r of netRecords) {
        uniqueRecords.set(Number(r.igreen_id), r);
      }
      const finalRecords = Array.from(uniqueRecords.values());
      console.log(`After final dedup: ${finalRecords.length} records`);

      let netUpdated = 0;
      for (let i = 0; i < finalRecords.length; i += 25) {
        const batch = finalRecords.slice(i, i + 25);
        const { data, error } = await supabase
          .from("network_members")
          .upsert(batch, { onConflict: "consultant_id,igreen_id", ignoreDuplicates: false })
          .select("id");
        if (error) console.error(`Network upsert error at ${i}:`, error);
        else netUpdated += (data?.length || 0);
      }

      // Remove stale members that no longer exist in the API
      const apiIds = finalRecords.map(r => Number(r.igreen_id));
      const { data: existingMembers } = await supabase
        .from("network_members")
        .select("igreen_id")
        .eq("consultant_id", consultantId);

      if (existingMembers) {
        const staleIds = (existingMembers as Array<{ igreen_id: number }>)
          .map((m) => m.igreen_id)
          .filter((id) => !apiIds.includes(id));
        if (staleIds.length > 0) {
          console.log(`Removing ${staleIds.length} stale members:`, staleIds);
          const { error: delErr } = await supabase
            .from("network_members")
            .delete()
            .eq("consultant_id", consultantId)
            .in("igreen_id", staleIds);
          if (delErr) console.error("Delete stale error:", delErr);
        }
      }

      return { success: true, mode: "sync_network", total_members: netData.length, updated: netUpdated, cleaned: 0 };
    } catch (err) {
      return { success: false, email: portalEmail, error: err instanceof Error ? err.message : "Erro rede" };
    }
  }

  // === SYNC CUSTOMERS ===
  console.log("Fetching customer data...");
  let allCustomers: Record<string, unknown>[] = [];
  let page = 1;
  const pageSize = 500;
  let hasMore = true;

  while (hasMore) {
    const url = `${API_BASE}/customer-map/${consultorId}?page=${page}&pageSize=${pageSize}`;
    console.log(`Fetching page ${page}...`);
    const dataRes = await fetch(url, { headers: authHeaders });

    if (!dataRes.ok) {
      const errText = await dataRes.text();
      console.error(`Data fetch failed on page ${page}: ${dataRes.status} - ${errText}`);
      break;
    }

    const responseData = await dataRes.json();
    const customers = Array.isArray(responseData) ? responseData : (responseData.data || []);
    const total = responseData.total || customers.length;

    console.log(`Page ${page}: got ${customers.length} customers (total: ${total})`);
    allCustomers = allCustomers.concat(customers);

    if (customers.length < pageSize || allCustomers.length >= total) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (allCustomers.length === 0) {
    return { success: false, email: portalEmail, error: "Nenhum cliente encontrado no portal." };
  }

  console.log(`Total customers fetched: ${allCustomers.length}`);
  if (allCustomers.length > 0) {
    console.log(`Sample fields: ${Object.keys(allCustomers[0]).join(", ")}`);
  }

  const seenPhones = new Map<string, string>();
  const records: Record<string, unknown>[] = [];
  let skippedNoPhone = 0;

  for (const c of allCustomers) {
    const record = buildRecord(c);
    if (!record || !record.phone_whatsapp) {
      skippedNoPhone++;
      continue;
    }

    const phone = String(record.phone_whatsapp);

    if (seenPhones.has(phone)) {
      const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo"));
      if (icode) {
        const uniquePhone = `${phone}_${icode}`;
        record.phone_whatsapp = uniquePhone;
        console.log(`Duplicate phone ${phone} for "${record.name}" — using unique key: ${uniquePhone}`);
        seenPhones.set(uniquePhone, String(record.name || "unknown"));
      } else {
        continue;
      }
    } else {
      seenPhones.set(phone, String(record.name || "unknown"));
    }

    if (consultantId) record.consultant_id = consultantId;
    records.push(record);
  }

  console.log(`Processing ${records.length} records (${skippedNoPhone} skipped no phone)`);

  let updatedCount = 0;
  let errorCount = 0;
  const BATCH_SIZE = 100;

  // First, fetch existing customers that are mid-conversation (have a conversation_step set)
  // to avoid overwriting their status/step during sync
  const allPhones = records.map(r => String(r.phone_whatsapp));
  const midConvoPhones = new Set<string>();
  
  // Batch fetch in chunks of 200
  for (let i = 0; i < allPhones.length; i += 200) {
    const chunk = allPhones.slice(i, i + 200);
    const { data: existing } = await supabase
      .from("customers")
      .select("phone_whatsapp, conversation_step")
      .in("phone_whatsapp", chunk)
      .not("conversation_step", "is", null);
    if (existing) {
      for (const e of existing as Array<{ phone_whatsapp: string; conversation_step: string | null }>) {
        // If a customer has an active conversation_step (not 'complete'), protect them
        if (e.conversation_step && e.conversation_step !== "complete") {
          midConvoPhones.add(e.phone_whatsapp);
        }
      }
    }
  }
  
  if (midConvoPhones.size > 0) {
    console.log(`⚠️ Protecting ${midConvoPhones.size} leads mid-conversation from status overwrite`);
  }

  // For mid-conversation leads, remove status from the upsert record so it won't overwrite
  for (const rec of records) {
    if (midConvoPhones.has(String(rec.phone_whatsapp))) {
      delete rec.status;
    }
  }

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("customers")
      .upsert(batch, { onConflict: "phone_whatsapp,consultant_id", ignoreDuplicates: false })
      .select("id");

    if (error) {
      console.error(`Batch upsert error at ${i}:`, error);
      errorCount += batch.length;
    } else {
      updatedCount += (data?.length || 0);
    }
  }

  const syncTimestamp = new Date().toISOString();
  await supabase
    .from("settings")
    .upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });

  const result = {
    success: true,
    email: portalEmail,
    total_from_portal: allCustomers.length,
    processed: records.length,
    updated: updatedCount,
    errors: errorCount,
    synced_at: syncTimestamp,
  };

  console.log("Sync completed:", result);
  return result;
}

// =====================================================
// Main handler
// =====================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let portalEmail = Deno.env.get("IGREEN_PORTAL_EMAIL");
    let portalPassword = Deno.env.get("IGREEN_PORTAL_PASSWORD");
    let consultantId: string | null = null;
    let mode = "sync";
    let source = "";
    let credsFromBody = false;

    try {
      const body = await req.json();
      if (body.portal_email) { portalEmail = body.portal_email; credsFromBody = true; }
      if (body.portal_password) { portalPassword = body.portal_password; credsFromBody = true; }
      if (body.consultant_id) consultantId = body.consultant_id;
      if (body.mode) mode = body.mode;
      if (body.source) source = body.source;
    } catch (_) { /* no body or invalid json */ }

    // ========================================================
    // CRON MODE: iterate over ALL consultants with credentials
    // ========================================================
    if (source === "cron") {
      console.log("=== CRON MODE: Syncing ALL consultants ===");
      const { data: consultants, error: cErr } = await supabase
        .from("consultants")
        .select("id, name, igreen_portal_email, igreen_portal_password")
        .eq("approved", true)
        .not("igreen_portal_email", "is", null)
        .not("igreen_portal_password", "is", null);

      if (cErr || !consultants || consultants.length === 0) {
        console.log("No consultants with credentials found, falling back to env vars.");
        if (portalEmail && portalPassword) {
          const result = await syncOneConsultant(supabase, portalEmail, portalPassword, null, mode);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ success: false, error: "Nenhum consultor com credenciais configuradas." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`Found ${consultants.length} consultants with credentials.`);
      const results: Record<string, unknown>[] = [];

      for (const c of consultants) {
        console.log(`--- Syncing: ${c.name} (${c.igreen_portal_email}) ---`);
        try {
          const r = await syncOneConsultant(
            supabase,
            c.igreen_portal_email!,
            c.igreen_portal_password!,
            c.id,
            mode,
          );
          results.push({ consultant: c.name, ...r });
        } catch (err) {
          console.error(`Error syncing ${c.name}:`, err);
          results.push({ consultant: c.name, success: false, error: err instanceof Error ? err.message : "Erro" });
        }
        // 5s delay between consultants to avoid iGreen rate limits
        await new Promise((r) => setTimeout(r, 5000));
      }

      const totalSynced = results.filter((r) => r.success).length;
      console.log(`CRON completed: ${totalSynced}/${consultants.length} consultants synced.`);

      return new Response(JSON.stringify({
        success: true,
        mode: "cron_all",
        total_consultants: consultants.length,
        synced: totalSynced,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================
    // MANUAL MODE: single consultant
    // ========================================================
    if (!portalEmail || !portalPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Credenciais do portal iGreen não configuradas. Preencha na aba Dados." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If credentials came from request body, do NOT override with stale DB values.


    if (consultantId && !credsFromBody) {
      const { data: cred } = await supabase
        .from("consultants")
        .select("igreen_portal_email, igreen_portal_password")
        .eq("id", consultantId)
        .maybeSingle();
      if (cred?.igreen_portal_email && cred?.igreen_portal_password) {
        portalEmail = cred.igreen_portal_email;
        portalPassword = cred.igreen_portal_password;
        console.log(`[creds] Loaded from DB for consultant: ${consultantId}`);
      }
    } else if (credsFromBody) {
      console.log(`[creds] Using credentials from request body (not DB)`);
    }

    if (!consultantId && portalEmail) {
      const { data: consultant } = await supabase
        .from("consultants")
        .select("id")
        .eq("igreen_portal_email", portalEmail)
        .maybeSingle();
      if (consultant?.id) {
        consultantId = consultant.id;
        console.log(`Resolved consultant_id from portal email: ${consultantId}`);
      }
    }

    const result = await syncOneConsultant(supabase, portalEmail!, portalPassword!, consultantId, mode);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
