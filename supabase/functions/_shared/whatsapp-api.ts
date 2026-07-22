/**
 * Adapter Evolution legado (admin-send-material etc.).
 * Delega para createEvolutionSender — inclui resolve de JID (BR 9º dígito).
 */
import { createEvolutionSender } from "./evolution-api.ts";

export function createWhatsAppSender(evolutionUrl: string, evolutionKey: string, instanceName: string) {
  const sender = createEvolutionSender(evolutionUrl, evolutionKey, instanceName);

  async function sendText(chatId: string, message: string): Promise<void> {
    const ok = await sender.sendText(chatId, message);
    if (!ok) console.error("Erro sendText Evolution (createWhatsAppSender)");
  }

  async function sendButtons(
    chatId: string,
    message: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<boolean> {
    return sender.sendButtons(chatId, message, buttons);
  }

  async function sendMedia(
    chatId: string,
    mediaUrl: string,
    caption: string,
    mediatype: "video" | "image" | "document" = "video",
  ): Promise<boolean | { ok: false; status: number; detail: string }> {
    const ok = await sender.sendMedia(chatId, mediaUrl, caption, mediatype);
    if (!ok) return { ok: false, status: 0, detail: "evolution_send_media_failed" };
    return true;
  }

  async function sendAudio(
    chatId: string,
    audioUrl: string,
  ): Promise<boolean | { ok: false; status: number; detail: string }> {
    const ok = await sender.sendAudio(chatId, audioUrl);
    if (!ok) return { ok: false, status: 0, detail: "evolution_send_audio_failed" };
    return true;
  }

  return { sendText, sendButtons, sendMedia, sendAudio };
}
