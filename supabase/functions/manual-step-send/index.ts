// Manual step sender: human takes over a conversation and triggers individual
// pieces (audio / image / video / text) of a configured flow step, on-demand.
// By default it does NOT advance conversation_step.
// Decisão de produto (jul/2026): envio manual NÃO religa o bot — só o botão
// "Religar" no chat (ou equivalente) despausa. When continueFlow=true, it
// resumes the custom flow after the selected step but keeps bot_paused.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createWhapiSender } from "../_shared/whapi-api.ts";
import { renderTemplateVars } from "../_shared/render-vars.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { resolveConsultantConnectedWaPhone } from "../_shared/consultant-wa-phone.ts";
import { safeFirstNameForAddress } from "../_shared/customer-display-name.ts";


type Part = "text" | "audio" | "image" | "video" | "document" | "all";

function inferNameSource(name: string | null | undefined, currentSource: string | null | undefined): string {
  const src = String(currentSource || "").toLowerCase();
  if (src) return src;
  const value = String(name || "").trim();
  return value ? "whatsapp_profile" : "unknown";
}

/**
 * Patch de update no envio manual.
 *
 * Decisão de produto: NÃO despausar. Bot fica off até "Religar" no chat.
 * Mantemos a função (e os spreads) para não quebrar call sites — retorna {}.
 */
function buildUnpausePatch(_customer: any): Record<string, any> {
  return {};
}

interface Body {
  consultantId: string;
  customerId: string;
  stepId?: string;   // bot_flow_steps.id
  stepKey?: string;  // alternative lookup
  part: Part;        // which piece to send (or "all")
  mediaId?: string;  // when there are multiple medias of same kind, target one
  continueFlow?: boolean; // resume flow after sending the selected full step
  variant?: "A" | "B" | "C" | "D" | "E" | "M"; // override de variante (consultor escolheu nos chips)
  force?: boolean;   // ignora trava awaiting_inbound (reenvio explícito)
}

