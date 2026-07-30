import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { resolveWhatsAppChatId, digitsOnlyPhone } from "../_shared/resolve-whatsapp-chat-id.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProxyRequest {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

/** Extrai instanceName de paths Evolution comuns (`message/…/{inst}`, `instance/…/{inst}`, `chat/…/{inst}`). */
function extractEvolutionInstanceName(safePath: string): string | null {
  const parts = safePath.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const root = parts[0];
  if (root === "message" || root === "chat" || root === "group" || root === "call") {
    return parts[2] || null;
  }
  if (root === "instance") {
    // instance/create e instance/fetchInstances não têm dono no path
    if (parts[1] === "create" || parts[1] === "fetchInstances") return null;
    return parts[2] || null;
  }
  return null;
}

function isMediaFetchPath(path: string): boolean {
  return path.startsWith("chat/getBase64FromMediaMessage/");
}

function createGracefulMediaUnavailableResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ base64: null, mimetype: null, mediaUnavailable: true, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function isLikelyMediaInfrastructureError(body: string): boolean {
  const normalizedBody = body.toLowerCase();
  return normalizedBody.includes("getaddrinfo") ||
    normalizedBody.includes("eai_again") ||
    normalizedBody.includes("enotfound") ||
    normalizedBody.includes("minio");
}

function isConnectionClosedError(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("connection closed") || lower.includes("read messages fail");
}

function isInstanceNotFoundError(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("instance not") ||
    lower.includes("instância não") ||
    lower.includes("instancia nao");
}

function normalizeEvolutionBaseUrl(rawUrl: string | undefined): string {
  const sanitized = (rawUrl || "")
    .trim()
    .replace(/\/manager\/?$/i, "")
    .replace(/\/+$/g, "");

  if (!sanitized) return "";
  return sanitized;
}

function getTimeoutMs(path: string): number {
  if (path.startsWith("instance/connectionState/")) return 12000;
  if (path === "instance/fetchInstances") return 12000;
  if (path.startsWith("instance/connect/")) return 20000;
  if (path === "instance/create") return 30000;
  if (path.startsWith("chat/findChats/")) return 20000;
  if (path.startsWith("chat/findMessages/")) return 20000;
  if (path.startsWith("message/")) return 15000;
  return 15000;
}

function getMaxAttempts(path: string): number {
  if (path.startsWith("instance/connectionState/")) return 1;
  if (path.startsWith("instance/connect/")) return 2;
  if (path === "instance/create") return 1;
  if (path === "instance/fetchInstances") return 1;
  return 1;
}

function getRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 5000);
}

function isRetriableResponseStatus(status: number): boolean {
  return status === 408 || status === 546 || status === 502 || status === 503 || status === 504;
}

// ─── Structured diagnostic responses ───
// Instead of generic { timeout: true }, return rich diagnostic info

interface DiagnosticPayload {
  state?: string;
  timeout?: boolean;
  reason: "timeout" | "server_slow" | "instance_not_found" | "connection_closed" | "service_unavailable" | "ok";
  recommendation: "retry" | "wait" | "reconnect_qr" | "safe_reset" | "none";
  message?: string;
  retryAfterMs?: number;
}

