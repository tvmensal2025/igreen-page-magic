// Worker Portal 2 — servidor HTTP que recebe leads e cadastra via API
// Diferente do worker-portal original (que clica na UI), este chama a API
// direto com HMAC + Playwright como tunnel TLS.
//
// Endpoints:
//   POST /submit-lead           — Cadastra lead no Portal 2
//   POST /confirm-otp           — Recebe OTP do cliente e valida
//   GET  /lead/:id/status       — Status do cadastro
//   GET  /health                — Healthcheck
//
// Autenticação: header `Authorization: Bearer ${WORKER_SECRET}`

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import ws from 'ws';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { Portal2Client, fileFromPath, closeBrowser } from './portal2-api-client.mjs';
import { runAuditPipeline, getAuditCount, sanitize, checkAuditHealth } from './ai-audit.mjs';
import { classifyPortalError, CORRECTION_PROMPTS } from './portal-errors.mjs';
import { resolvePortalWhatsapp } from './portal-phone.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3101);
const SECRET = process.env.WORKER_SECRET || 'change-me';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REDIS_URL = process.env.REDIS_URL || 'redis://evolution-api-redis:6379';
const QUEUE_NAME = 'portal-worker-2-leads';
// Auditoria IA dos primeiros N cadastros. A edge function `portal2-ai-audit`
// é quem chama o Gemini — o worker só manda o trace e recebe a análise.
//
// Defaults:
//   - PORTAL2_AI_AUDIT_LIMIT vazio/inválido/0 → usa 10 (não desliga sozinho).
//   - Pra desligar de propósito, defina PORTAL2_AI_AUDIT_DISABLED=true.
const _rawLimit = Number(process.env.PORTAL2_AI_AUDIT_LIMIT);
const AI_AUDIT_LIMIT = Number.isFinite(_rawLimit) && _rawLimit > 0 ? _rawLimit : 10;
const AI_AUDIT_DISABLED = String(process.env.PORTAL2_AI_AUDIT_DISABLED || '').toLowerCase() === 'true';
let auditHealth = { healthy: false, error: 'not_checked_yet', checked_at: null };


const supabase = (() => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️ Supabase não configurado — leads não serão persistidos');
    return null;
  }
  try {
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Node <22 não tem WebSocket nativo; passamos `ws` pra realtime-js
      realtime: { transport: ws },
    });
  } catch (e) {
    console.warn(`⚠️ Supabase init falhou: ${e.message} — seguindo sem persistência`);
    return null;
  }
})();

// ─── Auth middleware ────────────────────────────────────────────────────────
function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Monta o link de validação de código (mesmo link da facial/contrato).
 * Padrão canônico do sistema iGreen:
 *   https://digital.igreenenergy.com.br/validacao-codigo/{idcliente}?id={consultor}&sendcontract=true
 *
 * É o mesmo URL usado pra:
 *   - Cliente digitar o código OTP (recebido via WhatsApp pelo backend iGreen)
 *   - Validação facial (Idwall)
 *   - Assinatura do contrato
 */
function buildValidationLink(idcliente, idconsultor) {
  return `https://digital.igreenenergy.com.br/validacao-codigo/${idcliente}?id=${idconsultor}&sendcontract=true`;
}

function addUploadEvidence(result, upload) {
  const out = result && typeof result === 'object' ? { ...result } : {};
  if (upload) out.upload = upload;
  return out;
}

/**
 * MENSAGEM 1 (logo após cadastro no portal):
 * Pede SÓ o código de 6 dígitos que a iGreen vai mandar.
 * Sem link nessa etapa — o cliente responde o código aqui no WhatsApp
 * e o worker valida via /confirm-otp. O link de assinatura só vai
 * depois, em sendFacialLinkToCustomer.
 */
async function sendValidationLinkToCustomer(customerId, link) {
  return _sendMessageToCustomer(customerId, ({ firstName }) =>
    `Oi ${firstName}! 🎉\n\n` +
    `Seu cadastro foi enviado pra iGreen. 🌱\n\n` +
    `📲 Em instantes você vai receber aqui no WhatsApp uma mensagem ` +
    `da iGreen com um *código de 6 dígitos*.\n\n` +
    `Quando chegar, *me responde aqui com o código* para eu validar. ✅`,
  );
}

/**
 * MENSAGEM 2 (após OTP validado com sucesso): CHAVE DE OURO.
 * Calorosa, com nome, entrega o link da facial/assinatura e fecha o ciclo.
 */
async function sendFacialLinkToCustomer(customerId, link) {
  return _sendMessageToCustomer(customerId, ({ firstName }) =>
    `✅ ${firstName}, código confirmado!\n\n` +
    `Falta só *1 passinho* pra ativar sua economia 💚\n\n` +
    `👉 Assine e faça sua validação facial (selfie rapidinha):\n${link}\n\n` +
    `Em ~2 minutos te confirmo aqui que ficou tudo certo.\n` +
    `Bem-vindo(a) à iGreen — energia limpa com economia todo mês! 🌱🎉`,
  );
}



/**
 * Loop de correção (Req 7.1): quando o Portal 2 rejeita um dado recuperável,
 * o worker abre o `conversation_step` de correção e PERGUNTA proativamente ao
 * cliente o dado novo. Sem isto o lead ficava parado em `portal_submitting`
 * esperando um OTP que nunca chegava (o bot só re-perguntava se o cliente
 * mandasse mensagem espontânea). Best-effort: erro de envio só loga.
 */
async function sendCorrectionRequestToCustomer(customerId, prompt) {
  return _sendMessageToCustomer(customerId, ({ firstName }) =>
    `${firstName}, quase lá! 🙌\n\n${prompt}`,
  );
}

/**
 * Helper interno: monta destinatário, escolhe canal (Evolution → Whapi) e
 * envia a mensagem retornada pelo `messageBuilder`.
 */
