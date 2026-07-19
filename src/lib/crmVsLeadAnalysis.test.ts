import { describe, expect, it } from "vitest";
import {
  classifyAnalysisBucket,
  isCrmCadastroEmAnalise,
  isLeadCycleEligibleNotCrmAnalysis,
  isMetaCampanhaEmAnalise,
} from "./crmVsLeadAnalysis";

describe("crmVsLeadAnalysis — nunca misturar", () => {
  it("Miriam (lead em conversa): pending + flow step + sem portal → NÃO é CRM em análise", () => {
    const c = {
      status: "pending",
      conversation_step: "flow:d247403b-81fd-4a2a-89f3-b8bc6f1bc9ca",
      portal_submitted_at: null,
    };
    expect(isCrmCadastroEmAnalise(c)).toBe(false);
    expect(isLeadCycleEligibleNotCrmAnalysis(c)).toBe(true);
    expect(classifyAnalysisBucket(c)).toBe("outro"); // cadence decide lead_em_conversa
  });

  it("cadastro_em_analise → CRM ativo em análise", () => {
    const c = {
      status: "pending",
      conversation_step: "cadastro_em_analise",
      portal_submitted_at: null,
    };
    expect(isCrmCadastroEmAnalise(c)).toBe(true);
    expect(isLeadCycleEligibleNotCrmAnalysis(c)).toBe(false);
    expect(classifyAnalysisBucket(c)).toBe("crm_cadastro_em_analise");
  });

  it("portal_submitted_at setado → CRM em análise mesmo com step de fluxo residual", () => {
    const c = {
      status: "pending",
      conversation_step: "AI_QUALIFYING", // lixo residual
      portal_submitted_at: "2026-07-19T12:00:00Z",
    };
    expect(isCrmCadastroEmAnalise(c)).toBe(true);
    expect(isLeadCycleEligibleNotCrmAnalysis(c)).toBe(false);
  });

  it("status=pending sozinho NÃO decide o bucket", () => {
    const lead = { status: "pending", conversation_step: null, portal_submitted_at: null };
    const crm = {
      status: "pending",
      conversation_step: "cadastro_em_analise",
      portal_submitted_at: null,
    };
    expect(isCrmCadastroEmAnalise(lead)).toBe(false);
    expect(isCrmCadastroEmAnalise(crm)).toBe(true);
  });

  it("Meta pending_review ≠ customer", () => {
    expect(isMetaCampanhaEmAnalise("pending_review")).toBe(true);
    expect(
      classifyAnalysisBucket({ meta_campaign_status: "pending_review" }),
    ).toBe("meta_campanha_em_analise");
  });

  it("nunca mais contatar (bloqueado) sai da pizza", () => {
    expect(
      isLeadCycleEligibleNotCrmAnalysis({
        status: "pending",
        do_not_contact: true,
      }),
    ).toBe(false);
    expect(
      isLeadCycleEligibleNotCrmAnalysis({
        status: "pending",
        paused_reason: "dnc",
      }),
    ).toBe(false);
  });
});
