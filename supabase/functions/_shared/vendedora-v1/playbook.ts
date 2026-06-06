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
    cetico:      T("abertura_padrao", "consultivo_seguro", "Olá + apresentação no nome do consultor + benefício curto + 'posso te chamar como?'. Sem pedir nome formal nem fazer pitch longo."),
    interessado: T("abertura_padrao", "energetico_direto", "Olá + apresentação + benefício + 'posso te chamar como?'. Tom leve e direto."),
    comprador:   T("abertura_padrao", "objetivo", "Olá curto + nome do consultor + benefício + 'posso te chamar como?'."),
    indeciso:    T("abertura_padrao", "acolhedor_firme", "Olá + apresentação + benefício + 'posso te chamar como?'. Acolhedor."),
    reclamao:    T("abertura_padrao", "empatico", "Olá + apresentação + benefício (foco em aliviar conta) + 'posso te chamar como?'."),
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
    cetico:      T("apresentar_numero_e_qualificar", "consultivo_seguro", "Faixa 8-20% + número R$. Pergunta consultiva. NUNCA pedir foto neste turno."),
    interessado: T("apresentar_numero_e_qualificar", "energetico_direto", "Faixa 8-20% + número + 'faz sentido?'. NUNCA pedir foto neste turno."),
    comprador:   T("apresentar_numero_e_qualificar", "objetivo", "Faixa 8-20% + número. Pergunta curta. NUNCA pedir foto neste turno."),
    indeciso:    T("apresentar_numero_com_prova", "acolhedor_firme", "Faixa 8-20% + número + ANEEL. Pergunta consultiva. NUNCA pedir foto neste turno."),
    reclamao:    T("apresentar_numero_aliviando", "empatico", "Faixa 8-20% mostrando alívio vs reclamação. NUNCA pedir foto neste turno."),
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
    indeciso:    T("pedir_doc_reforcando_proximidade", "acolhedor_firme", "'Quase lá, só falta doc e e-mail.'"),
    reclamao:    T("pedir_doc_acalmando", "empatico", ""),
  },
  email: {
    cetico:      T("pedir_email_explicando_uso", "transparente", "E-mail é só pra receber o contrato e 2ª via."),
    interessado: T("pedir_email_direto", "leve_direto", "'Me passa seu melhor e-mail pra eu travar seu cadastro 📧'"),
    comprador:   T("pedir_email_direto", "objetivo", ""),
    indeciso:    T("pedir_email_reforcando_fim", "acolhedor_firme", "'Última info: e-mail e tá tudo certo.'"),
    reclamao:    T("pedir_email_acalmando", "empatico", "'Falta só o e-mail e finalizo seu cadastro agora.'"),
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
