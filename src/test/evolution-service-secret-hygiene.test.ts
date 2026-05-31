// Feature: evolution-multiconsultor-pronto
//
// SMOKE ESTÁTICO de higiene do segredo `SERVICE_SHARED_SECRET` — Tarefa 5.12.
//
// Este é um teste de ANÁLISE ESTÁTICA: ele lê o texto-fonte das edge functions
// e do `.env.example` e afirma propriedades de higiene do segredo de serviço
// (Critério de Aceitação 5.8 / Requisito 5):
//
//   1. Em `_shared/caller-auth.ts` e `evolution-webhook/index.ts`, o segredo é
//      lido via `Deno.env.get("SERVICE_SHARED_SECRET")` — nunca hardcoded.
//   2. Em TODA a árvore `supabase/functions/**`, não existe atribuição de um
//      literal-string ao identificador `SERVICE_SHARED_SECRET`
//      (i.e. nenhum `SERVICE_SHARED_SECRET = "algumvalor"`); o nome só aparece
//      entre aspas como argumento de `Deno.env.get(...)`. O header de saída
//      `"x-service-secret": SERVICE_SHARED_SECRET` (passa a VARIÁVEL, não loga)
//      é permitido.
//   3. O VALOR do segredo nunca é logado: nenhuma chamada
//      `console.log/info/warn/error/debug/trace(...)` inclui o identificador
//      `SERVICE_SHARED_SECRET` (nem por passagem direta, nem por interpolação
//      `${SERVICE_SHARED_SECRET}` dentro do log).
//   4. `.env.example` documenta apenas o NOME (sem valor): `SERVICE_SHARED_SECRET=`
//      com valor vazio (comentário após `#` é permitido).
//
// _Requirements: 5.8_

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Localização dos fontes (resolvida a partir deste arquivo de teste).
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase/functions");
const CALLER_AUTH = path.join(FUNCTIONS_DIR, "_shared/caller-auth.ts");
const EVOLUTION_WEBHOOK = path.join(FUNCTIONS_DIR, "evolution-webhook/index.ts");
const ENV_EXAMPLE = path.join(FUNCTIONS_DIR, ".env.example");

const SECRET = "SERVICE_SHARED_SECRET";

// ---------------------------------------------------------------------------
// Helpers de análise estática.
// ---------------------------------------------------------------------------

/** Coleta recursivamente todos os arquivos `.ts` sob `dir` (ignora node_modules). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".git")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (st.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extrai o texto dos argumentos de cada chamada `console.<level>(...)` em `src`,
 * casando parênteses e ignorando parênteses dentro de strings/templates.
 * Retorna o span de cada chamada (incluindo os parênteses externos).
 */
function extractConsoleCallSpans(src: string): string[] {
  const spans: string[] = [];
  const re = /console\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1; // índice do '(' de abertura
    let depth = 0;
    let inString: string | null = null;
    let prev = "";
    let i = openIdx;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (ch === inString && prev !== "\\") inString = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      prev = ch;
    }
    spans.push(src.slice(openIdx, i));
  }
  return spans;
}

// ---------------------------------------------------------------------------
// 1) Segredo lido de Deno.env nos dois sites principais.
// ---------------------------------------------------------------------------

