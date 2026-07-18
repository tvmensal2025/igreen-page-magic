import { describe, expect, it } from "vitest";
import {
  AFTER_CLUB_BUTTONS,
  AFTER_EXPLAIN_BUTTONS,
  AVAILABILITY_BODY_KEYS,
  DEFAULT_AVAILABILITY_PHRASES,
  MULTICHANNEL_CADENCE_TEMPLATES,
  SMS_CONSULTOR_WA_LINK,
  WHAPI_MAX_BUTTONS,
  allAudioSegmentsApproved,
  assertCatalogWhapiSafe,
  availabilityOverridesFromLibrary,
  buildAvailabilityPhrase,
  cadenceAudioUrlKey,
  cadenceBodyAudioUrlKey,
  emptyLibrary,
  ensureSmsConsultorWaLink,
  filterSegmentsForGender,
  hasGeneratedCadenceAudio,
  inferSpeechGender,
  isSofiaStitchMediaSlot,
  renderCadenceBody,
  resolveBody,
  sofiaUploadTargetSlot,
  spokenSegmentText,
  stepMediaLookupKeys,
} from "./multichannelCadenceTexts";

describe("Whapi safety", () => {
  it("catálogo seguro", () => {
    expect(assertCatalogWhapiSafe()).toEqual([]);
  });

  it("nenhum passo > 3 botões", () => {
    for (const t of MULTICHANNEL_CADENCE_TEMPLATES) {
      expect(t.buttons?.length ?? 0, t.key).toBeLessThanOrEqual(WHAPI_MAX_BUTTONS);
    }
  });
});

