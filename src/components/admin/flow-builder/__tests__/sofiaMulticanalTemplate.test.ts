import { describe, expect, it } from "vitest";
import { FLOW_TEMPLATES } from "@/components/admin/flow-builder/flowTemplates";

describe("sofia_ativacao_multicanal template", () => {
  const tpl = FLOW_TEMPLATES.find((t) => t.id === "sofia_ativacao_multicanal")!;

  it("existe com 11 passos Grupo A (inclui 3b Tenho dúvida)", () => {
    expect(tpl).toBeTruthy();
    expect(tpl.steps).toHaveLength(11);
    expect(tpl.steps.map((s) => s.step_key)).toEqual([
      "a1_ask_name",
      "a2_text_ask_bill_value",
      "a3_explain_with_buttons",
      "a3b_pedir_pergunta",
      "a5b_after_club_buttons",
      "a6_ask_bill_photo",
      "a7_ask_document",
      "a8_ask_email",
      "a9_confirm_phone",
      "a10_portal_otp_facial",
      "a11_facial_link",
    ]);
  });

  it("passo 3: gotos por step_key + números Evolution", () => {
    const a3 = tpl.steps.find((s) => s.step_key === "a3_explain_with_buttons")!;
    expect(a3.media_order).toEqual(["audio", "text"]);
    const txs = a3.transitions ?? [];
    expect(txs.find((t) => t.goto_step_key === "a5b_after_club_buttons")?.trigger_phrases).toContain(
      "1",
    );
    expect(txs.find((t) => t.goto_step_key === "a6_ask_bill_photo")?.trigger_phrases).toEqual(
      expect.arrayContaining(["activate", "Ativar benefício", "2"]),
    );
    expect(txs.find((t) => t.goto_step_key === "a3b_pedir_pergunta")?.trigger_phrases).toEqual(
      expect.arrayContaining(["duvida", "Tenho dúvida", "3"]),
    );
    expect(txs.some((t) => t.goto_special === "humano")).toBe(false);
  });

  it("passo 3b: só áudio + await (chain-stop)", () => {
    const a3b = tpl.steps.find((s) => s.step_key === "a3b_pedir_pergunta")!;
    expect(a3b.media_order).toEqual(["audio"]);
    expect(a3b.captures?.some((c: any) => c?.field === "_await_question" && c?.enabled)).toBe(
      true,
    );
  });

  it("passo 4: register → conta OCR; duvida → a3b", () => {
    const a5 = tpl.steps.find((s) => s.step_key === "a5b_after_club_buttons")!;
    expect(a5.media_order).toEqual(["audio", "text"]);
    expect(
      a5.transitions?.find((t) => t.goto_step_key === "a6_ask_bill_photo")?.trigger_phrases,
    ).toEqual(expect.arrayContaining(["register", "Ativar benefício", "1"]));
    expect(
      a5.transitions?.find((t) => t.goto_step_key === "a3b_pedir_pergunta")?.trigger_phrases,
    ).toEqual(expect.arrayContaining(["duvida", "Tenho dúvida", "2"]));
    expect(
      a5.transitions?.find((t) => t.goto_special === "humano")?.trigger_phrases,
    ).toEqual(expect.arrayContaining(["human", "3"]));
  });

  it("passo 8: phone_ok → a10 portal OTP", () => {
    const a9 = tpl.steps.find((s) => s.step_key === "a9_confirm_phone")!;
    expect(
      a9.transitions?.find((t) => t.goto_step_key === "a10_portal_otp_facial")?.trigger_phrases,
    ).toContain("1");
  });

  it("passo 9 é finalizar_cadastro (portal) e 10 é message facial", () => {
    expect(tpl.steps.find((s) => s.step_key === "a10_portal_otp_facial")?.step_type).toBe(
      "finalizar_cadastro",
    );
    expect(tpl.steps.find((s) => s.step_key === "a11_facial_link")?.step_type).toBe("message");
    expect(tpl.steps.find((s) => s.step_key === "a6_ask_bill_photo")?.step_type).toBe(
      "capture_conta",
    );
    expect(tpl.steps.find((s) => s.step_key === "a7_ask_document")?.step_type).toBe(
      "capture_documento",
    );
  });
});
