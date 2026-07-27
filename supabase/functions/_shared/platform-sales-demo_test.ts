/**
 * Tests — platform-sales-demo (menu 1–8, parse, state machine).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PS_DEMO_BTN_YES,
  buildPsDemoMenuText,
  buildPsDemoOutbounds,
  composePsDemoClientMessage,
  parsePsDemoIntent,
  resolvePsDemoAction,
  resolvePsDemoClientName,
  stageForDemoNumber,
} from "./platform-sales-demo.ts";

Deno.test("stageForDemoNumber: 1→aprovado … 8→d210; 50 inválido", () => {
  assertEquals(stageForDemoNumber(1), "aprovado");
  assertEquals(stageForDemoNumber(2), "d30");
  assertEquals(stageForDemoNumber(3), "d60");
  assertEquals(stageForDemoNumber(8), "d210");
  assertEquals(stageForDemoNumber(9), null);
  assertEquals(stageForDemoNumber(50), null);
});

Deno.test("menu texto tem 1..8, emoji, negrito e pede digitar número", () => {
  const t = buildPsDemoMenuText();
  assertEquals(t.includes("*1.* ✅ *Aprovado*"), true);
  assertEquals(t.includes("*3.* 📅 *60 dias*"), true);
  assertEquals(t.includes("*8.* 🏁 *210 dias*"), true);
  assertEquals(t.includes("Digite o número"), true);
  assertEquals(t.includes("📋"), true);
});

Deno.test("parse: botão e dígito", () => {
  assertEquals(parsePsDemoIntent(null, PS_DEMO_BTN_YES).kind, "yes");
  assertEquals(parsePsDemoIntent("3", null), { kind: "number", n: 3 });
  assertEquals(parsePsDemoIntent("*1.*", null), { kind: "number", n: 1 });
  assertEquals(parsePsDemoIntent("sim", null).kind, "yes");
});

Deno.test("resolve: cta_sent 1=Sim; menu 1=Aprovado", () => {
  const yes = resolvePsDemoAction("cta_sent", { kind: "number", n: 1 });
  assertEquals(yes.action, "send_menu");

  const stage = resolvePsDemoAction("menu", { kind: "number", n: 1 });
  assertEquals(stage.action, "send_stage");
  if (stage.action === "send_stage") assertEquals(stage.stage, "aprovado");
});

Deno.test("idle ignora; never empty outbounds em fallback", () => {
  assertEquals(resolvePsDemoAction("idle", { kind: "yes" }).action, "ignore");
  const fb = resolvePsDemoAction("menu", { kind: "unknown" });
  const outs = buildPsDemoOutbounds(fb);
  assertEquals(outs.length >= 1, true);
});

Deno.test("send_stage com mídia: imagem+áudio+menu, sem botões extras", () => {
  const resolved = resolvePsDemoAction("menu", { kind: "number", n: 1 });
  assertEquals(resolved.action, "send_stage");
  const outs = buildPsDemoOutbounds(resolved, {
    stageText: "Olá, Maria Tudo bem? Roteiro longo que NÃO deve ir no Zap.",
    imageUrl: "https://example.com/img.jpg",
    audioUrl: "https://example.com/a.ogg",
    mediaPackOk: true,
  });
  assertEquals(outs[0], { type: "image", url: "https://example.com/img.jpg" });
  assertEquals(outs[1], { type: "audio", url: "https://example.com/a.ogg" });
  assertEquals(outs[2]?.type, "text");
  assertEquals(outs.some((o) => o.type === "buttons"), false);
  assertEquals(outs.some((o) => o.type === "text" && o.text.includes("Roteiro longo")), false);
  assertEquals(outs.some((o) => o.type === "text" && o.text.includes("✅ *Aprovado*")), true);
  assertEquals(outs.some((o) => o.type === "text" && o.text.includes("sair")), true);
});

Deno.test("parse: Ver menu = reopen (não yes)", () => {
  assertEquals(parsePsDemoIntent("Ver menu", null).kind, "reopen");
  assertEquals(parsePsDemoIntent("menu", null).kind, "reopen");
  assertEquals(parsePsDemoIntent("sair", null).kind, "close");
});

Deno.test("send_stage sem mídia: fallback texto do roteiro", () => {
  const resolved = resolvePsDemoAction("menu", { kind: "number", n: 2 });
  const outs = buildPsDemoOutbounds(resolved, {
    stageText: "Fallback só se falhar mídia",
    mediaPackOk: false,
  });
  assertEquals(outs.some((o) => o.type === "text" && o.text.includes("Fallback só")), true);
});

Deno.test("compose abre com Olá Maria + saudação (template canônico)", () => {
  const raw =
    "Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\nSeu cadastro na iGreen foi aprovado.";
  const text = composePsDemoClientMessage(raw, {
    now: new Date("2026-07-27T15:00:00-03:00"),
  });
  assertEquals(text.startsWith("Olá, Maria Tudo bem?"), true);
  assertEquals(text.includes("Muito boa tarde"), true);
  assertEquals(text.includes("aprovado"), true);
});

Deno.test("compose usa prenome do consultor; sem nome → Maria", () => {
  const raw = "Olá, {{nome}} Tudo bem?";
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: "Caue" }).startsWith("Olá, Caue "),
    true,
  );
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: "Jaqueline" }).startsWith("Olá, Jaqueline "),
    true,
  );
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: "Daniel Silva" }).startsWith("Olá, Daniel "),
    true,
  );
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: "Edson ( Icotema )" }).startsWith("Olá, Edson "),
    true,
  );
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: "" }).startsWith("Olá, Maria "),
    true,
  );
  assertEquals(
    composePsDemoClientMessage(raw, { customerName: null }).startsWith("Olá, Maria "),
    true,
  );
  assertEquals(resolvePsDemoClientName("Rodrigo"), "Rodrigo");
  assertEquals(resolvePsDemoClientName(""), "Maria");
});
