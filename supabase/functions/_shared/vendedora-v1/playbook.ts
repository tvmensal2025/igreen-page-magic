// Playbook: para cada (etapa × perfil), jogada recomendada.
// Não é absoluto — o Planner pode discordar, mas começa daqui.

import type { Etapa, Perfil } from "./types.ts";

export interface PlaybookEntry {
  jogada: string;
  tom: string;
  detalhe: string;
}

const T = (jogada: string, tom: string, detalhe: string): PlaybookEntry => ({ jogada, tom, detalhe });

export const PLAYBOOK: Record<Etapa, Partial<Record<Perfil, PlaybookEntry>>> = {
  interesse: {
    cetico:      T("provar_credibilidade", "consultivo_seguro", "ANEEL + 80mil clientes, sem obra. Pergunta de interesse no fim."),
    interessado: T("abrir_funil_simulacao", "energetico_direto", "Oferecer simulação imediata."),
    comprador:   T("ir_direto_ao_nome", "objetivo", "Pular conversa fiada, pedir nome."),
    indeciso:    T("provar_e_perguntar_interesse", "acolhedor_firme", "Tirar dúvida em 1 linha + CTA."),
    reclamao:    T("validar_e_redirecionar", "empatico", "Reconhecer reclamação, mostrar valor."),
  },
  nome: {
    cetico:      T("explicar_porque_nome", "transparente", "Por que precisa do nome (simulação personalizada)."),
    interessado: T("pedir_nome", "leve_direto", "Direto: 'pra simular, qual seu nome?'"),
    comprador:   T("pedir_nome", "objetivo", ""),
    indeciso:    T("pedir_nome_com_gancho", "acolhedor_firme", "Reforça benefício antes de pedir nome."),
    reclamao:    T("pedir_nome_com_promessa", "empatico", "'Pra te dar atenção certa, qual seu nome?'"),
  },
  valor: {
    cetico:      T("pedir_valor_com_garantia", "transparente", "Garante que é só pra calcular, sem compromisso."),
    interessado: T("pedir_valor", "energetico_direto", "Direto: 'valor médio da conta?'"),
    comprador:   T("pedir_valor", "objetivo", ""),
    indeciso:    T("pedir_valor_com_gancho", "acolhedor_firme", "Lembra do benefício antes."),
    reclamao:    T("pedir_valor_resolvendo", "empatico", "'Pra te ajudar a baixar essa conta, qual o valor?'"),
  },
  simulacao: {
    cetico:      T("apresentar_numero_com_fonte", "consultivo_seguro", "20% da ANEEL. Mostrar economia anual."),
    interessado: T("apresentar_numero_com_cta", "energetico_direto", "Número + 'manda a foto da conta pra travar'."),
    comprador:   T("apresentar_numero_e_pedir_foto", "objetivo", ""),
    indeciso:    T("apresentar_numero_com_prova", "acolhedor_firme", "Número + prova social + CTA suave."),
    reclamao:    T("apresentar_numero_aliviando", "empatico", "Mostrar quanto economiza vs reclamação."),
  },
  foto_conta: {
    cetico:      T("explicar_uso_da_foto", "transparente", "Pra confirmar distribuidora + valor exato."),
    interessado: T("pedir_foto_direta", "leve_direto", "'Manda a foto da conta 📷'"),
    comprador:   T("pedir_foto_direta", "objetivo", ""),
    indeciso:    T("pedir_foto_reforcando_facilidade", "acolhedor_firme", "'2 minutos, só foto da conta.'"),
    reclamao:    T("pedir_foto_promessa_rapida", "empatico", ""),
  },
  doc: {
    cetico:      T("pedir_doc_explicando_seguranca", "transparente", "Dados ANEEL, criptografia. Frente do RG/CNH."),
    interessado: T("pedir_doc_direto", "leve_direto", "'Foto da frente do RG ou CNH 📄'"),
    comprador:   T("pedir_doc_direto", "objetivo", ""),
    indeciso:    T("pedir_doc_reforcando_proximidade", "acolhedor_firme", "'Última etapa, doc e tá feito.'"),
    reclamao:    T("pedir_doc_acalmando", "empatico", ""),
  },
  finalizando: {
    cetico:      T("confirmar_e_resumir", "transparente", ""),
    interessado: T("confirmar_e_celebrar", "energetico_direto", ""),
    comprador:   T("confirmar_objetivo", "objetivo", ""),
    indeciso:    T("confirmar_tranquilizar", "acolhedor_firme", ""),
    reclamao:    T("confirmar_e_garantir_suporte", "empatico", ""),
  },
  pos_cadastro: {
    cetico:      T("agradecer_e_proximos_passos", "transparente", ""),
    interessado: T("agradecer_celebrar", "energetico_direto", ""),
    comprador:   T("agradecer_objetivo", "objetivo", ""),
    indeciso:    T("agradecer_reforcar_seguranca", "acolhedor_firme", ""),
    reclamao:    T("agradecer_garantir_suporte", "empatico", ""),
  },
};

export function recommendedPlay(etapa: Etapa, perfil: Perfil | null | undefined): PlaybookEntry {
  const p = (perfil || "interessado") as Perfil;
  return PLAYBOOK[etapa]?.[p] || { jogada: "avancar_funil", tom: "consultivo_seguro", detalhe: "" };
}
