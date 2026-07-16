/**
 * Catálogo curado de 200 copies prontos (80 headlines + 80 primary_texts + 40 descriptions).
 * Substitui a chamada obrigatória ao ad-creative-builder no Step 3 do wizard.
 * IA vira "adaptador opcional" — o catálogo já dá copy publicável em milissegundos.
 *
 * Placeholders (substituídos ao aplicar):
 *   {{distribuidora}} → nome da distribuidora quando o consultor escolheu 1
 *   {{cidade}}        → 1ª cidade escolhida
 *
 * Cada item traz:
 *   - angle: usado para diversidade (1 por ângulo nas 5 sugestões)
 *   - needsDistribuidora: só é oferecido se o consultor escolheu uma distribuidora
 *   - score base (0-100): usado para ordenar dentro do ângulo
 */

export type CopyAngle =
  | "economia_concreta"
  | "dor_pas"
  | "prova_social"
  | "quebra_objecao"
  | "curiosidade"
  | "urgencia_local"
  | "autoridade"
  | "storytelling";

export interface CatalogItem {
  id: string;
  text: string;
  angle: CopyAngle;
  framework: string;
  score: number;
  needsDistribuidora?: boolean;
}

export const ANGLE_LABEL: Record<CopyAngle, string> = {
  economia_concreta: "💰 Economia concreta",
  dor_pas: "😤 Dor / PAS",
  prova_social: "👥 Prova social",
  quebra_objecao: "🛡️ Quebra de objeção",
  curiosidade: "🔍 Curiosidade",
  urgencia_local: "⏰ Urgência local",
  autoridade: "🏛️ Autoridade",
  storytelling: "📖 Storytelling",
};