describe("Fluxo A — 3 esperas (nome → valor → explicação)", () => {
  it("não existe mais passo 3b de correção de valor", () => {
    expect(MULTICHANNEL_CADENCE_TEMPLATES.some((t) => t.key === "a3b_ask_correct_value")).toBe(
      false,
    );
  });

  it("1 pede nome e aguarda (sem botão)", () => {
    const a1 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a1_ask_name");
    expect(a1?.buttons ?? []).toHaveLength(0);
    expect(a1?.timing.toLowerCase()).toContain("aguarda");
    expect(a1?.body).toMatch(/nome/i);
    expect(a1?.body).toMatch(/agilizar seu atendimento/i);
    expect(a1?.body).toBe(
      "*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.",
    );
  });

  it("2 áudio+texto chamam pelo nome e pedem valor", () => {
    const audio = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_audio_activate_name");
    const text = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_text_ask_bill_value");
    expect(audio?.body).toContain("{{nome}}");
    expect(audio?.body).toMatch(/Olá,\s*\{\{nome\}\}/);
    expect(audio?.body).toMatch(/gestor da iGreen/i);
    expect(audio?.body).toMatch(/economizar|conta de luz/i);
    expect(audio?.audioSegments?.[0]?.text).toMatch(/Olá/i);
    expect(audio?.audioSegments?.some((s) => s.id === "a2_activate")).toBe(false);
    expect(text?.body).toContain("{{nome}}");
    expect(text?.body).toMatch(/ativar o seu benefício/i);
    expect(text?.timing.toLowerCase()).toContain("aguarda");
  });

  it("3 unificado: texto desconto + áudio com nome + É simples + botões", () => {
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons");
    const audioLegacy = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_audio_explain");
    expect(a3?.canGenerateAudio).toBe(true);
    expect(a3?.audioPlacement).toBe("before_text");
    expect(a3?.pairedAudioKey).toBeUndefined();
    expect(a3?.buttons?.map((b) => b.id)).toEqual(
      AFTER_EXPLAIN_BUTTONS.map((b) => b.id),
    );
    expect(a3?.body).toContain("{{valor_conta}}");
    expect(a3?.body).toContain("{{economia_range}}");
    expect(a3?.body).toContain("{{nome}}");
    expect(a3?.body).toMatch(/8% a 20%/i);
    expect(a3?.body).toMatch(/\*O que você prefere agora\*?/i);
    expect(a3?.body).not.toMatch(/fazendas solares/i);
    expect(a3?.body).not.toMatch(/Nenhum consultor pede depósito/i);
    expect(a3?.audioSegments?.[0]?.kind).toBe("name");
    expect(a3?.audioSegments?.[0]?.text).toBe("{{nome}}.");
    expect(a3?.audioSegments?.some((s) => s.kind === "name" && s.text.includes("{{nome}}"))).toBe(
      true,
    );
    expect(a3?.audioSegments?.some((s) => /É simples/i.test(s.text))).toBe(true);
    expect(a3?.audioSegments?.some((s) => /fazendas solares/i.test(s.text))).toBe(true);
    expect(audioLegacy?.hiddenInPanel).toBe(true);
  });

  it("todos os áudios do Grupo A com cumprimento citam {{nome}}", () => {
    const greeters = MULTICHANNEL_CADENCE_TEMPLATES.filter(
      (t) =>
        t.group === "A" &&
        (t.channel === "whatsapp_audio" || t.channel === "call_script") &&
        t.audioSegments?.some((s) => s.kind === "name"),
    );
    expect(greeters.length).toBeGreaterThan(0);
    for (const t of greeters) {
      expect(t.body, t.key).toContain("{{nome}}");
    }
  });

  it("após clube: Cadastrar / Humano", () => {
    const a5b = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a5b_after_club_buttons");
    expect(a5b?.buttons?.map((b) => b.id)).toEqual(AFTER_CLUB_BUTTONS.map((b) => b.id));
  });

  it("há slots opcionais de SMS e ligação para o construtor", () => {
    expect(MULTICHANNEL_CADENCE_TEMPLATES.some((t) => t.key === "a_optional_sms_slot")).toBe(true);
    expect(MULTICHANNEL_CADENCE_TEMPLATES.some((t) => t.key === "a_optional_call_slot")).toBe(true);
  });

  it("todo SMS do catálogo tem https://wa.me do consultor", () => {
    const sms = MULTICHANNEL_CADENCE_TEMPLATES.filter((t) => t.channel === "sms");
    expect(sms.length).toBeGreaterThan(0);
    for (const t of sms) {
      // Slots de tema (`{{tema_sms}}`) recebem o link via ensureSmsConsultorWaLink.
      if (!/\{\{\s*tema_sms\s*\}\}/i.test(t.body)) {
        expect(t.body, t.key).toMatch(/https:\/\/wa\.me\/\{\{\s*consultor_phone\s*\}\}/i);
      }
      const resolved = resolveBody(t, emptyLibrary());
      expect(resolved, t.key).toContain(SMS_CONSULTOR_WA_LINK);
      expect(
        renderCadenceBody(resolved, { nome: "Maria", consultorPhone: "5511989000650" }),
        t.key,
      ).toContain("https://wa.me/5511989000650");
    }
  });

  it("ensureSmsConsultorWaLink acrescenta link se faltar e força https", () => {
    expect(ensureSmsConsultorWaLink("Oi {{nome}}")).toBe(`Oi {{nome}} ${SMS_CONSULTOR_WA_LINK}`);
    expect(ensureSmsConsultorWaLink(`Oi ${SMS_CONSULTOR_WA_LINK}`)).toBe(
      `Oi ${SMS_CONSULTOR_WA_LINK}`,
    );
    expect(ensureSmsConsultorWaLink("Oi wa.me/")).toBe(`Oi ${SMS_CONSULTOR_WA_LINK}`);
    expect(ensureSmsConsultorWaLink("Oi wa.me/{{consultor_phone}}")).toBe(
      `Oi ${SMS_CONSULTOR_WA_LINK}`,
    );
  });

  it("normaliza celular BR sem 9º dígito no link do SMS", () => {
    const out = renderCadenceBody("Abra: {{link_wa}}", {
      nome: "Maria",
      consultorPhone: "553484314317",
    });
    expect(out).toContain("https://wa.me/5534984314317");
    expect(out).not.toContain("wa.me/553484314317");
  });

  it("áudios: no máx. 1 corte de nome + 1 corpo por gênero (ou só corpo)", () => {
    const audios = MULTICHANNEL_CADENCE_TEMPLATES.filter(
      (t) =>
        t.canGenerateAudio &&
        !t.hiddenInPanel &&
        (t.channel === "whatsapp_audio" ||
          t.channel === "call_script" ||
          (t.audioSegments?.length ?? 0) > 0),
    );
    expect(audios.length).toBeGreaterThan(0);
    for (const t of audios) {
      const segs = t.audioSegments ?? [];
      expect(segs.length, t.key).toBeGreaterThan(0);
      const genderBodies = segs.filter((s) => s.genderVariant);
      if (genderBodies.length) {
        expect(genderBodies.map((s) => s.genderVariant).sort(), t.key).toEqual([
          "feminino",
          "masculino",
        ]);
        for (const g of ["feminino", "masculino"] as const) {
          const filtered = filterSegmentsForGender(segs, g);
          const maxSegs = 2;
          expect(filtered.length, `${t.key}:${g}`).toBeLessThanOrEqual(maxSegs);
          const names = filtered.filter((s) => s.kind === "name" || s.kind === "with_name");
          const maxNames = 1;
          expect(names.length, `${t.key}:${g}`).toBeLessThanOrEqual(maxNames);
          if (names.length === 1) {
            expect(["name", "with_name"]).toContain(filtered[0]?.kind);
            expect(filtered[1]?.kind, `${t.key}:${g}`).toBe("fixed");
            expect(filtered[1]?.genderVariant, `${t.key}:${g}`).toBe(g);
          }
        }
        continue;
      }
      // Passo 3: nome + corpo = 2 cortes (sem Então).
      const maxSegs = 2;
      expect(segs.length, t.key).toBeLessThanOrEqual(maxSegs);
      const names = segs.filter((s) => s.kind === "name" || s.kind === "with_name");
      expect(names.length, t.key).toBeLessThanOrEqual(1);
      if (names.length === 1) {
        expect(["name", "with_name"]).toContain(segs[0]?.kind);
        expect(segs[1]?.kind, t.key).toBe("fixed");
      } else {
        expect(segs.every((s) => s.kind === "fixed"), t.key).toBe(true);
      }
    }
  });

  it("passo 2 Olá+nome + corpos M/F; passos 3/4a só nome + corpo fixo", () => {
    const a2 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_audio_activate_name");
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons");
    const a5 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a5_audio_club_benefits");
    expect(a2?.audioSegments?.length).toBe(3);
    expect(a2?.audioSegments?.[0]?.kind).toBe("name");
    expect(a2?.audioSegments?.[0]?.text).toBe("Olá, {{nome}}.");
    expect(a2?.audioSegments?.filter((s) => s.genderVariant).length).toBe(2);
    expect(a3?.audioSegments?.length).toBe(2);
    expect(a3?.audioSegments?.[0]?.kind).toBe("name");
    expect(a3?.audioSegments?.[0]?.text).toBe("{{nome}}.");
    expect(a3?.audioSegments?.[1]?.kind).toBe("fixed");
    expect(a3?.audioSegments?.some((s) => /então/i.test(s.text))).toBe(false);
    expect(a5?.audioSegments?.length).toBe(2);
    expect(a5?.audioSegments?.[0]?.kind).toBe("name");
    expect(a5?.audioSegments?.[0]?.text).toBe("{{nome}}.");
    expect(a5?.audioSegments?.[1]?.kind).toBe("fixed");
    expect(a5?.audioSegments?.some((s) => s.kind === "name")).toBe(true);
  });

  it("spokenSegmentText Então, Nome. (legado)", () => {
    const out = spokenSegmentText(
      { id: "x", kind: "name", label: "", text: "Então, {{nome}}." },
      { nome: "Maria Silva" },
    );
    expect(out).toBe("Então, Maria.");
  });

  it("texto+botões apontam áudio parceiro acima (exceto passo 3 unificado)", () => {
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons");
    const a5b = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a5b_after_club_buttons");
    expect(a3?.pairedAudioKey).toBeUndefined();
    expect(a3?.canGenerateAudio).toBe(true);
    expect(a5b?.pairedAudioKey).toBe("a5_audio_club_benefits");
  });

  it("passo 2 usa Olá+nome; passos 3 e 4a só o nome", () => {
    const a2 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_audio_activate_name");
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons");
    expect(a2?.audioSegments?.find((s) => s.kind === "name")?.text).toBe("Olá, {{nome}}.");
    expect(a3?.audioSegments?.find((s) => s.kind === "name")?.text).toBe("{{nome}}.");
  });

  it("spokenSegmentText com {{nome}} puro = só o nome (passo 3)", () => {
    const out = spokenSegmentText(
      { id: "x", kind: "name", label: "", text: "{{nome}}" },
      { nome: "Maria Silva" },
    );
    expect(out).toBe("Maria.");
  });

  it("spokenSegmentText com Olá, {{nome}}. (passo 2)", () => {
    const out = spokenSegmentText(
      { id: "x", kind: "name", label: "", text: "Olá, {{nome}}." },
      { nome: "Maria Silva" },
    );
    expect(out).toBe("Olá, Maria.");
  });

  it("2a tem corpos fixos Sofia/Rafael gestor (2 áudios M/F)", () => {
    const a2 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_audio_activate_name");
    const f = a2?.audioSegments?.find((s) => s.genderVariant === "feminino")?.text ?? "";
    const m = a2?.audioSegments?.find((s) => s.genderVariant === "masculino")?.text ?? "";
    expect(f).toMatch(/gestor da iGreen/i);
    expect(m).toMatch(/gestor da iGreen/i);
    expect(f).toMatch(/Rafael, gestor/i);
    expect(f).not.toContain("{{bem_vindo}}");
    expect(m).not.toContain("{{bem_vindo}}");
    expect(cadenceAudioUrlKey("a2_audio_activate_name", "feminino")).toBe(
      "a2_audio_activate_name__feminino",
    );
  });

  it("boas-vindas respeitam gênero M/F", () => {
    const m = renderCadenceBody("Seja muito {{bem_vindo}}.", {
      nome: "João",
      gender: "masculino",
    });
    const f = renderCadenceBody("Seja muito {{bem_vindo}}.", {
      nome: "Maria",
      gender: "feminino",
    });
    expect(m).toContain("bem-vindo");
    expect(f).toContain("bem-vinda");
  });

  it("inferSpeechGender: Rafael masculino, Maria feminino, Luca exceção", () => {
    expect(inferSpeechGender("Rafael")).toBe("masculino");
    expect(inferSpeechGender("Rodrigo")).toBe("masculino");
    expect(inferSpeechGender("Maria")).toBe("feminino");
    expect(inferSpeechGender("Ana Paula")).toBe("feminino");
    expect(inferSpeechGender("Luca")).toBe("masculino");
    expect(inferSpeechGender("Joana")).toBe("feminino");
  });

  it("inferSpeechGender: nomes -ene/-ine são femininos (Sirlene nunca masculino)", () => {
    expect(inferSpeechGender("Sirlene")).toBe("feminino");
    expect(inferSpeechGender("Marlene")).toBe("feminino");
    expect(inferSpeechGender("Irene")).toBe("feminino");
    expect(inferSpeechGender("Darlene")).toBe("feminino");
    expect(inferSpeechGender("Aline")).toBe("feminino");
    expect(inferSpeechGender("Clarice")).toBe("feminino");
    expect(inferSpeechGender("Jaqueline")).toBe("feminino");
    expect(inferSpeechGender("Lucia")).toBe("feminino");
    expect(inferSpeechGender("Rafaela")).toBe("feminino");
    // masculino explícito não vira F por sufixo
    expect(inferSpeechGender("Rene")).toBe("masculino");
    expect(inferSpeechGender("Michel")).toBe("masculino");
  });

  it("cadenceBodyAudioUrlKey marca corpo sem nome", () => {
    expect(cadenceBodyAudioUrlKey("a2_audio_activate_name", "masculino")).toBe(
      "a2_audio_activate_name__body_masculino",
    );
  });

  it("abertura Sofia entra no corpo fixo dos áudios com cumprimento", () => {
    const a2 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a2_audio_activate_name");
    const bodies = a2?.audioSegments?.filter((s) => s.kind === "fixed") ?? [];
    expect(bodies.length).toBe(2);
    for (const body of bodies) {
      expect(body.text).toMatch(/Eu sou a Sofia, assistente virtual/i);
    }
  });

  it("render preenche nome e valor", () => {
    const out = renderCadenceBody("Oi {{nome}} · R$ {{valor_formatado}}", {
      nome: "Maria",
      valorFormatado: "500",
    });
    expect(out).toContain("Maria");
    expect(out).toContain("500");
  });

  it("render passo 3: valor_conta + economia_range", () => {
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons");
    expect(a3?.audioPlacement).toBe("before_text");
    const out = renderCadenceBody(a3!.body, {
      nome: "Maria",
      valorConta: "500",
      economiaMin: "40",
      economiaMax: "100",
    });
    expect(out).toContain("Maria");
    expect(out).toContain("R$ 500");
    expect(out).toContain("R$ 40 a R$ 100");
    expect(out).not.toContain("{{valor_conta}}");
    expect(out).not.toContain("{{economia_range}}");
  });

  it("stepMediaLookupKeys inclui corpos A2/A3 para o painel de mídias", () => {
    const a2 = stepMediaLookupKeys("a2_audio_activate_name");
    expect(a2).toContain("a2_audio_activate_name__body_feminino");
    expect(a2).toContain("a2_audio_activate_name__body_masculino");
    expect(isSofiaStitchMediaSlot("a3_explain_with_buttons")).toBe(true);
    expect(sofiaUploadTargetSlot("a2_audio_activate_name", "masculino")).toBe(
      "a2_audio_activate_name__body_masculino",
    );
  });

  it("allAudioSegmentsApproved: MP3 já gerado conta como Ok (evita falso bloqueio)", () => {
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons")!;
    const lib = emptyLibrary();
    expect(allAudioSegmentsApproved(a3, lib)).toBe(false);
    lib.audioUrls[a3.key] = "https://example.com/a3.mp3";
    expect(hasGeneratedCadenceAudio(a3.key, lib)).toBe(true);
    expect(allAudioSegmentsApproved(a3, lib)).toBe(true);
  });

  it("resolveBody ignora body salvo vazio e volta ao catálogo", () => {
    const a3 = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === "a3_explain_with_buttons")!;
    const lib = emptyLibrary();
    lib.bodies[a3.key] = "   ";
    expect(resolveBody(a3, lib)).toContain("{{valor_conta}}");
  });
});

