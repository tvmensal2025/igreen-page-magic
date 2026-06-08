/**
 * Evolution API adapter — substitui Whapi.
 * Usa a instância configurada no banco (settings.evolution_instance_name)
 * ou a variável de ambiente EVOLUTION_INSTANCE_NAME.
 */
import { fetchWithTimeout, withRetry, TIMEOUT_EVOLUTION } from "./utils.ts";

export function createWhatsAppSender(evolutionUrl: string, evolutionKey: string, instanceName: string) {
  const base = evolutionUrl.replace(/\/+$/, "");

  // ─── Enviar texto ─────────────────────────────────────────────────────
  async function sendText(chatId: string, message: string): Promise<void> {
    // chatId pode vir como "5511999998888@s.whatsapp.net" ou só "5511999998888"
    const number = chatId.replace("@s.whatsapp.net", "");
    const doSend = async () => {
      const res = await fetchWithTimeout(`${base}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({ number, text: message }),
        timeout: TIMEOUT_EVOLUTION,
      });
      if (!res.ok) throw new Error(`Evolution ${res.status}: ${await res.text()}`);
    };
    try {
      await withRetry(doSend, {
        maxAttempts: 2,
        retryOn: (e) => {
          const msg = String(e);
          return msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("timeout");
        },
      });
    } catch (e: any) {
      console.error("Erro sendText Evolution:", e?.message || e);
    }
  }

  // ─── Enviar botões (com fallback texto) ───────────────────────────────
  async function sendButtons(chatId: string, message: string, buttons: Array<{ id: string; title: string }>): Promise<boolean> {
    const number = chatId.replace("@s.whatsapp.net", "");
    buttons = buttons.slice(0, 3).map((btn) => ({ id: btn.id, title: btn.title.substring(0, 20) }));

    try {
      const res = await fetchWithTimeout(`${base}/message/sendButtons/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({
          number,
          title: "☀️ iGreen Energy",
          description: message,
          footer: "Toque em um botão abaixo",
          buttons: buttons.map((btn) => ({ type: "reply", displayText: btn.title, id: btn.id })),
        }),
        timeout: TIMEOUT_EVOLUTION,
      });
      if (res.ok) return true;
      console.warn("sendButtons Evolution falhou:", res.status, await res.text());
    } catch (e: any) {
      console.warn("sendButtons Evolution erro:", e.message);
    }

    // Fallback: texto numerado
    let textMessage = message + "\n\n";
    buttons.forEach((btn, i) => { textMessage += `${i + 1}. ${btn.title}\n`; });
    textMessage += "\nDigite o número:";
    await sendText(chatId, textMessage);
    return false;
  }

  async function sendMedia(chatId: string, mediaUrl: string, caption: string, mediatype: "video" | "image" | "document" = "video"): Promise<boolean> {
    const number = chatId.replace("@s.whatsapp.net", "");
    try {
      const res = await fetchWithTimeout(`${base}/message/sendMedia/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({
          number,
          mediatype,
          mimetype: mediatype === "video" ? "video/mp4" : mediatype === "image" ? "image/jpeg" : "application/pdf",
          caption,
          media: mediaUrl,
        }),
        timeout: 60_000,
      });
      if (!res.ok) {
        console.error("sendMedia Evolution falhou:", res.status);
        return false;
      }
      return true;
    } catch (e: any) {
      console.error("sendMedia Evolution erro:", e?.message);
      return false;
    }
  }

  // ─── Enviar áudio (voice note / PTT) ───────────────────────────────────
  async function sendAudio(chatId: string, audioUrl: string): Promise<boolean> {
    const number = chatId.replace("@s.whatsapp.net", "");
    try {
      const res = await fetchWithTimeout(`${base}/message/sendWhatsAppAudio/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({ number, audio: audioUrl, encoding: true }),
        timeout: 60_000,
      });
      if (!res.ok) {
        console.error("sendAudio Evolution falhou:", res.status, await res.text().catch(() => ""));
        return false;
      }
      return true;
    } catch (e: any) {
      console.error("sendAudio Evolution erro:", e?.message);
      return false;
    }
  }

  return { sendText, sendButtons, sendMedia, sendAudio };
}