// Identifica intenção do passo (perguntar nome / saudar / etc) a partir do texto.
function isNameAskingStep(step: any): boolean {
  const t = String(step?.message_text || step?.title || step?.step_key || "").toLowerCase();
  const captures = Array.isArray(step?.captures) ? step.captures : [];
  if (captures.some((c: any) => String(c?.name || c?.field || "").toLowerCase() === "name")) return true;
  return /seu\s+nome|qual\s+(é\s+)?o?\s*seu\s+nome|como\s+(você\s+)?se\s+chama|me\s+(diz\s+)?seu\s+nome/.test(t);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: must be logged-in user matching consultantId OR super_admin
    // System bypass: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> from internal callers
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, blocked: true, code: "unauthorized", error: "unauthorized", message: "Sessão expirada — faça login novamente." });

    const body = (await req.json()) as Body & { skipNameGuard?: boolean };
    if (!body?.consultantId || !body?.customerId || !body?.part) {
      return json({ ok: false, blocked: true, code: "missing_fields", error: "missing_fields", message: "Faltam dados obrigatórios (consultor, cliente ou parte)." });
    }

    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isSystemCall = !!SERVICE_KEY && jwt === SERVICE_KEY;

    if (!isSystemCall) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userRes } = await userClient.auth.getUser(jwt);
      const userId = userRes?.user?.id;
      if (!userId) return json({ ok: false, blocked: true, code: "unauthorized", error: "unauthorized", message: "Sessão expirada — faça login novamente." });
      if (userId !== body.consultantId) {
        const { data: isAdmin } = await supabase.rpc("is_super_admin", { _user_id: userId });
        if (!isAdmin) return json({ ok: false, blocked: true, code: "forbidden", error: "forbidden", message: "Sem permissão para enviar em nome deste consultor." });
      }
    }

    // Resolve customer + phone
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, name_source, phone_whatsapp, cpf, consultant_id, electricity_bill_value, flow_variant, conversation_step, last_custom_prompt_at, electricity_bill_photo_url, document_front_url, document_back_url, last_inbound_media_url, last_inbound_media_kind, last_inbound_media_at, bill_data_confirmed_at, doc_data_confirmed_at, bill_holder_name, doc_holder_name, name_mismatch_flag, name_mismatch_acknowledged_at, rg, data_nascimento, address_street, address_number, address_complement, address_neighborhood, address_city, address_state, cep, distribuidora, numero_instalacao, do_not_contact")
      .eq("id", body.customerId)
      .maybeSingle();
    if (!customer) return json({ ok: false, blocked: true, code: "customer_not_found", error: "customer_not_found", message: "Lead não encontrado (pode ter sido removido). Recarregue a lista." });

    const suppression = await assertCanContact(supabase, {
      customerId: body.customerId,
      consultantId: body.consultantId,
      phone: customer.phone_whatsapp,
      channel: "whatsapp",
    });
    if (!suppression.allowed) {
      return json({
        ok: false,
        blocked: true,
        code: "do_not_contact",
        error: "do_not_contact",
        message: "Lead em lista de não contato — envio bloqueado.",
        reason: suppression.reason,
      });
    }

    const rawPhone = String(customer.phone_whatsapp || "");
    if (rawPhone.startsWith("sem_celular_")) {
      return json({
        ok: false, blocked: true,
        code: "lead_sem_whatsapp",
        error: "lead_sem_whatsapp",
        message: "Esse lead foi importado via Excel sem celular válido — não dá pra enviar pelo WhatsApp.",
      });
    }
    let phoneDigits = rawPhone.replace(/\D/g, "");
    if (!phoneDigits || phoneDigits.length < 10) {
      return json({
        ok: false, blocked: true,
        code: "customer_no_phone",
        error: "customer_no_phone",
        message: "Lead sem número de WhatsApp válido (precisa ter DDD + número, ex: 11912345678).",
      });
    }
    if (phoneDigits.length === 10 || phoneDigits.length === 11) {
      phoneDigits = "55" + phoneDigits;
    }
    if (phoneDigits.length < 12 || phoneDigits.length > 13) {
      return json({
        ok: false, blocked: true,
        code: "phone_invalid_format",
        error: "phone_invalid_format",
        message: `Número '${rawPhone}' fora do padrão BR (55 + DDD + 8 ou 9 dígitos).`,
      });
    }
    const remoteJid = `${phoneDigits}@s.whatsapp.net`;

    // ═══════════════════════════════════════════════════════════════════
    // SHORTCUT: confirmação de OCR (conta/documento)
    // ═══════════════════════════════════════════════════════════════════
    // Quando consultor (OcrReviewCard / CaptureDataConfirmCard) ou cron
    // (ocr-review-timeout) pede stepKey="confirmando_dados_conta" ou
    // "confirmando_dados_doc", esses NÃO são steps configurados no flow
    // builder — são passos do pipeline LEGADO de cadastro.
    //
    // ANTES: caía no resolve normal de bot_flow_steps → step_not_found
    // → o consultor caía no fallback feio do CaptureDataConfirmCard que
    // mandava texto puro via whapi-proxy/send_text (sem botões).
    //
    // AGORA: monta o template oficial e envia com botões interativos
    // via createWhapiSender (mesma cara do sandbox e do post-OCR).
    // Idempotente: NÃO reenvia se já houver outbound idêntico nos últimos 25s.
    if (body.stepKey === "confirmando_dados_conta" || body.stepKey === "confirmando_dados_doc") {
      const isBill = body.stepKey === "confirmando_dados_conta";
      const stepKey = body.stepKey;

      // Anti-duplicação: pula se já houve outbound desse step nos últimos 25s.
      try {
        const sinceIso = new Date(Date.now() - 25_000).toISOString();
        const { data: recent } = await supabase
          .from("conversations")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("message_direction", "outbound")
          .eq("conversation_step", stepKey)
          .gte("created_at", sinceIso)
          .limit(1);
        if (Array.isArray(recent) && recent.length > 0 && !body.force) {
          return json({
            ok: true, sent: [], skipped: "recent_prompt",
            message: "Mensagem de confirmação já foi enviada há poucos segundos.",
          });
        }
      } catch (_) { /* best-effort */ }

      // Resolve sender (super_admin Whapi vs Evolution do consultor).
      const { data: settingsRows } = await supabase.from("settings").select("key, value");
      const settings: Record<string, any> = {};
      for (const r of (settingsRows as any[]) || []) {
        try { settings[r.key] = typeof r.value === "string" ? JSON.parse(r.value) : r.value; }
        catch { settings[r.key] = r.value; }
      }
      const { data: superAdminRow } = await supabase
        .from("consultants").select("id").eq("id", body.consultantId).maybeSingle();
      // Settings key correta é `superadmin_consultant_id` (sem underscore extra)
      // — match com whapi-webhook/index.ts:92 e o resto da codebase.
      const isSuperAdminFlow = !!(settings.superadmin_consultant_id && String(settings.superadmin_consultant_id) === String((superAdminRow as any)?.id));

      let confirmSender: any;
      if (isSuperAdminFlow) {
        const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
        if (!whapiToken) {
          return json({ code: "whapi_token_missing", error: "whapi_token_missing", message: "Token do WhatsApp (Whapi) não configurado." }, 500);
        }
        confirmSender = createWhapiSender(whapiToken);
      } else {
        // 🐛 CORREÇÃO: antes este atalho lia da tabela `evolution_instances`
        // (que NÃO existe no banco) com colunas inexistentes — sempre dava
        // `no_instance` para consultor Evolution, mesmo conectado. Agora usa
        // a MESMA fonte do envio principal: tabela `whatsapp_instances` +
        // EVOLUTION_API_URL / EVOLUTION_API_KEY do ambiente.
        const { data: instRow } = await supabase
          .from("whatsapp_instances").select("instance_name, status")
          .eq("consultant_id", body.consultantId)
          .maybeSingle();
        const instanceName = (instRow as any)?.instance_name;
        if (!instanceName) {
          return json({ code: "no_instance", error: "no_instance", message: "Nenhuma instância WhatsApp conectada." }, 400);
        }
        const evolutionUrl = Deno.env.get("EVOLUTION_API_URL") || "";
        const evolutionKey = Deno.env.get("EVOLUTION_API_KEY") || "";
        if (!evolutionUrl || !evolutionKey) {
          return json({ code: "evolution_not_configured", error: "evolution_not_configured", message: "Evolution API não configurada no servidor. Avise o admin." }, 500);
        }
        const { createEvolutionSender } = await import("../_shared/evolution-api.ts");
        confirmSender = createEvolutionSender(evolutionUrl, evolutionKey, instanceName);
      }

      // Monta o template (mesmo formato do bot-flow.ts buildConfirmacaoConta / Doc).
      const fmtBRL = (n: number) =>
        Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      let confirmMsg: string;
      let buttons: Array<{ id: string; title: string }>;
      if (isBill) {
        const v = Number((customer as any).electricity_bill_value || 0);
        confirmMsg =
          "📋 *Dados da conta:*\n\n" +
          `👤 *Nome:* ${(customer as any).bill_holder_name || (customer as any).name || "❌"}\n` +
          `📍 *Endereço:* ${(customer as any).address_street || "❌"} ${(customer as any).address_number || ""}\n` +
          `🏘️ *Bairro:* ${(customer as any).address_neighborhood || "❌"}\n` +
          `🏙️ *Cidade:* ${(customer as any).address_city || "❌"} - ${(customer as any).address_state || ""}\n` +
          `📮 *CEP:* ${(customer as any).cep || "❌"}\n` +
          `⚡ *Distribuidora:* ${(customer as any).distribuidora || "❌"}\n` +
          `🔢 *Nº Instalação:* ${(customer as any).numero_instalacao || "❌"}\n` +
          `💰 *Valor:* R$ ${fmtBRL(v)}\n\n` +
          "Está tudo correto?";
        buttons = [
          { id: "sim_conta", title: "✅ SIM" },
          { id: "nao_conta", title: "❌ NÃO" },
          { id: "editar_conta", title: "✏️ EDITAR" },
        ];
      } else {
        confirmMsg =
          `📋 *Confirme seus dados pessoais:*\n\n` +
          `👤 Nome: *${(customer as any).doc_holder_name || (customer as any).name || "—"}*\n` +
          `🆔 CPF: *${(customer as any).cpf || "—"}*\n` +
          `🪪 RG: *${(customer as any).rg || "—"}*\n` +
          `🎂 Nascimento: *${(customer as any).data_nascimento || "—"}*\n\n` +
          "Está tudo correto?";
        buttons = [
          { id: "sim_doc", title: "✅ SIM" },
          { id: "nao_doc", title: "❌ NÃO" },
          { id: "editar_doc", title: "✏️ EDITAR" },
        ];
      }

      let buttonsSent = false;
      try {
        const ok = await confirmSender.sendButtons(remoteJid, confirmMsg, buttons);
        buttonsSent = ok !== false;
      } catch (e: any) {
        console.warn(`[manual-step-send/confirm-shortcut] sendButtons falhou:`, e?.message);
      }
      if (!buttonsSent) {
        // Fallback: texto numerado.
        const fallback = `${confirmMsg}\n\n${buttons.map((b, i) => `${i + 1}️⃣ ${b.title.replace(/^[✅❌✏️]\s*/, "")}`).join("\n")}\n\n_Digite ${buttons.map((_, i) => i + 1).join(", ")} ou *${buttons[0].title.replace(/^[✅❌✏️]\s*/, "")}* / *${buttons[1].title.replace(/^[✅❌✏️]\s*/, "")}* / *${buttons[2].title.replace(/^[✅❌✏️]\s*/, "")}*:_`;
        try {
          await confirmSender.sendText(remoteJid, fallback);
        } catch (e: any) {
          console.error(`[manual-step-send/confirm-shortcut] sendText fallback falhou:`, e?.message);
          return json({ ok: false, blocked: true, code: "send_failed", error: "send_failed", message: "Falha ao enviar mensagem de confirmação." });
        }
      }

      // Persiste no histórico.
      await supabase.from("conversations").insert({
        customer_id: customer.id,
        message_direction: "outbound",
        message_text: confirmMsg,
        message_type: "text",
        conversation_step: stepKey,
      });

      // Atualiza estado do customer.
      const flagField = isBill ? "bill_data_confirmation_by" : "doc_data_confirmation_by";
      await supabase.from("customers").update({
        conversation_step: stepKey,
        [flagField]: "awaiting_client",
        ocr_review_pending: null,
        ocr_review_decided_at: new Date().toISOString(),
        ocr_review_decided_by: "awaiting_client",
        ...buildUnpausePatch(customer),
        custom_step_retries: 0,
        custom_step_retries_step: null,
        last_custom_prompt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any).eq("id", customer.id);

      return json({
        ok: true,
        shortcut: "ocr_confirm",
        kind: isBill ? "bill" : "doc",
        sent: [{ kind: "text", buttons: buttonsSent }],
        next_step: stepKey,
      });
    }

    // Override de variante: se o consultor escolheu A/B/C nos chips, persiste no
    // customer pra não misturar variantes na mesma conversa.
    let variant = String((customer as any)?.flow_variant || "A").toUpperCase();
    if (body.variant && ["A", "B", "C", "D", "E", "M"].includes(body.variant) && body.variant !== variant) {
      await supabase.from("customers")
        .update({ flow_variant: body.variant, updated_at: new Date().toISOString() })
        .eq("id", customer.id);
      variant = body.variant;
    }

    // Safety net: se a variante do lead NÃO está mais habilitada para o
    // consultor (active_variants), realinha para a primeira ativa com bot_flow
    // publicado. Evita disparar Fluxo A quando o consultor só ativou D.
    try {
      const { data: coRow } = await supabase
        .from("consultants").select("active_variants")
        .eq("id", body.consultantId).maybeSingle();
      const active: string[] = Array.isArray((coRow as any)?.active_variants)
        ? (coRow as any).active_variants.map((v: string) => String(v).toUpperCase())
        : [];
      if (active.length > 0 && !active.includes(variant)) {
        const { data: bf } = await supabase
          .from("bot_flows").select("variant")
          .eq("consultant_id", body.consultantId).eq("is_active", true)
          .in("variant", active);
        const ok = new Set(((bf as any[]) || []).map((r) => String(r.variant).toUpperCase()));
        const target = active.find((v) => ok.has(v));
        if (target && target !== variant) {
          await supabase.from("customers")
            .update({ flow_variant: target, updated_at: new Date().toISOString() })
            .eq("id", customer.id);
          variant = target;
          (customer as any).flow_variant = target;
        }
      }
    } catch (_e) { /* não-fatal */ }

    // Trava anti-disparo-em-massa: se o último outbound desse customer foi nos
    // últimos 25s e o lead ainda NÃO respondeu, bloqueia (force=true ignora).
    // Aplica só quando o consultor pede o "passo inteiro" (part==="all"); envios
    // 1-a-1 e auto-prompts não disparam essa trava.
    if (!body.force && body.part === "all" && !body.skipNameGuard) {
      const { data: lastOut } = await supabase
        .from("conversations")
        .select("created_at")
        .eq("customer_id", customer.id)
        .eq("message_direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastOut?.created_at) {
        const lastOutAt = new Date(lastOut.created_at).getTime();
        const elapsedMs = Date.now() - lastOutAt;
        if (elapsedMs < 25_000) {
          const { data: laterIn } = await supabase
            .from("conversations")
            .select("id")
            .eq("customer_id", customer.id)
            .eq("message_direction", "inbound")
            .gt("created_at", lastOut.created_at)
            .limit(1)
            .maybeSingle();
          if (!laterIn) {
            const secs = Math.max(1, Math.ceil((25_000 - elapsedMs) / 1000));
            return json({
              ok: false,
              blocked: true,
              code: "awaiting_inbound",
              error: "awaiting_inbound",
              message: `Aguarde o lead responder antes de enviar o próximo passo (~${secs}s).`,
            });
          }
        }
      }
    }

    // Resolve step — robusto: tenta por id, depois por step_key, depois por step_type
    // (cobre o caso de UI mandar "capture_documento", "finalizar_cadastro" etc).
    const SELECT_COLS = "id, step_key, slot_key, message_text, media_order, flow_id, step_type, position, transitions, captures";
    const KNOWN_TYPES = new Set([
      "capture_name", "capture_conta", "capture_documento", "capture_doc",
      "capture_email", "capture_cpf", "capture_cep", "capture_bill_value",
      "confirm_phone", "finalizar_cadastro",
    ]);

    async function getActiveFlowId(): Promise<string | null> {
      // 1) Tenta a variante do cliente.
      const { data: flow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", body.consultantId)
        .eq("is_active", true)
        .eq("variant", variant)
        .maybeSingle();
      if (flow?.id) return String((flow as any).id);
      // 2) Fallback: qualquer fluxo ativo do consultor (A primeiro, depois o que houver).
      // Evita 404 quando o consultor só publicou uma variante e o cliente está em outra.
      const { data: any1 } = await supabase
        .from("bot_flows")
        .select("id, variant")
        .eq("consultant_id", body.consultantId)
        .eq("is_active", true)
        .order("variant", { ascending: true })
        .limit(1)
        .maybeSingle();
      return any1?.id ? String((any1 as any).id) : null;
    }

    let step: any = null;
    if (body.stepId) {
      const r1 = await supabase
        .from("bot_flow_steps").select(SELECT_COLS)
        .eq("is_active", true).eq("id", body.stepId).maybeSingle();
      step = (r1 as any).data;
      if (!step) {
        // Talvez tenham mandado um step_key como stepId
        const r2 = await supabase
          .from("bot_flow_steps").select(SELECT_COLS)
          .eq("is_active", true).eq("step_key", body.stepId)
          .order("position", { ascending: true }).limit(1).maybeSingle();
        step = (r2 as any).data;
      }
    } else if (body.stepKey) {
      const flowId = await getActiveFlowId();
      if (!flowId) return json({ code: "no_active_flow", error: "no_active_flow", message: "Nenhum fluxo ativo encontrado para essa variante." }, 404);
      const r1 = await supabase
        .from("bot_flow_steps").select(SELECT_COLS)
        .eq("flow_id", flowId).eq("is_active", true)
        .eq("step_key", body.stepKey).maybeSingle();
      step = (r1 as any).data;
      if (!step && KNOWN_TYPES.has(body.stepKey)) {
        const wanted = body.stepKey === "capture_doc" ? "capture_documento" : body.stepKey;
        const r2 = await supabase
          .from("bot_flow_steps").select(SELECT_COLS)
          .eq("flow_id", flowId).eq("is_active", true)
          .eq("step_type", wanted)
          .order("position", { ascending: true }).limit(1).maybeSingle();
        step = (r2 as any).data;
      }
    } else {
      return json({ code: "missing_step", error: "missing_step", message: "Passo do fluxo não informado." }, 400);
    }

    // Último fallback: se ainda não achou e continueFlow=true, pega o próximo
    // passo ativo do fluxo a partir da posição atual do customer (ou o primeiro).
    if (!step && body.continueFlow) {
      const flowId = await getActiveFlowId();
      if (flowId) {
        const { data: fallbackStep } = await supabase
          .from("bot_flow_steps").select(SELECT_COLS)
          .eq("flow_id", flowId).eq("is_active", true)
          .order("position", { ascending: true }).limit(1).maybeSingle();
        if (fallbackStep) {
          console.warn(`[manual-step-send] step não encontrado — usando primeiro passo do fluxo como fallback`);
          step = fallbackStep;
        }
      }
    }
    if (!step) return json({ code: "step_not_found", error: "step_not_found", message: "Passo selecionado não existe mais (foi removido ou desativado)." }, 404);

    // Guarda nome: se o lead ainda não tem nome real e o passo escolhido NÃO é "pedir nome",
    // bloqueia e instrui o consultor a pedir o nome primeiro (mantém {{nome}} válido + gameficação).
    // pushName do WhatsApp grava name_source="whatsapp_profile" — não conta como
    // nome capturado de verdade (consultor precisa "Pedir nome" ou lead se apresentar).
    const nameSource = inferNameSource((customer as any).name, (customer as any).name_source);
    const NAME_NOT_TRUSTED = new Set(["", "unknown", "whatsapp_profile"]);
    const stepAsksName = isNameAskingStep(step);
    // Fluxo D e Fluxo MG são automáticos por botões e capturam o nome ao longo do avanço — sem guard.
    const skipNameGuardForVariantD = variant === "D" || variant === "M";
    if (!body.skipNameGuard && !skipNameGuardForVariantD && NAME_NOT_TRUSTED.has(nameSource) && !stepAsksName) {
      return json({
        ok: false,
        blocked: true,
        code: "name_not_captured_yet",
        error: "name_not_captured_yet",
        message: "Antes de avançar peça o nome do lead — clique em 'Pedir nome' no topo da ficha.",
      });
    }

    // ─── GUARD MISMATCH (auditoria 5511971254913): nome da conta ≠ nome do RG
    // Bloqueia "Finalizar" enquanto consultor não confirmar titularidade.
    {
      const _stype = String((step as any).step_type || "");
      const _skey = String((step as any).step_key || "").toLowerCase();
      const isFinalStep = _stype === "finalizar_cadastro" || _skey === "finalizando" || _skey === "finalizar_cadastro";
      const mismatch = (customer as any).name_mismatch_flag === true;
      const acked = !!(customer as any).name_mismatch_acknowledged_at;
      if (isFinalStep && mismatch && !acked && !body.skipNameGuard) {
        return json({
          ok: false, blocked: true,
          code: "mismatch_pending",
          error: "mismatch_pending",
          message: `Antes de finalizar, confirme a titularidade: conta="${(customer as any).bill_holder_name || "—"}" × documento="${(customer as any).doc_holder_name || "—"}". Use o banner amarelo acima dos passos.`,
        });
      }
    }

    // ─── DEBOUNCE manual (5s) por (customer, step, part) — evita double-click duplicando áudio/texto
    if (!body.force) {
      try {
        const targetStepKey = (step as any).step_key || String((step as any).id);
        // Dedupe estendido (3 min) pra passos de welcome — consultor clicando
        // o botão "Iniciar" várias vezes não deve enviar boas-vindas em loop.
        const isWelcomeStep = /welcome|boas[_-]?vindas/i.test(String(targetStepKey))
          || Number((step as any).position) === 1;
        const debounceMs = isWelcomeStep ? 180_000 : 5_000;
        const sinceIso = new Date(Date.now() - debounceMs).toISOString();
        const { data: recentManual } = await supabase
          .from("conversations")
          .select("id, message_type, created_at")
          .eq("customer_id", customer.id)
          .eq("message_direction", "outbound")
          .eq("conversation_step", targetStepKey)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(5);
        if (Array.isArray(recentManual) && recentManual.length > 0) {
          const partMatch = body.part === "all"
            ? true
            : recentManual.some((r: any) => String(r.message_type) === body.part);
          if (partMatch) {
            const ageMs = Date.now() - new Date(recentManual[0].created_at).getTime();
            console.log(`[manual-step-send] debounce — step="${targetStepKey}" part=${body.part} idade=${ageMs}ms (welcome=${isWelcomeStep})`);
            return json({
              ok: true,
              sent: [],
              debounced: true,
              message: isWelcomeStep
                ? `Boas-vindas já enviadas há ${Math.round(ageMs/1000)}s — aguarde 3 min para reenviar.`
                : "Mesma ação enviada há poucos segundos — ignorada para não duplicar.",
            });
          }
        }
      } catch (_e) { /* anti-rep é best-effort */ }
    }

    const slotKey = (step as any).slot_key || (step as any).step_key;


    // Resolve medias for slot
    const { data: mediaRows } = await supabase
      .from("ai_media_library")
      .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
      .eq("consultant_id", body.consultantId)
      .eq("slot_key", slotKey)
      .eq("active", true)
      .eq("is_draft", false)
      .order("send_order", { ascending: true });
    let medias = ((mediaRows as any[]) || []).filter((m) => !!m?.url);

    // Sofia A2/A3/A5: áudio real está em __body (+ intro com nome). Lookup
    // exato do slot_key não acha nada — e NUNCA devemos mandar MP3 de prévia
    // (Maria/Rodrigo). Mesmo caminho do bot (sendStepMedia / wa-audio-stitch).
    const needsAudioPart = body.part === "all" || body.part === "audio";
    if (needsAudioPart && slotKey) {
      try {
        const { isPersonalizedWaAudioSlot, pickSafePersonalizedWaAudio } = await import(
          "../_shared/wa-audio-stitch.ts"
        );
        if (isPersonalizedWaAudioSlot(String(slotKey))) {
          const nonAudio = medias.filter((m) => String(m.kind).toLowerCase() !== "audio");
          medias = nonAudio;
          const safe = await pickSafePersonalizedWaAudio(supabase, {
            consultantId: body.consultantId,
            slotKey: String(slotKey),
            customerName: (customer as any)?.name,
            nameSource: (customer as any)?.name_source,
            // Manual: cache costurado costuma ser rápido; gera no máx. ~45s.
            timeoutMs: 45_000,
          });
          if (safe.ok && safe.url && (safe.mode === "stitch" || safe.mode === "body_only")) {
            medias = [
              ...nonAudio,
              {
                id: `sofia-${slotKey}`,
                kind: "audio",
                label: `sofia ${slotKey} · ${safe.displayName || "sem-nome"} · ${safe.mode}`,
                url: String(safe.url),
                slot_key: slotKey,
                send_order: 0,
                duration_sec: null,
                transcript: null,
              },
            ];
            console.log(
              `[manual-step-send] wa-audio SAFE slot=${slotKey} name=${safe.displayName} mode=${safe.mode} cached=${safe.cached}`,
            );
          } else {
            console.warn(
              `[manual-step-send] wa-audio SKIP slot=${slotKey} err=${safe.error} — segue só texto/botões`,
            );
          }
        } else if (medias.length === 0) {
          // Fallback: corpo gravado como slot__body / slot__body_gender
          const { data: bodyRows } = await supabase
            .from("ai_media_library")
            .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
            .eq("consultant_id", body.consultantId)
            .like("slot_key", `${slotKey}__body%`)
            .eq("active", true)
            .eq("is_draft", false)
            .order("send_order", { ascending: true });
          const extras = ((bodyRows as any[]) || []).filter((m) => !!m?.url);
          if (extras.length) {
            medias = extras;
            console.log(`[manual-step-send] fallback ${slotKey}__body* → ${extras.length} mídia(s)`);
          }
        }
      } catch (stitchErr) {
        console.warn(
          "[manual-step-send] wa-stitch erro:",
          (stitchErr as Error)?.message || stitchErr,
        );
      }
    }

    // Envio manual ignora a regra de variante (override humano).
    if (variant === "B") {
      console.log(`[manual-step-send] variant=B detected but manual override — audios kept`);
    }


    // ── Roteamento de envio: Whapi (super admin) ou Evolution (demais) ──
    // Bug crítico anterior: o manual-step-send SEMPRE usava Whapi, mesmo
    // quando o consultor era um licenciado Evolution. Resultado: o ⚡ no
    // composer mandava a mensagem do número do super admin, não do número
    // do consultor.
    //
    // Agora identifica o canal a partir de `settings.superadmin_consultant_id`
    // e da existência de `whatsapp_instances` para o consultor. Fallback
    // para Whapi mantém compatibilidade com a fase em que tudo era Whapi.
    const { data: settingsRows } = await supabase.from("settings").select("key,value");
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((s: any) => { settings[s.key] = s.value; });
    const superAdminId = String(settings.superadmin_consultant_id || "").trim();
    const isSuperAdmin = !!superAdminId && superAdminId === String(body.consultantId);

    let sender: any;
    if (isSuperAdmin) {
      const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
      if (!whapiToken) return json({ code: "whapi_token_missing", error: "whapi_token_missing", message: "Token do WhatsApp (Whapi) não configurado no sistema. Avise o admin." }, 500);
      sender = createWhapiSender(whapiToken);
    } else {
      // Evolution sender — busca a instância do consultor.
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name, status")
        .eq("consultant_id", body.consultantId)
        .maybeSingle();
      const instanceName = (inst as any)?.instance_name;
      if (!instanceName) {
        return json({
          code: "instance_disconnected",
          error: "instance_disconnected",
          message: "Sua instância de WhatsApp não está configurada. Reconecte em /admin/conexao e tente de novo.",
        }, 502);
      }
      const evolutionUrl = Deno.env.get("EVOLUTION_API_URL") || "";
      const evolutionKey = Deno.env.get("EVOLUTION_API_KEY") || "";
      if (!evolutionUrl || !evolutionKey) {
        return json({ code: "evolution_not_configured", error: "evolution_not_configured", message: "Evolution API não configurada no servidor. Avise o admin." }, 500);
      }
      const { createEvolutionSender } = await import("../_shared/evolution-api.ts");
      sender = createEvolutionSender(evolutionUrl, evolutionKey, instanceName);
    }

    // Build variables for text rendering. Carrega nome do representante
    // (primeiro nome) — sem isso {{representante}} vira "" e o cleanup
    // remove o `* *` à volta, sumindo "do Rafael" no welcome do fluxo.
    let _repName = "";
    let _repPhone = "";
    try {
      const { data: _consultant } = await supabase
        .from("consultants").select("name, display_name").eq("id", body.consultantId).maybeSingle();
      const { resolvePublicConsultantLabel } = await import("../_shared/consultant-public-label.ts");
      const _full = resolvePublicConsultantLabel(
        (_consultant as any)?.name,
        (_consultant as any)?.display_name,
        "",
      );
      _repName = _full.split(/\s+/)[0] || _full;
      // Link wa.me = WhatsApp CONECTADO (chip), nunca notification_phone.
      _repPhone = await resolveConsultantConnectedWaPhone(supabase, body.consultantId);
    } catch (_) { /* best-effort */ }
    // Fallback final — nunca deixar `representante` vazio chegar ao cliente.
    // Sem isso, o template "Sou a *assistente virtual* do *{{representante}}*"
    // virava "Sou a *assistente virtual* do  e vou..." (espaço duplo + asterisco
    // órfão removido pela limpeza do renderTemplateVars). Bug confirmado em
    // produção: cliente JOSINETE recebeu essa mensagem em 23/05 via manual-step-send.
    if (!_repName) _repName = "iGreen Energy";
    const renderedText = (step as any).message_text
      ? renderTemplateVars(String((step as any).message_text), {
          name: (customer as any).name || "",
          name_source: (customer as any).name_source,
          phone: (customer as any).phone_whatsapp || "",
          cpf: (customer as any).cpf || "",
          representante: _repName,
          representante_phone: _repPhone,
          valor_conta: (customer as any).electricity_bill_value,
          variant: (customer as any)?.flow_variant,
        })
      : "";

    // Vars map for ad-hoc placeholder substitution in fallback prompts
    const _firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
    const _phoneRaw = String((customer as any).phone_whatsapp || "").replace(/\D/g, "");
    const _phoneNoCc = _phoneRaw.startsWith("55") && _phoneRaw.length >= 12 ? _phoneRaw.slice(2) : _phoneRaw;
    const _phoneFmt = _phoneNoCc.length === 11
      ? `(${_phoneNoCc.slice(0,2)}) ${_phoneNoCc.slice(2,7)}-${_phoneNoCc.slice(7)}`
      : _phoneNoCc.length === 10
        ? `(${_phoneNoCc.slice(0,2)}) ${_phoneNoCc.slice(2,6)}-${_phoneNoCc.slice(6)}`
        : _phoneRaw;
    const _cpfRaw = String((customer as any).cpf || "").replace(/\D/g, "");
    const _cpfFmt = _cpfRaw.length === 11
      ? _cpfRaw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
      : _cpfRaw;
    const _bill = (customer as any).electricity_bill_value;
    const _billStr = _bill == null ? "" : String(_bill);
    const vars: Record<string, string> = {
      "{{nome}}": _firstName, "{nome}": _firstName,
      "{{Nome}}": _firstName, "{Nome}": _firstName,
      "{{name}}": _firstName, "{name}": _firstName,
      "{{primeiro_nome}}": _firstName, "{primeiro_nome}": _firstName,
      "{{telefone}}": _phoneFmt, "{telefone}": _phoneFmt,
      "{{phone}}": _phoneFmt, "{phone}": _phoneFmt,
      "{{celular}}": _phoneFmt, "{celular}": _phoneFmt,
      "{{whatsapp}}": _phoneFmt, "{whatsapp}": _phoneFmt,
      "{{cpf}}": _cpfFmt, "{cpf}": _cpfFmt,
      "{{CPF}}": _cpfFmt, "{CPF}": _cpfFmt,
      "{{documento}}": _cpfFmt, "{documento}": _cpfFmt,
      "{{valor_conta}}": _billStr, "{valor_conta}": _billStr,
      "{{valor}}": _billStr, "{valor}": _billStr,
    };



    // Botões Whapi (quick_reply) — opcionais, configurados em captures._buttons.
    // Mesma normalização do bot-flow.ts (linha ~1003).
    let _buttons: { id: string; title: string }[] = [];
    try {
      const caps = Array.isArray((step as any).captures) ? (step as any).captures : [];
      const found = caps.find((c: any) => c?.field === "_buttons" && c?.enabled !== false);
      if (found && Array.isArray(found.value)) {
        _buttons = found.value
          .map((b: any) => ({ id: String(b?.id || "").trim(), title: String(b?.title || "").trim() }))
          .filter((b: any) => b.id && b.title)
          .slice(0, 3);
      }
    } catch (_) { /* noop */ }
    const applyVarsBtn = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);

    // Build items list per part request
    type Item = { kind: string; text?: string; media?: any };
    const allItems: Item[] = [];
    medias.forEach((m) => {
      allItems.push({ kind: String(m.kind || "document").toLowerCase(), media: m });
    });
    if (renderedText.trim()) allItems.push({ kind: "text", text: renderedText });

    let toSend: Item[] = [];
    if (body.part === "all") {
      const order = Array.isArray((step as any).media_order) && (step as any).media_order.length > 0
        ? (step as any).media_order.map((k: any) => String(k).toLowerCase())
        : ["audio", "image", "video", "text", "document"];
      toSend = [...allItems].sort((a, b) => {
        const ia = order.indexOf(a.kind); const ib = order.indexOf(b.kind);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    } else if (body.part === "text") {
      if (renderedText.trim()) toSend = [{ kind: "text", text: renderedText }];
    } else {
      const targeted = allItems.filter((it) => it.kind === body.part);
      const chosen = body.mediaId ? targeted.find((it) => it.media?.id === body.mediaId) : targeted[0];
      if (chosen) toSend = [chosen];
    }

    // Se o passo é de captura (capture_*, confirm_phone, finalizar_cadastro)
    // e nada foi montado para enviar, gera um prompt automático.
    const stepType = String((step as any).step_type || "message");
    const isCaptureStep = stepType !== "message";

    // ─── REAPROVEITAR ARQUIVO JÁ RECEBIDO ───
    // Se consultor clicou em "Captura conta" / "Captura documento" e o cliente
    // já tinha mandado o arquivo, roda OCR direto em vez de pedir de novo.
    if (isCaptureStep && (stepType === "capture_conta" || stepType === "capture_documento" || stepType === "capture_doc")) {
      const isBill = stepType === "capture_conta";
      const targetKind: "image" | "document" | null = null;
      const existingUrl = isBill
        ? ((customer as any).electricity_bill_photo_url || (customer as any).last_inbound_media_url)
        : ((customer as any).document_front_url || (customer as any).last_inbound_media_url);
      const alreadyConfirmed = isBill
        ? !!(customer as any).bill_data_confirmed_at
        : !!(customer as any).doc_data_confirmed_at;
      if (alreadyConfirmed) {
        return json({
          ok: true,
          sent: [],
          skipped: "already_confirmed",
          kind: isBill ? "bill" : "doc",
          message: isBill
            ? "Conta já confirmada — avance manualmente para o próximo passo."
            : "Documento já confirmado — avance manualmente para o próximo passo.",
        });
      }
      const recentMedia = (customer as any).last_inbound_media_at
        ? (Date.now() - new Date((customer as any).last_inbound_media_at).getTime()) < 7 * 24 * 60 * 60 * 1000
        : false;
      const canReuse = !!existingUrl && !alreadyConfirmed
        && (isBill ? true : !!(customer as any).last_inbound_media_kind || !!(customer as any).document_front_url)
        && ((customer as any).electricity_bill_photo_url || (customer as any).document_front_url || recentMedia);
      if (canReuse) {
        try {
          const { data: rpData, error: rpErr } = await supabase.functions.invoke("reprocess-capture", {
            body: { customerId: customer.id, kind: isBill ? "bill" : "doc" },
          });
          if (rpErr) console.warn("[manual-step-send] reprocess-capture error:", rpErr.message);
          return json({
            ok: true,
            reused_existing_file: true,
            kind: isBill ? "bill" : "doc",
            reprocess: rpData,
            message: "Arquivo já recebido — OCR reprocessado. Confirme os dados na ficha do lead.",
          });
        } catch (e) {
          console.warn("[manual-step-send] reprocess invoke failed:", (e as Error).message);
        }
      }
    }

    if (isCaptureStep && toSend.length === 0) {
      const stepType2 = String((step as any).step_type || "");
      const stepKey2  = String((step as any).step_key  || "").toLowerCase();
      const isConfirmPhone = stepKey2 === "ask_phone_confirm" || stepType2 === "confirm_phone";

      // ── confirm_phone: envia com botões (sim / outro número) ──────────────
      if (isConfirmPhone) {
        let p = String((customer as any).phone_whatsapp || "").replace(/\D/g, "");
        if (p.startsWith("55") && p.length >= 12) p = p.substring(2);
        const fmt = p.length >= 11
          ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
          : p || "número não disponível";
        const confirmMsg = `📞 Esse é o seu *telefone de contato*?\n\n*${fmt}*`;
        const legacy = "ask_phone_confirm";

        // Debounce
        const lastPromptAt = (customer as any).last_custom_prompt_at
          ? new Date((customer as any).last_custom_prompt_at).getTime()
          : 0;
        const sameStep = String((customer as any).conversation_step || "") === legacy;
        if (sameStep && Date.now() - lastPromptAt < 20_000) {
          return json({
            ok: true, sent: [], skipped: "recent_prompt",
            message: "Pergunta já enviada há poucos segundos — aguarde a resposta do cliente.",
          });
        }

        // Tenta enviar com botões; fallback para texto numerado já está no sender
        const sent = await sender.sendButtons(remoteJid, confirmMsg, [
          { id: "sim_phone",    title: "✅ Sim, é esse" },
          { id: "editar_phone", title: "📱 Outro número" },
        ]);

        const logText = sent
          ? confirmMsg
          : `${confirmMsg}\n\n1️⃣ Sim, é esse\n2️⃣ Outro número\n\n_Digite 1 ou 2:_`;

        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "outbound",
          message_text: logText,
          message_type: "text",
          conversation_step: legacy,
        });
        await supabase.from("customers").update({
          conversation_step: legacy,
          ...buildUnpausePatch(customer),
          custom_step_retries: 0,
          custom_step_retries_step: null,
          last_custom_prompt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", customer.id);

        return json({
          ok: true,
          sent: [{ kind: "text", auto_prompt: true, buttons: true }],
          continued: true,
          next_step: legacy,
        });
      }

      // ── outros capture steps: prompt de texto ─────────────────────────────
      const applyVars2 = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
      const promptRaw = resolveCapturePrompt(step, renderedText);
      if (promptRaw) {
        const prompt = applyVars2(promptRaw);
        const legacyStep = mapCaptureStepToLegacy(stepType2, (step as any).id, (step as any).step_key);

        // Debounce
        const lastPromptAt = (customer as any).last_custom_prompt_at
          ? new Date((customer as any).last_custom_prompt_at).getTime()
          : 0;
        const sameStep = String((customer as any).conversation_step || "") === legacyStep;
        if (sameStep && Date.now() - lastPromptAt < 20_000) {
          return json({
            ok: true, sent: [], skipped: "recent_prompt",
            message: "Pergunta já enviada há poucos segundos — aguarde a resposta do cliente.",
          });
        }

        await sender.sendText(remoteJid, prompt);
        await supabase.from("conversations").insert({
          customer_id: customer.id,
          message_direction: "outbound",
          message_text: prompt,
          message_type: "text",
          conversation_step: legacyStep,
        });
        await supabase.from("customers").update({
          conversation_step: legacyStep,
          ...buildUnpausePatch(customer),
          custom_step_retries: 0,
          custom_step_retries_step: null,
          last_custom_prompt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", customer.id);

        return json({
          ok: true,
          sent: [{ kind: "text", auto_prompt: true }],
          continued: true,
          next_step: legacyStep,
        });
      }
    }

    if (toSend.length === 0) {
      // Nothing to send (step has no media/text for this part). If the caller asked
      // to continue the flow, still reposition the lead onto this step and unpause.
      if (body.continueFlow && body.part === "all") {
        await supabase.from("customers").update({
          conversation_step: (step as any).step_key || (step as any).id,
          ...buildUnpausePatch(customer),
          custom_step_retries: 0,
          custom_step_retries_step: null,
          updated_at: new Date().toISOString(),
        }).eq("id", customer.id);
        return json({
          ok: true,
          sent: [],
          continued: true,
          next_step: (step as any).step_key || (step as any).id,
          message: "Passo sem mídia/texto — lead reposicionado sem envio.",
        });
      }
      return json({
        ok: false,
        code: "nothing_to_send",
        error: "nothing_to_send",
        message: "Esse passo não tem mídia nem texto configurado para enviar.",
      }, 400);
    }

    const { canSendMediaOnce } = await import("../_shared/media-dedupe.ts");
    const sentLog: any[] = [];
    let buttonsSentManual = false;
    for (let i = 0; i < toSend.length; i++) {
      const it = toSend[i];
      const isLast = i === toSend.length - 1;
      try {
        if (it.kind === "text" && it.text) {
          const useButtons = isLast && _buttons.length > 0;
          if (useButtons) {
            const renderedButtons = _buttons.map((b) => ({
              id: b.id,
              title: applyVarsBtn(b.title).slice(0, 20),
            }));
            await sender.sendButtons(remoteJid, it.text, renderedButtons);
            buttonsSentManual = true;
          } else {
            await sender.sendText(remoteJid, it.text);
          }
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: it.text,
            message_type: "text",
            conversation_step: (step as any).step_key || null,
          });
          sentLog.push({ kind: "text", buttons: useButtons || undefined });
        } else if (it.media?.url) {
          const kind = ["audio", "video", "image"].includes(it.kind) ? it.kind : "document";
          // Anti-duplicação de áudio/vídeo (mesma regra do bot automático).
          if (!body.force) {
            const canSend = await canSendMediaOnce(supabase, {
              consultantId: body.consultantId,
              customerId: customer.id,
              mediaId: it.media.id,
              slotKey: it.media.slot_key || slotKey,
              kind,
            });
            if (!canSend) {
              console.log(`[manual-step-send] ⏭️ ${kind} (${it.media.id}) já enviado — pulando`);
              sentLog.push({ kind, mediaId: it.media.id, skipped: "already_sent" });
              continue;
            }
          }
          await sender.sendMedia(remoteJid, it.media.url, "", kind, Number(it.media.duration_sec || 0) || undefined);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: `[${kind}:${it.media.slot_key || slotKey}] (manual)`,
            message_type: kind,
            conversation_step: (step as any).step_key || null,
          });
          sentLog.push({ kind, mediaId: it.media.id });
        }
      } catch (sendErr) {
        const msg = (sendErr as Error)?.message || "erro desconhecido";
        console.error(`[manual-step-send] whapi send failed (kind=${it.kind}):`, msg);
        if (sentLog.length === 0) {
          const lower = msg.toLowerCase();
          const code = lower.includes("not on whatsapp") || lower.includes("phone not registered") || lower.includes("not a whatsapp")
            ? "phone_not_on_whatsapp"
            : lower.includes("instance") || lower.includes("disconnected") || lower.includes("not connected")
              ? "instance_disconnected"
              : lower.includes("fetch") || lower.includes("network") || lower.includes("timeout") || lower.includes("econn")
                ? "whapi_network"
                : "whapi_send_failed";
          const friendly = code === "phone_not_on_whatsapp"
            ? `Esse número (${rawPhone}) não tem WhatsApp ativo.`
            : code === "instance_disconnected"
              ? "WhatsApp do consultor desconectado. Reconecte em /admin/conexao e tente de novo."
              : code === "whapi_network"
                ? "Sem resposta da Whapi (rede). Tente novamente em alguns segundos."
                : `Whapi recusou o envio: ${msg}`;
          return json({ code, error: code, message: friendly, whapi_error: msg }, 502);
        }
        return json({
          ok: false,
          code: "partial_send",
          error: "partial_send",
          message: `Mandei ${sentLog.length} de ${toSend.length} itens — o restante falhou: ${msg}`,
          sent: sentLog,
        }, 207);
      }
      if (!isLast) {
        // Delay proporcional à duração real do item enviado:
        //  - áudio/vídeo: espera a mídia "tocar" (até 90s) antes da próxima
        //  - imagem/doc:  2.5s
        //  - texto:       1.5s
        let delay: number;
        if (it.kind === "audio" || it.kind === "video") {
          const durSec = Number(it.media?.duration_sec || 0);
          if (durSec > 0) {
            delay = Math.min(Math.max(durSec * 1000, 3000), 90_000);
          } else {
            delay = it.kind === "audio" ? 6000 : 8000;
          }
        } else if (it.kind === "image" || it.kind === "document") {
          delay = 2500;
        } else {
          delay = 1500;
        }
        // 🐛 BUG CORRIGIDO: o delay era calculado mas NUNCA aplicado (faltava o
        // await). Sem a pausa, áudio/imagem/vídeo/texto saíam todos no mesmo
        // instante em rajada — a Whapi/WhatsApp descartava ou desordenava as
        // mensagens, e o consultor via "não foi" / chegou bagunçado. Agora
        // espera o tempo proporcional antes de mandar o próximo item.
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Garantia: se o step tem _buttons mas a última mídia não foi texto,
    // envia os botões em uma mensagem separada (caso a ordem termine em vídeo/imagem).
    // 🔧 (2026-05-28): em vez de "Escolha uma opção" (visualmente parece outra
    // mensagem do bot), reusa o texto do step se existir, ou "." mínimo.
    if (sentLog.length > 0 && _buttons.length > 0 && !buttonsSentManual) {
      try {
        const renderedButtons = _buttons.map((b) => ({
          id: b.id,
          title: applyVarsBtn(b.title).slice(0, 20),
        }));
        await new Promise((r) => setTimeout(r, 600));
        const stepText = renderedText && renderedText.trim().length > 0
          ? renderedText
          : ".";
        await sender.sendButtons(remoteJid, stepText, renderedButtons);
        if (stepText !== "." && !sentLog.some((s: any) => s.kind === "text")) {
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: stepText,
            message_type: "text",
            conversation_step: (step as any).step_key || null,
          });
        }
        sentLog.push({ kind: "buttons", standalone: true });
      } catch (e) {
        console.warn("[manual-step-send] envio dos botões (fallback) falhou:", (e as Error).message);
      }
    }



    const flowPatch = body.continueFlow && body.part === "all"
      ? await buildContinuationPatch(supabase, sender, remoteJid, body.consultantId, customer, step, vars, variant)
      : null;
    if (flowPatch) {
      await supabase.from("customers").update(flowPatch).eq("id", customer.id);
    } else if (body.part === "all") {
      // Sem encadeamento: ainda assim posiciona o cursor no passo clicado
      // para que a próxima resposta do lead caia no step certo (captura/confirm).
      const clickedType = String((step as any).step_type || "message");
      const cursorStep = clickedType === "message"
        ? (step as any).id
        : mapCaptureStepToLegacy(clickedType, (step as any).id, (step as any).step_key);
      try {
        await supabase.from("customers").update({
          conversation_step: cursorStep,
          last_step_advanced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", customer.id);
      } catch (e) {
        console.warn("[manual-step-send] cursor update failed:", (e as Error).message);
      }
      return json({ ok: true, sent: sentLog, continued: false, next_step: cursorStep });
    }

    return json({ ok: true, sent: sentLog, continued: !!flowPatch, next_step: flowPatch?.conversation_step });
  } catch (e) {
    const msg = (e as Error).message || "internal_error";
    console.error("[manual-step-send] error", msg);
    return json({ code: "internal_error", error: "internal_error", message: `Erro interno: ${msg}` }, 500);
  }
});


