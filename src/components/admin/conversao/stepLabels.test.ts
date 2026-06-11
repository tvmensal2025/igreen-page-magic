import { describe, it, expect } from "vitest";
import { stepLabel, STEP_LABELS } from "./stepLabels";

describe("stepLabel — nunca mostra código cru", () => {
  it("usa o dicionário quando existe", () => {
    expect(stepLabel("aguardando_conta")).toBe("Esperando a foto da conta");
    expect(stepLabel("welcome")).toBe("Início da conversa");
    expect(stepLabel("finalizando")).toBe("Finalizando o cadastro");
  });

  it("nulo/vazio vira 'Sem etapa definida'", () => {
    expect(stepLabel(null)).toBe(STEP_LABELS.sem_etapa);
    expect(stepLabel(undefined)).toBe(STEP_LABELS.sem_etapa);
  });

  it("UUID sem título carregado vira 'Passo do fluxo' (não código)", () => {
    expect(stepLabel("6226f6f3-e655-4cc9-af20-d8c28c998160")).toBe("Passo do fluxo");
    expect(stepLabel("flow:c87d76f8-f4d2-48ec-ac08-4ef0b3c92834")).toBe("Passo do fluxo");
  });

  it("UUID com título carregado usa o título do construtor", () => {
    const map = new Map([["6226f6f3-e655-4cc9-af20-d8c28c998160", "Boas-vindas"]]);
    expect(stepLabel("6226f6f3-e655-4cc9-af20-d8c28c998160", map)).toBe("Boas-vindas");
    const map2 = new Map([["c87d76f8-f4d2-48ec-ac08-4ef0b3c92834", "Como funciona"]]);
    expect(stepLabel("flow:c87d76f8-f4d2-48ec-ac08-4ef0b3c92834", map2)).toBe("Como funciona");
  });

  it("step desconhecido vira Title Case legível, nunca snake_case", () => {
    expect(stepLabel("novo_passo_qualquer")).toBe("Novo passo qualquer");
    expect(stepLabel("etapa_x")).toBe("Etapa x");
  });

  it("nenhum step real do banco retorna o código cru", () => {
    const reais = [
      "sem_etapa", "aguardando_humano", "aguardando_conta", "welcome",
      "aguardando_doc_auto", "flow:b1a53333-3333-4333-8333-000000000003",
      "finalizando", "corrigir_celular_portal", "6226f6f3-e655-4cc9-af20-d8c28c998160",
      "aguardando_documento", "aguardando_otp",
    ];
    for (const s of reais) {
      const label = stepLabel(s);
      expect(label).not.toBe(s); // nunca igual ao código
      expect(label.length).toBeGreaterThan(1);
    }
  });
});