// ─────────────────────────── HEADLINES (80) ───────────────────────────
export const HEADLINES: CatalogItem[] = [
  // economia_concreta (10) — sem %/R$ (claims atraem curioso e encarecem CPL)
  { id: "h-ec-1", text: "Simule se sua conta pode baixar", angle: "economia_concreta", framework: "específico", score: 92 },
  { id: "h-ec-2", text: "Veja como pagar menos na luz", angle: "economia_concreta", framework: "específico", score: 90 },
  { id: "h-ec-3", text: "Consulte economia na sua fatura", angle: "economia_concreta", framework: "específico", score: 88 },
  { id: "h-ec-4", text: "Conta {{distribuidora}} pode baixar", angle: "economia_concreta", framework: "específico", score: 94, needsDistribuidora: true },
  { id: "h-ec-5", text: "Desconto direto no seu boleto", angle: "economia_concreta", framework: "benefício", score: 82 },
  { id: "h-ec-6", text: "Boleto de luz mais leve", angle: "economia_concreta", framework: "específico", score: 86 },
  { id: "h-ec-7", text: "Alívio na próxima fatura", angle: "economia_concreta", framework: "específico", score: 87 },
  { id: "h-ec-8", text: "Economia recorrente na luz", angle: "economia_concreta", framework: "específico", score: 84 },
  { id: "h-ec-9", text: "Conta cara? Simule no zap", angle: "economia_concreta", framework: "direto", score: 83 },
  { id: "h-ec-10", text: "Fatura mais leve todo mês", angle: "economia_concreta", framework: "benefício", score: 76 },

  // dor_pas (10)
  { id: "h-dp-1", text: "Sua conta de luz subiu de novo?", angle: "dor_pas", framework: "PAS", score: 88 },
  { id: "h-dp-2", text: "Cansada da conta alta?", angle: "dor_pas", framework: "PAS", score: 85 },
  { id: "h-dp-3", text: "Fatura de luz sem controle?", angle: "dor_pas", framework: "PAS", score: 82 },
  { id: "h-dp-4", text: "Bandeira vermelha de novo?", angle: "dor_pas", framework: "PAS", score: 84 },
  { id: "h-dp-5", text: "Luz cara todo mês? Chega", angle: "dor_pas", framework: "PAS", score: 83 },
  { id: "h-dp-6", text: "Cansou de pagar caro?", angle: "dor_pas", framework: "PAS", score: 80 },
  { id: "h-dp-7", text: "Conta da {{distribuidora}} pesou?", angle: "dor_pas", framework: "PAS", score: 89, needsDistribuidora: true },
  { id: "h-dp-8", text: "Aumento na luz de novo?", angle: "dor_pas", framework: "PAS", score: 81 },
  { id: "h-dp-9", text: "Sua fatura pesou demais?", angle: "dor_pas", framework: "PAS", score: 86 },
  { id: "h-dp-10", text: "Refém da conta de luz?", angle: "dor_pas", framework: "PAS", score: 78 },

  // prova_social (10) — sem números inventados
  { id: "h-ps-1", text: "Famílias já pagam menos", angle: "prova_social", framework: "prova social", score: 85 },
  { id: "h-ps-2", text: "Vizinhos já pagam menos", angle: "prova_social", framework: "prova social", score: 78 },
  { id: "h-ps-3", text: "Escolha de quem quer economia", angle: "prova_social", framework: "prova social", score: 82 },
  { id: "h-ps-4", text: "Seus vizinhos já economizam", angle: "prova_social", framework: "prova social", score: 80 },
  { id: "h-ps-5", text: "Moradores de {{cidade}} consultam", angle: "prova_social", framework: "prova social", score: 88 },
  { id: "h-ps-6", text: "Quem consultou já mudou", angle: "prova_social", framework: "prova social", score: 79 },
  { id: "h-ps-7", text: "Depoimentos reais no zap", angle: "prova_social", framework: "prova social", score: 74 },
  { id: "h-ps-8", text: "Quem simula costuma seguir", angle: "prova_social", framework: "prova social", score: 77 },
  { id: "h-ps-9", text: "Famílias {{distribuidora}} consultam", angle: "prova_social", framework: "prova social", score: 84, needsDistribuidora: true },
  { id: "h-ps-10", text: "Cada vez mais gente muda", angle: "prova_social", framework: "prova social", score: 81 },

  // quebra_objecao (10)
  { id: "h-qo-1", text: "Pague menos sem obra nem taxa", angle: "quebra_objecao", framework: "objeção", score: 87 },
  { id: "h-qo-2", text: "Sem instalar nada em casa", angle: "quebra_objecao", framework: "objeção", score: 82 },
  { id: "h-qo-3", text: "Não precisa trocar a fiação", angle: "quebra_objecao", framework: "objeção", score: 78 },
  { id: "h-qo-4", text: "Zero taxa de adesão", angle: "quebra_objecao", framework: "objeção", score: 80 },
  { id: "h-qo-5", text: "Sem fidelidade e sem multa", angle: "quebra_objecao", framework: "objeção", score: 83 },
  { id: "h-qo-6", text: "Cancele quando quiser", angle: "quebra_objecao", framework: "objeção", score: 76 },
  { id: "h-qo-7", text: "Sem placa no telhado", angle: "quebra_objecao", framework: "objeção", score: 79 },
  { id: "h-qo-8", text: "Sem análise de crédito", angle: "quebra_objecao", framework: "objeção", score: 81 },
  { id: "h-qo-9", text: "Sem investimento inicial", angle: "quebra_objecao", framework: "objeção", score: 82 },
  { id: "h-qo-10", text: "Zero dor de cabeça", angle: "quebra_objecao", framework: "objeção", score: 74 },

  // curiosidade (10)
  { id: "h-cu-1", text: "A lei que baixa sua conta", angle: "curiosidade", framework: "curiosidade", score: 84 },
  { id: "h-cu-2", text: "O que a distribuidora esconde", angle: "curiosidade", framework: "curiosidade", score: 86 },
  { id: "h-cu-3", text: "Descubra por que pagam menos", angle: "curiosidade", framework: "curiosidade", score: 80 },
  { id: "h-cu-4", text: "Lei 14.300 mudou tudo", angle: "curiosidade", framework: "curiosidade", score: 83 },
  { id: "h-cu-5", text: "Segredo da conta baixa", angle: "curiosidade", framework: "curiosidade", score: 78 },
  { id: "h-cu-6", text: "Ninguém te contou isso", angle: "curiosidade", framework: "curiosidade", score: 79 },
  { id: "h-cu-7", text: "Por que sua conta é tão alta?", angle: "curiosidade", framework: "curiosidade", score: 81 },
  { id: "h-cu-8", text: "O truque legal da luz barata", angle: "curiosidade", framework: "curiosidade", score: 77 },
  { id: "h-cu-9", text: "3 motivos da sua conta subir", angle: "curiosidade", framework: "curiosidade", score: 80 },
  { id: "h-cu-10", text: "Como pagar bem menos em 2026", angle: "curiosidade", framework: "curiosidade", score: 82 },

  // urgencia_local (10)
  { id: "h-ul-1", text: "Em até 30 dias na sua fatura", angle: "urgencia_local", framework: "urgência", score: 82 },
  { id: "h-ul-2", text: "Vagas limitadas em {{cidade}}", angle: "urgencia_local", framework: "urgência", score: 84 },
  { id: "h-ul-3", text: "Últimas vagas neste mês", angle: "urgencia_local", framework: "urgência", score: 80 },
  { id: "h-ul-4", text: "Só para clientes {{distribuidora}}", angle: "urgencia_local", framework: "urgência", score: 90, needsDistribuidora: true },
  { id: "h-ul-5", text: "Válido só nesta semana", angle: "urgencia_local", framework: "urgência", score: 76 },
  { id: "h-ul-6", text: "Começa na próxima fatura", angle: "urgencia_local", framework: "urgência", score: 78 },
  { id: "h-ul-7", text: "Termina no fim do mês", angle: "urgencia_local", framework: "urgência", score: 75 },
  { id: "h-ul-8", text: "Restam poucas vagas em {{cidade}}", angle: "urgencia_local", framework: "urgência", score: 85 },
  { id: "h-ul-9", text: "Ativo em 30 dias", angle: "urgencia_local", framework: "urgência", score: 74 },
  { id: "h-ul-10", text: "Reserve sua vaga agora", angle: "urgencia_local", framework: "urgência", score: 77 },

  // autoridade (10)
  { id: "h-au-1", text: "Autorizado pela ANEEL", angle: "autoridade", framework: "autoridade", score: 82 },
  { id: "h-au-2", text: "Energia limpa homologada", angle: "autoridade", framework: "autoridade", score: 78 },
  { id: "h-au-3", text: "iGreen Energy oficial", angle: "autoridade", framework: "autoridade", score: 76 },
  { id: "h-au-4", text: "Regulamentado por lei", angle: "autoridade", framework: "autoridade", score: 79 },
  { id: "h-au-5", text: "Aprovado na sua região", angle: "autoridade", framework: "autoridade", score: 77 },
  { id: "h-au-6", text: "Certificação de origem limpa", angle: "autoridade", framework: "autoridade", score: 75 },
  { id: "h-au-7", text: "Homologado na {{distribuidora}}", angle: "autoridade", framework: "autoridade", score: 88, needsDistribuidora: true },
  { id: "h-au-8", text: "Rede oficial iGreen", angle: "autoridade", framework: "autoridade", score: 74 },
  { id: "h-au-9", text: "Tecnologia auditada", angle: "autoridade", framework: "autoridade", score: 72 },
  { id: "h-au-10", text: "Padrão ANEEL de qualidade", angle: "autoridade", framework: "autoridade", score: 76 },

  // storytelling (10)
  { id: "h-st-1", text: "Ana pagava R$ 480. Hoje R$ 360", angle: "storytelling", framework: "história", score: 88 },
  { id: "h-st-2", text: "Ele fez a conta cair em 30 dias", angle: "storytelling", framework: "história", score: 84 },
  { id: "h-st-3", text: "Dona Maria descobriu o truque", angle: "storytelling", framework: "história", score: 82 },
  { id: "h-st-4", text: "Da luz cara à economia real", angle: "storytelling", framework: "história", score: 78 },
  { id: "h-st-5", text: "Assim ela cortou R$ 200/mês", angle: "storytelling", framework: "história", score: 85 },
  { id: "h-st-6", text: "Como cortei minha conta em 22%", angle: "storytelling", framework: "história", score: 83 },
  { id: "h-st-7", text: "Comerciante em {{cidade}} pagou 22% menos", angle: "storytelling", framework: "história", score: 86 },
  { id: "h-st-8", text: "A história do José e a conta 20% menor", angle: "storytelling", framework: "história", score: 80 },
  { id: "h-st-9", text: "Antes R$ 550, agora R$ 430", angle: "storytelling", framework: "história", score: 84 },
  { id: "h-st-10", text: "Ela achou que era golpe. Não é.", angle: "storytelling", framework: "história", score: 79 },
];

