// =============================================================================
// Acompanhamento — Camada de dados da comissão Green
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import {
  estimateBillValue,
  graduacaoRank,
  isDirectCustomer,
  resolveGraduacao,
  type CountMode,
  type EntradaRule,
  type GreenCustomerInput,
  type GreenSettings,
} from "./greenCommission";

export interface EntradaRuleRow extends EntradaRule {
  id: string;
  ativo: boolean;
}

export interface GreenPortfolioStats {
  totalSync: number;
  diretosCp: number;
  validadosIgreen: number;
  validadosCrm: number;
  faltaAssinatura: number;
  comFaturaReal: number;
  comFaturaEstimada: number;
  semFatura: number;
}

export interface ValidatedCustomers {
  settings: GreenSettings;
  /** Clientes validados no CRM neste mês (entrada). */
  thisMonth: GreenCustomerInput[];
  /** Clientes validados no CRM (recorrente oficial). */
  allActiveCrm: GreenCustomerInput[];
  /** iGreen Validado ainda sem CRM — potencial recorrente. */
  potencialIgreen: GreenCustomerInput[];
  portfolio: GreenPortfolioStats;
  semFaturaCount: number;
  /** Carteira para o painel de faturas Green. */
  faturaClients: GreenFaturaClient[];
}

export type GreenFaturaKind = "real" | "estimada" | "sem_fatura";

export interface GreenFaturaClient {
  id: string;
  name: string | null;
  distribuidora: string | null;
  faturaValor: number | null;
  kind: GreenFaturaKind;
}

const DEFAULT_SETTINGS: Omit<GreenSettings, "myIgreenId" | "consultantName"> = {
  graduacao: "licenciado",
  countMode: "somado",
  cadastroIgreenIds: [],
};

const LS_PREFIX = "green-commission-settings:";

function lsKey(consultantId: string): string {
  return `${LS_PREFIX}${consultantId}`;
}

/** Fallback local quando migration ainda não aplicada no Supabase. */
export function loadLocalGreenSettings(consultantId: string): Partial<GreenSettings> | null {
  try {
    const raw = localStorage.getItem(lsKey(consultantId));
    return raw ? (JSON.parse(raw) as Partial<GreenSettings>) : null;
  } catch {
    return null;
  }
}

export function saveLocalGreenSettings(consultantId: string, partial: Partial<GreenSettings>): void {
  try {
    const prev = loadLocalGreenSettings(consultantId) ?? {};
    localStorage.setItem(lsKey(consultantId), JSON.stringify({ ...prev, ...partial }));
  } catch {
    /* ignore quota */
  }
}

const REPROVADO_RE = /reprov|cancel/i;

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function mapRuleRow(r: Record<string, unknown>): EntradaRuleRow {
  return {
    id: String(r.id),
    distribuidora: String(r.distribuidora),
    minPessoas: Number(r.min_pessoas) || 0,
    entradaTotalPct: Number(r.entrada_total_pct) || 0,
    pctImediato: Number(r.pct_imediato) || 0,
    pctDiferido: Number(r.pct_diferido) || 0,
    diasDiferido: Number(r.dias_diferido) || 90,
    ativo: r.ativo !== false,
  };
}

async function loadConsultantProfile(consultantId: string) {
  const { data } = await supabase
    .from("consultants")
    .select("igreen_id,name")
    .eq("id", consultantId)
    .maybeSingle();
  return {
    myIgreenId: (data as { igreen_id?: string } | null)?.igreen_id
      ? String((data as { igreen_id: string }).igreen_id)
      : null,
    consultantName: (data as { name?: string } | null)?.name ?? null,
  };
}