function createDiagnosticResponse(safePath: string, reason: DiagnosticPayload["reason"], extra: Record<string, unknown> = {}): Response {
  const diagnostic: DiagnosticPayload & Record<string, unknown> = {
    reason,
    recommendation: "retry",
    retryAfterMs: 5000,
    ...extra,
  };

  // Set recommendation based on reason
  switch (reason) {
    case "timeout":
    case "server_slow":
      diagnostic.recommendation = "wait";
      diagnostic.retryAfterMs = 8000;
      diagnostic.message = "Servidor WhatsApp respondendo lentamente. Aguarde.";
      break;
    case "instance_not_found":
      diagnostic.recommendation = "safe_reset";
      diagnostic.retryAfterMs = 0;
      diagnostic.message = "Instância não encontrada. É necessário recriar.";
      break;
    case "connection_closed":
      diagnostic.recommendation = "reconnect_qr";
      diagnostic.retryAfterMs = 3000;
      diagnostic.message = "Sessão WhatsApp desconectada. Necessário novo QR Code.";
      break;
    case "service_unavailable":
      diagnostic.recommendation = "wait";
      diagnostic.retryAfterMs = 15000;
      diagnostic.message = "Servidor WhatsApp temporariamente indisponível.";
      break;
  }

  // Path-specific overrides for connectionState
  if (safePath.startsWith("instance/connectionState/")) {
    return new Response(JSON.stringify({
      state: reason === "instance_not_found" ? "missing" : "unknown",
      timeout: reason === "timeout" || reason === "server_slow",
      diagnostic,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath === "instance/fetchInstances") {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath.startsWith("instance/connect/")) {
    return new Response(JSON.stringify({
      base64: null,
      timeout: reason === "timeout",
      notReady: true,
      diagnostic,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath === "instance/create") {
    return new Response(JSON.stringify({
      instance: { instanceName: "" },
      timeout: true,
      diagnostic,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (isMediaFetchPath(safePath)) {
    return createGracefulMediaUnavailableResponse({ timeout: true, diagnostic });
  }

  if (safePath.startsWith("chat/fetchProfilePictureUrl/")) {
    return new Response(JSON.stringify({ profilePictureUrl: null, timeout: true, diagnostic }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath.startsWith("chat/findChats/") || safePath.startsWith("chat/findMessages/")) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath.startsWith("chat/markMessageAsRead/")) {
    return new Response(JSON.stringify({ message: "Read messages", read: "skipped", timeout: true, diagnostic }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (safePath.startsWith("message/")) {
    return new Response(JSON.stringify({
      error: "Timeout ao enviar mensagem. Tente novamente.",
      timeout: true,
      sent: false,
      diagnostic,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    error: "Serviço temporariamente indisponível.",
    timeout: true,
    unavailable: true,
    diagnostic,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(
  targetUrl: string,
  fetchOptions: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(targetUrl, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function proxyToEvolution(
  safePath: string,
  method: string,
  targetUrl: string,
  fetchOptions: RequestInit,
): Promise<Response> {
  const timeoutMs = getTimeoutMs(safePath);
  const attempts = getMaxAttempts(safePath);

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(
      "[evolution-proxy] ->",
      method || "GET",
      targetUrl,
      `(timeout=${timeoutMs}ms, attempt=${attempt}/${attempts})`,
    );

    try {
      const response = await fetchWithTimeout(targetUrl, fetchOptions, timeoutMs);
      if (isRetriableResponseStatus(response.status)) {
        const bodyPreview = await response.text();
        console.warn(
          `[evolution-proxy] Retriable status ${response.status} on attempt ${attempt}: ${bodyPreview.substring(0, 200)}`,
        );

        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, getRetryDelay(attempt)));
          continue;
        }

        return createDiagnosticResponse(safePath, "service_unavailable");
      }
      return response;
    } catch (networkError) {
      lastError = networkError;

      if (networkError instanceof DOMException && networkError.name === "AbortError") {
        console.error(
          `[evolution-proxy] Timeout after ${timeoutMs}ms for ${method || "GET"} ${targetUrl} (attempt ${attempt}/${attempts})`,
        );

        if (attempt < attempts) {
          const delay = getRetryDelay(attempt);
          console.log(`[evolution-proxy] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        console.error(`[evolution-proxy] All ${attempts} attempts exhausted for ${safePath}`);
        return createDiagnosticResponse(safePath, "timeout");
      }

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, getRetryDelay(attempt)));
        continue;
      }

      throw networkError;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown proxy error");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionUrlRaw = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionUrl = normalizeEvolutionBaseUrl(evolutionUrlRaw);

    console.log("[evolution-proxy] EVOLUTION_API_URL(raw):", evolutionUrlRaw ? evolutionUrlRaw.substring(0, 60) : "NOT SET");
    console.log("[evolution-proxy] EVOLUTION_API_URL(normalized):", evolutionUrl ? evolutionUrl.substring(0, 60) : "NOT SET");
    console.log("[evolution-proxy] EVOLUTION_API_KEY configured:", !!evolutionKey);

    if (!evolutionUrl || !evolutionKey) {
      return new Response(
        JSON.stringify({ error: "Configuração do serviço de conexão incompleta." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = (req.headers.get("Authorization") || "").trim();
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(
        JSON.stringify({ error: "Token de autenticação inválido ou ausente", code: "auth_missing" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const token = authHeader.replace(/^bearer\s+/i, "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log("[evolution-proxy] Auth failed:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Token de autenticação inválido ou ausente", code: "auth_invalid" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[evolution-proxy] Auth OK, user:", user.id);

    let payload: ProxyRequest;
    try {
      payload = (await req.json()) as ProxyRequest;
    } catch {
      return new Response(
        JSON.stringify({ error: "Body JSON inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { path, method, body } = payload;

    if (!path) {
      return new Response(
        JSON.stringify({ error: "Campo 'path' é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const safePath = path.replace(/^\/+/, "");
    const targetUrl = `${evolutionUrl}/${safePath}`;

    // Posse da instância: consultor só opera a própria; admin passa.
    const instanceName = extractEvolutionInstanceName(safePath);
    if (instanceName) {
      let isAdmin = false;
      try {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: user.id });
        isAdmin = sa === true;
      } catch {
        isAdmin = false;
      }
      if (!isAdmin) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("consultant_id")
          .eq("instance_name", instanceName)
          .maybeSingle();
        const owner = (inst as { consultant_id?: string } | null)?.consultant_id;
        if (!owner || owner !== user.id) {
          return new Response(
            JSON.stringify({ error: "forbidden", code: "instance_forbidden", message: "Instância não pertence a este consultor." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    let outboundBody = body;
    // BR 9º dígito: reescreve `number` no envio manual (front → Evolution)
    // com o JID real de POST /chat/whatsappNumbers/{instance}.
    if (
      safePath.startsWith("message/") &&
      (method === "POST" || method === "PUT") &&
      outboundBody &&
      typeof outboundBody === "object" &&
      !Array.isArray(outboundBody) &&
      (outboundBody as { number?: unknown }).number
    ) {
      const instanceNameForWa = safePath.split("/")[2] || "";
      const rawNumber = String((outboundBody as { number?: unknown }).number || "");
      if (instanceNameForWa && digitsOnlyPhone(rawNumber)) {
        // DNC absoluto também no envio manual via proxy Evolution.
        {
          const suppression = await assertCanContact(supabase, {
            phone: rawNumber,
            consultantId: user.id,
            channel: "whatsapp",
          });
          if (!suppression.allowed) {
            return new Response(
              JSON.stringify({
                error: "Lead em lista de não contato — envio bloqueado.",
                reasonCode: "do_not_contact",
                reason: suppression.reason,
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
        const resolved = await resolveWhatsAppChatId({
          phoneOrJid: rawNumber,
          provider: {
            kind: "evolution",
            apiUrl: evolutionUrl,
            apiKey: evolutionKey!,
            instanceName: instanceNameForWa,
          },
          fallbackProviders: Deno.env.get("WHAPI_TOKEN")
            ? [{
              kind: "whapi",
              apiToken: Deno.env.get("WHAPI_TOKEN")!,
              baseUrl: Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud",
            }]
            : [],
          supabase,
        });
        if (!resolved.ok) {
          return new Response(
            JSON.stringify({
              error: "Destino sem WhatsApp válido (wa_id)",
              reasonCode: "invalid_whatsapp",
              detail: resolved.reason,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (resolved.changed) {
          console.log(
            `[evolution-proxy] wa_chat_id rewritten ${rawNumber.slice(-8)} → ${resolved.digits.slice(-8)}`,
          );
        }
        outboundBody = { ...(outboundBody as Record<string, unknown>), number: resolved.digits };
      }
    }

    const fetchOptions: RequestInit = {
      method: method || "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionKey,
      },
    };

    if (outboundBody && (method === "POST" || method === "PUT")) {
      fetchOptions.body = JSON.stringify(outboundBody);
    }

    let evolutionResponse: Response;
    try {
      evolutionResponse = await proxyToEvolution(safePath, method || "GET", targetUrl, fetchOptions);
    } catch (networkError) {
      console.error("[evolution-proxy] Network error connecting to service", networkError);
      const gracefulResponse = createDiagnosticResponse(safePath, "service_unavailable");
      console.warn(`[evolution-proxy] Falling back to diagnostic response for ${safePath}`);
      evolutionResponse = gracefulResponse;
    }

    const responseBody = await evolutionResponse.text();
    console.log("[evolution-proxy] <-", evolutionResponse.status, responseBody.substring(0, 300));

    // Gracefully handle non-critical media fetch failures so chat rendering never breaks.
    if (isMediaFetchPath(safePath) && (evolutionResponse.status === 400 || evolutionResponse.status >= 500)) {
      const infrastructureIssue = isLikelyMediaInfrastructureError(responseBody);
      console.warn(
        `[evolution-proxy] Media fetch failed with status ${evolutionResponse.status}${infrastructureIssue ? " (storage/DNS issue)" : ""}, returning graceful null`,
      );
      return new Response(
        JSON.stringify({
          base64: null,
          mimetype: null,
          mediaUnavailable: true,
          upstreamStatus: evolutionResponse.status,
          storageUnavailable: infrastructureIssue || undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Detect "instance not found" errors — return structured diagnostic
    if (evolutionResponse.status >= 400 && isInstanceNotFoundError(responseBody)) {
      console.warn(`[evolution-proxy] Instance not found on ${safePath}`);
      const resp = createDiagnosticResponse(safePath, "instance_not_found");
      const body = await resp.text();
      return new Response(body, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gracefully handle connect/QR errors — instance may still be initializing
    if (safePath.startsWith("instance/connect/") && evolutionResponse.status >= 400) {
      console.warn(`[evolution-proxy] connect returned ${evolutionResponse.status}, returning graceful null QR`);
      return new Response(
        JSON.stringify({ base64: null, notReady: true, diagnostic: { reason: "server_slow", recommendation: "wait", retryAfterMs: 5000 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gracefully handle infrastructure errors (DNS/MinIO) on message-sending routes
    if (safePath.startsWith("message/") && evolutionResponse.status >= 400 && isLikelyMediaInfrastructureError(responseBody)) {
      console.warn(
        `[evolution-proxy] Infrastructure error on ${safePath} (status ${evolutionResponse.status}), returning graceful failure`,
      );
      return new Response(
        JSON.stringify({
          error: "Servidor de mídia temporariamente indisponível. Tente novamente em instantes.",
          timeout: true,
          sent: false,
          storageUnavailable: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Handle "Connection Closed" and similar transient errors gracefully
    if (evolutionResponse.status >= 400 && isConnectionClosedError(responseBody)) {
      console.warn(`[evolution-proxy] Connection closed on ${safePath} (status ${evolutionResponse.status}), returning diagnostic response`);

      if (safePath.startsWith("chat/findMessages/") || safePath.startsWith("chat/findChats/") || safePath.startsWith("chat/findContacts/")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (safePath.startsWith("chat/fetchProfilePictureUrl/")) {
        return new Response(JSON.stringify({ profilePictureUrl: null, connectionClosed: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (safePath.startsWith("chat/markMessageAsRead/")) {
        return new Response(JSON.stringify({ message: "Read messages", read: "skipped", connectionClosed: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (safePath.startsWith("message/")) {
        return new Response(JSON.stringify({ error: "Conexão temporariamente instável. Tente novamente.", timeout: true, sent: false, connectionClosed: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (safePath.startsWith("instance/connectionState/")) {
        return new Response(JSON.stringify({
          instance: { state: "close" },
          connectionClosed: true,
          diagnostic: { reason: "connection_closed", recommendation: "reconnect_qr", retryAfterMs: 3000, message: "Sessão WhatsApp desconectada." },
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Generic fallback
      return new Response(JSON.stringify({
        error: "Conexão temporariamente instável.",
        unavailable: true,
        connectionClosed: true,
        diagnostic: { reason: "connection_closed", recommendation: "reconnect_qr" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(responseBody, {
      status: evolutionResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("evolution-proxy error:", error);
    const errMsg = (error as Error).message || "Internal error";
    if (isConnectionClosedError(errMsg)) {
      console.warn("[evolution-proxy] Connection closed in catch block, returning diagnostic response");
      return new Response(
        JSON.stringify({
          error: "Conexão temporariamente instável.",
          unavailable: true,
          connectionClosed: true,
          diagnostic: { reason: "connection_closed", recommendation: "reconnect_qr" },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