// ─────────────────────────── PRIMARY TEXTS (80) ───────────────────────────
// Regra: começam com HOOK curto (≤40 chars antes do 1º ponto) + CTA no final.
export const PRIMARY_TEXTS: CatalogItem[] = [
  // economia_concreta — sem %/R$ (qualifica antes de prometer)
  { id: "p-ec-1", text: "Quer saber se sua conta pode baixar? Simule no zap, sem obra. 👇", angle: "economia_concreta", framework: "AIDA", score: 94 },
  { id: "p-ec-2", text: "Fatura pesada? Consulte se há economia na sua região. Toca aqui.", angle: "economia_concreta", framework: "AIDA", score: 92 },
  { id: "p-ec-3", text: "Boleto mais leve pode ser possível. Simule sua conta no zap 👇", angle: "economia_concreta", framework: "AIDA", score: 90 },
  { id: "p-ec-4", text: "Cliente {{distribuidora}}? Consulte desconto no boleto, sem obra. 👇", angle: "economia_concreta", framework: "AIDA", score: 95, needsDistribuidora: true },
  { id: "p-ec-5", text: "Boleto mais leve? Veja se sua região entra. Toca aqui.", angle: "economia_concreta", framework: "benefício", score: 87 },
  { id: "p-ec-6", text: "Economia recorrente sem instalar nada. Simule no zap 👇", angle: "economia_concreta", framework: "benefício", score: 89 },
  { id: "p-ec-7", text: "Quer aliviar a próxima fatura? Simples, sem taxa. Toca aqui.", angle: "economia_concreta", framework: "AIDA", score: 88 },
  { id: "p-ec-8", text: "Desconto recorrente no boleto. Consulte no zap 👇", angle: "economia_concreta", framework: "benefício", score: 90 },
  { id: "p-ec-9", text: "Conta alta todo mês? Simule se dá pra baixar. Toca aqui.", angle: "economia_concreta", framework: "AIDA", score: 86 },
  { id: "p-ec-10", text: "Consulte economia na luz. Ativa após análise. Fala no zap 👇", angle: "economia_concreta", framework: "AIDA", score: 87 },

  // dor_pas
  { id: "p-dp-1", text: "Conta de luz subindo de novo? Desconto direto no boleto, sem obra. Fala no zap 👇", angle: "dor_pas", framework: "PAS", score: 95 },
  { id: "p-dp-2", text: "Cansada de pagar caro? Energia limpa, conta leve. Chama agora 🌱", angle: "dor_pas", framework: "PAS", score: 90 },
  { id: "p-dp-3", text: "Bandeira vermelha outra vez? Consulte economia no boleto. Toca aqui.", angle: "dor_pas", framework: "PAS", score: 88 },
  { id: "p-dp-4", text: "Sem fôlego com a luz? Desconto que entra após análise. Fala no zap 👇", angle: "dor_pas", framework: "PAS", score: 87 },
  { id: "p-dp-5", text: "Fatura da {{distribuidora}} disparou? Consulte no zap 👇", angle: "dor_pas", framework: "PAS", score: 93, needsDistribuidora: true },
  { id: "p-dp-6", text: "Cansou de bandeira vermelha? Preço mais previsível. Toca aqui.", angle: "dor_pas", framework: "PAS", score: 85 },
  { id: "p-dp-7", text: "Não dá mais pra aguentar? Simule a próxima fatura. Fala no zap 👇", angle: "dor_pas", framework: "PAS", score: 84 },
  { id: "p-dp-8", text: "Aumento em cima de aumento? Veja se dá pra aliviar. Chama agora.", angle: "dor_pas", framework: "PAS", score: 86 },
  { id: "p-dp-9", text: "Sua conta pesou demais? Consulte em poucos minutos. Fala no zap 👇", angle: "dor_pas", framework: "PAS", score: 83 },
  { id: "p-dp-10", text: "A luz virou vilã? Simule economia e siga tranquilo. Toca aqui.", angle: "dor_pas", framework: "PAS", score: 82 },

  // prova_social
  { id: "p-ps-1", text: "Famílias já pagam menos na luz. Quer consultar? Fala no zap 👇", angle: "prova_social", framework: "prova social", score: 90 },
  { id: "p-ps-2", text: "Seus vizinhos já consultaram. Descubra se você também entra. Toca aqui.", angle: "prova_social", framework: "prova social", score: 87 },
  { id: "p-ps-3", text: "Quem já mudou recomenda consultar. Veja os depoimentos 👇", angle: "prova_social", framework: "prova social", score: 85 },
  { id: "p-ps-4", text: "Em {{cidade}} muita gente já consultou. Bora ser o próximo? 👇", angle: "prova_social", framework: "prova social", score: 92 },
  { id: "p-ps-5", text: "Quem consultou costuma seguir. E você? Toca aqui.", angle: "prova_social", framework: "prova social", score: 82 },
  { id: "p-ps-6", text: "Quem simula entende o desconto. Peça no zap 👇", angle: "prova_social", framework: "prova social", score: 84 },
  { id: "p-ps-7", text: "Contas menores todo mês. Descubra se sua região entra 👇", angle: "prova_social", framework: "prova social", score: 83 },
  { id: "p-ps-8", text: "Clientes {{distribuidora}} consultam no zap 👇", angle: "prova_social", framework: "prova social", score: 88, needsDistribuidora: true },
  { id: "p-ps-9", text: "Cada vez mais famílias mudam. Toca aqui e descubra.", angle: "prova_social", framework: "prova social", score: 86 },
  { id: "p-ps-10", text: "Sua rua já consulta. Falta você. Chama no zap 👇", angle: "prova_social", framework: "prova social", score: 81 },

  // quebra_objecao
  { id: "p-qo-1", text: "Sem obra em casa. Sem taxa de adesão. Consulte no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 90 },
  { id: "p-qo-2", text: "Zero placa no telhado. Zero fidelidade. Toca aqui.", angle: "quebra_objecao", framework: "objeção", score: 88 },
  { id: "p-qo-3", text: "Sem instalar nada. Sem trocar fiação. Fala no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 87 },
  { id: "p-qo-4", text: "Sem análise de crédito. Sem investimento inicial. Chama no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 86 },
  { id: "p-qo-5", text: "Cancele quando quiser. Sem multa. Simula no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 85 },
  { id: "p-qo-6", text: "Sem obra na sua casa. Só troca no cadastro. Toca aqui.", angle: "quebra_objecao", framework: "objeção", score: 84 },
  { id: "p-qo-7", text: "Sem burocracia. Ativa em 30 dias. Fala no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 83 },
  { id: "p-qo-8", text: "Sem taxa de adesão. Só desconto. Chama agora.", angle: "quebra_objecao", framework: "objeção", score: 82 },
  { id: "p-qo-9", text: "Zero risco. Cancele com 1 clique. Fala no zap 👇", angle: "quebra_objecao", framework: "objeção", score: 81 },
  { id: "p-qo-10", text: "Não é empréstimo, não é golpe. É lei. Toca aqui.", angle: "quebra_objecao", framework: "objeção", score: 84 },

  // curiosidade
  { id: "p-cu-1", text: "A Lei 14.300 te dá direito ao desconto. Quase ninguém sabe. Fala no zap 👇", angle: "curiosidade", framework: "curiosidade", score: 89 },
  { id: "p-cu-2", text: "Por que sua conta é tão alta? Descubra em 3 min. Toca aqui.", angle: "curiosidade", framework: "curiosidade", score: 85 },
  { id: "p-cu-3", text: "O que a {{distribuidora}} não te conta. Fala no zap 👇", angle: "curiosidade", framework: "curiosidade", score: 91, needsDistribuidora: true },
  { id: "p-cu-4", text: "Segredo da luz barata? Está na lei. Chama agora.", angle: "curiosidade", framework: "curiosidade", score: 83 },
  { id: "p-cu-5", text: "3 motivos da sua conta subir. Veja 👇", angle: "curiosidade", framework: "curiosidade", score: 82 },
  { id: "p-cu-6", text: "Como pagar bem menos em 2026? Toca aqui.", angle: "curiosidade", framework: "curiosidade", score: 84 },
  { id: "p-cu-7", text: "Ninguém te contou isso sobre luz. Chama no zap 👇", angle: "curiosidade", framework: "curiosidade", score: 81 },
  { id: "p-cu-8", text: "Descubra o desconto que ninguém oferece. Fala no zap 👇", angle: "curiosidade", framework: "curiosidade", score: 82 },
  { id: "p-cu-9", text: "O truque legal para conta menor. Toca aqui.", angle: "curiosidade", framework: "curiosidade", score: 80 },
  { id: "p-cu-10", text: "Por que uns pagam metade? Vamos te contar.", angle: "curiosidade", framework: "curiosidade", score: 79 },

  // urgencia_local
  { id: "p-ul-1", text: "Vagas limitadas em {{cidade}}. Reserve agora no zap 👇", angle: "urgencia_local", framework: "urgência", score: 88 },
  { id: "p-ul-2", text: "Só para clientes {{distribuidora}}. Últimas 30 vagas. Fala no zap 👇", angle: "urgencia_local", framework: "urgência", score: 92, needsDistribuidora: true },
  { id: "p-ul-3", text: "Termina no fim do mês. Corte 20% já. Toca aqui.", angle: "urgencia_local", framework: "urgência", score: 84 },
  { id: "p-ul-4", text: "Válido só nesta semana. Simule no zap 👇", angle: "urgencia_local", framework: "urgência", score: 83 },
  { id: "p-ul-5", text: "Começa na próxima fatura. Não perca. Chama agora.", angle: "urgencia_local", framework: "urgência", score: 85 },
  { id: "p-ul-6", text: "Últimas vagas do mês em {{cidade}}. Fala no zap 👇", angle: "urgencia_local", framework: "urgência", score: 87 },
  { id: "p-ul-7", text: "Ativo em 30 dias. Reserve a sua vaga. Toca aqui.", angle: "urgencia_local", framework: "urgência", score: 82 },
  { id: "p-ul-8", text: "Só nesta semana: 20% off vitalício. Fala no zap 👇", angle: "urgencia_local", framework: "urgência", score: 84 },
  { id: "p-ul-9", text: "Poucas vagas para sua região. Chama no zap 👇", angle: "urgencia_local", framework: "urgência", score: 81 },
  { id: "p-ul-10", text: "Fim do mês fecha as inscrições. Toca aqui.", angle: "urgencia_local", framework: "urgência", score: 80 },

  // autoridade
  { id: "p-au-1", text: "Homologado pela ANEEL. 20% off todo mês. Fala no zap 👇", angle: "autoridade", framework: "autoridade", score: 85 },
  { id: "p-au-2", text: "iGreen oficial. Energia limpa, conta leve. Toca aqui.", angle: "autoridade", framework: "autoridade", score: 82 },
  { id: "p-au-3", text: "Regulamentado por lei. Desconto de verdade. Fala no zap 👇", angle: "autoridade", framework: "autoridade", score: 83 },
  { id: "p-au-4", text: "Homologado na {{distribuidora}}. 20% off. Chama no zap 👇", angle: "autoridade", framework: "autoridade", score: 90, needsDistribuidora: true },
  { id: "p-au-5", text: "Certificação de origem limpa. Fala no zap 👇", angle: "autoridade", framework: "autoridade", score: 78 },
  { id: "p-au-6", text: "Tecnologia auditada. 20% mais barata. Toca aqui.", angle: "autoridade", framework: "autoridade", score: 80 },
  { id: "p-au-7", text: "Padrão ANEEL. Zero pegadinha. Chama no zap 👇", angle: "autoridade", framework: "autoridade", score: 81 },
  { id: "p-au-8", text: "Rede oficial iGreen. Ativa em 30 dias. Fala no zap 👇", angle: "autoridade", framework: "autoridade", score: 79 },
  { id: "p-au-9", text: "Aprovado na sua região. Sem obra. Toca aqui.", angle: "autoridade", framework: "autoridade", score: 82 },
  { id: "p-au-10", text: "Autorizado por lei federal. 20% off. Fala no zap 👇", angle: "autoridade", framework: "autoridade", score: 83 },

  // storytelling
  { id: "p-st-1", text: "Ana pagava R$ 480. Hoje R$ 360. Descubra como. Fala no zap 👇", angle: "storytelling", framework: "história", score: 90 },
  { id: "p-st-2", text: "Ele cortou 22% em 30 dias. Vem ver 👇", angle: "storytelling", framework: "história", score: 86 },
  { id: "p-st-3", text: "Dona Maria achou que era golpe. Hoje paga R$ 200 menos. Toca aqui.", angle: "storytelling", framework: "história", score: 88 },
  { id: "p-st-4", text: "Comerciante em {{cidade}} baixou 25% da luz. Chama no zap 👇", angle: "storytelling", framework: "história", score: 92 },
  { id: "p-st-5", text: "Ela pagava caro. Mudou. Agora sobra dinheiro. Fala no zap 👇", angle: "storytelling", framework: "história", score: 84 },
  { id: "p-st-6", text: "Antes R$ 550, agora R$ 430. Toca aqui e simule a sua.", angle: "storytelling", framework: "história", score: 87 },
  { id: "p-st-7", text: "José cortou R$ 200 por mês. Sem obra em casa. Chama no zap 👇", angle: "storytelling", framework: "história", score: 85 },
  { id: "p-st-8", text: "Como cortei minha conta em 22%. Fala no zap 👇", angle: "storytelling", framework: "história", score: 83 },
  { id: "p-st-9", text: "A luz virou vilã. Ela virou o jogo em 30 dias. Toca aqui.", angle: "storytelling", framework: "história", score: 82 },
  { id: "p-st-10", text: "Cliente {{distribuidora}} economizou R$ 1.400 no ano. Chama no zap 👇", angle: "storytelling", framework: "história", score: 89, needsDistribuidora: true },
];

// ─────────────────────────── DESCRIPTIONS (40, ≤25 chars) ───────────────────────────
export const DESCRIPTIONS: string[] = [
  "Sem obra. Sem taxa.",
  "Ative em 30 dias.",
  "20% off vitalício.",
  "Direto no boleto.",
  "Sem fidelidade.",
  "Zero investimento.",
  "Energia limpa.",
  "Sem placa em casa.",
  "Cancele quando quiser.",
  "Aprovado por lei.",
  "Homologado ANEEL.",
  "Vagas limitadas.",
  "Corte 20% já.",
  "Sem análise crédito.",
  "Simule no zap.",
  "Só clientes locais.",
  "Reserve sua vaga.",
  "Sem multa nunca.",
  "22% off todo mês.",
  "Ativa fácil.",
  "Sem burocracia.",
  "Só desconto real.",
  "Fatura mais leve.",
  "R$ 1.200/ano.",
  "Sem trocar fiação.",
  "Preço fixo mensal.",
  "Zero taxa adesão.",
  "iGreen oficial.",
  "Últimas vagas hoje.",
  "Depoimentos reais.",
  "Bandeira sem susto.",
  "Ative em 3 dias.",
  "Corte já 18%.",
  "Sem risco.",
  "Sem pegadinha.",
  "Rede iGreen oficial.",
  "Simule agora.",
  "Solução em lei.",
  "Vaga limitada.",
  "Chame no zap.",
];

// ─────────────────────────── HELPERS ───────────────────────────

/** Substitui {{distribuidora}} e {{cidade}} pelos valores disponíveis. */
export function renderPlaceholders(
  text: string,
  ctx: { distribuidora?: string | null; cidade?: string | null },
): string {
  let out = text;
  if (ctx.distribuidora) out = out.split("{{distribuidora}}").join(ctx.distribuidora);
  if (ctx.cidade) out = out.split("{{cidade}}").join(ctx.cidade);
  return out;
}

/** Filtra o catálogo com base no contexto (remove itens que precisam de distribuidora). */
function filterByContext(items: CatalogItem[], ctx: { distribuidora?: string | null; cidade?: string | null }): CatalogItem[] {
  return items.filter((i) => {
    if (i.needsDistribuidora && !ctx.distribuidora) return false;
    if (i.text.includes("{{cidade}}") && !ctx.cidade) return false;
    // Claims numéricos atraem curioso e pioram CPL/conversão — fora do sample padrão.
    if (isClaimHeavyCopy(i.text)) return false;
    return true;
  });
}

/** % / R$ / prova social inventada — Meta penaliza e o lead costuma ser fraco. */
export function isClaimHeavyCopy(text: string): boolean {
  const t = String(text || "");
  return (
    /\d+\s*%/.test(t) ||
    /R\$\s*\d/i.test(t) ||
    /\+\s*\d+\s*mil/i.test(t) ||
    /\b\d+\s*mil\b/i.test(t) ||
    /\b\d+\s*em\s*\d+\b/i.test(t) ||
    /lei\s*14\.?300/i.test(t)
  );
}

/**
 * Sorteia 6 headlines (1 por ângulo quando possível) e 3 primary_texts diversificados.
 * Retorna já com placeholders substituídos.
 */
export function sampleCopyPack(ctx: { distribuidora?: string | null; cidade?: string | null }, seed = Date.now()) {
  const rand = mulberry32(seed);

  const headlines = pickDiverse(filterByContext(HEADLINES, ctx), 6, rand);
  const primary = pickDiverse(filterByContext(PRIMARY_TEXTS, ctx), 3, rand);
  const description = DESCRIPTIONS[Math.floor(rand() * DESCRIPTIONS.length)];

  const render = (it: CatalogItem) => ({
    text: renderPlaceholders(it.text, ctx),
    framework: it.framework,
    angle: it.angle,
    score: it.score,
  });

  return {
    headlines: headlines.map(render),
    primary_texts: primary.map(render),
    description,
  };
}

/** Escolhe N itens tentando 1 por ângulo, embaralhando dentro do ângulo por peso (score + jitter). */
function pickDiverse(items: CatalogItem[], count: number, rand: () => number): CatalogItem[] {
  const byAngle = new Map<string, CatalogItem[]>();
  for (const it of items) {
    const arr = byAngle.get(it.angle) || [];
    arr.push(it);
    byAngle.set(it.angle, arr);
  }
  // Para cada ângulo, escolhe 1 candidato com peso do score.
  const candidates: CatalogItem[] = [];
  for (const [, arr] of byAngle) {
    const chosen = weightedChoose(arr, rand);
    if (chosen) candidates.push(chosen);
  }
  // Ordena candidatos por score + jitter para não travar sempre no mesmo.
  candidates.sort((a, b) => (b.score + rand() * 10) - (a.score + rand() * 10));
  return candidates.slice(0, count);
}

function weightedChoose(arr: CatalogItem[], rand: () => number): CatalogItem | null {
  if (!arr.length) return null;
  const total = arr.reduce((s, i) => s + Math.max(1, i.score), 0);
  let r = rand() * total;
  for (const it of arr) {
    r -= Math.max(1, it.score);
    if (r <= 0) return it;
  }
  return arr[arr.length - 1];
}

/** PRNG determinístico simples para embaralhamentos reproduzíveis. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Totais expostos p/ UI (ex: "Ver mais 195 opções"). */
export const CATALOG_TOTALS = {
  headlines: HEADLINES.length,
  primary_texts: PRIMARY_TEXTS.length,
  descriptions: DESCRIPTIONS.length,
  total: HEADLINES.length + PRIMARY_TEXTS.length + DESCRIPTIONS.length,
};
