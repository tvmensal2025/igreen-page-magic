/**
 * Prova estática: os caminhos de análise, lote e desfecho não têm como
 * escrever na Meta.
 *
 * Teste de comportamento não cobre isto: alguém pode adicionar um import de
 * cliente Graph amanhã e todos os testes continuariam verdes até a primeira
 * campanha ser alterada em produção. Aqui a garantia é o texto do módulo.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SHARED = new URL(".", import.meta.url).pathname;
const SHADOW = new URL("../campaign-brain-shadow/index.ts", import.meta.url)
  .pathname;

/** Módulos que rodam no caminho analyze/scheduled/outcomes. */
const PURE_MODULES = [
  "brain-batch.ts",
  "brain-measure.ts",
  "brain-decide.ts",
  "brain-snapshot.ts",
  "brain-sample.ts",
  "brain-health.ts",
  "brain-attribution.ts",
  "brain-campaign-support.ts",
  "brain-outcome.ts",
  "brain-data-quality.ts",
  "brain-decision-store.ts",
  // Entra na lista porque o store usa a chave de idempotência daqui. É a
  // prova de que essa dependência não arrasta nenhuma chamada de rede junto.
  "brain-execution.ts",
];

function read(path: string): string {
  return Deno.readTextFileSync(path);
}

/** Ignora comentários: a proibição é sobre código, não sobre a explicação. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

Deno.test("nenhum módulo do caminho de análise fala com a Graph API", () => {
  for (const file of PURE_MODULES) {
    const code = codeOnly(read(`${SHARED}${file}`));
    assertEquals(
      /graph\.facebook/.test(code),
      false,
      `${file} não pode citar graph.facebook`,
    );
    assertEquals(/fbFetch/.test(code), false, `${file} não pode usar fbFetch`);
    assertEquals(
      /\bfetch\s*\(/.test(code),
      false,
      `${file} não pode chamar fetch`,
    );
  }
});

Deno.test("nenhum módulo do caminho de análise importa cliente da Meta", () => {
  const PROIBIDOS = ["fb-graph.ts", "facebook-api", "meta-api", "ads-mutation"];
  for (const file of PURE_MODULES) {
    const code = codeOnly(read(`${SHARED}${file}`));
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const imp of imports) {
      for (const proibido of PROIBIDOS) {
        assert(
          !imp.includes(proibido),
          `${file} importa ${imp} — caminho de análise não pode alcançar a Meta`,
        );
      }
    }
  }
});

Deno.test("o lote não conhece a camada de execução", () => {
  const batch = codeOnly(read(`${SHARED}brain-batch.ts`));
  // O lote decide e registra; quem um dia escrever na Meta é outra história,
  // e ela não passa por aqui.
  assertEquals(/from\s+"\.\/brain-execution/.test(batch), false);
  for (const proibido of ["pauseCampaign", "updateBudget", "activateCampaign"]) {
    assertEquals(
      batch.includes(proibido),
      false,
      `lote não pode chamar ${proibido}`,
    );
  }
});

Deno.test("a edge do Cérebro não importa cliente Graph", () => {
  const code = codeOnly(read(SHADOW));
  assertEquals(/graph\.facebook/.test(code), false);
  assertEquals(/fbFetch/.test(code), false);
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  // `fb-graph.ts` entra só pelo cliente de banco e auth; o que não pode é
  // qualquer função de mutação.
  for (const proibido of ["ads-mutation", "brain-execution"]) {
    assert(
      imports.every((i) => !i.includes(proibido)),
      `edge não pode importar ${proibido}`,
    );
  }
  for (const fn of ["fbFetch", "pauseCampaign", "updateBudget"]) {
    assertEquals(code.includes(fn), false, `edge não pode usar ${fn}`);
  }
});

Deno.test("os modos de lote são restritos ao agendador", () => {
  const code = read(SHADOW);
  assert(
    code.includes("modo restrito ao agendador"),
    "scheduled/outcomes não podem ser chamados por consultor logado",
  );
  assert(code.includes("isBatchMode"));
});
