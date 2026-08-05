/**
 * Verifica se TODOS os números da campanha de disparo em massa foram bloqueados.
 *
 * Responde: cada número que entrou na campanha está impedido de receber
 * mensagem (bot, cadência, pós-venda, reheat), SMS e ligação?
 *
 * COMO USAR (a service_role key está no painel do Supabase em
 * Settings > API > service_role — a mesma que as edge functions usam):
 *
 *   SUPABASE_SERVICE_ROLE_KEY=<sua_key> node scripts/verificar-bloqueio-bulk.mjs
 *
 * Outro dia:
 *   DIA=2026-08-04 SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/verificar-bloqueio-bulk.mjs
 *
 * SÓ LÊ. Nenhum UPDATE, INSERT ou DELETE. Nada é enviado a ninguém.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIA = process.env.DIA || "2026-08-04";

if (!KEY) {
  console.error(`
[erro] SUPABASE_SERVICE_ROLE_KEY não definida.

  Pegue em: Supabase > Settings > API > service_role (secret)
  E rode:   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/verificar-bloqueio-bulk.mjs
`);
  process.exit(1);
}

/**
 * Chave canônica do telefone: DDD + 8 dígitos finais.
 * Iguala o mesmo celular gravado com e sem o 9º dígito, com ou sem DDI 55,
 * e ignora o sufixo `_igreenCode` que o sync da carteira acrescenta.
 * Mesma ideia do phoneAlt em voice-dialer-webhook.
 */
