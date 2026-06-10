/**
 * Envio de templates multi-arquivo.
 *
 * Centraliza a lógica de disparar um template (com vários itens em ordem) para
 * um destinatário, reutilizada por todos os painéis de envio (Bulk, Bulk-Block,
 * Chat). Mantém compatibilidade: se o template não tiver `items`, cai no modelo
 * legado (media_url/image_url/media_type).
 */
import { sendWhatsAppMessage, type MediaCategory } from "@/services/messageSender";
import type { MessageTemplate, TemplateItem } from "@/types/whatsapp";

export interface SendTemplateOptions {
  instanceName: string;
  phone: string;
  isWhapi?: boolean;
  /** Aplica placeholders ({{nome}} etc.) no texto de cada item. */
  renderText?: (text: string) => string;
  /**
   * M1 — Progresso: chamado a cada item enviado. `index` é 1-based.
   * Permite a UI mostrar "enviando 2 de 3..." em vez de só girar.
   */
  onProgress?: (index: number, total: number, label: string) => void;
  /**
   * M3 — Falha por item: chamado quando um item específico falha (após o
   * retry). Permite a UI dizer "o áudio falhou, texto e imagem foram".
   */
  onItemError?: (label: string, error: string) => void;
}

/** Rótulo amigável (pt-BR) do tipo do item, para progresso/erros. */
function itemLabel(type: string | null | undefined): string {
  switch (type) {
    case "image": return "imagem";
    case "video": return "vídeo";
    case "audio": return "áudio";
    case "document": return "documento";
    default: return "texto";
  }
}

/**
 * M2 — Envia uma mensagem com 1 retry automático em caso de timeout.
 * Falhas "duras" (número inválido, etc.) não são repetidas — só timeouts,
 * que costumam ser transitórios (rede/servidor lento).
 */
async function sendWithRetry(
  payload: Parameters<typeof sendWhatsAppMessage>[0],
): Promise<Awaited<ReturnType<typeof sendWhatsAppMessage>>> {
  const first = await sendWhatsAppMessage(payload);
  if (first.status !== "timeout") return first;
  // Espera curta e tenta de novo uma única vez.
  await new Promise((r) => setTimeout(r, 1500));
  return sendWhatsAppMessage(payload);
}

/** Converte o tipo do item/template em categoria de envio. */
function toCategory(type: string | null | undefined): MediaCategory {
  switch (type) {
    case "image": return "image";
    case "video": return "video";
    case "audio": return "audio";
    case "document": return "document";
    default: return "text";
  }
}

/**
 * Deriva os campos legados (media_type/media_url/image_url) do template a partir
 * da lista de itens. Mantém a MESMA convenção do backfill, para que os caminhos
 * de envio antigos (chat, pós-venda) não dupliquem mídia:
 *  - mídia principal = primeiro item de mídia que NÃO é imagem (áudio/vídeo/doc);
 *    se só houver imagem, ela vira a principal.
 *  - image_url = imagem anexa, SOMENTE quando a principal não é imagem
 *    (evita gravar a mesma imagem em media_url e image_url).
 */
export function deriveLegacyMediaFields(
  items: { message_type: string; media_url: string | null }[],
): { media_type: string; media_url: string | null; image_url: string | null } {
  const mediaItems = items.filter((i) => i.message_type !== "text" && i.media_url);
  const principal = mediaItems.find((i) => i.message_type !== "image") || mediaItems[0];
  const imageItem = mediaItems.find((i) => i.message_type === "image");
  const media_type = principal?.message_type || "text";
  const media_url = principal?.media_url ?? null;
  const image_url =
    principal && principal.message_type !== "image" && imageItem
      ? imageItem.media_url
      : null;
  return { media_type, media_url, image_url };
}

/**
 * Deriva a lista de itens a enviar a partir do template.
 * - Usa `items[]` (multi-arquivo) quando existir.
 * - Senão, reconstrói 1..2 itens a partir dos campos legados (image_url + mídia/texto).
 */
