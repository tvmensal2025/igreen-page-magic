// recon-igreen-seed
// Popula a fila `igreen_recon_queue` com TODAS as rotas e endpoints a mapear
// no portal iGreen. Chamado 1x pelo admin em /admin/recon.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KNOWN_ROUTES = [
  "/dashboard",
  "/clientes-green", "/clientes-green/faturas", "/clientes-green/injecao",
  "/clientes-green/boletos", "/clientes-green/devolutivas",
  "/clientes-green/devolutivas-resolvidas", "/clientes-green/cashback",
  "/clientes-green/resumo-geral", "/clientes-green/comissoes",
  "/produtos/telecom", "/produtos/telecom/clientes", "/produtos/telecom/linhas",
  "/produtos/telecom/faturas", "/produtos/telecom/comissoes",
  "/produtos/telecom/recargas", "/produtos/telecom/bonus",
  "/produtos/telecom/portabilidade", "/produtos/telecom/licenciados",
  "/produtos/telecom/planos", "/produtos/telecom/resumo-geral",
  "/seguros", "/seguros/apolices", "/seguros/clientes", "/seguros/comissoes",
  "/seguros/sinistros", "/seguros/renovacoes", "/seguros/cashback",
  "/seguros/licenciados", "/seguros/produtos", "/seguros/propostas",
  "/seguros/resumo-geral",
  "/rede-lider", "/rede-lider/membros", "/rede-lider/licenciados",
  "/rede-lider/ranking", "/rede-lider/comissoes", "/rede-lider/bonus",
  "/rede-lider/carreira", "/rede-lider/graduacao",
  "/rotinas", "/rotinas/diaria", "/rotinas/semanal", "/rotinas/mensal",
  "/comissoes", "/comissoes/resumo", "/comissoes/extrato",
  "/financeiro", "/financeiro/boletos", "/financeiro/extrato",
  "/financeiro/carteira", "/financeiro/notas", "/financeiro/saques",
  "/relatorios", "/perfil", "/configuracoes",
];

const KNOWN_ENDPOINTS = [
  "/crm/green", "/crm/telecom", "/crm/seguros",
  "/cashback/resumo?origem=green", "/cashback/resumo?origem=telecom", "/cashback/resumo?origem=seguros",
  "/clientes-green/boletos?status=todos&search=&page=1&perPage=50",
  "/clientes-green/devolutivas?categoria=todos&search=&page=1&perPage=50",
  "/rotinas/devolutivas-novas?mes=" + new Date().toISOString().slice(0, 7),
  "/telecom/faturas?status=todos&search=&page=1&perPage=50",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const monthsBack = Number(body.months_back ?? 24);
    const resetErrors = body.reset_errors ?? false;

    const jobs: Array<{ kind: string; target: string; params: any; priority: number }> = [];

    for (const route of KNOWN_ROUTES) {
      jobs.push({ kind: "route", target: route, params: {}, priority: 100 });
    }
    for (const endpoint of KNOWN_ENDPOINTS) {
      jobs.push({ kind: "endpoint", target: endpoint, params: {}, priority: 90 });
    }
    const now = new Date();
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      jobs.push({ kind: "nm_month", target: mes, params: { mes }, priority: 80 });
    }

    // Insert em bulk, ignorando duplicatas (constraint UNIQUE kind+target+params)
    let inserted = 0;
    for (const j of jobs) {
      const { error } = await supabase.from("igreen_recon_queue").insert({
        kind: j.kind,
        target: j.target,
        params: j.params,
        priority: j.priority,
        status: "pending",
      });
      if (!error) inserted++;
    }

    if (resetErrors) {
      await supabase
        .from("igreen_recon_queue")
        .update({ status: "pending", attempts: 0, last_error: null })
        .eq("status", "error");
    }

    const { data: progress } = await supabase.from("igreen_recon_queue_progress").select("*");

    return new Response(JSON.stringify({ ok: true, planned: jobs.length, inserted, progress }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