function chaveFone(raw) {
  const d = String(raw ?? "").split("_")[0].replace(/\D/g, "");
  const nat = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  return nat.length >= 10 ? nat.slice(0, 2) + nat.slice(-8) : null;
}

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    throw new Error(`REST ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/** Pagina para não truncar no limite default do PostgREST. */
async function restAll(base) {
  const out = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest(`${base}&limit=${PAGE}&offset=${offset}`);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const iso = (d) => `${d}T00:00:00-03:00`;
const diaSeguinte = (d) => {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

console.log(`\nVerificando bloqueio da campanha de ${DIA} (somente leitura)`);
console.log("=".repeat(64));

// ── 1) Campanhas do dia ─────────────────────────────────────────────────────
const camps = await restAll(
  `bulk_campaigns?select=id,name,consultant_id,status,total,sent,failed,created_at` +
    `&created_at=gte.${iso(DIA)}&created_at=lt.${iso(diaSeguinte(DIA))}&order=created_at`,
);

if (camps.length === 0) {
  console.log(`\nNenhuma campanha de disparo em massa encontrada em ${DIA}.`);
  const ultimas = await rest("bulk_campaigns?select=name,status,total,created_at&order=created_at.desc&limit=5");
  if (ultimas.length) {
    console.log(`\nUltimas campanhas registradas:`);
    for (const u of ultimas) {
      console.log(`  ${u.created_at}  ${u.status.padEnd(10)} total=${String(u.total).padStart(5)}  ${u.name}`);
    }
    console.log(`\nRode de novo com a data certa:  DIA=<AAAA-MM-DD> ...`);
  }
  process.exit(0);
}

console.log(`\nCampanhas encontradas: ${camps.length}\n`);
for (const c of camps) {
  console.log(`  ${c.name}`);
  console.log(`    status=${c.status}  total=${c.total}  enviadas=${c.sent}  falhas=${c.failed}`);
}

// ── 2) Alvos ────────────────────────────────────────────────────────────────
const ids = camps.map((c) => c.id);
const consultantByCamp = new Map(camps.map((c) => [c.id, c.consultant_id]));
const targets = await restAll(
  `bulk_campaign_targets?select=campaign_id,phone,name,status,error&campaign_id=in.(${ids.join(",")})`,
);

const alvos = new Map(); // "consultor|chave" -> dados
let semChave = 0;
for (const t of targets) {
  const chave = chaveFone(t.phone);
  if (!chave) { semChave++; continue; }
  const consultantId = consultantByCamp.get(t.campaign_id);
  const k = `${consultantId}|${chave}`;
  if (!alvos.has(k)) {
    alvos.set(k, { consultantId, chave, phoneExemplo: t.phone, nome: t.name, statuses: new Set() });
  }
  alvos.get(k).statuses.add(t.status);
}

const porStatus = targets.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
console.log(`\nAlvos: ${targets.length} linhas -> ${alvos.size} numeros distintos`);
console.log(`  status no disparo: ${JSON.stringify(porStatus)}`);
if (semChave) console.log(`  ignorados (telefone invalido): ${semChave}`);

// ── 3) Cadastros e DNC de voz dos consultores envolvidos ────────────────────
const consultantIds = [...new Set(camps.map((c) => c.consultant_id).filter(Boolean))];

const custByKey = new Map();
for (const cid of consultantIds) {
  const rows = await restAll(
    `customers?select=id,name,phone_whatsapp,do_not_contact,bot_paused,bot_paused_reason,` +
      `customer_origin,status,is_converted,pos_venda_stage,andamento_igreen` +
      `&consultant_id=eq.${cid}`,
  );
  for (const r of rows) {
    const chave = chaveFone(r.phone_whatsapp);
    if (!chave) continue;
    const k = `${cid}|${chave}`;
    if (!custByKey.has(k)) custByKey.set(k, []);
    custByKey.get(k).push(r);
  }
}

const dncByKey = new Set();
for (const cid of consultantIds) {
  const rows = await restAll(`voice_dnc_list?select=phone&consultant_id=eq.${cid}`);
  for (const r of rows) {
    const d = String(r.phone ?? "").replace(/\D/g, "");
    if (d.length >= 8) dncByKey.add(`${cid}|${d.slice(-8)}`);
  }
}

// ── 4) Avaliação: só é bloqueio real quando TODAS as condições batem ────────
// Motivos que dão silêncio PERMANENTE em _shared/bot/paused.ts. Qualquer outro
// valor expira em 48h e o lead volta a receber.
const REASONS_PERMANENTES = new Set(["requested", "opt_out", "complaint"]);
const CLIENTE_STATUS = new Set(["approved", "active", "registered_igreen", "cadastro_concluido", "complete"]);
const CLIENTE_ANDAMENTO = new Set(["ativo", "aprovado", "validado", "licenciada", "licenciado"]);

const furos = { semCadastro: [], faltaDnc: [], faltaPausa: [], pausaExpiravel: [], smsVozLiberado: [] };
const clientes = [];
let ok = 0;

for (const a of alvos.values()) {
  const rows = custByKey.get(`${a.consultantId}|${a.chave}`) ?? [];
  const temDncVoz = dncByKey.has(`${a.consultantId}|${a.chave.slice(-8)}`);
  const info = { fone: a.phoneExemplo, nome: a.nome, disparo: [...a.statuses].join(",") };

  if (rows.length === 0) { furos.semCadastro.push(info); continue; }

  for (const r of rows) {
    const ehCliente =
      ["igreen_sync", "igreen_extension"].includes(r.customer_origin) ||
      r.is_converted === true ||
      CLIENTE_STATUS.has(String(r.status ?? "").toLowerCase()) ||
      String(r.pos_venda_stage ?? "").trim() !== "" ||
      CLIENTE_ANDAMENTO.has(String(r.andamento_igreen ?? "").toLowerCase());
    if (ehCliente) {
      clientes.push({ ...info, cadastro: r.name, origem: r.customer_origin, status: r.status });
    }
  }

  // do_not_contact sozinho não silencia número compartilhado: evalNumberPauseRows
  // só trata DNC como pausa quando TODAS as linhas do telefone são DNC.
  const todosDnc = rows.every((r) => r.do_not_contact === true);
  const todosPausados = rows.every((r) => r.bot_paused === true);
  const pausaPermanente = rows.every((r) =>
    REASONS_PERMANENTES.has(String(r.bot_paused_reason ?? "").toLowerCase()),
  );

  const det = { ...info, cadastros: rows.length };
  if (!todosDnc) furos.faltaDnc.push(det);
  else if (!todosPausados) furos.faltaPausa.push(det);
  else if (!pausaPermanente) {
    furos.pausaExpiravel.push({ ...det, reason: rows.map((r) => r.bot_paused_reason).join(",") });
  } else if (!temDncVoz) furos.smsVozLiberado.push(det);
  else ok++;
}

// ── 5) Veredito ─────────────────────────────────────────────────────────────
const total = alvos.size;
const linha = (rot, n) => `  ${rot.padEnd(42)} ${String(n).padStart(6)}`;

console.log(`\n${"=".repeat(64)}\nRESULTADO\n${"=".repeat(64)}`);
console.log(linha("numeros na campanha", total));
console.log(linha("BLOQUEADOS por completo", ok));
console.log(`\nFuros (cada um = numero que ainda PODE receber algo):`);
console.log(linha("sem cadastro em customers", furos.semCadastro.length));
console.log(linha("falta do_not_contact", furos.faltaDnc.length));
console.log(linha("falta bot_paused", furos.faltaPausa.length));
console.log(linha("pausa expira em 48h (reason invalido)", furos.pausaExpiravel.length));
console.log(linha("SMS/ligacao liberado (fora do DNC voz)", furos.smsVozLiberado.length));

const totalFuros = Object.values(furos).reduce((s, v) => s + v.length, 0);
console.log(`\n${"=".repeat(64)}`);
if (total > 0 && totalFuros === 0) {
  console.log(`VEREDITO: TODOS os ${total} numeros estao bloqueados.`);
} else {
  console.log(`VEREDITO: NAO. ${totalFuros} de ${total} numeros ainda podem receber mensagem ou ligacao.`);
  console.log(`Para fechar: ETAPA 1 de scripts/bloquear-campanha-2026-08-04.sql`);
}
console.log("=".repeat(64));

for (const [nome, lista] of Object.entries(furos)) {
  if (!lista.length) continue;
  console.log(`\n--- ${nome} (${lista.length}) — primeiros 20 ---`);
  for (const f of lista.slice(0, 20)) console.log(`  ${JSON.stringify(f)}`);
}

if (clientes.length) {
  console.log(`\n!! ATENCAO: ${clientes.length} numero(s) da campanha sao CLIENTE da carteira.`);
  console.log(`   Bloquear corta o pos-venda (D30..D210) de quem ja paga. Avalie antes.`);
  for (const c of clientes.slice(0, 20)) console.log(`  ${JSON.stringify(c)}`);
}
console.log();
