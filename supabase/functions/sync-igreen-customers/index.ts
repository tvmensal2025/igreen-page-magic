import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// =====================================================
// sync-igreen-customers
// Estratégia única: delega o login/scraping para o Playwright Worker na VPS
// (IGREEN_SYNC_WORKER_URL). Toda a normalização e upsert continua aqui.
// =====================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  record.customer_origin = "igreen_sync";
  record.phone_contact_confirmed = false;

  const name = safeStr(get(c, "nomeCliente", "nome", "Nome", "name", "Nome do Cliente"));
  if (name) record.name = name;

  const statusRaw = safeStr(get(c, "andamento", "Andamento", "status"));
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
// Resolve worker URL + secret (mesmo padrão do portal-worker)
// =====================================================
async function resolveSyncWorker(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ url: string; secret: string } | null> {
  const { data: settingsRows } = await supabase.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

  const url = (
    settings.igreen_sync_worker_url ||
    Deno.env.get("IGREEN_SYNC_WORKER_URL") ||
    ""
  ).replace(/\/$/, "");
  const secret =
    settings.igreen_sync_worker_secret ||
    Deno.env.get("IGREEN_SYNC_WORKER_SECRET") ||
    settings.worker_secret ||
    Deno.env.get("WORKER_SECRET") ||
    "";

  if (!url) return null;
  return { url, secret };
}