describe("REQ 5.8 — segredo é lido de Deno.env (não hardcoded)", () => {
  const callerAuthSrc = readFileSync(CALLER_AUTH, "utf8");
  const evoSrc = readFileSync(EVOLUTION_WEBHOOK, "utf8");

  // Aceita aspas simples ou duplas no nome do env.
  const envReadRe = /Deno\.env\.get\(\s*["']SERVICE_SHARED_SECRET["']\s*\)/;

  it("caller-auth.ts lê o segredo via Deno.env.get(\"SERVICE_SHARED_SECRET\")", () => {
    expect(envReadRe.test(callerAuthSrc)).toBe(true);
  });

  it("evolution-webhook/index.ts lê o segredo via Deno.env.get(\"SERVICE_SHARED_SECRET\")", () => {
    expect(envReadRe.test(evoSrc)).toBe(true);
  });

  it("nos dois arquivos, o NOME entre aspas só aparece como argumento de Deno.env.get(...)", () => {
    for (const src of [callerAuthSrc, evoSrc]) {
      // Toda ocorrência do nome ENTRE ASPAS deve ser precedida por `Deno.env.get(`.
      const quotedNameRe = /(["'])SERVICE_SHARED_SECRET\1/g;
      let m: RegExpExecArray | null;
      while ((m = quotedNameRe.exec(src)) !== null) {
        const preceding = src.slice(Math.max(0, m.index - 24), m.index);
        expect(preceding).toMatch(/Deno\.env\.get\(\s*$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Nenhuma atribuição de literal-string ao identificador (sem hardcode).
// ---------------------------------------------------------------------------

describe("REQ 5.8 — nenhum literal de segredo hardcoded em supabase/functions/**", () => {
  const tsFiles = collectTsFiles(FUNCTIONS_DIR);

  it("encontra arquivos .ts para analisar (sanidade)", () => {
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it("não há `SERVICE_SHARED_SECRET = \"...\"` (atribuição de literal)", () => {
    // Casa o identificador seguido de `=` e ABRINDO uma string literal.
    // NÃO casa `const SECRET = Deno.env.get(...)` (após `=` vem `Deno`, não aspas)
    // nem comparações `=== "..."` (após o id vem `===`, não `<id> = "`).
    const assignLiteralRe = /\bSERVICE_SHARED_SECRET\b\s*=\s*["'`]/;
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const src = readFileSync(file, "utf8");
      if (assignLiteralRe.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o header de saída `\"x-service-secret\": SERVICE_SHARED_SECRET` passa a VARIÁVEL (permitido)", () => {
    const evoSrc = readFileSync(EVOLUTION_WEBHOOK, "utf8");
    // Confirma que existe a passagem da variável (não um literal) no header.
    expect(evoSrc).toMatch(/["']x-service-secret["']\s*:\s*SERVICE_SHARED_SECRET\b/);
    // E garante que NÃO é seguido de aspas (não é literal hardcoded no header).
    expect(evoSrc).not.toMatch(/["']x-service-secret["']\s*:\s*["'`]/);
  });
});

// ---------------------------------------------------------------------------
// 3) O VALOR do segredo nunca é logado.
// ---------------------------------------------------------------------------

describe("REQ 5.8 — o valor do segredo nunca é logado", () => {
  const tsFiles = collectTsFiles(FUNCTIONS_DIR);

  it("nenhuma chamada console.* inclui o identificador SERVICE_SHARED_SECRET", () => {
    const offenders: string[] = [];
    for (const file of tsFiles) {
      const src = readFileSync(file, "utf8");
      for (const span of extractConsoleCallSpans(src)) {
        if (/\bSERVICE_SHARED_SECRET\b/.test(span)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} :: ${span.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("não há interpolação `${SERVICE_SHARED_SECRET}` em nenhum fonte (defesa extra)", () => {
    const offenders: string[] = [];
    const interpRe = /\$\{\s*SERVICE_SHARED_SECRET\s*\}/;
    for (const file of tsFiles) {
      const src = readFileSync(file, "utf8");
      if (interpRe.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4) .env.example documenta o NOME apenas (sem valor).
// ---------------------------------------------------------------------------

describe("REQ 5.8 — .env.example documenta o NOME, sem valor", () => {
  const envSrc = readFileSync(ENV_EXAMPLE, "utf8");

  it("contém a linha `SERVICE_SHARED_SECRET=` com valor vazio (comentário permitido)", () => {
    // Linha que define a var: `SERVICE_SHARED_SECRET=` seguido apenas de espaços
    // e/ou um comentário `# ...`. Nenhum valor real entre `=` e o `#`.
    const line = envSrc
      .split(/\r?\n/)
      .find((l) => /^\s*SERVICE_SHARED_SECRET\s*=/.test(l));
    expect(line, "linha SERVICE_SHARED_SECRET= deve existir no .env.example").toBeDefined();
    expect(line!).toMatch(/^\s*SERVICE_SHARED_SECRET=\s*(#.*)?$/);
  });
});
