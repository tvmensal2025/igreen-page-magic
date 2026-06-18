// =============================================================================
// Acompanhamento — Motor de comissão Conexão Green (recorrente + entrada)
// =============================================================================
// Funções PURAS que estimam quanto o consultor recebe da Conexão Green, a
// partir de:
//   • clientes validados (Pós-Venda) com sua distribuidora e fatura;
//   • regras de entrada configuradas por distribuidora (faixas pessoas → %);
//   • graduação manual do consultor (bônus de carreira no recorrente).
//
// IMPORTANTE: é uma ESTIMATIVA local. O valor oficial é sempre o do portal
// iGreen. As tabelas de % seguem o manual oficial (LicConexaoGreen):
//   CP (Conexão Própria):  4% na maioria · 2% em ES(EDP), RS(CEEE), SE(Energisa)
//   CI (Conexão Indireta): 1% na maioria · 0,5% nos mesmos 3 casos
//   Carreira: Sênior +0,2% · G-Expansão +0,3% · Gestor +0,5% · E-Expansão +0,6%
//             · Executivo +0,8% · D-Expansão +1% · Diretor +1,4% · Acionista +1,8%
// =============================================================================

// ─── Tipos de entrada do motor ───────────────────────────────────────────

/** Modo de contagem das faixas de entrada. */
export type CountMode = "somado" | "individual";

/** Regra de uma faixa de entrada (espelha consultant_entrada_rules). */
export interface EntradaRule {
  distribuidora: string;
  minPessoas: number;
  entradaTotalPct: number;
  pctImediato: number;
  pctDiferido: number;
  diasDiferido: number;
}

/** Cliente validado mínimo necessário para o cálculo. */
export interface GreenCustomerInput {
  id: string;
  isDirect: boolean;
  distribuidora: string | null;
  uf: string | null;
  /** Valor da fatura (informado ou estimado por consumo). */
  faturaValor: number | null;
  /** true quando fatura veio de media_consumo (estimativa). */
  faturaEstimada?: boolean;
  /** Data de validação no Pós-Venda (pos_venda_approved_at). */
  validatedAt: string | null;
  /** iGreen marcou Validado (andamento) — potencial antes do CRM. */
  validadoIgreen?: boolean;
}

export interface GraduacaoOption {
  value: string;
  label: string;
  bonusPct: number;
}

/** Graduações Green — fonte única para Dados, dashboard e motor. */
export const GRADUACAO_OPTIONS: GraduacaoOption[] = [
  { value: "licenciado", label: "Licenciado", bonusPct: 0 },
  { value: "senior", label: "Sênior", bonusPct: 0.2 },
  { value: "g-expansao", label: "G-Expansão", bonusPct: 0.3 },
  { value: "gestor", label: "Gestor", bonusPct: 0.5 },
  { value: "e-expansao", label: "E-Expansão", bonusPct: 0.6 },
  { value: "executivo", label: "Executivo", bonusPct: 0.8 },
  { value: "d-expansao", label: "D-Expansão", bonusPct: 1.0 },
  { value: "diretor", label: "Diretor", bonusPct: 1.4 },
  { value: "acionista", label: "Acionista", bonusPct: 1.8 },
];

function normGraduacao(g?: string | null): string {
  return norm(g).toLowerCase().replace(/\s+/g, "-");
}

export function graduacaoDisplay(graduacao?: string | null): GraduacaoOption {
  const key = normGraduacao(graduacao);
  return GRADUACAO_OPTIONS.find((o) => o.value === key) ?? GRADUACAO_OPTIONS[0];
}

/** Índice na escada de graduação (0 = Licenciado). Graduações desconhecidas = 0. */
export function graduacaoRank(graduacao?: string | null): number {
  const key = normGraduacao(graduacao);
  const idx = GRADUACAO_OPTIONS.findIndex((o) => o.value === key);
  return idx >= 0 ? idx : 0;
}

/** Escolhe a graduação mais alta entre várias fontes (DB, sync iGreen, local). */
export function resolveGraduacao(...sources: (string | null | undefined)[]): string {
  let best = GRADUACAO_OPTIONS[0].value;
  let bestRank = 0;
  for (const source of sources) {
    if (!source?.trim()) continue;
    const rank = graduacaoRank(source);
    if (rank > bestRank) {
      bestRank = rank;
      best = normGraduacao(source);
    }
  }
  return best;
}

