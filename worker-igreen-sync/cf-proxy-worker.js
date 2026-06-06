/**
 * Cloudflare Worker — Proxy para API iGreen
 * 
 * Deploy em: https://dash.cloudflare.com/workers
 * 
 * Este worker recebe requests do worker VPS e faz o proxy
 * para api-main.igreenenergy.com.br como se fosse um
 * request interno do Cloudflare (bypassa o WAF).
 * 
 * Segurança: valida o header X-Proxy-Secret antes de encaminhar.
 * 
 * Free tier: 100.000 requests/dia — suficiente para centenas de usuários.
 */

// Mude para um segredo longo e aleatório
const PROXY_SECRET = 'MUDE_PARA_UM_SEGREDO_LONGO';

// Base URL da API iGreen
const IGREEN_API_BASE = 'https://api-main.igreenenergy.com.br';

export default {
  async fetch(request, env, ctx) {
    // Validar segredo
    const secret = request.headers.get('X-Proxy-Secret');
    if (secret !== PROXY_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, mode: 'cf-worker-proxy' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extrair o path alvo do header X-Target-Path
    const targetPath = request.headers.get('X-Target-Path') || url.pathname;
    const targetUrl = `${IGREEN_API_BASE}${targetPath}`;

    // Copiar headers, removendo os nossos headers de controle
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower === 'x-proxy-secret' || lower === 'x-target-path' || lower === 'host') continue;
      headers.set(key, value);
    }
    headers.set('Host', 'api-main.igreenenergy.com.br');

    // Encaminhar o request para a API iGreen
    const body = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined;

    const igreenResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    // Retornar a resposta da API iGreen
    const responseHeaders = new Headers(igreenResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(igreenResponse.body, {
      status: igreenResponse.status,
      statusText: igreenResponse.statusText,
      headers: responseHeaders,
    });
  }
};