async function buildContinuationPatch(supabase: any, sender: any, remoteJid: string, consultantId: string, customer: any, step: any, vars: Record<string, string>, variant: string = "A") {
  const patch: any = {
    // Ação manual deliberada do consultor → despausa este lead.
    // Pausa global (`manual_global_pause`) continua nos demais.
    ...buildUnpausePatch(customer),
    custom_step_retries: 0,
    custom_step_retries_step: null,
    updated_at: new Date().toISOString(),
  };

  // Estado inicial: o "cursor" do conversation_step fica no passo clicado.
  // Se não houver próximo passo (passo é o último), mantém o próprio passo —
  // só vai pra "finalizando" se o passo clicado for de fato finalizar_cadastro.
  const clickedType = String(step.step_type || "message");
  if (clickedType === "finalizar_cadastro") {
    patch.conversation_step = "finalizando";
  } else if (clickedType !== "message") {
    patch.conversation_step = mapCaptureStepToLegacy(clickedType, step.id, step.step_key);
  } else {
    patch.conversation_step = step.id;
  }

  // FIX: Se o passo clicado JÁ é uma captura/confirmação/finalização, NUNCA
  // encadear automaticamente — o lead precisa responder antes. Sem este return,
  // o loop abaixo passa por cima do passo de captura (ex.: capture_documento)
  // e acaba enviando o passo de finalizar, sobrescrevendo o cursor pra
  // "finalizando" e pulando o pedido do documento.
  if (clickedType !== "message") {
    console.log(`[manual-step-send] clickedType=${clickedType} é captura — não encadeia, mantém cursor=${patch.conversation_step}`);
    return patch;
  }

  let cursorPos = Number(step.position) || 0;
  const MAX_CHAIN = 20; // cobre fluxos grandes (10+ passos) sem loop infinito.

  const _stripTrailingDecor = (s: string) =>
    s.replace(/[\s\u200B-\u200D\uFEFF\p{Extended_Pictographic}\p{Emoji_Component}]+$/gu, "");
  const _normEnd = (s: any) => _stripTrailingDecor(String(s?.message_text || "").trim());
  const _looksLikeQuestion = (s: any) => _normEnd(s).endsWith("?");
  const _hasInlineCapture = (s: any) => Array.isArray(s?.captures)
    && s.captures.some((c: any) => c?.enabled === true);
  const _hasIntentTransitions = (s: any) => Array.isArray(s?.transitions)
    && s.transitions.some((t: any) => Array.isArray(t?.trigger_phrases) && t.trigger_phrases.length > 0);

  for (let i = 0; i < MAX_CHAIN; i++) {
    const { data: next } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, slot_key, message_text, media_order, step_type, position, captures, transitions")
      .eq("flow_id", step.flow_id)
      .eq("is_active", true)
      .gt("position", cursorPos)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!next) break; // sem próximo — mantém conversation_step já definido.

    cursorPos = Number(next.position) || cursorPos + 1;
    const ntype = String(next.step_type || "message");

    // Critério 1: próximo é passo de captura (não-message) → envia prompt,
    // grava legacy correspondente e PARA. Cliente precisa responder.
    if (ntype !== "message") {
      const legacy = mapCaptureStepToLegacy(ntype, next.id, next.step_key);
      patch.conversation_step = legacy;
      const applyVars = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
      const rendered = next.message_text ? applyVars(String(next.message_text)) : "";

      // ── confirm_phone: envia com botões ──────────────────────────────────
      const nextKey = String(next.step_key || "").toLowerCase();
      if (nextKey === "ask_phone_confirm" || ntype === "confirm_phone") {
        let p = String((customer as any).phone_whatsapp || "").replace(/\D/g, "");
        if (p.startsWith("55") && p.length >= 12) p = p.substring(2);
        const fmt = p.length >= 11
          ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
          : p || "número não disponível";
        const confirmMsg = `📞 Esse é o seu *telefone de contato*?\n\n*${fmt}*`;
        try {
          await sender.sendButtons(remoteJid, confirmMsg, [
            { id: "sim_phone",    title: "✅ Sim, é esse" },
            { id: "editar_phone", title: "📱 Outro número" },
          ]);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: confirmMsg,
            message_type: "text",
            conversation_step: legacy,
          });
          patch.last_custom_prompt_at = new Date().toISOString();
        } catch (e) {
          console.error(`[manual-step-send] falha ao enviar confirm_phone com botões:`, (e as Error).message);
        }
        break;
      }

      // ── outros capture steps: prompt de texto ────────────────────────────
      const promptRaw = resolveCapturePrompt(next, rendered);
      if (promptRaw) {
        const prompt = applyVars(promptRaw);
        try {
          await sender.sendText(remoteJid, prompt);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: prompt,
            message_type: "text",
            conversation_step: legacy,
          });
          patch.last_custom_prompt_at = new Date().toISOString();
        } catch (e) {
          console.error(`[manual-step-send] falha ao enviar prompt do capture (${ntype}):`, (e as Error).message);
        }
      }
      break;
    }

    // Próximo é message — despacha conteúdo, atualiza cursor de conversation_step.
    const sentNext = await sendConfiguredStep(supabase, sender, remoteJid, consultantId, customer.id, next, vars, variant, customer);
    if (sentNext) patch.last_custom_prompt_at = new Date().toISOString();
    patch.conversation_step = next.id;

    // Critério 2: passo message COM captura inline (ex.: "Captura do nome") → PARA.
    if (_hasInlineCapture(next)) break;
    // Critério 3: texto termina em "?" — pergunta → PARA.
    if (_looksLikeQuestion(next)) break;
    // Critério 4: transitions com trigger_phrases (intent) → PARA.
    if (_hasIntentTransitions(next)) break;

    // Pequeno delay entre passos puramente informativos.
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`[manual-step-send] continueFlow step=${step.step_key || step.id} consultant=${consultantId} final=${patch.conversation_step}`);
  return patch;
}