/** Graduação do próprio consultor na rede sync iGreen (network_members). */
async function fetchNetworkGraduacao(
  consultantId: string,
  myIgreenId: string | null,
): Promise<string | null> {
  const igreenNum = myIgreenId ? parseInt(myIgreenId.replace(/\D/g, ""), 10) : NaN;

  if (Number.isFinite(igreenNum) && igreenNum > 0) {
    const { data } = await supabase
      .from("network_members" as any)
      .select("graduacao")
      .eq("consultant_id", consultantId)
      .eq("igreen_id", igreenNum)
      .maybeSingle();
    const grad = (data as { graduacao?: string | null } | null)?.graduacao?.trim();
    if (grad) return grad;
  }

  // Fallback: membro raiz (nível 0) costuma ser o próprio consultor.
  const { data: root } = await supabase
    .from("network_members" as any)
    .select("graduacao")
    .eq("consultant_id", consultantId)
    .eq("nivel", 0)
    .maybeSingle();
  return (root as { graduacao?: string | null } | null)?.graduacao?.trim() || null;
}

async function persistGraduacaoUpgrade(consultantId: string, graduacao: string): Promise<void> {
  const { error } = await supabase
    .from("consultant_commission_settings" as any)
    .upsert({ consultant_id: consultantId, graduacao }, { onConflict: "consultant_id" });
  if (error) console.warn("[greenData] persistGraduacaoUpgrade:", error.message);
}

/** Carrega graduação, modo de contagem e IDs extras de cadastro CP. */
export async function fetchGreenSettings(consultantId: string): Promise<GreenSettings> {
  const profile = await loadConsultantProfile(consultantId);
  const local = loadLocalGreenSettings(consultantId);
  const networkGraduacao = await fetchNetworkGraduacao(consultantId, profile.myIgreenId);

  const { data, error } = await supabase
    .from("consultant_commission_settings" as any)
    .select("graduacao,count_mode,cadastro_igreen_ids")
    .eq("consultant_id", consultantId)
    .maybeSingle();

  if (error || !data) {
    const graduacao = resolveGraduacao(local?.graduacao, networkGraduacao, DEFAULT_SETTINGS.graduacao);
    if (networkGraduacao && graduacaoRank(graduacao) > graduacaoRank(local?.graduacao)) {
      void persistGraduacaoUpgrade(consultantId, graduacao);
    }
    return {
      ...DEFAULT_SETTINGS,
      graduacao,
      countMode: (local?.countMode as CountMode) ?? DEFAULT_SETTINGS.countMode,
      cadastroIgreenIds: local?.cadastroIgreenIds ?? [],
      ...profile,
    };
  }

  const row = data as {
    graduacao?: string;
    count_mode?: string;
    cadastro_igreen_ids?: string[];
  };

  const graduacao = resolveGraduacao(row.graduacao, networkGraduacao, local?.graduacao, DEFAULT_SETTINGS.graduacao);
  if (networkGraduacao && graduacaoRank(graduacao) > graduacaoRank(row.graduacao)) {
    void persistGraduacaoUpgrade(consultantId, graduacao);
  }

  const settings: GreenSettings = {
    graduacao,
    countMode: (row.count_mode as CountMode) || local?.countMode || DEFAULT_SETTINGS.countMode,
    cadastroIgreenIds: row.cadastro_igreen_ids?.length
      ? row.cadastro_igreen_ids.map(String)
      : local?.cadastroIgreenIds ?? [],
    ...profile,
  };

  saveLocalGreenSettings(consultantId, {
    graduacao: settings.graduacao,
    countMode: settings.countMode,
    cadastroIgreenIds: settings.cadastroIgreenIds,
  });

  return settings;
}

/** Persiste graduação + IDs de cadastro (DB + localStorage). */
export async function saveGreenProfile(
  consultantId: string,
  patch: Partial<Pick<GreenSettings, "graduacao" | "cadastroIgreenIds" | "countMode">>,
): Promise<void> {
  saveLocalGreenSettings(consultantId, patch);

  const payload: Record<string, unknown> = { consultant_id: consultantId };
  if (patch.graduacao != null) payload.graduacao = patch.graduacao;
  if (patch.countMode != null) payload.count_mode = patch.countMode;
  if (patch.cadastroIgreenIds != null) payload.cadastro_igreen_ids = patch.cadastroIgreenIds;

  const { error } = await supabase
    .from("consultant_commission_settings" as any)
    .upsert(payload, { onConflict: "consultant_id" });

  if (error) throw error;
}

