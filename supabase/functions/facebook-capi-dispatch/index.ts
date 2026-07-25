// Despachante da fila CAPI (`facebook_capi_outbox`).
//
// Envia cada evento pendente à Meta usando o `event_key` como `event_id`. Como
// a Meta deduplica por `event_id`, repetir o MESMO evento é seguro e não infla
// conversão — é isso que permite retry com backoff.
//
// NASCE DESLIGADO: exige o toggle `facebook_capi_dispatch`. Motor novo não entra
// ligado; habilitar é decisão humana explícita.
import {
  adminClient,
  FB_GRAPH,
  fbWriteIdempotent,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import {
  buildCapiEventPayload,
  buildHashedUserData,
  extractCapiError,
  isRetryableCapiError,
} from "../_shared/capi-event.ts";

const TOGGLE_KEY = "facebook_capi_dispatch";
const MAX_ATTEMPTS = 6;

interface OutboxRow {
  id: string;
  event_key: string;
  consultant_id: string;
  customer_id: string | null;
  event_name: string;
  value_numeric: number | null;
  currency: string | null;
  hashed_user_data: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  attempts: number;
}

Deno.serve(async (req) => {
  const cors = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const admin = adminClient();
    const auth = await assertCronAuthStrict(req, admin);
    if (!auth.ok) return cronAuthUnauthorized(auth.reason, cors);

    if (!(await isAutomationEnabled(admin, TOGGLE_KEY))) {
      await logSkipped(admin, TOGGLE_KEY);
      return json({ skipped: "automation_disabled", key: TOGGLE_KEY });
    }

    const token = Deno.env.get("FACEBOOK_CAPI_ACCESS_TOKEN") ?? "";
    const platform = await loadPlatformAccount();
    const pixelId = Deno.env.get("FACEBOOK_CAPI_PIXEL_ID") ||
      platform?.pixel_id || "";
    const accessToken = token || platform?.token || "";
    if (!accessToken || !pixelId) {
      // Sem credencial não marcamos falha: a fila espera a configuração.
      return json({ skipped: "capi_not_configured" });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(
      Math.max(Number(body?.limit) || 25, 1),
      100,
    );

    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_facebook_capi_events",
      { _limit: batchSize, _lease_seconds: 120 },
    );
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as OutboxRow[];
    let sent = 0;
    let failed = 0;
    let dead = 0;

    for (const row of rows) {
      try {
        // Sem PII na fila: quando há cliente, os dados de contato são lidos
        // agora e hasheados no envio.
        let userData = row.hashed_user_data ?? null;
        if (!userData && row.customer_id) {
          const { data: customer } = await admin
            .from("customers")
            .select("email, phone_whatsapp, name")
            .eq("id", row.customer_id)
            .maybeSingle();
          userData = await buildHashedUserData({
            email: (customer as { email?: string } | null)?.email ?? null,
            phone: (customer as { phone_whatsapp?: string } | null)
              ?.phone_whatsapp ?? null,
            externalId: row.customer_id,
          });
        }
        if (!userData || Object.keys(userData).length === 0) {
          // Evento sem nenhum identificador é inútil para a Meta e nunca
          // melhora com retry: encerra como morto, com motivo claro.
          await admin.rpc("mark_facebook_capi_failed", {
            _id: row.id,
            _error: "sem identificador de usuário",
            _response: null,
            _max_attempts: 1,
          });
          dead++;
          continue;
        }

        const context = row.context ?? {};
        const offline = context.offline === true;
        const offlineSetId = typeof context.offline_event_set_id === "string"
          ? context.offline_event_set_id
          : null;
        const targetId = offline && offlineSetId ? offlineSetId : pixelId;

        const event = buildCapiEventPayload({
          eventName: row.event_name,
          // event_id estável = deduplicação da Meta = retry seguro.
          eventId: row.event_key,
          userData,
          offline,
          sourceUrl: typeof context.source_url === "string"
            ? context.source_url
            : null,
          value: row.value_numeric === null ? null : Number(row.value_numeric),
          currency: row.currency,
        });

        // Idempotente por event_id: pode retentar dentro da própria chamada.
        const response = await fbWriteIdempotent(
          `${FB_GRAPH}/${targetId}/events?access_token=${accessToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: [event] }),
          },
          2,
        ).catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));

        const errorMessage = extractCapiError(response);
        if (!errorMessage) {
          await admin.rpc("mark_facebook_capi_sent", {
            _id: row.id,
            _response: response as Record<string, unknown>,
          });
          sent++;
          continue;
        }

        // Erro permanente não merece 6 tentativas: encerra de uma vez.
        const maxAttempts = isRetryableCapiError(errorMessage)
          ? MAX_ATTEMPTS
          : 1;
        const { data: failResult } = await admin.rpc(
          "mark_facebook_capi_failed",
          {
            _id: row.id,
            _error: errorMessage,
            _response: response as Record<string, unknown>,
            _max_attempts: maxAttempts,
          },
        );
        if ((failResult as { dead?: boolean } | null)?.dead) dead++;
        else failed++;
      } catch (rowError) {
        const message = rowError instanceof Error
          ? rowError.message
          : String(rowError);
        console.error("[fb-capi-dispatch]", row.event_key, message);
        await admin.rpc("mark_facebook_capi_failed", {
          _id: row.id,
          _error: message,
          _response: null,
          _max_attempts: MAX_ATTEMPTS,
        });
        failed++;
      }
    }

    return json({ ok: true, claimed: rows.length, sent, failed, dead });
  } catch (error) {
    console.error("[fb-capi-dispatch]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