async function sendConfiguredStep(supabase: any, sender: any, remoteJid: string, consultantId: string, customerId: string, step: any, vars: Record<string, string>, variant: string = "A", customer?: any) {
  const applyVars = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  const slotKey = step.slot_key || step.step_key;
  const { data: mediaRows } = await supabase
    .from("ai_media_library")
    .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", true)
    .eq("is_draft", false)
    .order("send_order", { ascending: true });
  let rawRows = ((mediaRows as any[]) || []).filter((m) => !!m?.url);

  // Mesmo stitch Sofia do envio principal (A2/A3/A5).
  if (slotKey) {
    try {
      const { isPersonalizedWaAudioSlot, pickSafePersonalizedWaAudio } = await import(
        "../_shared/wa-audio-stitch.ts"
      );
      if (isPersonalizedWaAudioSlot(String(slotKey))) {
        const nonAudio = rawRows.filter((m) => String(m.kind).toLowerCase() !== "audio");
        const safe = await pickSafePersonalizedWaAudio(supabase, {
          consultantId,
          slotKey: String(slotKey),
          customerName: customer?.name,
          nameSource: customer?.name_source,
          timeoutMs: 45_000,
        });
        if (safe.ok && safe.url && (safe.mode === "stitch" || safe.mode === "body_only")) {
          rawRows = [
            ...nonAudio,
            {
              id: `sofia-${slotKey}`,
              kind: "audio",
              label: `sofia ${slotKey} · ${safe.mode}`,
              url: String(safe.url),
              slot_key: slotKey,
              send_order: 0,
              duration_sec: null,
              transcript: null,
            },
          ];
        } else {
          rawRows = nonAudio;
        }
      } else if (rawRows.length === 0) {
        const { data: bodyRows } = await supabase
          .from("ai_media_library")
          .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
          .eq("consultant_id", consultantId)
          .like("slot_key", `${slotKey}__body%`)
          .eq("active", true)
          .eq("is_draft", false)
          .order("send_order", { ascending: true });
        rawRows = ((bodyRows as any[]) || []).filter((m) => !!m?.url);
      }
    } catch (e) {
      console.warn("[manual-step-send/continue] stitch:", (e as Error)?.message || e);
    }
  }

  const items: Array<{ kind: string; text?: string; media?: any }> = [];
  for (const m of rawRows) {
    // Envio manual (continuação) ignora a regra de variante B
    items.push({ kind: String(m.kind || "document").toLowerCase(), media: m });
  }
  const text = step.message_text ? applyVars(String(step.message_text)) : "";
  if (text.trim()) items.push({ kind: "text", text });
  if (!items.length) return false;

  const order = Array.isArray(step.media_order) && step.media_order.length > 0
    ? step.media_order.map((k: any) => String(k).toLowerCase())
    : ["audio", "image", "video", "text", "document"];
  items.sort((a: any, b: any) => {
    const ia = order.indexOf(a.kind); const ib = order.indexOf(b.kind);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Botões do passo (captures._buttons) — última mensagem como interactive.
  let stepButtons: { id: string; title: string }[] = [];
  try {
    const caps = Array.isArray(step.captures) ? step.captures : [];
    const found = caps.find((c: any) => c?.field === "_buttons" && c?.enabled !== false);
    if (found && Array.isArray(found.value)) {
      stepButtons = found.value
        .map((b: any) => ({ id: String(b?.id || ""), title: String(b?.title || "").trim() }))
        .filter((b: { id: string; title: string }) => b.id && b.title);
    }
  } catch { /* ignore */ }

  const { canSendMediaOnce } = await import("../_shared/media-dedupe.ts");
  let sent = false;
  for (let i = 0; i < items.length; i++) {
    const it: any = items[i];
    const isLast = i === items.length - 1;
    if (it.kind === "text" && it.text) {
      if (isLast && stepButtons.length > 0 && typeof sender.sendButtons === "function") {
        await sender.sendButtons(remoteJid, it.text, stepButtons);
      } else {
        await sender.sendText(remoteJid, it.text);
      }
      await supabase.from("conversations").insert({ customer_id: customerId, message_direction: "outbound", message_text: it.text, message_type: "text", conversation_step: step.step_key || step.id });
      sent = true;
    } else if (it.media?.url) {
      const kind = ["audio", "video", "image"].includes(it.kind) ? it.kind : "document";
      const canSend = await canSendMediaOnce(supabase, {
        consultantId, customerId, mediaId: it.media.id,
        slotKey: it.media.slot_key || slotKey, kind,
      });
      if (!canSend) { continue; }
      await sender.sendMedia(remoteJid, it.media.url, "", kind, Number(it.media.duration_sec || 0) || undefined);
      await supabase.from("conversations").insert({ customer_id: customerId, message_direction: "outbound", message_text: `[${kind}:${it.media.slot_key || slotKey}] (continue)`, message_type: kind, conversation_step: step.step_key || step.id });
      sent = true;
    }
    if (i < items.length - 1) {
      let d = 1200;
      if (it.kind === "audio" || it.kind === "video") {
        const durSec = Number(it.media?.duration_sec || 0);
        d = durSec > 0 ? Math.min(Math.max(durSec * 1000, 3000), 90_000) : (it.kind === "audio" ? 6000 : 8000);
      } else if (it.kind === "image" || it.kind === "document") {
        d = 2500;
      }
      await new Promise((r) => setTimeout(r, d));
    }
  }
  return sent;
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Mapeia step_type custom de captura para a chave legada usada pelo bot
 * (whapi-webhook trata essas chaves nativamente: aguardando_conta, etc).
 */
function mapCaptureStepToLegacy(stepType: string, stepId: string, stepKey?: string): string {
  // step_key explícito tem prioridade quando já é legacy reconhecido
  const k = String(stepKey || "").toLowerCase();
  if (["ask_name", "aguardando_nome", "ask_email", "ask_cpf", "ask_rg", "ask_cep",
       "ask_number", "ask_complement", "ask_bill_value", "ask_phone_confirm",
       "aguardando_conta", "confirmando_dados_conta", "aguardando_doc_auto",
       "ask_doc_frente_manual", "ask_doc_verso_manual", "ask_finalizar",
       "finalizando", "portal_submitting", "aguardando_otp", "validando_otp"].includes(k)) {
    return k;
  }
  switch (stepType) {
    case "capture_name": return "ask_name";
    case "capture_conta": return "aguardando_conta";
    case "capture_documento":
    case "capture_doc": return "aguardando_doc_auto";
    case "capture_email": return "ask_email";
    case "capture_cpf": return "ask_cpf";
    case "capture_cep": return "ask_cep";
    case "capture_bill_value": return "ask_bill_value";
    case "confirm_phone": return "ask_phone_confirm";
    case "finalizar_cadastro": return "finalizando";
    default: return stepKey || stepId;
  }
}

/**
 * Resolve o texto a enviar quando o passo é de captura.
 * Ordem: message_text já renderizado → primeiro captures[].retry_text → fallback por tipo.
 */
function resolveCapturePrompt(step: any, renderedText: string): string | null {
  if (renderedText && renderedText.trim()) return renderedText.trim();

  const caps = Array.isArray(step?.captures) ? step.captures : [];
  for (const c of caps) {
    const t = String(c?.retry_text || c?.prompt || "").trim();
    if (t) return t;
  }

  const stepType = String(step?.step_type || "");
  const stepKey  = String(step?.step_key  || "").toLowerCase();

  // step_key explícito tem prioridade para mensagens personalizadas
  if (stepKey === "ask_email" || stepType === "capture_email") {
    return (
      "📧 *Qual o seu melhor e-mail?*\n\n" +
      "_Vou usar pra liberar o seu acesso ao app *iGreen Club* 📱_\n" +
      "_(onde você acompanha cashback, faturas e indicações)_\n\n" +
      "Pode ser Gmail, Outlook, iCloud…"
    );
  }

  // confirm_phone: retorna null aqui — tratado separadamente com botões
  if (stepKey === "ask_phone_confirm" || stepType === "confirm_phone") {
    return null; // handled via sendButtons below
  }

  switch (stepType) {
    case "capture_conta":
      return "{{nome}}, me manda a foto *ou PDF* da sua conta de luz aqui pelo WhatsApp 📄";
    case "capture_documento":
    case "capture_doc":
      return "Agora me envia uma foto do seu documento (RG ou CNH, frente e verso) 📷";
    case "finalizar_cadastro":
      return "Tô finalizando seu cadastro, só um instante… ⏳";
    default:
      return null;
  }
}