export async function saveCountMode(consultantId: string, mode: CountMode): Promise<void> {
  await saveGreenProfile(consultantId, { countMode: mode });
}

export async function fetchEntradaRules(consultantId: string): Promise<EntradaRuleRow[]> {
  const { data, error } = await supabase
    .from("consultant_entrada_rules" as any)
    .select("id,distribuidora,min_pessoas,entrada_total_pct,pct_imediato,pct_diferido,dias_diferido,ativo")
    .eq("consultant_id", consultantId)
    .eq("ativo", true)
    .order("distribuidora", { ascending: true })
    .order("min_pessoas", { ascending: true });
  if (error) return [];
  return ((data as unknown as Record<string, unknown>[]) || []).map(mapRuleRow);
}

export interface UpsertEntradaRuleInput {
  id?: string;
  distribuidora: string;
  minPessoas: number;
  entradaTotalPct: number;
  pctImediato: number;
  pctDiferido: number;
  diasDiferido: number;
}

export async function upsertEntradaRule(consultantId: string, input: UpsertEntradaRuleInput): Promise<void> {
  const payload: Record<string, unknown> = {
    consultant_id: consultantId,
    distribuidora: input.distribuidora.trim().toUpperCase(),
    min_pessoas: input.minPessoas,
    entrada_total_pct: input.entradaTotalPct,
    pct_imediato: input.pctImediato,
    pct_diferido: input.pctDiferido,
    dias_diferido: input.diasDiferido,
    ativo: true,
  };
  if (input.id) payload.id = input.id;
  const { error } = await supabase
    .from("consultant_entrada_rules" as any)
    .upsert(payload, { onConflict: "consultant_id,distribuidora,min_pessoas" });
  if (error) throw error;
}

export async function deleteEntradaRule(id: string): Promise<void> {
  const { error } = await supabase
    .from("consultant_entrada_rules" as any)
    .update({ ativo: false })
    .eq("id", id);
  if (error) throw error;
}

type RawCustomer = {
  id: string;
  name: string | null;
  distribuidora: string | null;
  address_state: string | null;
  electricity_bill_value: number | null;
  media_consumo: number | null;
  desconto_cliente: number | null;
  pos_venda_approved_at: string | null;
  registered_by_igreen_id: string | null;
  registered_by_name: string | null;
  status: string | null;
  andamento_igreen: string | null;
  pos_venda_stage: string | null;
};

function isReproved(c: RawCustomer): boolean {
  return (
    REPROVADO_RE.test(c.andamento_igreen || "") ||
    ["rejected", "cancelled", "canceled"].includes(c.status || "") ||
    c.pos_venda_stage === "reprovado"
  );
}

function toGreenInput(c: RawCustomer, settings: GreenSettings, extra?: Partial<GreenCustomerInput>): GreenCustomerInput {
  const billRaw = c.electricity_bill_value != null ? Number(c.electricity_bill_value) : null;
  const hasRealBill = billRaw != null && billRaw > 0;
  const fatura = estimateBillValue(billRaw, c.media_consumo, c.desconto_cliente);
  return {
    id: c.id,
    isDirect: isDirectCustomer(c.registered_by_igreen_id, c.registered_by_name, settings),
    distribuidora: c.distribuidora ?? null,
    uf: c.address_state ?? null,
    faturaValor: fatura > 0 ? fatura : null,
    faturaEstimada: !hasRealBill && fatura > 0,
    validatedAt: c.pos_venda_approved_at ?? null,
    validadoIgreen: c.andamento_igreen === "Validado",
    ...extra,
  };
}