/** Tarifa média R$/kWh quando sync não traz valor da conta (estimativa conservadora). */
export const DEFAULT_TARIFA_KWH = 0.95;

export interface GreenSettings {
  graduacao: string;
  countMode: CountMode;
  /** IDs iGreen extras que contam como CP (além do igreen_id do perfil). */
  cadastroIgreenIds: string[];
  consultantName: string | null;
  myIgreenId: string | null;
}

/**
 * Estima fatura mensal: prefere electricity_bill_value; senão consumo × tarifa
 * com desconto do cliente (campo sync desconto_cliente em %).
 */
export function estimateBillValue(
  electricityBill: number | null | undefined,
  mediaConsumo: number | null | undefined,
  descontoCliente: number | null | undefined,
  tarifaKwh: number = DEFAULT_TARIFA_KWH,
): number {
  const bill = Number(electricityBill);
  if (Number.isFinite(bill) && bill > 0) return Math.round(bill * 100) / 100;

  const kwh = Number(mediaConsumo);
  if (!Number.isFinite(kwh) || kwh <= 0) return 0;

  const desc = Number(descontoCliente);
  const factor = Number.isFinite(desc) && desc > 0 ? Math.max(0, 1 - desc / 100) : 1;
  return Math.round(kwh * tarifaKwh * factor * 100) / 100;
}

function normalizePersonName(name?: string | null): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cliente direto (CP): registered_by_igreen_id bate com meu ID ou IDs extras,
 * OU nome do cadastrador contém meu nome (fallback sync com código errado).
 */
export function isDirectCustomer(
  registeredByIgreenId: string | null | undefined,
  registeredByName: string | null | undefined,
  settings: Pick<GreenSettings, "myIgreenId" | "cadastroIgreenIds" | "consultantName">,
): boolean {
  const regId = registeredByIgreenId != null ? String(registeredByIgreenId).trim() : "";
  const cpIds = new Set<string>();
  if (settings.myIgreenId) cpIds.add(String(settings.myIgreenId).trim());
  for (const id of settings.cadastroIgreenIds) {
    const t = String(id).trim();
    if (t) cpIds.add(t);
  }
  if (regId && cpIds.has(regId)) return true;

  const cName = normalizePersonName(settings.consultantName);
  const rName = normalizePersonName(registeredByName);
  if (!cName || !rName || cName.length < 3) return false;

  const parts = cName.split(" ").filter((p) => p.length >= 2);
  if (parts.length >= 2) {
    return parts.every((p) => rName.includes(p));
  }
  return rName.includes(parts[0]) && parts[0].length >= 4;
}

// ─── Recorrente: % por distribuidora/UF ────────────────────────────────────

// Normaliza texto para comparação (sem acento, maiúsculas, espaços colapsados).
function norm(s?: string | null): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Casos de exceção do manual: recorrente reduzido (CP 2% / CI 0,5%).
// Chave por UF + fragmento da distribuidora.
const REDUCED_RECURRING: { uf: string; match: string }[] = [
  { uf: "ES", match: "EDP" },
  { uf: "RS", match: "CEEE" },
  { uf: "SE", match: "ENERGISA" },
];

/** true se a combinação UF/distribuidora cai no recorrente reduzido. */
export function isReducedRecurring(uf?: string | null, distribuidora?: string | null): boolean {
  const u = norm(uf);
  const d = norm(distribuidora);
  return REDUCED_RECURRING.some((r) => r.uf === u && d.includes(r.match));
}

/** % recorrente base (sem carreira) conforme CP/CI e exceções por UF. */
export function baseRecurringPercent(isDirect: boolean, uf?: string | null, distribuidora?: string | null): number {
  const reduced = isReducedRecurring(uf, distribuidora);
  if (isDirect) return reduced ? 2 : 4; // CP
  return reduced ? 0.5 : 1; // CI
}

// ─── Carreira: bônus de % por graduação (manual iGreen) ────────────────────

/** Bônus de carreira (em pontos percentuais) para a graduação informada. */
export function careerBonusPercent(graduacao?: string | null): number {
  return graduacaoDisplay(graduacao).bonusPct;
}

// ─── Entrada: resolver faixa por distribuidora ──────────────────────────────

/**
 * Conta validados por distribuidora a partir dos clientes diretos do mês.
 * A chave é a distribuidora normalizada; o valor é a contagem.
 */
