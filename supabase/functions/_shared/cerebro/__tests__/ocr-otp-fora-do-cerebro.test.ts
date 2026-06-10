// Testes-guardião: OCR via dispatcher/hooks e OTP interceptado ANTES do
// Cérebro (pt-BR) — Tarefa 11.4.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro
// (mídia, OCR, OTP, portal)" e "Não quebrar o worker do portal".
//
// Valida: Requisitos 16.2 e 16.3.
//   - 16.2: o Cérebro opera sem alterar o trio de proteção/integração do
//     webhook — em particular, sem assumir a interceptação de OTP, que
//     continua ANTES do hook do Cérebro;
//   - 16.3: OCR continua executado pelo dispatcher existente
//     (`_shared/dispatcher/` + hooks), não pelo Cérebro.
//
// O QUE ESTES TESTES PROVAM
// -------------------------
// (a) OCR fica FORA do Cérebro:
//     1. o repassador do Cérebro (`despacho-cadastro.ts`) roteia a ação `ocr`
//        como "dispatcher_existente" e NÃO toca no worker/OCR;
//     2. nenhum arquivo do núcleo do Cérebro importa um módulo de OCR nem
//        implementa OCR (extração de texto de imagem) por conta própria.
//
// (b) submit-otp fica FORA do Cérebro:
//     1. o repassador roteia `otp_submit` como "otp_intercept" (não-portal);
//     2. nenhum arquivo do núcleo importa `submit-otp`/`otp-intercept` nem
//        chama os endpoints de OTP (`submit-otp`/`confirm-otp`).
//
// (c) Ordem nos DOIS webhooks (lendo o código-fonte real): a interceptação de
//     OTP está posicionada ANTES da chamada do hook de sombra do Cérebro
//     (`executarCerebroSombra`) e CURTO-CIRCUITA o turno (retorna `Response`)
//     antes de chegar ao Cérebro. Logo, o Cérebro nem vê o turno de OTP.
//
// São testes de leitura/estrutura (sem rede).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/ocr-otp-fora-do-cerebro.test.ts --no-check --allow-read

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { despacharAcaoCadastro } from "../despacho-cadastro.ts";
import type { AcaoCadastroDeferida } from "../tipos.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OCR: AcaoCadastroDeferida = {
  kind: "ocr",
  stepId: "passo-conta",
  flowId: "fluxo-1",
  pipeline: "ocr_conta",
  mediaRef: "msg-123",
};

const OTP: AcaoCadastroDeferida = {
  kind: "otp_submit",
  stepId: "passo-otp",
  flowId: "fluxo-1",
  otpCode: "123456",
};

// Espião do helper de portal: se ele for chamado, o teste falha. Prova que nem
// OCR nem OTP tocam o worker do portal.
function fazerEspiaoPortal() {
  const chamadas: string[] = [];
  // deno-lint-ignore no-explicit-any
  const fn = (_supabase: any, customerId: string) => {
    chamadas.push(customerId);
    return Promise.resolve({ ok: true, mode: "dispatched" as const, status: 200, worker: "digital" as const });
  };
  return { fn, chamadas };
}

// ─── (a.1) OCR é roteado ao dispatcher existente, sem tocar o portal ─────────

Deno.test("11.4: o repassador roteia OCR para o dispatcher existente (não o Cérebro)", async () => {
  const espiao = fazerEspiaoPortal();
  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-ocr",
    acaoCadastro: OCR,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  // OCR continua sendo executado pelo dispatcher existente (`_shared/dispatcher/`
  // + hooks de OCR), não pelo Cérebro.
  assertEquals(r.destino, "dispatcher_existente");
  assertEquals(r.kind, "ocr");
  // O Cérebro não toca worker/OCR diretamente.
  assertEquals(r.acionouPortalWorker, false);
  assertEquals(espiao.chamadas.length, 0);
});

// ─── (b.1) OTP é reconhecido como otp_intercept, sem tocar o portal ──────────

Deno.test("11.4: o repassador roteia otp_submit para o otp-intercept (fora do Cérebro)", async () => {
  const espiao = fazerEspiaoPortal();
  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-otp",
    acaoCadastro: OTP,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  assertEquals(r.destino, "otp_intercept");
  assertEquals(r.kind, "otp_submit");
  assertEquals(r.acionouPortalWorker, false);
  assertEquals(espiao.chamadas.length, 0);
});