async function callWorker(
  worker: { url: string; secret: string },
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 180_000); // 3 min
  try {
    const res = await fetch(`${worker.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": worker.secret,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || text.slice(0, 300), data };
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================
// syncOneConsultant — chama o worker e processa os dados
// =====================================================
async function syncOneConsultant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  worker: { url: string; secret: string },
  portalEmail: string,
  portalPassword: string,
  consultantId: string | null,
  mode: string,
): Promise<Record<string, unknown>> {
  const emailNorm = String(portalEmail || "").trim().toLowerCase();
  const passwordNorm = String(portalPassword || "");

  if (!emailNorm || !passwordNorm) {
    return { success: false, email: emailNorm, error: "Credenciais do portal iGreen não preenchidas." };
  }

  // === SYNC NETWORK MODE ===
  if (mode === "explore_network" || mode === "sync_network") {
    console.log(`[worker] sync-network for ${emailNorm}`);
    const r = await callWorker(worker, "/sync-network", {
      portal_email: emailNorm,
      portal_password: passwordNorm,
    });
    if (!r.ok) {
      return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
    }

    const members: Record<string, unknown>[] = r.data?.members || r.data?.data || [];
    const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
    if (consultantId && consultorId) {
      await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
    }

    // Dedup
    const deduped = new Map<number, Record<string, unknown>>();
    for (const m of members) {
      const id = Number(m.idconsultor || m.id);
      if (id) deduped.set(id, m);
    }
    const netData = Array.from(deduped.values());

    const netRecords = netData.map((m) => ({
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
      gp_total: safeNum(m.gp) ?? 0,
      gi_total: safeNum(m.gi) ?? 0,
      updated_at: new Date().toISOString(),
    }));

    let netUpdated = 0;
    for (let i = 0; i < netRecords.length; i += 25) {
      const batch = netRecords.slice(i, i + 25);
      const { data, error } = await supabase
        .from("network_members")
        .upsert(batch, { onConflict: "consultant_id,igreen_id", ignoreDuplicates: false })
        .select("id");
      if (error) console.error(`Network upsert error at ${i}:`, error);
      else netUpdated += (data?.length || 0);
    }

    // Remove stale members
    if (consultantId) {
      const apiIds = netRecords.map((r) => Number(r.igreen_id));
      const { data: existingMembers } = await supabase
        .from("network_members")
        .select("igreen_id")
        .eq("consultant_id", consultantId);
      if (existingMembers) {
        const staleIds = (existingMembers as Array<{ igreen_id: number }>)
          .map((m) => m.igreen_id)
          .filter((id) => !apiIds.includes(id));
        if (staleIds.length > 0) {
          await supabase
            .from("network_members")
            .delete()
            .eq("consultant_id", consultantId)
            .in("igreen_id", staleIds);
        }
      }
    }

    return { success: true, mode: "sync_network", total_members: netData.length, updated: netUpdated };
  }

  // === SYNC CUSTOMERS ===
  console.log(`[worker] sync-customers for ${emailNorm}`);
  const r = await callWorker(worker, "/sync-customers", {
    portal_email: emailNorm,
    portal_password: passwordNorm,
  });
  if (!r.ok) {
    return { success: false, email: emailNorm, error: `Worker falhou: ${r.error}`, status: r.status };
  }

  const allCustomers: Record<string, unknown>[] = r.data?.customers || r.data?.data || [];
  const consultorId = r.data?.consultor_id ? String(r.data.consultor_id) : null;
  if (consultantId && consultorId) {
    await supabase.from("consultants").update({ igreen_consultor_id: consultorId }).eq("id", consultantId);
  }

  if (allCustomers.length === 0) {
    return { success: false, email: emailNorm, error: "Nenhum cliente retornado pelo worker." };
  }

  console.log(`Worker returned ${allCustomers.length} customers`);

  const seenPhones = new Map<string, string>();
  const records: Record<string, unknown>[] = [];
  let skippedNoPhone = 0;

  for (const c of allCustomers) {
    const record = buildRecord(c);
    if (!record || !record.phone_whatsapp) { skippedNoPhone++; continue; }
    const phone = String(record.phone_whatsapp);

    if (seenPhones.has(phone)) {
      const icode = safeStr(get(c, "codigoCliente", "codigoIgreen", "codigo"));
      if (icode) {
        const uniquePhone = `${phone}_${icode}`;
        record.phone_whatsapp = uniquePhone;
        seenPhones.set(uniquePhone, String(record.name || "unknown"));
      } else continue;
    } else {
      seenPhones.set(phone, String(record.name || "unknown"));
    }

    if (consultantId) record.consultant_id = consultantId;
    records.push(record);
  }

  // Proteção mid-conversation + detecção de leads que viram carteira
  const allPhones = records.map((r) => String(r.phone_whatsapp));
  const midConvoPhones = new Set<string>();
  // Clientes que hoje são lead/manual e, neste sync, passam a igreen_sync.
  // Precisam ter resíduo de temperatura (lead_insights) e de funil (crm_deals)
  // removido: carteira validada/reprovada/devolutiva não entra nessas trilhas.
  // Só preenchido quando o consultor é conhecido (cleanup escopado por dono).
  const flippingToWalletIds: string[] = [];
  for (let i = 0; i < allPhones.length; i += 200) {
    const chunk = allPhones.slice(i, i + 200);
    let q = supabase
      .from("customers")
      .select("id, phone_whatsapp, conversation_step, customer_origin")
      .in("phone_whatsapp", chunk);
    // Escopa por consultor quando conhecido — evita tocar cliente homônimo
    // (mesmo telefone) de outro consultor.
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: existing } = await q;
    if (existing) {
      for (const e of existing as Array<{ id: string; phone_whatsapp: string; conversation_step: string | null; customer_origin: string | null }>) {
        const midConvo = !!e.conversation_step && e.conversation_step !== "complete";
        if (midConvo) midConvoPhones.add(e.phone_whatsapp);
        const isLeadOrigin = !e.customer_origin || e.customer_origin === "whatsapp_lead" || e.customer_origin === "manual";
        if (consultantId && isLeadOrigin && !midConvo) flippingToWalletIds.push(e.id);
      }
    }
  }
  if (midConvoPhones.size > 0) {
    console.log(`⚠️ Protecting ${midConvoPhones.size} mid-conversation leads`);
  }
  // Mid-conversation: preserva status E origem. Um lead em atendimento não vira
  // carteira no meio da conversa. Omitir as colunas no upsert mantém o valor
  // atual (o registro já existe, então onConflict só atualiza o que vier).
  for (const rec of records) {
    if (midConvoPhones.has(String(rec.phone_whatsapp))) {
      delete rec.status;
      delete rec.customer_origin;
    }
  }

  let updatedCount = 0;
  let errorCount = 0;
  const BATCH_SIZE = 100;
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

  // Cleanup de resíduo: leads que viraram carteira (igreen_sync) neste sync não
  // podem manter linha de temperatura (lead_insights) nem card de funil
  // (crm_deals). Escopado por consultor (flippingToWalletIds só é populado
  // quando consultantId é conhecido). Falha aqui não invalida o sync.
  let cleanedInsights = 0;
  let cleanedDeals = 0;
  if (consultantId && flippingToWalletIds.length > 0) {
    for (let i = 0; i < flippingToWalletIds.length; i += 100) {
      const idChunk = flippingToWalletIds.slice(i, i + 100);
      const { error: liErr, count: liCount } = await supabase
        .from("lead_insights")
        .delete({ count: "exact" })
        .in("customer_id", idChunk);
      if (liErr) console.error(`lead_insights cleanup error at ${i}:`, liErr);
      else cleanedInsights += liCount || 0;

      const { error: cdErr, count: cdCount } = await supabase
        .from("crm_deals")
        .delete({ count: "exact" })
        .eq("consultant_id", consultantId)
        .in("customer_id", idChunk);
      if (cdErr) console.error(`crm_deals cleanup error at ${i}:`, cdErr);
      else cleanedDeals += cdCount || 0;
    }
    if (cleanedInsights > 0 || cleanedDeals > 0) {
      console.log(`🧹 Cleanup leads→carteira: ${cleanedInsights} insights, ${cleanedDeals} deals removidos`);
    }
  }

  const syncTimestamp = new Date().toISOString();
  await supabase
    .from("settings")
    .upsert({ key: "last_igreen_sync", value: syncTimestamp }, { onConflict: "key" });

  return {
    success: true,
    email: emailNorm,
    total_from_portal: allCustomers.length,
    processed: records.length,
    skipped_no_phone: skippedNoPhone,
    updated: updatedCount,
    errors: errorCount,
    cleaned_insights: cleanedInsights,
    cleaned_deals: cleanedDeals,
    synced_at: syncTimestamp,
  };
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
    } catch (_) { /* sem body */ }

    const worker = await resolveSyncWorker(supabase);
    if (!worker) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Worker de sync iGreen não configurado. Defina IGREEN_SYNC_WORKER_URL (secret) ou settings.igreen_sync_worker_url.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================================================
    // CRON MODE: itera sobre todos os consultores aprovados
    // ========================================================
    if (source === "cron") {
      console.log("=== CRON MODE: Syncing ALL consultants ===");
      const { data: consultants, error: cErr } = await supabase
        .from("consultants")
        .select("id, name, igreen_portal_email, igreen_portal_password")
        .eq("approved", true);

      const usable = (consultants || []).filter((c: Record<string, unknown>) =>
        !!c.igreen_portal_email && !!c.igreen_portal_password
      );

      if (cErr || usable.length === 0) {
        if (portalEmail && portalPassword) {
          const result = await syncOneConsultant(supabase, worker, portalEmail, portalPassword, null, mode);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ success: false, error: "Nenhum consultor com credenciais iGreen configuradas." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`Found ${usable.length} consultants with credentials.`);
      const results: Record<string, unknown>[] = [];

      for (const c of usable) {
        console.log(`--- Syncing: ${c.name} (${c.igreen_portal_email}) ---`);
        try {
          const r = await syncOneConsultant(
            supabase,
            worker,
            c.igreen_portal_email,
            c.igreen_portal_password,
            c.id,
            mode,
          );
          results.push({ consultant: c.name, ...r });
        } catch (err) {
          console.error(`Error syncing ${c.name}:`, err);
          results.push({ consultant: c.name, success: false, error: err instanceof Error ? err.message : "Erro" });
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      const totalSynced = results.filter((r) => r.success).length;
      return new Response(JSON.stringify({
        success: true,
        mode: "cron_all",
        total_consultants: usable.length,
        synced: totalSynced,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================
    // MANUAL MODE: single consultant
    // ========================================================
    if (consultantId && !credsFromBody) {
      const { data: cred } = await supabase
        .from("consultants")
        .select("igreen_portal_email, igreen_portal_password")
        .eq("id", consultantId)
        .maybeSingle();
      if (cred?.igreen_portal_email && cred?.igreen_portal_password) {
        portalEmail = cred.igreen_portal_email;
        portalPassword = cred.igreen_portal_password;
      }
    }

    if (!consultantId && portalEmail) {
      const { data: consultant } = await supabase
        .from("consultants")
        .select("id")
        .eq("igreen_portal_email", portalEmail)
        .maybeSingle();
      if (consultant?.id) consultantId = consultant.id;
    }

    if (!portalEmail || !portalPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Credenciais do portal iGreen não configuradas. Preencha email/senha na aba Dados." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await syncOneConsultant(
      supabase,
      worker,
      portalEmail,
      portalPassword,
      consultantId,
      mode,
    );

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
