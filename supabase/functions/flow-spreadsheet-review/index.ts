// Edge function: revisão de fluxo via Lovable AI Gateway (GPT-5.5)
// Modo "global" analisa o fluxo inteiro; modo "step" foca num passo.
// Retorna { summary, issues[] } via tool calling estruturado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface Body {
  mode: "global" | "step";
  flowId: string;
  stepId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY não configurada" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.flowId || !body?.mode) return json({ error: "missing_fields" }, 400);
    if (body.mode === "step" && !body.stepId) return json({ error: "missing_stepId" }, 400);

    // Verifica ownership
    const { data: flow } = await admin
      .from("bot_flows")
      .select("id, consultant_id, variant, name")
      .eq("id", body.flowId)
      .maybeSingle();
    if (!flow) return json({ error: "flow_not_found" }, 404);

    if ((flow as any).consultant_id !== userId) {
      const { data: isAdmin } = await admin.rpc("is_super_admin", { _user_id: userId });
      if (!isAdmin) return json({ error: "forbidden" }, 403);
    }

    // Carrega todos os passos
    const { data: stepsRaw } = await admin
      .from("bot_flow_steps")
      .select("id, position, step_type, step_key, title, summary, message_text, slot_key, transitions, captures, fallback, is_active")
      .eq("flow_id", body.flowId)
      .order("position");
    const steps = (stepsRaw as any[]) || [];

    // Carrega mídias ativas
    const consultantId = (flow as any).consultant_id;
    const { data: mediasRaw } = await admin
      .from("ai_media_library")
      .select("kind, slot_key, name, active, is_public, consultant_id")
      .or(`consultant_id.eq.${consultantId},is_public.eq.true`)
      .eq("active", true);
    const mediasBySlot: Record<string, string[]> = {};
    for (const m of (mediasRaw as any[]) || []) {
      const k = m.slot_key as string | null;
      if (!k) continue;
      if (!mediasBySlot[k]) mediasBySlot[k] = [];
      mediasBySlot[k].push(`${m.kind}:${m.name ?? "(sem nome)"}`);
    }

    const flowTable = steps.map((s) => ({
      id: s.id,
      pos: s.position,
      step_key: s.step_key,
      title: s.title,
      type: s.step_type,
      message_text: s.message_text ?? "",
      buttons: extractButtons(s.captures),
      transitions: (s.transitions || []).map((t: any) => ({
        intent: t.trigger_intent,
        phrases: t.trigger_phrases || [],
        goto_step_id: t.goto_step_id,
        goto_step_title: t.goto_step_id ? (steps.find((x) => x.id === t.goto_step_id)?.title ?? "(removido)") : null,
        goto_special: t.goto_special,
      })),
      fallback: s.fallback,
      captures: (s.captures || []).filter((c: any) => c.field !== "_buttons"),
      medias: s.slot_key ? mediasBySlot[s.slot_key] ?? [] : [],
      is_active: s.is_active,
    }));

    const focusStep = body.mode === "step" ? steps.find((s) => s.id === body.stepId) : null;

    const systemPrompt = `Você é um especialista em fluxos de WhatsApp para captação de leads de energia solar (iGreen Energy, canal whapi).

Sua missão: revisar o fluxo e apontar problemas concretos com sugestões aplicáveis.

Contexto do projeto:
- Variante D do fluxo é a "personalizada" com OCR multi-campo (CPF, RG, nascimento)
- Após confirmação da conta de luz, NÃO repetir "como funciona"
- Passos críticos: aguardando_conta (preflight rejeita CNH/RG), aguardando_doc_auto (detecta tipo com confiança ≥0.62 CNH / 0.78 outros), aguardando_doc_verso, confirm_phone
- Mensagens devem ser curtas, diretas, em PT-BR informal, máx 3 linhas
- Use {{nome}}, {{valor_conta}}, {{representante}} como placeholders

Procure por:
- copy: textos longos demais, ambíguos, robóticos, sem CTA claro, com erro gramatical
- logic: passos sem transições, transições apontando para passos removidos/inativos, loops infinitos
- media: passos sem mídia ativa quando deveriam ter, mídias órfãs
- transition: triggers duplicados, fallback ausente
- retry: ausência de limite de tentativas em capturas
- variant: incoerência com a variante D
- ux: passos que pedem múltiplos dados separadamente quando podiam consolidar

Para cada problema, gere um PATCH JSON aplicável diretamente em bot_flow_steps (chaves permitidas: message_text, title, summary, captures, transitions, fallback, step_type, is_active, auto_detect_doc_type, text_delay_ms).

Use severity: critical (quebra o fluxo), warning (degrada conversão), info (polimento).`;

    const userPrompt = body.mode === "global"
      ? `Revisão GLOBAL do fluxo "${(flow as any).name ?? "?"}" (variante ${(flow as any).variant}).
${steps.length} passos. Identifique até 10 problemas mais relevantes.

FLUXO COMPLETO (JSON):
${JSON.stringify(flowTable, null, 2)}`
      : `Revisão FOCADA no passo abaixo. Liste 1-3 melhorias específicas com patches.

PASSO ALVO:
${JSON.stringify(flowTable.find((x) => x.id === body.stepId), null, 2)}

CONTEXTO (passos vizinhos):
${JSON.stringify(flowTable.filter((x) => Math.abs(x.pos - (focusStep?.position ?? 0)) <= 2), null, 2)}`;

    const tools = [{
      type: "function",
      function: {
        name: "report_flow_issues",
        description: "Reporta problemas encontrados no fluxo com sugestões e patches aplicáveis.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Resumo executivo (2-4 frases) em PT-BR" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step_id: { type: ["string", "null"] },
                  step_key: { type: ["string", "null"] },
                  severity: { type: "string", enum: ["critical", "warning", "info"] },
                  category: { type: "string", enum: ["copy", "logic", "media", "transition", "retry", "variant", "ux"] },
                  problem: { type: "string" },
                  suggestion: { type: "string" },
                  patch: { type: ["object", "null"], additionalProperties: true },
                },
                required: ["severity", "category", "problem", "suggestion"],
              },
            },
          },
          required: ["summary", "issues"],
        },
      },
    }];

    const reqBody: Record<string, any> = {
      model: "openai/gpt-5.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "report_flow_issues" } },
      reasoning_effort: body.mode === "global" ? "high" : "medium",
    };

    const resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[flow-spreadsheet-review] gateway error", resp.status, text);
      if (resp.status === 429) return json({ error: "Limite de requisições atingido. Aguarde alguns segundos e tente novamente." }, 429);
      if (resp.status === 402) return json({ error: "Créditos esgotados. Adicione créditos em Settings > Workspace > Usage." }, 402);
      return json({ error: `Gateway erro ${resp.status}`, details: text.slice(0, 400) }, 500);
    }

    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return json({ error: "IA não retornou tool_call", raw: data?.choices?.[0]?.message ?? null }, 500);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return json({ error: "Falha ao parsear resposta da IA", raw: toolCall.function.arguments?.slice(0, 400) }, 500);
    }

    return json({ ok: true, ...parsed });
  } catch (e) {
    console.error("[flow-spreadsheet-review] error", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function extractButtons(captures: any): { id: string; title: string }[] {
  if (!Array.isArray(captures)) return [];
  const btn = captures.find((c: any) => c?.field === "_buttons");
  return Array.isArray(btn?.value) ? btn.value : [];
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