// ─── Leitura dos arquivos do núcleo do Cérebro (apenas a raiz, não __tests__) ─

const RAIZ_CEREBRO = new URL("../", import.meta.url);

async function lerArquivosTs(): Promise<Array<{ nome: string; texto: string }>> {
  const arquivos: Array<{ nome: string; texto: string }> = [];
  for await (const entry of Deno.readDir(RAIZ_CEREBRO)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const texto = await Deno.readTextFile(new URL(entry.name, RAIZ_CEREBRO));
    arquivos.push({ nome: entry.name, texto });
  }
  return arquivos;
}

// Captura linhas de `import ... from "..."` (estáticas e dinâmicas) e o caminho.
function caminhosImportados(texto: string): string[] {
  const caminhos: string[] = [];
  const re = /(?:import\s[^"']*from\s*|import\s*\(\s*|export\s[^"']*from\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    caminhos.push(m[1]);
  }
  return caminhos;
}

// ─── (a.2) Nenhum arquivo do núcleo importa/implementa OCR ───────────────────

Deno.test("11.4: o núcleo do Cérebro não importa um módulo de OCR", async () => {
  const arquivos = await lerArquivosTs();
  for (const a of arquivos) {
    for (const caminho of caminhosImportados(a.texto)) {
      assert(
        !/ocr/i.test(caminho),
        `${a.nome} importou um módulo de OCR (${caminho}) — OCR é do dispatcher existente`,
      );
    }
  }
});

Deno.test("11.4: o núcleo do Cérebro não implementa OCR (extração de texto de imagem)", async () => {
  const arquivos = await lerArquivosTs();
  // Sinais de IMPLEMENTAÇÃO de OCR (não as meras etiquetas `ocr`/`ocr_conta`,
  // que são apenas tipos de ação repassados). Se algum aparecer, o Cérebro
  // estaria fazendo OCR por conta própria — regressão do Requisito 16.3.
  const padroesProibidos = [
    /tesseract/i,
    /extractTextFromImage/i,
    /runOcr/i,
    /vision\.googleapis/i,
    /image[_-]?to[_-]?text/i,
  ];
  for (const a of arquivos) {
    for (const padrao of padroesProibidos) {
      assert(
        !padrao.test(a.texto),
        `${a.nome} parece implementar OCR (${padrao}) — deveria delegar ao dispatcher existente`,
      );
    }
  }
});

// ─── (b.2) Nenhum arquivo do núcleo importa/implementa submit-otp ────────────

Deno.test("11.4: o núcleo do Cérebro não importa submit-otp nem otp-intercept", async () => {
  const arquivos = await lerArquivosTs();
  for (const a of arquivos) {
    for (const caminho of caminhosImportados(a.texto)) {
      assert(
        !/submit-otp|otp-intercept/i.test(caminho),
        `${a.nome} importou ${caminho} — a interceptação de OTP fica FORA do Cérebro`,
      );
    }
  }
});

Deno.test("11.4: o núcleo do Cérebro não chama os endpoints de OTP (submit-otp/confirm-otp)", async () => {
  const arquivos = await lerArquivosTs();
  for (const a of arquivos) {
    assert(
      !/functions\/v1\/submit-otp|\/confirm-otp/i.test(a.texto),
      `${a.nome} chamou um endpoint de OTP — submit-otp pertence ao webhook/worker, não ao Cérebro`,
    );
  }
});

// ─── (c) Ordem nos DOIS webhooks: OTP-intercept ANTES do hook do Cérebro ─────
//
// Lemos o código-fonte real de cada webhook e provamos, por posição no arquivo,
// que a interceptação de OTP (e o `return Response` que curto-circuita o turno)
// vem ANTES da chamada `executarCerebroSombra`. Assim o Cérebro nem vê o turno
// de OTP.

const EVOLUTION_WEBHOOK = new URL(
  "../../../evolution-webhook/index.ts",
  import.meta.url,
);
const WHAPI_WEBHOOK = new URL(
  "../../../whapi-webhook/index.ts",
  import.meta.url,
);

interface OrdemWebhook {
  /** Início do bloco de interceptação de OTP. */
  idxOtpIntercept: number;
  /** `return Response` que curto-circuita o turno de OTP. */
  idxReturnOtp: number;
  /** Chamada do hook de sombra do Cérebro. */
  idxHookCerebro: number;
}

function medirOrdem(
  texto: string,
  marcadorOtp: RegExp,
  marcadorReturnOtp: RegExp,
): OrdemWebhook {
  const idxOtpIntercept = texto.search(marcadorOtp);
  const idxHookCerebro = texto.indexOf("executarCerebroSombra");
  // O primeiro `return Response` do bloco de OTP, buscado a partir do início
  // da interceptação.
  const idxReturnOtp = idxOtpIntercept >= 0
    ? (() => {
      const resto = texto.slice(idxOtpIntercept);
      const rel = resto.search(marcadorReturnOtp);
      return rel >= 0 ? idxOtpIntercept + rel : -1;
    })()
    : -1;
  return { idxOtpIntercept, idxReturnOtp, idxHookCerebro };
}

Deno.test("11.4: evolution-webhook intercepta OTP e curto-circuita ANTES do hook do Cérebro", async () => {
  const texto = await Deno.readTextFile(EVOLUTION_WEBHOOK);
  // No evolution-webhook a interceptação é feita por `tryInterceptOtp` e o
  // curto-circuito é `if (otpResult.intercepted) { ... return new Response`.
  const o = medirOrdem(
    texto,
    /tryInterceptOtp\(/,
    /return new Response/,
  );

  assert(o.idxOtpIntercept >= 0, "não achei a interceptação de OTP (tryInterceptOtp)");
  assert(o.idxHookCerebro >= 0, "não achei a chamada executarCerebroSombra");
  assert(o.idxReturnOtp >= 0, "não achei o return Response do bloco de OTP");

  // OTP é interceptado ANTES de o hook do Cérebro ser chamado.
  assert(
    o.idxOtpIntercept < o.idxHookCerebro,
    "a interceptação de OTP deveria vir ANTES de executarCerebroSombra",
  );
  // E o turno de OTP RETORNA (curto-circuita) antes de chegar ao Cérebro.
  assert(
    o.idxReturnOtp < o.idxHookCerebro,
    "o return do turno de OTP deveria curto-circuitar ANTES do hook do Cérebro",
  );
  // Confirma também o marcador de bloqueio do fluxo seguinte.
  assert(/otpResult\.intercepted/.test(texto), "esperava o curto-circuito por otpResult.intercepted");
});

Deno.test("11.4: whapi-webhook intercepta OTP e curto-circuita ANTES do hook do Cérebro", async () => {
  const texto = await Deno.readTextFile(WHAPI_WEBHOOK);
  // No whapi-webhook a interceptação é inline e retorna com msg "otp_intercepted".
  const o = medirOrdem(
    texto,
    /OTP INTERCEPT/i,
    /return new Response[\s\S]*?otp_intercepted/,
  );

  assert(o.idxOtpIntercept >= 0, "não achei o bloco de OTP INTERCEPT");
  assert(o.idxHookCerebro >= 0, "não achei a chamada executarCerebroSombra");
  assert(o.idxReturnOtp >= 0, "não achei o return Response 'otp_intercepted'");

  assert(
    o.idxOtpIntercept < o.idxHookCerebro,
    "a interceptação de OTP deveria vir ANTES de executarCerebroSombra",
  );
  assert(
    o.idxReturnOtp < o.idxHookCerebro,
    "o return do turno de OTP deveria curto-circuitar ANTES do hook do Cérebro",
  );
});

// ─── (c.extra) Os dois webhooks chamam o hook do Cérebro do mesmo jeito ──────
//
// Garante o par simétrico (C2 do design): se um webhook tiver o hook e o outro
// não, este teste sinaliza divergência.

Deno.test("11.4: os DOIS webhooks chamam o hook de sombra do Cérebro (par simétrico)", async () => {
  const evo = await Deno.readTextFile(EVOLUTION_WEBHOOK);
  const whapi = await Deno.readTextFile(WHAPI_WEBHOOK);
  assert(/executarCerebroSombra/.test(evo), "evolution-webhook não chama o hook do Cérebro");
  assert(/executarCerebroSombra/.test(whapi), "whapi-webhook não chama o hook do Cérebro");
});