async function _sendMessageToCustomer(customerId, messageBuilder) {
  if (!supabase || !customerId) return { skipped: 'no_supabase_or_customer_id' };

  const [{ data: settingsRows }, { data: customer }] = await Promise.all([
    supabase.from('settings').select('*'),
    supabase
      .from('customers')
      .select('id, name, phone_whatsapp, portal2_celular_alt, phone_landline, phone_contact_confirmed, consultant_id')
      .eq('id', customerId)
      .maybeSingle(),
  ]);
  // Brasil só: manda no celular do Portal (alt/landline), não só na chave do chat.
  const destPhone = resolvePortalWhatsapp(customer) || customer?.phone_whatsapp;
  if (!destPhone) return { skipped: 'no_phone' };

  const settings = {};
  settingsRows?.forEach(s => { settings[s.key] = s.value; });

  const phone = String(destPhone).replace(/\D/g, '');
  const normalized = phone.startsWith('55') ? phone : `55${phone}`;
  const firstName = String(customer.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  const text = messageBuilder({ firstName, phone: normalized, customer });

  // 1. Evolution API (instância do consultor)
  let instanceName = null;
  if (customer.consultant_id) {
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_name')
      .eq('consultant_id', customer.consultant_id)
      .limit(1)
      .maybeSingle();
    instanceName = inst?.instance_name || null;
  }
  const evoUrl = (settings.evolution_api_url || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const evoKey = settings.evolution_api_key || process.env.EVOLUTION_API_KEY || '';
  if (evoUrl && evoKey && instanceName) {
    try {
      const r = await fetch(`${evoUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evoKey },
        body: JSON.stringify({ number: normalized, text }),
      });
      if (r.ok) return { sent: 'evolution', instance: instanceName };
      console.warn(`  ⚠ evolution sendText ${r.status}`);
    } catch (e) {
      console.warn(`  ⚠ evolution send failed: ${e.message}`);
    }
  }

  // 2. Whapi fallback
  const whapiToken = settings.whapi_token || process.env.WHAPI_TOKEN || '';
  const whapiUrl = (settings.whapi_api_url || process.env.WHAPI_API_URL || 'https://gate.whapi.cloud').replace(/\/$/, '');
  if (whapiToken) {
    try {
      const r = await fetch(`${whapiUrl}/messages/text`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${whapiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: `${normalized}@s.whatsapp.net`, body: text, typing_time: 0 }),
      });
      if (r.ok) return { sent: 'whapi' };
      console.warn(`  ⚠ whapi sendText ${r.status}`);
    } catch (e) {
      console.warn(`  ⚠ whapi send failed: ${e.message}`);
    }
  }

  return { skipped: 'no_channel_configured' };
}

// ─── Job processor ──────────────────────────────────────────────────────────
async function processLead(job) {
  const { customer_id, dados } = job.data;
  console.log(`▶ [job ${job.id}] cadastrando customer=${customer_id} idconsultor=${dados.idconsultor}`);

  // Decide se vai auditar este lead. Limite controlado por env pra não
  // gastar token Gemini em todos os cadastros (só os primeiros N pra mapear
  // pontos cegos). Quando AI_AUDIT_LIMIT=0, desliga totalmente.
  let shouldAudit = false;
  if (!AI_AUDIT_DISABLED && AI_AUDIT_LIMIT > 0 && SUPABASE_URL) {
    try {
      const count = await getAuditCount(supabase);
      shouldAudit = count < AI_AUDIT_LIMIT;
      if (shouldAudit) console.log(`  🔍 auditoria IA ativa (${count + 1}/${AI_AUDIT_LIMIT})`);
    } catch {}
  }


  const trace = shouldAudit ? [] : null;
  const t0 = Date.now();
  const c = new Portal2Client({ idconsultor: dados.idconsultor, tracer: trace });
  let cadastroResult = null;
  let cadastroError = null;

  try {
    cadastroResult = await c.cadastrarCliente(dados);
    console.log(`✓ [job ${job.id}] customer=${customer_id} → idcliente=${cadastroResult.idcliente}`);

    // Link único de validação de código + facial + assinatura
    const validationLink = buildValidationLink(cadastroResult.idcliente, dados.idconsultor);
    console.log(`  🔗 link: ${validationLink}`);

    // Persistir no banco (best-effort).
    // NÃO grava link_facial/link_assinatura aqui — isso só depois do OTP
    // validado (sendFacialLinkToCustomer /confirm-otp). Gravar cedo fazia o
    // watchdog mandar o link da facial antes do código ser confirmado.
    if (supabase && customer_id) {
      const updates = {
        portal2_idcliente: cadastroResult.idcliente,
        portal2_idsolcontratovalidacao: cadastroResult.idsolcontratovalidacao,
        portal2_status: 'created',
        portal2_created_at: new Date().toISOString(),
        portal2_contract_link: validationLink,
        igreen_link: validationLink,
        igreen_code: String(cadastroResult.idcliente),
        status: 'awaiting_otp',
        conversation_step: 'aguardando_otp',
        portal_submitted_at: new Date().toISOString(),
      };
      // PR2: persistir fornecedora resolvida (evita re-resolver via /bonus/rules
      // em retries futuros) e terms_accepted_at quando acceptTerms confirmou.
      if (cadastroResult.fornecedora) updates.fornecedora = cadastroResult.fornecedora;
      if (cadastroResult.termsAccepted) updates.terms_accepted_at = new Date().toISOString();
      await supabase.from('customers').update(updates).eq('id', customer_id).then(
        () => {},
        (e) => console.warn(`  ⚠ supabase update falhou: ${e.message}`),
      );

      // Modo_Extração + resultados dos extractors (Req 3/4) — OBSERVACIONAL.
      // Gravação SEPARADA e best-effort (Req 3.6/4.5): nunca altera o idcliente
      // já criado acima nem aborta o job. PII mascarada via `sanitize`
      // (CPF/documento → 4 últimos dígitos; buffers/base64 omitidos — Req 12).
      const extraction = cadastroResult.extraction;
      if (extraction) {
        await supabase.from('customers').update({
          portal2_extraction_mode: extraction.mode,
          portal2_ocr_doc_result: sanitize(addUploadEvidence(extraction.doc, extraction.upload)),
          portal2_ocr_bill_result: sanitize(addUploadEvidence(extraction.bill, extraction.upload)),
        }).eq('id', customer_id).then(
          () => {},
          (e) => console.warn(`  ⚠ persistência extração (sucesso) falhou: ${e.message}`),
        );
      }
    }

    // Disparar geração de OTP (a iGreen manda WhatsApp pro cliente com o código)
    let otpGenerated = false;
    try {
      await c.generateVerificationCode(cadastroResult.idcliente);
      otpGenerated = true;
      console.log(`  ✓ OTP requisitado pra customer=${customer_id} (cliente recebe via WhatsApp da iGreen)`);
      if (supabase && customer_id) {
        await supabase.from('customers').update({
          portal2_status: 'otp_sent',
          portal2_otp_sent_at: new Date().toISOString(),
        }).eq('id', customer_id).then(() => {}, () => {});
      }
    } catch (e) {
      console.warn(`  ⚠ falha ao gerar OTP: ${e.message}`);
      if (supabase && customer_id) {
        await supabase.from('customers').update({
          portal2_status: 'otp_generate_failed',
          last_otp_dispatch_error: `generate_otp_failed: ${String(e.message || '').slice(0, 400)}`,
          last_otp_dispatch_at: new Date().toISOString(),
        }).eq('id', customer_id).then(() => {}, () => {});
      }
      // Avisa o cliente que o código pode demorar / pedir reenvio
      try {
        await _sendMessageToCustomer(customer_id, ({ firstName }) =>
          `${firstName}, seu cadastro foi enviado ✅\n\n` +
          `Estou gerando o código de verificação. Se em 1–2 minutos não chegar ` +
          `uma mensagem da iGreen com o código, me avisa aqui que eu peço de novo.`,
        );
      } catch (_) { /* best-effort */ }
    }

    // Mandar pedido do código só se o OTP foi gerado (senão já avisamos acima).
    if (otpGenerated) {
      try {
        const sendResult = await sendValidationLinkToCustomer(customer_id, validationLink);
        console.log(`  📲 pedido de código: ${JSON.stringify(sendResult)}`);
      } catch (e) {
        console.warn(`  ⚠ envio do pedido de código falhou: ${e.message}`);
      }
    }

    const finalResult = { success: true, validationLink, otpGenerated, ...cadastroResult };

    // Auditoria IA — fire & forget pra não bloquear retorno do job
    if (shouldAudit) {
      runAuditPipeline({
        supabase, supabaseUrl: SUPABASE_URL, workerSecret: SECRET,
        customer_id, job_id: job.id, idconsultor: dados.idconsultor,
        status: 'success', trace, input: dados, result: finalResult,
        extraction: cadastroResult.extraction, duration_ms: Date.now() - t0,
      }).then(ai => {
        if (ai?.summary) console.log(`  🔍 IA: ${ai.summary}`);
        if (ai?.findings?.length) {
          for (const f of ai.findings) {
            console.log(`     ${f.severity?.toUpperCase() || '?'} [${f.category}] ${f.title}`);
          }
        }
      }, () => {});
    }

    return finalResult;
  } catch (e) {
    cadastroError = e;
    console.error(`✗ [job ${job.id}] customer=${customer_id} erro: ${e.message}`);

    // Classifica a rejeição numa Classe_de_Erro estável (Req 6). `unknown`
    // (sem match textual) é tratado como instabilidade/transporte e mantém o
    // retry do BullMQ; classes determinísticas NÃO re-lançam (payload errado
    // não deve ser reenviado — Req 9.1).
    const { kind, recoverable } = classifyPortalError(e.message);

    // Short-circuit: cliente JÁ está cadastrado na iGreen (mesmo CPF ou
    // throw explícito do checkCustomerExists). Não é falha — é sucesso
    // silencioso: marca como registered_igreen e não pede intervenção
    // humana nem reenvia OTP/link. Sem mensagem ao cliente.
    const msgLower = String(e.message ?? '').toLowerCase();
    const isAlreadyRegistered =
      kind === 'duplicate_document' ||
      msgLower.includes('cliente já cadastrado') ||
      msgLower.includes('cliente ja cadastrado');
    if (isAlreadyRegistered && supabase && customer_id) {
      await supabase.from('customers').update({
        status: 'registered_igreen',
        conversation_step: 'cadastro_em_analise',
        portal2_status: 'already_registered',
        portal2_error: String(e.message ?? '').slice(0, 2000),
        portal2_error_kind: kind,
        error_message: null,
      }).eq('id', customer_id).then(
        () => console.log(`  ✓ already_registered: customer=${customer_id} marcado como registered_igreen (sem mensagem)`),
        (err) => console.warn(`  ⚠ falha ao marcar already_registered: ${err.message}`),
      );
      return { success: true, alreadyRegistered: true, reason: e.message };
    }



    if (supabase && customer_id) {
      // Lê o contador de tentativas por classe pra decidir o roteamento do
      // status (Req 9.5/9.6 + 10.1/10.2). Best-effort: se a leitura falhar,
      // assume 0 tentativas.
      let attempts = 0;
      try {
        const { data: cust } = await supabase
          .from('customers')
          .select('portal2_correction_attempts')
          .eq('id', customer_id)
          .maybeSingle();
        attempts = Number(cust?.portal2_correction_attempts?.[kind] ?? 0);
      } catch {}

      // Roteamento do status terminal:
      //   - não-recuperável → needs_human (Req 10.1)
      //   - recuperável com limite esgotado (>=3) → needs_human (Req 9.5/10.2)
      //   - recuperável com tentativas < 3 → awaiting_correction (loop do bot)
      let nextStatus;
      if (!recoverable) {
        nextStatus = 'needs_human';
      } else {
        nextStatus = attempts >= 3 ? 'needs_human' : 'awaiting_correction';
      }

      const updates = {
        portal2_status: nextStatus,
        portal2_error: String(e.message ?? '').slice(0, 2000), // Req 6.8
        portal2_error_kind: kind,                              // Req 6.1
      };
      // Anexo não confirmado no Portal: limpa idcliente pra permitir nova tentativa
      // limpa (novo idsolcontratovalidacao) quando operador reprocessar o lead.
      if (kind === 'attachment_not_confirmed') {
        updates.portal2_idcliente = null;
      }
      // Loop de correção (Req 7.1): se vamos pedir correção, abre o
      // `conversation_step` certo AQUI para que a próxima mensagem do cliente
      // caia direto no handler corrigir_* (e não re-pergunte). A pergunta é
      // enviada proativamente logo após persistir (correctionToSend).
      let correctionToSend = null;
      if (nextStatus === 'awaiting_correction' && CORRECTION_PROMPTS[kind]) {
        updates.conversation_step = CORRECTION_PROMPTS[kind].step;
        correctionToSend = CORRECTION_PROMPTS[kind].prompt;
      }
      // Modo_Extração mesmo em falha (Req 3.3 — antes do estado terminal).
      if (e.extraction) {
        updates.portal2_extraction_mode = e.extraction.mode ?? null;
        updates.portal2_ocr_doc_result = sanitize(addUploadEvidence(e.extraction.doc, e.extraction.upload));
        updates.portal2_ocr_bill_result = sanitize(addUploadEvidence(e.extraction.bill, e.extraction.upload));
      }
      // Best-effort (Req 3.6/4.5): falha de persistência não aborta o job.
      await supabase.from('customers').update(updates).eq('id', customer_id).then(
        () => {},
        (err) => console.warn(`  ⚠ persistência erro/extração falhou: ${err.message}`),
      );

      // Alerta operacional: registra em infra_metrics quando anexo não
      // confirmou (super-admin-alerts e dashboard de saúde consomem essa
      // chave). Best-effort.
      if (kind === 'attachment_not_confirmed') {
        await supabase.from('infra_metrics').insert({
          metric_key: 'portal_attachment_failed',
          value_num: null,
          meta: {
            customer_id,
            missing: e?.body?.missing || null,
            upload: e?.body?.upload || null,
            error: String(e.message || '').slice(0, 500),
            at: new Date().toISOString(),
          },
        }).then(() => {}, (err) => console.warn(`  ⚠ infra_metrics alert falhou: ${err.message}`));
      }

      // IA reprovada: avisa o cliente e marca handoff (não é correção de campo).
      if (kind === 'ia_reprovada') {
        updates.status = 'needs_human';
        updates.conversation_step = 'aguardando_humano';
        updates.bot_paused = true;
        updates.bot_paused_reason = 'portal_ia_reprovada';
        updates.bot_paused_at = new Date().toISOString();
        await supabase.from('customers').update(updates).eq('id', customer_id).then(() => {}, () => {});
        await _sendMessageToCustomer(customer_id, ({ firstName }) =>
          `${firstName}, recebi seus documentos aqui ✅\n\n` +
          `A validação automática pediu uma revisão humana antes de concluir. ` +
          `Um consultor vai te chamar em breve por aqui 👍`,
        ).catch(() => {});
        await supabase.from('infra_metrics').insert({
          metric_key: 'portal_ia_reprovada',
          value_num: null,
          meta: {
            customer_id,
            gate: e?.body?.gate || null,
            error: String(e.message || '').slice(0, 500),
            at: new Date().toISOString(),
          },
        }).then(() => {}, () => {});
      }

      // Pergunta proativa ao cliente (Req 7.1). Best-effort: só após a
      // persistência do step, para a resposta do cliente cair no handler certo.
      if (correctionToSend) {
        await sendCorrectionRequestToCustomer(customer_id, correctionToSend).then(
          (r) => console.log(`  📲 correção solicitada ao cliente (${kind}): ${JSON.stringify(r)}`),
          (err) => console.warn(`  ⚠ envio da correção falhou: ${err.message}`),
        );
      }
    }

    // Auditoria IA também na falha — esses são os mais valiosos pra revisar
    if (shouldAudit) {
      runAuditPipeline({
        supabase, supabaseUrl: SUPABASE_URL, workerSecret: SECRET,
        customer_id, job_id: job.id, idconsultor: dados.idconsultor,
        status: 'failed', trace, input: dados,
        result: e.body ? { error_body: e.body } : null,
        extraction: e.extraction, error: e.message, duration_ms: Date.now() - t0,
      }).then(ai => {
        if (ai?.summary) console.log(`  🔍 IA: ${ai.summary}`);
        if (ai?.findings?.length) {
          for (const f of ai.findings) {
            console.log(`     ${f.severity?.toUpperCase() || '?'} [${f.category}] ${f.title} — ${f.detail?.slice(0, 200)}`);
          }
        }
        if (ai?.next_actions?.length) {
          console.log(`  🔧 sugestões IA:`);
          for (const a of ai.next_actions) console.log(`     • ${a}`);
        }
      }, () => {});
    }

    // Decisão de retry do BullMQ (Req 9.1):
    //   - erro classificado determinístico (≠ unknown) → NÃO re-lança.
    //   - `unknown` em cima de 400/422 = payload inválido → também NÃO re-lança
    //     (retry não corrige schema). Só re-lança quando for genuinamente
    //     transporte/instabilidade (ECONNRESET, 5xx, timeout, etc).
    const msg = String(e.message ?? '');
    const isPayload4xx = /->\s*4\d\d:/.test(msg);
    const isTransient = kind === 'unknown' && !isPayload4xx;
    if (isTransient) {
      throw e; // bullmq faz retry
    }
    console.log(`  ↪ erro classificado (${kind}${isPayload4xx && kind === 'unknown' ? ',payload4xx' : ''}) — sem retry BullMQ; roteado pelo status`);
    return { success: false, error_kind: kind, recoverable, message: msg.slice(0, 2000) };
  }
}

// ─── Setup BullMQ ───────────────────────────────────────────────────────────
function buildRedisConn(forWorker = false) {
  try {
    const u = new URL(REDIS_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password ? decodeURIComponent(u.password) : undefined,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      // Worker (blocking) precisa maxRetriesPerRequest=null; Queue não.
      maxRetriesPerRequest: forWorker ? null : 3,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 1000, 5000)),
    };
  } catch { return { host: 'evolution-api-redis', port: 6379 }; }
}

let queue = null;
let worker = null;
let queueAvailable = false;

async function initQueue() {
  try {
    queue = new Queue(QUEUE_NAME, { connection: buildRedisConn(false) });
    // suprime spam de erros de conexão antes de declararmos indisponível
    queue.on('error', (e) => {
      if (queueAvailable) console.warn(`  queue error: ${e.message}`);
    });
    await queue.getJobCounts();
    worker = new Worker(QUEUE_NAME, processLead, {
      connection: buildRedisConn(true), // ⚠️ worker exige maxRetriesPerRequest=null
      concurrency: 1, // 1 cadastro por vez (evita problemas com Playwright singleton)
      limiter: { max: 6, duration: 60_000 }, // máximo 6 cadastros/min
    });
    worker.on('error', (e) => {
      if (queueAvailable) console.warn(`  worker conn error: ${e.message}`);
    });
    worker.on('failed', (job, err) => console.error(`  worker fail job=${job?.id}: ${err.message}`));
    worker.on('completed', (job) => console.log(`  worker done job=${job.id}`));
    queueAvailable = true;
    const conn = buildRedisConn();
    console.log(`✅ BullMQ conectado (${conn.host}:${conn.port}) fila="${QUEUE_NAME}"`);
  } catch (e) {
    console.warn(`⚠️ Redis indisponível: ${e.message} — funcionando em modo síncrono`);
    // limpa connections que ficaram tentando reconectar em loop
    try { if (worker) await worker.close(); } catch {}
    try { if (queue) await queue.close(); } catch {}
    queue = null;
    worker = null;
    queueAvailable = false;
  }
}

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'worker-portal-2',
    portal: 'https://green.igreenenergy.com.br/autoconexao',
    queue: queueAvailable ? 'redis-bullmq' : 'sync',
    uptime: process.uptime(),
    ai_audit: {
      enabled: !AI_AUDIT_DISABLED && AI_AUDIT_LIMIT > 0,
      limit: AI_AUDIT_LIMIT,
      healthy: auditHealth.healthy,
      last_error: auditHealth.error,
      checked_at: auditHealth.checked_at,
    },
  });
});


app.post('/submit-lead', authRequired, async (req, res) => {
  let { customer_id, dados } = req.body || {};

  // Se não veio dados, busca do Supabase a partir do customer_id
  if (!dados && customer_id && supabase) {
    try {
      dados = await fetchDadosFromSupabase(customer_id);
      if (!dados) return res.status(404).json({ ok: false, error: 'customer não encontrado ou sem igreen_id do consultor' });
    } catch (e) {
      return res.status(500).json({ ok: false, error: `falha ao buscar customer: ${e.message}` });
    }
  }

  if (!dados?.idconsultor) return res.status(400).json({ ok: false, error: 'dados.idconsultor obrigatório (ou customer_id válido)' });
  if (!dados?.cpf) return res.status(400).json({ ok: false, error: 'dados.cpf obrigatório' });

  // Blindagem: chamadas antigas do webhook podem enviar `dados` completo com
  // consumoMedio=0. Antes de enfileirar, corrige a partir do customer/valor para
  // o job não repetir 3x falhando em /bonus/rules por consumo ausente.
  if ((!Number(dados.consumoMedio) || Number(dados.consumoMedio) < 50) && customer_id) {
    const valorPayload = Number(dados.electricityBillValue || dados.electricity_bill_value || 0);
    let valorConta = Number.isFinite(valorPayload) ? valorPayload : 0;
    let mediaBanco = 0;
    if (supabase) {
      const { data: c } = await supabase
        .from('customers')
        .select('media_consumo, electricity_bill_value')
        .eq('id', customer_id)
        .maybeSingle();
      mediaBanco = Number(c?.media_consumo || 0);
      valorConta = valorConta || Number(c?.electricity_bill_value || 0);
    }
    if (mediaBanco >= 50) dados.consumoMedio = Math.round(mediaBanco);
    else if (valorConta >= 30) dados.consumoMedio = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
    else dados.consumoMedio = 350;
    console.warn(`  ⚠ consumoMedio corrigido antes da fila: ${dados.consumoMedio} kWh customer=${customer_id}`);
    if (supabase && Number(dados.consumoMedio) >= 50) {
      await supabase.from('customers').update({ media_consumo: Number(dados.consumoMedio) }).eq('id', customer_id)
        .then(() => {}, () => {});
    }
  }

  // 🛡️ SANITY-CHECK PRIMÁRIO (fila): mesmo quando consumoMedio veio preenchido
  // no payload, valida R$/kWh em [0.70 .. 1.60] e sobrescreve se inconsistente.
  // Worker oficial NUNCA submete consumo incoerente ao portal iGreen.
  if (Number(dados.consumoMedio) >= 50) {
    const valorPayload = Number(dados.electricityBillValue || dados.electricity_bill_value || 0);
    let valorConta = Number.isFinite(valorPayload) ? valorPayload : 0;
    if (!valorConta && supabase && customer_id) {
      const { data: c } = await supabase
        .from('customers').select('electricity_bill_value').eq('id', customer_id).maybeSingle();
      valorConta = Number(c?.electricity_bill_value || 0);
    }
    if (valorConta >= 30) {
      const consumoAtual = Number(dados.consumoMedio);
      const ratio = valorConta / consumoAtual;
      if (ratio < 0.70 || ratio > 1.60) {
        const corrigido = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
        console.warn(`  🛡️ [portal2][sanity-fila] customer=${customer_id} valor=R$${valorConta} consumo=${consumoAtual} ratio=${ratio.toFixed(2)} → corrigido=${corrigido} kWh`);
        dados.consumoMedio = corrigido;
        if (supabase && customer_id) {
          await supabase.from('customers').update({
            media_consumo: corrigido,
            ocr_consumo_rejeitado: true,
            ocr_consumo_original: consumoAtual,
          }).eq('id', customer_id).then(() => {}, () => {});
        }
      }
    }
  }

  // REGRA: nenhum cadastro sobe sem conta de energia + documento (frente/verso
  // pra RG; só frente pra CNH). Quando `dados` veio do payload da edge function
  // (sem os arquivos), aqui é onde resolvemos/anexamos do MinIO/Supabase. Se algo
  // obrigatório faltar, recusa com 422 e marca o lead — nunca enfileira incompleto.
  try {
    await ensureDocumentsAttachedAndGate(dados, customer_id);
  } catch (e) {
    if (e.code === 'MISSING_DOCUMENTS') {
      console.warn(`  ⛔ submit recusado customer=${customer_id}: ${e.message}`);
      if (supabase && customer_id) {
        await supabase.from('customers').update({
          portal2_status: 'blocked_missing_documents',
          portal2_error: e.message.slice(0, 500),
        }).eq('id', customer_id).then(() => {}, () => {});
      }
      return res.status(422).json({ ok: false, error: e.message, code: 'MISSING_DOCUMENTS' });
    }
    return res.status(500).json({ ok: false, error: `falha ao validar documentos: ${e.message}` });
  }

  try {
    if (queueAvailable) {
      const job = await queue.add('cadastrar', { customer_id, dados }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      });
      return res.json({ ok: true, queued: true, job_id: job.id });
    }
    // Modo síncrono (sem Redis): processa direto
    const result = await processLead({ id: 'sync-' + Date.now(), data: { customer_id, dados } });
    return res.json({ ok: true, queued: false, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Helpers de parsing da resposta /extractor/extract-receipt ─────────────
//
// O endpoint não tem schema fixo. Variações conhecidas:
//   - Fatura/conta de luz: { data: { consumomedio, fornecedora_energia, ... }}
//   - BOLETO de pagamento: { data: { tipo_comprovante: 'BOLETO', valor_pago,
//     beneficiario: 'CPFL PIRATININGA', ... }}     ← sem consumomedio
// Esse helper garimpa as variantes conhecidas + faz scan recursivo no JSON.

// Walk genérico: percorre um objeto/array procurando por chaves cujo nome
// case-insensitive bate com algum dos `keys`. Retorna o primeiro match.
function _findInResponse(resp, keys) {
  if (!resp || typeof resp !== 'object') return null;
  const lowered = keys.map(k => k.toLowerCase());
  const seen = new WeakSet();
  const stack = [resp];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) { for (const v of node) stack.push(v); continue; }
    for (const [k, v] of Object.entries(node)) {
      if (lowered.includes(k.toLowerCase()) && v != null && v !== '') return v;
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

function _kwhFromReceiptResponse(resp) {
  const raw = _findInResponse(resp, [
    'consumomedio', 'consumo_medio', 'consumoMedio', 'mediaConsumo',
    'media_consumo', 'kwh', 'kWh', 'consumo',
  ]);
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Distribuidora/concessionária. A iGreen pode retornar em vários campos:
//   - `beneficiario` (BOLETO): nome do destinatário do pagamento (ex: "CPFL
//     PIRATININGA")
//   - `concessionaria` / `distribuidora` / `fornecedora_energia` (fatura)
//   - `empresa` / `cedente` em alguns variantes
function _distribuidoraFromReceiptResponse(resp) {
  const raw = _findInResponse(resp, [
    'concessionaria', 'distribuidora', 'fornecedora_energia',
    'beneficiario', 'cedente', 'empresa',
  ]);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Filtra valores claramente não-distribuidora (banco, CEP, etc.)
  if (!trimmed || /^\d+$/.test(trimmed) || trimmed.length > 80) return null;
  return trimmed;
}

// valor pago/total na fatura — usado pra estimar kWh quando OCR não trouxe
// consumomedio (caso BOLETO).
function _valorFromReceiptResponse(resp) {
  const raw = _findInResponse(resp, [
    'valor_pago', 'valorPago', 'valor_total', 'valorTotal',
    'valor', 'total', 'amount',
  ]);
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Resolve extensão a partir do mime.
function _extFromMime(mime) {
  return mime === 'application/pdf' ? 'pdf'
       : mime === 'image/png' ? 'png'
       : mime === 'image/jpeg' ? 'jpg'
       : 'bin';
}

// Sniffa o mime real a partir dos magic bytes (fallback quando não há data URL
// ou o content-type vem genérico como application/octet-stream).
function _sniffMime(buffer, fallback = 'application/pdf') {
  const head = buffer.slice(0, 4).toString('hex').toLowerCase();
  if (head.startsWith('ffd8')) return 'image/jpeg';
  if (head.startsWith('8950')) return 'image/png';
  if (head.startsWith('2550')) return 'application/pdf';
  return fallback;
}

// Decodifica base64 (data URL ou base64 puro) em { buffer, mime, filename }.
// `label` define o nome do arquivo (conta / doc-frente / doc-verso).
function _decodeBillBase64(b64, label = 'conta') {
  if (!b64 || typeof b64 !== 'string') return null;
  let mime = 'application/pdf';
  let payload = b64;
  const m = b64.match(/^data:([^;]+);base64,(.+)$/);
  if (m) { mime = m[1]; payload = m[2]; }
  try {
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length < 100) return null;
    if (!m) mime = _sniffMime(buffer);
    return { buffer, mime, filename: `${label}.${_extFromMime(mime)}` };
  } catch { return null; }
}

// Baixa um arquivo de uma URL http(s) (MinIO/Supabase) em { buffer, mime, filename }.
// Usa fetch nativo (Node 20). Retorna null em falha (caller decide o gate).
async function _downloadToFile(url, label = 'doc') {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      console.warn(`  ⚠ download ${label} HTTP ${r.status}: ${url.slice(0, 80)}`);
      return null;
    }
    const buffer = Buffer.from(await r.arrayBuffer());
    if (buffer.length < 100) return null;
    let mime = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(mime)) mime = _sniffMime(buffer);
    return { buffer, mime, filename: `${label}.${_extFromMime(mime)}` };
  } catch (e) {
    console.warn(`  ⚠ download ${label} falhou: ${e.message}`);
    return null;
  }
}

// Resolve um anexo do customer: prioriza base64 inline / data URL; senão baixa
// da URL http (MinIO/Supabase). Retorna { buffer, mime, filename } ou null.
async function _resolveCustomerFile(b64Col, url, label) {
  const inline = _decodeBillBase64(
    b64Col || (typeof url === 'string' && url.startsWith('data:') ? url : null),
    label,
  );
  if (inline) return inline;
  return _downloadToFile(url, label);
}

// CNH dispensa verso (frente já tem todos os dados). RG exige frente + verso.
function _isCnhCustomer(c) {
  if (!c) return false;
  if (String(c.document_back_url || '') === 'nao_aplicavel') return true;
  return String(c.document_type || '').toLowerCase().includes('cnh');
}

/**
 * REGRA DE NEGÓCIO: nenhum cadastro sobe ao Portal 2 sem a conta de energia
 * E o documento (frente + verso pra RG; só frente pra CNH).
 *
 * Anexa os arquivos faltantes em `dados` (resolvendo base64 inline ou baixando
 * do MinIO/Supabase) e aplica o gate. Lança Error com `.code='MISSING_DOCUMENTS'`
 * quando algum obrigatório não puder ser resolvido.
 */
async function ensureDocumentsAttachedAndGate(dados, customerId) {
  if (!supabase || !customerId) {
    // Sem Supabase não dá pra resolver/validar anexos — exige que já venham no payload.
    const missing = [];
    if (!dados.billFile) missing.push('conta de energia');
    if (!dados.docFile) missing.push('documento (frente)');
    if (missing.length) {
      const err = new Error(`Documentos obrigatórios ausentes: ${missing.join(', ')}`);
      err.code = 'MISSING_DOCUMENTS';
      throw err;
    }
    return;
  }

  const { data: c, error } = await supabase
    .from('customers')
    .select(`
      document_type,
      contaunica, contaunica_answered,
      electricity_bill_photo_url, electricity_boleto_photo_url, bill_base64,
      document_front_url, document_front_base64,
      document_back_url, document_back_base64
    `)
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(`falha ao carregar anexos do customer: ${error.message}`);
  if (!c) throw new Error('customer não encontrado para validação de documentos');

  const isCnh = _isCnhCustomer(c);
  dados.isCnh = isCnh;

  // Boleto único → portal exige comprovante bancário no slot energy-bill.
  const wantsBoletoUnico = c?.contaunica_answered === true && c?.contaunica === true;
  if (!dados.billFile) {
    dados.billFile = wantsBoletoUnico
      ? await _resolveCustomerFile(null, c.electricity_boleto_photo_url, 'boleto')
      : await _resolveCustomerFile(c.bill_base64, c.electricity_bill_photo_url, 'conta');
  }
  if (!dados.docFile) {
    dados.docFile = await _resolveCustomerFile(c.document_front_base64, c.document_front_url, 'doc-frente');
  }
  if (!dados.docBackFile && !isCnh) {
    dados.docBackFile = await _resolveCustomerFile(c.document_back_base64, c.document_back_url, 'doc-verso');
  }

  const missing = [];
  if (!dados.billFile) missing.push(wantsBoletoUnico ? 'boleto bancário' : 'conta de energia');
  if (!dados.docFile) missing.push('documento (frente)');
  if (!isCnh && !dados.docBackFile) missing.push('documento (verso)');
  if (missing.length) {
    const err = new Error(`Documentos obrigatórios ausentes: ${missing.join(', ')}`);
    err.code = 'MISSING_DOCUMENTS';
    throw err;
  }
  console.log(`  📎 anexos OK customer=${customerId}: conta+doc${isCnh ? ' (CNH só frente)' : '+verso'}`);
}

// ─── Helper: monta payload a partir do customers do Supabase ─────────────────
async function fetchDadosFromSupabase(customerId) {
  const { data: c, error } = await supabase
    .from('customers')
    .select(`
      id,
      cpf, name, doc_holder_name, bill_holder_name,
      data_nascimento,
      phone_whatsapp,
      portal2_celular_alt,
      phone_landline,
      phone_contact_confirmed,
      email,
      cep, address_street, address_number, address_complement,
      address_neighborhood, address_city, address_state,
      numero_instalacao, media_consumo, electricity_bill_value,
      portal_idconsultor_override,
      distribuidora, debitos_aberto, possui_procurador,
      document_type,
      bill_base64, electricity_bill_photo_url, electricity_boleto_photo_url,
      document_front_base64, document_front_url,
      document_back_base64, document_back_url,
      orgao_expedidor, fornecedora, contaunica, contaunica_answered, possui_placas,
      transferir_titularidade, transferir_titularidade_answered,
      logindistribuidora, senhadistribuidora,
      pj_jsonb, procurador_jsonb,
      referral_partner_id, consultant_id,
      consultants:consultant_id(igreen_id, name, portal_kind),
      referral_partners:referral_partner_id(cli, partner_igreen_id)
    `)
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const consultant = c.consultants;
  const partner = c.referral_partners;
  // Regra de produto (2026-07-09 + override ficha):
  //   0) portal_idconsultor_override > 0 → sobrescreve tudo
  //   1) partner_igreen_id > 0 → idconsultor = partner_igreen_id
  //   2) cli > 0 (ativo)       → idconsultor = cli  (cli = id iGreen do consultor)
  //   3) senão                 → idconsultor = dono da instância
  // indcli = 0: cli/override cadastra PARA o consultor, não como indicador do dono.
  const overrideRaw = Number(c.portal_idconsultor_override || 0);
  const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
  const donoIgreenId = consultant?.igreen_id ? Number(consultant.igreen_id) : null;
  const partnerIgreenId = partner?.partner_igreen_id ? Number(partner.partner_igreen_id) : 0;
  const partnerCli = partner?.cli ? Number(partner.cli) : 0;
  const partnerAsConsultant =
    (Number.isFinite(partnerIgreenId) && partnerIgreenId > 0)
      ? partnerIgreenId
      : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
  const igreenId = overrideId > 0
    ? overrideId
    : (partnerAsConsultant > 0 ? partnerAsConsultant : donoIgreenId);
  if (!igreenId) return null;
  if (overrideId > 0) {
    console.log(`  ✏️ [idconsultor-override] customer=${customerId} idconsultor=${overrideId} (parceiro=${partnerAsConsultant || '-'} dono=${donoIgreenId})`);
  } else if (partnerAsConsultant > 0) {
    console.log(`  🤝 [consultor-parceiro] customer=${customerId} idconsultor=${igreenId} (cli=${partnerCli || '-'} partner_igreen_id=${partnerIgreenId || '-'}) dono=${donoIgreenId}`);
  }

  // ── Resolve anexos do customer (conta + doc frente + doc verso) ──────────
  // Prioriza base64 inline / data URL; senão baixa do MinIO/Supabase via URL.
  // CNH dispensa verso. O gate de obrigatoriedade roda em
  // ensureDocumentsAttachedAndGate antes de enfileirar.
  const isCnh = _isCnhCustomer(c);
  // Quando o cliente marcou boleto único (contaunica=true + transferir_titularidade=true),
  // o portal iGreen valida o slot `energy-bill` esperando um COMPROVANTE BANCÁRIO,
  // não a fatura da distribuidora. Usa o slot separado `electricity_boleto_photo_url`.
  const wantsBoletoUnico = c?.contaunica_answered === true && c?.contaunica === true;
  const billFile = wantsBoletoUnico
    ? await _resolveCustomerFile(null, c.electricity_boleto_photo_url, 'boleto')
    : await _resolveCustomerFile(c.bill_base64, c.electricity_bill_photo_url, 'conta');
  const docFile = await _resolveCustomerFile(c.document_front_base64, c.document_front_url, 'doc-frente');
  const docBackFile = isCnh ? null : await _resolveCustomerFile(c.document_back_base64, c.document_back_url, 'doc-verso');

  // ── Distribuidora — prioridade: ──────────────────────────────────────────
  //   1. CEP → ViaCEP → CITY_HINT/UF_DEFAULT (mais confiável; sem OCR)
  //   2. customers.distribuidora (digitado ou herdado da UI)
  //   3. OCR do beneficiario na fatura/boleto
  //
  //   Em todos os casos, passamos pelo resolveConcessionaria pra normalizar
  //   pro nome oficial aceito pela iGreen.
  let distribuidora = c.distribuidora || '';
  let cidadeResolvida = c.address_city || '';
  let ufResolvida = c.address_state || '';
  let cepResolveTried = false;
  if (c.cep) {
    cepResolveTried = true;
    try {
      const tmpClient = new Portal2Client({ idconsultor: igreenId });
      const cepResult = await tmpClient.resolveConcessionariaByCep(c.cep);
      if (cepResult?.concessionaria) {
        const before = distribuidora;
        distribuidora = cepResult.concessionaria;
        ufResolvida = cepResult.uf || ufResolvida;
        cidadeResolvida = cepResult.cidade || cidadeResolvida;
        console.log(`  📮 CEP ${c.cep} → ${ufResolvida}/${cidadeResolvida} → "${distribuidora}"${before && before !== distribuidora ? ` (era "${before}")` : ''}`);
        // Persiste pra próximas execuções
        if (before !== distribuidora) {
          await supabase.from('customers').update({ distribuidora }).eq('id', customerId)
            .then(() => {}, () => {});
        }
      }
    } catch (e) {
      console.warn(`  ⚠ resolveConcessionariaByCep falhou: ${e.message}`);
    }
  }

  // ── Consumo médio (kWh) — prioridade: ────────────────────────────────────
  //   1. customers.media_consumo (já preenchido por OCR anterior ou manual)
  //   2. OCR oficial da iGreen via /extractor/extract-receipt no PDF da fatura
  //   3. Estimativa pela tarifa (último fallback, só se não der pra extrair)
  let consumoMedio = Number(c.media_consumo || 0);
  let ocrIdsol = null;
  let ocrBillExtracted = false;
  // Resposta bruta do extract-receipt — repassada ao cadastrarCliente para o
  // gate IA (is_authentic / mismatch) quando billAlreadyExtracted=true.
  let billExtractionResult = null;

  if (billFile) {
    console.log(`  📄 OCR fatura: chamando /extractor/extract-receipt (${billFile.mime}, ${billFile.buffer.length}B)`);
    try {
      const tmpClient = new Portal2Client({ idconsultor: igreenId });
      const init = await tmpClient.initValidation().catch(() => null);
      ocrIdsol = init?.idsolcontratovalidacao || null;
      const resp = await tmpClient.extractReceipt({
        fileBuffer: billFile.buffer,
        filename: billFile.filename,
        mime: billFile.mime,
        idsolcontratovalidacao: ocrIdsol,
      });
      ocrBillExtracted = true;
      billExtractionResult = resp;

      // 1. Distribuidora — só sobrescreve se CEP não resolveu (CEP é a
      //    fonte mais confiável). Caso contrário, OCR é só corroboração.
      const ocrDistRaw = _distribuidoraFromReceiptResponse(resp);
      const uf = ufResolvida || c.address_state || '';
      const cidade = cidadeResolvida || c.address_city || '';
      if (!distribuidora && ocrDistRaw && uf) {
        const resolved = await tmpClient.resolveConcessionaria(uf, ocrDistRaw, cidade).catch(() => null);
        if (resolved) {
          distribuidora = resolved;
          console.log(`  ↳ OCR distribuidora: "${ocrDistRaw}" → "${resolved}" (UF=${uf}, cidade=${cidade})`);
          await supabase.from('customers').update({ distribuidora: resolved }).eq('id', customerId)
            .then(() => {}, () => {});
        }
      } else if (ocrDistRaw && distribuidora) {
        // Apenas log de divergência (não age) — pode ajudar debug
        const ocrResolved = await tmpClient.resolveConcessionaria(uf, ocrDistRaw, cidade).catch(() => null);
        if (ocrResolved && ocrResolved !== distribuidora) {
          console.log(`  ℹ OCR sugere "${ocrResolved}" mas CEP/customer já resolveu "${distribuidora}" — mantendo`);
        }
      }

      // 2. Consumo médio — fatura traz `consumomedio`; boleto não.
      const kwh = _kwhFromReceiptResponse(resp);
      if (kwh) {
        consumoMedio = kwh;
        console.log(`  ↳ OCR consumomedio=${kwh} kWh (idsol=${ocrIdsol})`);
        await supabase.from('customers').update({ media_consumo: kwh }).eq('id', customerId)
          .then(() => {}, () => {});
      } else if (!consumoMedio) {
        const valorOcr = _valorFromReceiptResponse(resp);
        const valor = valorOcr || Number(c.electricity_bill_value || 0);
        if (valor > 0) {
          // Tarifa B1 residencial BR ~R$1,10/kWh com tributos. Clampa em
          // 100..2000 kWh (cobre tier A/B e C/D das regras).
          const TARIFA = 1.10;
          const estimado = Math.round(valor / TARIFA);
          consumoMedio = Math.max(100, Math.min(2000, estimado));
          const fonte = valorOcr ? 'OCR valor_pago' : 'electricity_bill_value';
          const tipo = resp?.data?.tipo_comprovante || resp?.tipo_comprovante;
          console.warn(`  ⚠ OCR sem consumomedio${tipo ? ' (' + tipo + ')' : ''}. Estimando ${consumoMedio} kWh via ${fonte}=R$${valor}`);
        }
      }
    } catch (e) {
      console.warn(`  ⚠ OCR fatura falhou: ${e.message}`);
    }
  } else if (!consumoMedio) {
    console.warn(`  ⚠ media_consumo vazio e bill_base64 ausente — OCR não disponível`);
  }

  // Fallback final: sem OCR e sem media_consumo, estima pelo valor da conta.
  if (!consumoMedio) {
    const TARIFA = 1.10;
    const valorConta = Number(c.electricity_bill_value || 0);
    if (valorConta > 0) {
      const estimado = Math.round(valorConta / TARIFA);
      consumoMedio = Math.max(100, Math.min(2000, estimado));
      console.warn(`  ⚠ usando estimativa: ${consumoMedio} kWh a partir de R$${valorConta}`);
    } else {
      consumoMedio = 350;
      console.warn(`  ⚠ sem dados de consumo — assumindo 350 kWh`);
    }
  }

  // ── 🛡️ SANITY-CHECK PRIMÁRIO (worker oficial) ──────────────────────────
  // Validador-de-última-linha: independente do que bot/OCR salvou no DB, se
  // R$/kWh ficar fora da faixa B1 [0.70 .. 1.60], sobrescreve com estimativa
  // (R$ / 1.10) e marca ocr_consumo_rejeitado. O worker-portal-2 é a fonte
  // oficial do cadastro — nenhum lead sobe ao portal iGreen com consumo
  // incoerente.
  {
    const valorConta = Number(c.electricity_bill_value || 0);
    if (valorConta >= 30 && consumoMedio >= 50) {
      const ratio = valorConta / consumoMedio;
      if (ratio < 0.70 || ratio > 1.60) {
        const corrigido = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
        console.warn(`  🛡️ [portal2][sanity] customer=${customerId} valor=R$${valorConta} consumo=${consumoMedio} ratio=${ratio.toFixed(2)} → corrigido=${corrigido} kWh`);
        if (supabase) {
          await supabase.from('customers').update({
            media_consumo: corrigido,
            ocr_consumo_rejeitado: true,
            ocr_consumo_original: consumoMedio,
          }).eq('id', customerId).then(() => {}, () => {});
        }
        consumoMedio = corrigido;
      }
    }
  }

  return _buildDadosObject(c, consultant, partner, igreenId,
    consumoMedio, distribuidora, billFile, docFile, docBackFile,
    ocrIdsol, ocrBillExtracted, billExtractionResult);
}

// Extraído pra eliminar duplicação. Quando billAlreadyExtracted=true,
// cadastrarCliente reaproveita o idsolcontratovalidacao e pula extractReceipt.
function _buildDadosObject(c, consultant, partner, igreenId,
                            consumoMedio, distribuidora,
                            billFile, docFile, docBackFile,
                            idsolcontratovalidacao, billAlreadyExtracted,
                            billExtractionResult) {
  // indcli=0: quando cli/partner_igreen_id define o idconsultor, o parceiro
  // É o consultor do cadastro (não indicador sob o dono).
  return {
    idconsultor: igreenId,
    indcli: 0,
    cpf: c.cpf || '',
    nome: c.doc_holder_name || c.name || '',
    dataNascimento: c.data_nascimento || '',
    // Telefone do Portal 2: alt → landline confirmado → whatsapp (chave da conversa).
    whatsapp: resolvePortalWhatsapp(c),
    email: c.email || '',
    cep: c.cep || '',
    endereco: c.address_street || '',
    numero: c.address_number || '',
    complemento: c.address_complement || '',
    bairro: c.address_neighborhood || '',
    cidade: c.address_city || '',
    uf: c.address_state || '',
    numeroInstalacao: c.numero_instalacao || '',
    consumoMedio,
    concessionaria: distribuidora || '',
    // Anexos pra reaproveitar dentro de cadastrarCliente. Mantemos o billFile
    // SEMPRE presente (prova pro gate de documentos); a flag billAlreadyExtracted
    // sinaliza ao client que extractReceipt já rodou (evita OCR redundante).
    billFile: billFile || undefined,
    billAlreadyExtracted: !!billAlreadyExtracted,
    // Veredito bruto do OCR da conta (is_authentic etc.) — gate IA no client.
    billExtractionResult: billExtractionResult || undefined,
    docFile: docFile || undefined,
    docBackFile: docBackFile || undefined,
    isCnh: _isCnhCustomer(c),
    idsolcontratovalidacao: idsolcontratovalidacao || undefined,
    sendcontract: true,
    // PR2: novas colunas (todas opcionais — defaults compatíveis com o hardcode anterior).
    // Quando NULL no banco, caem nos defaults atuais do montarPayloadCadastro.
    orgaoExpedidor: c?.orgao_expedidor || '',
    fornecedora: c?.fornecedora || undefined,            // undefined → cadastrarCliente resolve via /bonus/rules
    possuiPlacas: c?.possui_placas ?? false,
    // UX bot = boleto; portal = titularidade. Mesma escolha: unificado ⇔ transferir.
    contaUnica: c?.contaunica_answered === true ? !!c?.contaunica : false,
    transferirTitularidade: c?.contaunica_answered === true
      ? !!c?.contaunica
      : (c?.transferir_titularidade ?? false),
    loginDistribuidora: c?.logindistribuidora || '',
    // senhadistribuidora hoje vem TEXT pura do banco (a coleta cifrada
    // chega no PR3). Se vier vazio/null, o worker envia '' — comportamento atual.
    senhaDistribuidora: c?.senhadistribuidora || '',
    pj: c?.pj_jsonb || undefined,
    procurador: c?.procurador_jsonb || undefined,
  };
}

app.post('/confirm-otp', authRequired, async (req, res) => {
  const body = req.body || {};
  let { idconsultor, idcliente, customer_id } = body;
  const code = body.code || body.otp_code;

  if (!code) {
    return res.status(400).json({ ok: false, error: 'code obrigatório', error_kind: 'missing_code' });
  }

  // Tolerância: se o webhook mandou só customer_id, resolvemos os IDs do
  // iGreen direto do Supabase. Assim o /confirm-otp nunca falha por payload
  // incompleto vindo de integrações futuras.
  if ((!idconsultor || !idcliente) && customer_id && supabase) {
    try {
      const { data: cust } = await supabase
        .from('customers')
        .select('portal2_idcliente, consultant_id, consultants:consultant_id(igreen_id)')
        .eq('id', customer_id)
        .maybeSingle();
      if (!idcliente && cust?.portal2_idcliente) idcliente = Number(cust.portal2_idcliente);
      if (!idconsultor && cust?.consultants?.igreen_id) idconsultor = Number(cust.consultants.igreen_id);
    } catch (e) {
      console.warn(`  ⚠ /confirm-otp lookup customer falhou: ${e.message}`);
    }
  }

  if (!idconsultor || !idcliente) {
    // Cadastro ainda não terminou no Portal 2. Persiste o código pra
    // recover-stuck-otp reprocessar quando o idcliente chegar.
    if (supabase && customer_id) {
      await supabase.from('customers').update({
        otp_code: String(code).slice(0, 12),
        otp_pending_replay: true,
        otp_received_at: new Date().toISOString(),
      }).eq('id', customer_id).then(() => {}, () => {});
    }
    return res.status(202).json({
      ok: false,
      queued_for_replay: true,
      error: 'idcliente/idconsultor ainda não disponíveis — código guardado',
      error_kind: 'awaiting_portal_idcliente',
    });
  }

  // Como o código NÃO expira, fazemos retry curto contra a iGreen pra
  // absorver instabilidade transitória do backend.
  let lastErr = null;
  let result = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = new Portal2Client({ idconsultor });
      result = await c.validateVerificationCode({ idcliente, code });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ /confirm-otp tentativa ${attempt}/3 falhou: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1200));
    }
  }
  if (lastErr) {
    if (supabase && customer_id) {
      await supabase.from('customers').update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: String(lastErr.message || '').slice(0, 500),
      }).eq('id', customer_id).then(() => {}, () => {});
    }
    return res.status(502).json({
      ok: false,
      error: lastErr.message,
      error_kind: 'igreen_validate_failed',
    });
  }

  console.log(`✓ OTP validado idcliente=${idcliente} customer=${customer_id}`);

  try {
    const c = new Portal2Client({ idconsultor });

    // Busca o link DIRETO de assinatura (facial embutida). Polling curto
    // pra absorver latência do backend iGreen.
    let signatureLink = null;
    let contractInfo = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        contractInfo = await c.getContractGenerated(idcliente);
        signatureLink = contractInfo?.linkassinatura
          || contractInfo?.link_assinatura
          || contractInfo?.linkAssinatura
          || null;
        if (signatureLink) break;
      } catch (_) { /* segue tentando */ }
      await new Promise(r => setTimeout(r, 1500));
    }
    const fallbackLink = buildValidationLink(idcliente, idconsultor);
    const finalLink = signatureLink || fallbackLink;
    const linkSource = signatureLink ? 'igreen-direct' : 'fallback-canonico';
    console.log(`  🔗 link facial/assinatura (${linkSource}): ${finalLink}`);

    if (supabase && customer_id) {
      await supabase.from('customers').update({
        portal2_status: 'otp_validated',
        portal2_otp_validated_at: new Date().toISOString(),
        portal2_contract_link: finalLink,
        link_facial: finalLink,
        link_assinatura: finalLink,
        otp_code: String(code).slice(0, 12),
        otp_validated_at: new Date().toISOString(),
        otp_pending_replay: false,
        status: 'awaiting_signature',
        conversation_step: 'aguardando_facial',
      }).eq('id', customer_id).then(() => {}, () => {});
    }

    // CHAVE DE OURO: link único + mensagem calorosa.
    if (customer_id) {
      try {
        const sendResult = await sendFacialLinkToCustomer(customer_id, finalLink);
        console.log(`  📲 chave de ouro (link facial) WhatsApp: ${JSON.stringify(sendResult)}`);
        // Marca envio para o watchdog C não reenviar / não achar que faltou.
        if (supabase && sendResult && !sendResult.skipped) {
          await supabase.from('customers').update({
            link_facial_sent_at: new Date().toISOString(),
          }).eq('id', customer_id).then(() => {}, () => {});
        }
      } catch (e) {
        console.warn(`  ⚠ envio da chave de ouro falhou: ${e.message}`);
      }
    }

    return res.json({
      ok: true,
      result,
      link: finalLink,
      link_source: linkSource,
      contract: contractInfo,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, error_kind: 'post_validation_failed' });
  }
});


app.get('/lead/:idcliente/status', authRequired, async (req, res) => {
  const { idcliente } = req.params;
  const idconsultor = Number(req.query.idconsultor);
  if (!idconsultor) return res.status(400).json({ ok: false, error: 'idconsultor obrigatório (query)' });
  try {
    const c = new Portal2Client({ idconsultor });
    const [otp, contract] = await Promise.all([
      c.getVerificationCodeStatus(idcliente).catch(e => ({ error: e.message })),
      c.getContractGenerated(idcliente).catch(e => ({ error: e.message })),
    ]);
    return res.json({ ok: true, otp_status: otp, contract });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});





app.get('/queue/status', authRequired, async (req, res) => {
  if (!queueAvailable) return res.json({ ok: true, queue: 'sync (sem redis)' });
  const counts = await queue.getJobCounts();
  return res.json({ ok: true, queue: QUEUE_NAME, counts });
});

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function main() {
  await initQueue();

  // Health-check da auditoria IA: testa SUPABASE + WORKER_SECRET + verify_jwt
  // + GEMINI_API_KEY ANTES de aceitar tráfego. Erro NÃO derruba o worker —
  // só loga visível e expõe em GET /health pra alertas.
  if (!AI_AUDIT_DISABLED) {
    try {
      const h = await checkAuditHealth({ supabaseUrl: SUPABASE_URL, workerSecret: SECRET });
      auditHealth = { ...h, checked_at: new Date().toISOString() };
      if (h.healthy) {
        console.log(`✅ AI audit OK (gemini=${h.info?.gemini_configured} secret=${h.info?.worker_secret_configured})`);
      } else {
        console.error(`🔴 AI AUDIT INDISPONÍVEL: ${h.error}`);
        console.error(`   → consertar antes que cadastros passem sem análise IA.`);
      }
    } catch (e) {
      auditHealth = { healthy: false, error: e.message, checked_at: new Date().toISOString() };
      console.error(`🔴 AI AUDIT health-check falhou: ${e.message}`);
    }
  } else {
    auditHealth = { healthy: false, error: 'disabled_by_flag PORTAL2_AI_AUDIT_DISABLED=true', checked_at: new Date().toISOString() };
    console.warn(`⚠️ AI audit DESABILITADA por flag PORTAL2_AI_AUDIT_DISABLED=true`);
  }

  app.listen(PORT, () => {
    console.log(`🚀 worker-portal-2 ouvindo na porta ${PORT}`);
    console.log(`   POST /submit-lead`);
    console.log(`   POST /confirm-otp`);
    console.log(`   GET  /lead/:id/status`);
    console.log(`   GET  /queue/status`);
    console.log(`   GET  /health`);
  });
}


// Graceful shutdown — fecha browser singleton
async function shutdown(sig) {
  console.log(`\n[${sig}] encerrando...`);
  try { if (worker) await worker.close(); } catch {}
  try { if (queue) await queue.close(); } catch {}
  try { await closeBrowser(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