async function fetchAllSyncCustomers(consultantId: string): Promise<RawCustomer[]> {
  const all: RawCustomer[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("customers")
      .select(
        "id,name,distribuidora,address_state,electricity_bill_value,media_consumo,desconto_cliente,pos_venda_approved_at,registered_by_igreen_id,registered_by_name,status,andamento_igreen,pos_venda_stage",
      )
      .eq("customer_origin", "igreen_sync")
      .or(`consultant_id.eq.${consultantId},assigned_consultant_id.eq.${consultantId}`)
      .range(from, from + step - 1);
    if (error) throw error;
    const batch = (data as RawCustomer[]) || [];
    all.push(...batch);
    if (batch.length < step) break;
    from += step;
  }
  return all;
}

function buildPortfolioStats(rows: RawCustomer[], settings: GreenSettings): GreenPortfolioStats {
  let diretosCp = 0;
  let validadosIgreen = 0;
  let validadosCrm = 0;
  let faltaAssinatura = 0;
  let comFaturaReal = 0;
  let comFaturaEstimada = 0;
  let semFatura = 0;

  for (const c of rows) {
    if (isReproved(c)) continue;

    if (isDirectCustomer(c.registered_by_igreen_id, c.registered_by_name, settings)) diretosCp++;
    if (c.andamento_igreen === "Validado") validadosIgreen++;
    if (c.pos_venda_approved_at) validadosCrm++;
    if (/falta assinatura/i.test(c.andamento_igreen || "") || c.status === "awaiting_signature") {
      faltaAssinatura++;
    }

    const billRaw = c.electricity_bill_value != null ? Number(c.electricity_bill_value) : null;
    const est = estimateBillValue(billRaw, c.media_consumo, c.desconto_cliente);
    if (billRaw != null && billRaw > 0) comFaturaReal++;
    else if (est > 0) comFaturaEstimada++;
    else semFatura++;
  }

  return {
    totalSync: rows.length,
    diretosCp,
    validadosIgreen,
    validadosCrm,
    faltaAssinatura,
    comFaturaReal,
    comFaturaEstimada,
    semFatura,
  };
}

/** Carrega clientes, estatísticas da carteira e listas para o motor de ganhos. */
export async function fetchValidatedCustomers(consultantId: string): Promise<ValidatedCustomers> {
  const settings = await fetchGreenSettings(consultantId);
  const rows = await fetchAllSyncCustomers(consultantId);
  const portfolio = buildPortfolioStats(rows, settings);

  const monthStart = startOfMonthIso();
  const allActiveCrm: GreenCustomerInput[] = [];
  const thisMonth: GreenCustomerInput[] = [];
  const potencialIgreen: GreenCustomerInput[] = [];
  const faturaClients: GreenFaturaClient[] = [];
  let semFaturaCount = 0;

  for (const c of rows) {
    if (isReproved(c)) continue;

    const input = toGreenInput(c, settings);
    const billRaw = c.electricity_bill_value != null ? Number(c.electricity_bill_value) : null;
    const hasRealBill = billRaw != null && billRaw > 0;
    const est = estimateBillValue(billRaw, c.media_consumo, c.desconto_cliente);

    let kind: GreenFaturaKind = "sem_fatura";
    if (hasRealBill) kind = "real";
    else if (est > 0) kind = "estimada";

    if (c.pos_venda_approved_at || c.andamento_igreen === "Validado") {
      faturaClients.push({
        id: c.id,
        name: c.name ?? null,
        distribuidora: c.distribuidora,
        faturaValor: input.faturaValor,
        kind,
      });
    }

    if (c.pos_venda_approved_at) {
      allActiveCrm.push(input);
      if (c.pos_venda_approved_at >= monthStart) {
        thisMonth.push(input);
        if (input.isDirect && (input.faturaValor == null || input.faturaValor <= 0)) semFaturaCount++;
      }
    } else if (c.andamento_igreen === "Validado") {
      potencialIgreen.push(input);
    }
  }

  return {
    settings,
    thisMonth,
    allActiveCrm,
    potencialIgreen,
    portfolio,
    semFaturaCount,
    faturaClients,
  };
}
