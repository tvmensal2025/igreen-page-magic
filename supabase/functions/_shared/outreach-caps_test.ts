import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_CAPS,
  decideOutreachCap,
  resolveCapValues,
  usageBucketKey,
} from "./outreach-caps.ts";

const caps = { capB: 150, capC: 50, capGlobal: 200 };
const zero = { b: 0, c: 0 };

Deno.test("grupo A tem bypass mesmo com tudo estourado", () => {
  const v = decideOutreachCap({
    group: "A",
    consultantUsage: { b: 999, c: 999 },
    consultantCaps: caps,
    platformUsage: { b: 999, c: 999 },
    platformCaps: caps,
  });
  assertEquals(v.allowed, true);
});

Deno.test("consultor novo dispara mesmo com outro consultor no limite dele", () => {
  // O caso que motivou a mudança: o consultor A gastou a cota inteira dele.
  // O consultor B não pode herdar esse bloqueio.
  const v = decideOutreachCap({
    group: "B",
    consultantUsage: zero,
    consultantCaps: caps,
    platformUsage: { b: 150, c: 0 }, // veio todo do consultor A
    platformCaps: { ...caps, capGlobal: 400 }, // chip com folga
  });
  assertEquals(v.allowed, true);
});

Deno.test("cota do próprio consultor bloqueia por grupo", () => {
  const v = decideOutreachCap({
    group: "B",
    consultantUsage: { b: 150, c: 0 },
    consultantCaps: caps,
    platformUsage: { b: 150, c: 0 },
    platformCaps: { ...caps, capGlobal: 1000 },
  });
  assertEquals(v, { allowed: false, blockedBy: "consultant", group: "B" });
});

Deno.test("cota C é independente da cota B", () => {
  const usage = { b: 150, c: 0 };
  assertEquals(
    decideOutreachCap({
      group: "C",
      consultantUsage: usage,
      consultantCaps: { ...caps, capGlobal: 1000 },
      platformUsage: usage,
      platformCaps: { ...caps, capGlobal: 1000 },
    }).allowed,
    true,
  );
});

Deno.test("soma B+C do consultor respeita o teto dele", () => {
  const v = decideOutreachCap({
    group: "C",
    consultantUsage: { b: 160, c: 40 },
    consultantCaps: caps,
    platformUsage: { b: 160, c: 40 },
    platformCaps: { ...caps, capGlobal: 1000 },
  });
  assertEquals(v, { allowed: false, blockedBy: "consultant", group: "C" });
});

Deno.test("teto do número compartilhado segura todo mundo (anti-ban)", () => {
  // Consultor zerado, mas o chip já mandou 200 hoje: não pode sair mais nada.
  const v = decideOutreachCap({
    group: "B",
    consultantUsage: zero,
    consultantCaps: caps,
    platformUsage: { b: 150, c: 50 },
    platformCaps: caps,
  });
  assertEquals(v, { allowed: false, blockedBy: "platform", group: "B" });
});

Deno.test("teto de plataforma vence a cota do consultor", () => {
  const v = decideOutreachCap({
    group: "B",
    consultantUsage: { b: 999, c: 999 },
    consultantCaps: caps,
    platformUsage: { b: 200, c: 0 },
    platformCaps: caps,
  });
  assertEquals((v as { blockedBy: string }).blockedBy, "platform");
});

Deno.test("resolveCapValues usa a linha do consultor e cai no fallback", () => {
  assertEquals(
    resolveCapValues({ cap_b: 30, cap_c: 10, cap_global_outreach: 40 }),
    { capB: 30, capC: 10, capGlobal: 40 },
  );
  assertEquals(resolveCapValues(null), DEFAULT_CAPS);
  assertEquals(resolveCapValues({ cap_b: 0, cap_c: -5 }, caps), caps);
  assertEquals(resolveCapValues({ cap_b: "abc" }, caps), caps);
});

Deno.test("envio sem dono vai para um balde separado", () => {
  assertEquals(usageBucketKey(null), "__sem_consultor__");
  assertEquals(usageBucketKey("   "), "__sem_consultor__");
  assertEquals(usageBucketKey("abc-123"), "abc-123");
});
