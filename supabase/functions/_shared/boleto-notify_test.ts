import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BOLETO_RECEBER_DOC_BUTTON_ID,
  boletoChegouStageKey,
  buildBoletoAudioSpoken,
  BOLETO_APP_ANDROID_BUTTON_ID,
  BOLETO_APP_IOS_BUTTON_ID,
  buildAppStoreNumberedMessage,
  buildAppStoreButtonsPrompt,
  resolveBoletoAppStoreChoice,
  buildBoletoButtonPrompt,
  buildBoletoFearFaqReply,
  buildClubLink,
  stripBoletoButtonCta,
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

Deno.test("apps Android/iOS: numerado (Evolution) e botões (Whapi)", () => {
  const numbered = buildAppStoreNumberedMessage("https://club.igreenenergy.com.br/?id=1");
  assertEquals(numbered.includes("*1.*"), true);
  assertEquals(numbered.includes("*2.*"), true);
  assertEquals(numbered.includes("play.google.com"), true);
  assertEquals(numbered.includes("apps.apple.com"), true);
  const prompt = buildAppStoreButtonsPrompt("https://club.igreenenergy.com.br/?id=1");
  assertEquals(prompt.includes("qual celular"), true);
  assertEquals(resolveBoletoAppStoreChoice({ buttonId: BOLETO_APP_ANDROID_BUTTON_ID }), "android");
  assertEquals(resolveBoletoAppStoreChoice({ buttonId: BOLETO_APP_IOS_BUTTON_ID }), "ios");
  assertEquals(resolveBoletoAppStoreChoice({ text: "iphone" }), "ios");
  // "1" fica pro Receber boleto — não confundir com Android
  assertEquals(resolveBoletoAppStoreChoice({ text: "1" }), null);
});

Deno.test("convite do botão em mensagem própria", () => {
  assertEquals(
    buildBoletoButtonPrompt("Receber boleto"),
    "Quer o boleto aqui no Zap? É só tocar em *Receber boleto* 👇",
  );
  assertEquals(
    buildBoletoButtonPrompt(""),
    "Quer o boleto aqui no Zap? É só tocar em *Receber boleto* 👇",
  );
});

Deno.test("texto legado perde a CTA duplicada do botão", () => {
  const legado = [
    "Seu acesso no Club:",
    "https://club.igreenenergy.com.br/?id=1",
    "",
    "Se quiser o boleto aqui no Zap, toque em *Receber boleto* (ou digite *1*).",
  ].join("\n");
  assertEquals(
    stripBoletoButtonCta(legado),
    "Seu acesso no Club:\nhttps://club.igreenenergy.com.br/?id=1",
  );
  // Texto já limpo não deve ser alterado.
  const limpo = "Seu acesso no Club:\nhttps://club.igreenenergy.com.br/?id=1";
  assertEquals(stripBoletoButtonCta(limpo), limpo);
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

Deno.test("FAQ medo aponta Club e não oferece arquivo no Zap", () => {
  const faq = buildBoletoFearFaqReply({ name: "Ana", nameSource: "manual", igreenCode: "99" });
  assertEquals(faq.includes("iGreen Club"), true);
  assertEquals(/receber\s+boleto/i.test(faq), false);
  assertEquals(/\bPDF\b/i.test(faq), false);
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

Deno.test("buildBoletoAudioSpoken personaliza Oi Nome no roteiro Sofia", () => {
  const out = buildBoletoAudioSpoken({
    audioBody: "Oi! Tudo bem?\n\nAqui é a Sofia, assistente virtual do seu consultor.",
    name: "Maria Silva",
    nameSource: "manual",
  });
  assertEquals(out.startsWith("Oi, Maria! Tudo bem?"), true);
  assertEquals(out.includes("Aqui é a Sofia"), true);
  assertEquals(out.includes("PDF"), false);
  const legado = buildBoletoAudioSpoken({
    audioBody: "seu boleto já está ativo.",
    name: "Maria Silva",
    nameSource: "manual",
  });
  assertEquals(legado.startsWith("Oi, Maria! Tudo bem?"), true);
});

Deno.test("shouldRunBoletoNotifyNow hora", () => {
  const at8 = new Date("2026-08-06T11:00:00.000Z");
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 8, cron_daily: true }, at8), true);
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 9, cron_daily: true }, at8), false);
});
