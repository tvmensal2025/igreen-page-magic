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
  buildClubAccessLine,
  buildClubLink,
  stripBoletoButtonCta,
  isBoletoFearOrDoubtText,
  isBoletoReceberDocIntent,
  isBoletoStatusPago,
  normalizeClubAccessEmail,
  parseMesFromStageKey,
  renderBoletoNotifyTemplate,
  shouldRunBoletoNotifyNow,
} from "./boleto-notify.ts";

Deno.test("stage_key boleto_chegou", () => {
  assertEquals(boletoChegouStageKey("03/2026"), "boleto_chegou:03/2026");
  assertEquals(parseMesFromStageKey("boleto_chegou:03/2026"), "03/2026");
});

Deno.test("apps Android/iOS: numerado (Evolution) e botões (Whapi)", () => {
  const numbered = buildAppStoreNumberedMessage("maria@example.com");
  assertEquals(numbered.includes("*1.*"), true);
  assertEquals(numbered.includes("*2.*"), true);
  assertEquals(numbered.includes("play.google.com"), true);
  assertEquals(numbered.includes("apps.apple.com"), true);
  // Acesso vai pelo e-mail — nunca o link com id do cliente.
  assertEquals(numbered.includes("maria@example.com"), true);
  assertEquals(numbered.includes("club.igreenenergy.com.br"), false);
  const prompt = buildAppStoreButtonsPrompt("maria@example.com");
  assertEquals(prompt.includes("qual celular"), true);
  assertEquals(prompt.includes("club.igreenenergy.com.br"), false);
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

Deno.test("acesso ao Club: e-mail do cadastro, com fallback sem link", () => {
  assertEquals(normalizeClubAccessEmail(" Maria@Example.COM "), "maria@example.com");
  assertEquals(normalizeClubAccessEmail("nao-e-email"), null);
  assertEquals(normalizeClubAccessEmail(null), null);

  const comEmail = buildClubAccessLine("maria@example.com");
  assertEquals(comEmail.includes("maria@example.com"), true);

  const semEmail = buildClubAccessLine(null);
  assertEquals(semEmail.includes("e-mail do seu cadastro"), true);
  assertEquals(semEmail.includes("http"), false);
  // Lixo no cadastro não vira acesso inventado.
  assertEquals(buildClubAccessLine("sem arroba"), semEmail);
});

Deno.test("boleto pago não vira aviso", () => {
  assertEquals(isBoletoStatusPago("pago"), true);
  assertEquals(isBoletoStatusPago("PAGO"), true);
  assertEquals(isBoletoStatusPago("baixado"), true);
  assertEquals(isBoletoStatusPago("liquidado"), true);
  assertEquals(isBoletoStatusPago("disponivel"), false);
  assertEquals(isBoletoStatusPago("vencido"), false);
  assertEquals(isBoletoStatusPago(null), false);
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
  const faq = buildBoletoFearFaqReply({
    name: "Ana",
    nameSource: "manual",
    igreenCode: "99",
    email: "ana@example.com",
  });
  assertEquals(faq.includes("iGreen Club"), true);
  assertEquals(faq.includes("ana@example.com"), true);
  assertEquals(faq.includes("club.igreenenergy.com.br"), false);
  assertEquals(/receber\s+boleto/i.test(faq), false);
  assertEquals(/\bPDF\b/i.test(faq), false);
});

Deno.test("template renderiza mes e saudacao", () => {
  const out = renderBoletoNotifyTemplate(
    "{{saudacao}}boleto de *{{mes}}* no app {{email_acesso}}",
    { name: "Maria", nameSource: "manual", mes: "03/2026", emailAcesso: "maria@example.com" },
  );
  assertEquals(out.includes("PDF"), false);
  assertEquals(out.includes("03/2026"), true);
  assertEquals(out.includes("Maria"), true);
  assertEquals(out.includes("maria@example.com"), true);
});

Deno.test("template legado: {{link_club}} virou e-mail, não link", () => {
  const out = renderBoletoNotifyTemplate(
    "Seu acesso no Club:\n{{link_club}}",
    { name: null, nameSource: null, emailAcesso: "maria@example.com" },
  );
  assertEquals(out.includes("maria@example.com"), true);
  assertEquals(out.includes("club.igreenenergy.com.br"), false);

  const semEmail = renderBoletoNotifyTemplate(
    "Seu acesso no Club:\n{{link_club}}",
    { name: null, nameSource: null },
  );
  assertEquals(semEmail.includes("http"), false);
});

Deno.test("template injeta Play Store e App Store", () => {
  const out = renderBoletoNotifyTemplate(
    "Android {{link_play}}\niPhone {{link_appstore}}",
    { name: null, nameSource: null },
  );
  assertEquals(out.includes("play.google.com/store/apps/details?id=com.embarcadero.iGreenConnect"), true);
  assertEquals(out.includes("apps.apple.com/br/app/igreen-club/id6444493340"), true);
});

Deno.test("buildBoletoAudioSpoken: Olá Nome + IA/consultor da conta", () => {
  const out = buildBoletoAudioSpoken({
    audioBody:
      "Aqui é {{assistente}}, assistente virtual {{posse_consultor}}. Chame {{chamar_consultor}}.",
    name: "Maria Silva",
    nameSource: "manual",
    assistantName: "Sofia",
    consultantName: "Rafael Ferreira",
    consultantDisplayName: "Abel Olympio", // display de outra pessoa → ignora
    consultantGender: "consultor",
  });
  assertEquals(out.startsWith("Olá, Maria! Tudo bem?"), true);
  assertEquals(out.includes("Aqui é Sofia, assistente virtual do Rafael"), true);
  assertEquals(out.includes("Chame o Rafael"), true);
  assertEquals(out.includes("Abel"), false);
  assertEquals(out.includes("PDF"), false);
});

Deno.test("shouldRunBoletoNotifyNow hora", () => {
  const at8 = new Date("2026-08-06T11:00:00.000Z");
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 8, cron_daily: true }, at8), true);
  assertEquals(shouldRunBoletoNotifyNow({ cron_hour_brt: 9, cron_daily: true }, at8), false);
});