export function countDirectByDistribuidora(customers: GreenCustomerInput[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of customers) {
    if (!c.isDirect) continue;
    const key = norm(c.distribuidora);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Resolve a maior faixa atingida para uma distribuidora, dado:
 *   • somado     → usa a contagem TOTAL de validados diretos do mês;
 *   • individual → usa apenas a contagem daquela distribuidora.
 * Retorna a regra escolhida ou null se nenhuma faixa foi atingida.
 */
export function resolveEntradaTier(
  rules: EntradaRule[],
  distribuidora: string | null,
  counts: Map<string, number>,
  mode: CountMode,
): EntradaRule | null {
  const key = norm(distribuidora);
  if (!key) return null;

  const distribRules = rules
    .filter((r) => norm(r.distribuidora) === key)
    .sort((a, b) => a.minPessoas - b.minPessoas);
  if (distribRules.length === 0) return null;

  const effectiveCount =
    mode === "somado"
      ? Array.from(counts.values()).reduce((a, b) => a + b, 0)
      : counts.get(key) ?? 0;

  let chosen: EntradaRule | null = null;
  for (const r of distribRules) {
    if (effectiveCount >= r.minPessoas) chosen = r;
    else break;
  }
  return chosen;
}

// ─── Resultado consolidado ──────────────────────────────────────────────────

export interface GreenCustomerGain {
  customerId: string;
  isDirect: boolean;
  distribuidora: string | null;
  fatura: number;
  /** Recorrente mensal estimado (base + carreira). */
  recorrenteMensal: number;
  /** % recorrente aplicado (base + carreira). */
  recorrentePct: number;
  /** Entrada paga agora (imediato). Só clientes diretos. */
  entradaImediata: number;
  /** Entrada diferida (a receber). Só clientes diretos. */
  entradaDiferida: number;
  /** Quando a parcela diferida cai (ISO) — validatedAt + diasDiferido. */
  entradaDiferidaEm: string | null;
}

export interface GreenGainsSummary {
  /** Total recorrente mensal estimado (todos os clientes). */
  recorrenteMensal: number;
  /** Total de entrada imediata no período (diretos). */
  entradaImediata: number;
  /** Total de entrada diferida a receber (diretos). */
  entradaDiferida: number;
  /** Detalhe por cliente. */
  porCliente: GreenCustomerGain[];
}

function addDaysIso(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Calcula os ganhos Green de um conjunto de clientes validados no período.
 * - Recorrente: todo cliente com fatura (CP ou CI) — repete todo mês.
 * - Entrada: apenas clientes diretos (CP), uma única vez, dividida em
 *   parcela imediata e parcela diferida (90 dias por padrão).
 */
export function computeGreenGains(
  customers: GreenCustomerInput[],
  rules: EntradaRule[],
  settings: GreenSettings,
): GreenGainsSummary {
  const counts = countDirectByDistribuidora(customers);
  const carreira = careerBonusPercent(settings.graduacao);

  const porCliente: GreenCustomerGain[] = customers.map((c) => {
    const fatura = Number.isFinite(c.faturaValor) && (c.faturaValor ?? 0) > 0 ? (c.faturaValor as number) : 0;
    const recPct = baseRecurringPercent(c.isDirect, c.uf, c.distribuidora) + carreira;
    const recorrenteMensal = fatura * (recPct / 100);

    let entradaImediata = 0;
    let entradaDiferida = 0;
    let entradaDiferidaEm: string | null = null;

    if (c.isDirect) {
      const tier = resolveEntradaTier(rules, c.distribuidora, counts, settings.countMode);
      if (tier) {
        entradaImediata = fatura * (tier.pctImediato / 100);
        entradaDiferida = fatura * (tier.pctDiferido / 100);
        entradaDiferidaEm = addDaysIso(c.validatedAt, tier.diasDiferido);
      }
    }

    return {
      customerId: c.id,
      isDirect: c.isDirect,
      distribuidora: c.distribuidora,
      fatura,
      recorrenteMensal,
      recorrentePct: recPct,
      entradaImediata,
      entradaDiferida,
      entradaDiferidaEm,
    };
  });

  return {
    recorrenteMensal: porCliente.reduce((a, g) => a + g.recorrenteMensal, 0),
    entradaImediata: porCliente.reduce((a, g) => a + g.entradaImediata, 0),
    entradaDiferida: porCliente.reduce((a, g) => a + g.entradaDiferida, 0),
    porCliente,
  };
}
