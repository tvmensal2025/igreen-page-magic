import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BOLETO_RECEBER_DOC_BUTTON_ID,
  boletoChegouStageKey,
  buildBoletoAudioSpoken,
  buildClubLink,
  isBoletoFearOrDoubtText,
  isBoletoReceberDocIntent,
  parseMesFromStageKey,
  renderBoletoNotifyTemplate,
  shouldRunBoletoNotifyNow,
} from "./boleto-notify.ts";

Deno.test("stage_key boleto_chegou", () => {
  assertEquals(boletoChegouStageKey("03/2026"), "boleto_chegou:03/2026");
  assertEquals(parseMesFromStageKey("boleto_chegou:03/2026"), "03/2026");
});

Deno.test("club link", () => {
  assertEquals(buildClubLink("12345"), "https://club.igreenenergy.com.br/?id=12345");
});

Deno.test("intent receber boleto (sem palavra PDF)", () => {
  assertEquals(
    isBoletoReceberDocIntent({ buttonId: BOLETO_RECEBER_DOC_BUTTON_ID }),
    true,
  );
  assertEquals(isBoletoReceberDocIntent({ text: "1" }), true);
  assertEquals(isBoletoReceberDocIntent({ text: "Receber boleto" }), true);
  assertEquals(isBoletoReceberDocIntent({ text: "pdf" }), false);
  assertEquals(isBoletoReceberDocIntent({ text: "oi" }), false);
});

Deno.test("medo/dúvida boleto", () => {
  assertEquals(isBoletoFearOrDoubtText("isso é golpe?"), true);
  assertEquals(isBoletoFearOrDoubtText("meu boleto chegou?"), true);
  assertEquals(isBoletoFearOrDoubtText("bom dia"), false);
});

Deno.test("template renderiza mes e saudacao", () => {
  const out = renderBoletoNotifyTemplate(
    "{{saudacao}}boleto de *{{mes}}* no app {{link_club}}",
    { name: "Maria", nameSource: "manual", mes: "03/2026", linkClub: "https://x" },
  );
  assertEquals(out.includes("PDF"), false);
  assertEquals(out.includes("03/2026"), true);
  assertEquals(out.includes("Maria"), true);
});

Deno.test("template injeta Play Store e App Store", () => {
  const out = renderBoletoNotifyTemplate(
    "Android {{link_play}}\niPhone {{link_appstore}}",
    { name: null, nameSource: null },
  );
  assertEquals(out.includes("play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect"), true);
  assertEquals(out.includes("apps.apple.com/br/app/igreen-club/id6444493340"), true);
});

Deno.test("buildBoletoAudioSpoken usa Olá Nome Tudo bem", () => {
  const out = buildBoletoAudioSpoken({
    audioBody: "seu boleto já está ativo.",
    name: "Maria Silva",
    nameSource: "manual",
  });
  assertEquals(out.startsWith("Olá, Maria! Tudo bem?"), true);
  assertEquals(out.includes("seu boleto já está ativo."), true);
  assertEquals(out.includes("PDF"), false);
});

Deno.test("shouldRunBoletoNotifyNow hora", () => {
  const at8 = new Date("2026-08-06T11:00:00.000Z");
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 8, cron_daily: true }, at8), true);
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 9, cron_daily: true }, at8), false);
});