export function resolveTemplateItems(template: MessageTemplate): TemplateItem[] {
  if (template.items && template.items.length > 0) {
    return [...template.items].sort((a, b) => a.position - b.position);
  }
  // Legado → reconstrói itens equivalentes.
  const items: TemplateItem[] = [];
  const mtype = (template.media_type || "text") as TemplateItem["message_type"];
  // imagem anexa (quando o tipo principal não é imagem) vai primeiro
  if (template.image_url && mtype !== "image") {
    items.push({ position: 0, message_type: "image", media_url: template.image_url, image_url: null, message_text: null, delay_seconds: 0 });
  }
  if (mtype !== "text" && template.media_url) {
    items.push({ position: items.length, message_type: mtype, media_url: template.media_url, image_url: null, message_text: template.content || null, delay_seconds: 0 });
  } else if (template.content) {
    items.push({ position: items.length, message_type: "text", media_url: null, image_url: null, message_text: template.content, delay_seconds: 0 });
  }
  return items;
}

/**
 * Envia todos os itens de um template em ordem, respeitando o delay de cada um.
 * Retorna true se TODOS os itens foram enviados com sucesso.
 */
export async function sendTemplate(
  template: MessageTemplate,
  opts: SendTemplateOptions,
): Promise<boolean> {
  const items = resolveTemplateItems(template);
  if (items.length === 0) return false;

  let allOk = true;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const label = itemLabel(it.message_type);

    // M1 — avisa a UI qual item está saindo (1-based).
    opts.onProgress?.(i + 1, items.length, label);

    // Delay entre itens (a partir do 2º).
    if (i > 0 && it.delay_seconds > 0) {
      await new Promise((r) => setTimeout(r, it.delay_seconds * 1000));
    }

    const category = toCategory(it.message_type);
    const text = it.message_text
      ? (opts.renderText ? opts.renderText(it.message_text) : it.message_text)
      : "";

    // Imagem anexa do item (quando o tipo principal não é imagem) — envia antes.
    if (it.image_url && it.message_type !== "image") {
      const ri = await sendWithRetry({
        instanceName: opts.instanceName, phone: opts.phone, isWhapi: opts.isWhapi,
        mediaCategory: "image", mediaUrl: it.image_url,
      });
      if (ri.status === "failed" || ri.status === "timeout") {
        allOk = false;
        opts.onItemError?.("imagem", ri.error || "falha no envio");
      }
    }

    let r;
    if (category === "text") {
      if (!text.trim()) continue;
      r = await sendWithRetry({ instanceName: opts.instanceName, phone: opts.phone, isWhapi: opts.isWhapi, mediaCategory: "text", text });
    } else if (category === "audio") {
      if (!it.media_url) continue;
      r = await sendWithRetry({ instanceName: opts.instanceName, phone: opts.phone, isWhapi: opts.isWhapi, mediaCategory: "audio", mediaUrl: it.media_url });
      // Áudio não carrega legenda — manda o texto numa mensagem separada.
      if (text.trim()) {
        const rt = await sendWithRetry({ instanceName: opts.instanceName, phone: opts.phone, isWhapi: opts.isWhapi, mediaCategory: "text", text });
        if (rt.status === "failed" || rt.status === "timeout") {
          allOk = false;
          opts.onItemError?.("texto", rt.error || "falha no envio");
        }
      }
    } else {
      if (!it.media_url) continue;
      r = await sendWithRetry({ instanceName: opts.instanceName, phone: opts.phone, isWhapi: opts.isWhapi, mediaCategory: category, mediaUrl: it.media_url, text });
    }
    if (r && (r.status === "failed" || r.status === "timeout")) {
      allOk = false;
      opts.onItemError?.(label, r.error || "falha no envio");
    }
  }

  return allOk;
}
