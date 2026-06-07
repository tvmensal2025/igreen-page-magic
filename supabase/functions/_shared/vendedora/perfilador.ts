// Camada 1 — Perfilador. Lê o lead em JSON estruturado.

import { chat } from "./gateway.ts";
import type { PerfilOutput } from "./types.ts";

const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você é um analista de vendas que lê uma conversa de WhatsApp e devolve APENAS JSON.

Classifique o lead nas dimensões abaixo. Seja preciso, evite "neutro/medio" quando houver sinais claros.

Schema obrigatório:
{
  "perfil": "cetico|interessado|comprador|indeciso|reclamao",
  "sentimento": "positivo|neutro|negativo|irritado",
  "urgencia": "alta|media|baixa",
  "temperatura": 0-100,
  "sinais_compra": ["..."],
  "sinais_perda": ["..."]
}

Definições:
- perfil "comprador": pede preço, prazo, próximos passos, ou já confirmou interesse forte
- perfil "cetico": questiona credibilidade, pergunta "é golpe", "é seguro"
- perfil "interessado": curioso, faz perguntas abertas, responde positivo
- perfil "indeciso": "vou pensar", "depois", "talvez"
- perfil "reclamao": fala mal de conta, distribuidora, governo, outros serviços
- temperatura: 0 = frio, 100 = pronto pra fechar agora

Devolva SOMENTE o JSON, sem comentários.`;

export async function perfilar(history: string, ultimoInbound: string): Promise<PerfilOutput> {
  const r = await chat({
    model: MODEL,
    json: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `# Histórico\n${history}\n\n# Última mensagem do lead\n${ultimoInbound}` },
    ],
  });
  try {
    const parsed = JSON.parse(r.text);
    return normalize(parsed);
  } catch {
    return {
      perfil: "interessado",
      sentimento: "neutro",
      urgencia: "media",
      temperatura: 40,
      sinais_compra: [],
      sinais_perda: [],
    };
  }
}

function normalize(p: any): PerfilOutput {
  const allowedPerfil = ["cetico", "interessado", "comprador", "indeciso", "reclamao"];
  const allowedSent = ["positivo", "neutro", "negativo", "irritado"];
  const allowedUrg = ["alta", "media", "baixa"];
  return {
    perfil: allowedPerfil.includes(p?.perfil) ? p.perfil : "interessado",
    sentimento: allowedSent.includes(p?.sentimento) ? p.sentimento : "neutro",
    urgencia: allowedUrg.includes(p?.urgencia) ? p.urgencia : "media",
    temperatura: Math.max(0, Math.min(100, Number(p?.temperatura) || 40)),
    sinais_compra: Array.isArray(p?.sinais_compra) ? p.sinais_compra.slice(0, 5).map(String) : [],
    sinais_perda: Array.isArray(p?.sinais_perda) ? p.sinais_perda.slice(0, 5).map(String) : [],
  };
}