describe("Disponibilidade — {{frase_disponibilidade}}", () => {
  it("catálogo tem 4 frases alinhadas aos defaults", () => {
    for (const [slot, key] of Object.entries(AVAILABILITY_BODY_KEYS) as Array<
      [keyof typeof DEFAULT_AVAILABILITY_PHRASES, string]
    >) {
      const tpl = MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
      expect(tpl?.body, key).toBe(DEFAULT_AVAILABILITY_PHRASES[slot]);
    }
  });

  it("usa override da biblioteca quando existir", () => {
    const lib = emptyLibrary();
    lib.bodies.availability_before_1630 = "Atendo hoje até 18h, {{nome}}.";
    const overrides = availabilityOverridesFromLibrary(lib);
    // 10:00 SP ≈ 13:00 UTC (sem horário de verão)
    const noonUtc = new Date("2026-07-15T13:00:00.000Z"); // qua
    const { slot, phrase } = buildAvailabilityPhrase(noonUtc, overrides);
    expect(slot).toBe("before_1630");
    expect(phrase).toBe("Atendo hoje até 18h, {{nome}}.");
  });

  it("renderCadenceBody injeta frase da lib", () => {
    const lib = emptyLibrary();
    lib.bodies.availability_before_1630 = "Frase custom do painel.";
    const out = renderCadenceBody("Oi.\n\n{{frase_disponibilidade}}", {
      now: new Date("2026-07-15T13:00:00.000Z"),
      availabilityOverrides: availabilityOverridesFromLibrary(lib),
    });
    expect(out).toContain("Frase custom do painel.");
    expect(out).not.toContain("{{frase_disponibilidade}}");
  });

  it("fim de semana usa frase after_1800", () => {
    const sat = new Date("2026-07-18T15:00:00.000Z"); // sábado
    const { slot, phrase } = buildAvailabilityPhrase(sat);
    expect(slot).toBe("closed");
    expect(phrase).toBe(DEFAULT_AVAILABILITY_PHRASES.after_1800);
  });
});
