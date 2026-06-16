// ─── Aprovação de cadastro de consultor por "SIM" no WhatsApp ──────────────
//
// O QUE FAZ
// ---------
// Quando o super admin responde "SIM" (ou "SIM <nome>") no WhatsApp para o
// número do Whapi, este módulo:
//   1. Confirma que o remetente é o super admin (allowlist de telefones).
//   2. Encontra o(s) consultor(es) com approved=false (cadastro pendente).
//   3. Aprova (approved=true) e confirma de volta no WhatsApp.
//
// Custo zero: usa o mesmo número/canal Whapi que o projeto já paga.
//
// Segurança: só aprova se o telefone do remetente bater com a allowlist do
// super admin (consultants.phone do superadmin_consultant_id + app_settings.
// super_admin_phone). Assim, um lead qualquer que mande "sim" NUNCA aprova
// um cadastro.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ApprovalSenderResult {
  ok: boolean;
}

export interface ApprovalSender {
  // Mesma assinatura do createWhapiSender().sendText (3º arg opcional ignorado aqui).
  sendText: (remoteJid: string, text: string, opts?: any) => Promise<boolean>;
}

// Só dígitos; remove DDI 55 e o nono dígito para comparar de forma tolerante.
// Ex.: "5511990092401" e "11990092401" e "551190092401" devem casar.
function phoneKey(raw: string | null | undefined): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  // Remove o nono dígito (celular): DDD (2) + 9 + 8 dígitos = 11 → vira 10.
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d;
}

// Detecta intenção de aprovar: "sim", "aprovar", "aprova", "ok", "👍",
// opcionalmente seguido de um nome/license para desambiguar.
// Retorna null se não for um comando de aprovação.
export function parseApprovalCommand(text: string): { target: string | null } | null {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  // Primeira palavra precisa ser um gatilho de aprovação.
  const m = t.match(/^(sim|aprovar|aprova|aprovado|ok|👍)\b\s*(.*)$/);
  if (!m) return null;
  const target = (m[2] || "").trim();
  return { target: target || null };
}

// Carrega a allowlist de telefones do super admin (chaves normalizadas).
async function loadSuperAdminPhoneKeys(
  supabase: SupabaseClient,
  superAdminConsultantId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();

  if (superAdminConsultantId) {
    const { data: consultant } = await supabase
      .from("consultants")
      .select("phone")
      .eq("id", superAdminConsultantId)
      .maybeSingle();
    const k = phoneKey((consultant as any)?.phone);
    if (k) keys.add(k);
  }

  const { data: appSettings } = await supabase
    .from("app_settings")
    .select("super_admin_phone")
    .eq("id", "global")
    .maybeSingle();
  const k2 = phoneKey((appSettings as any)?.super_admin_phone);
  if (k2) keys.add(k2);

  return keys;
}

export function isSuperAdminPhone(
  senderPhone: string,
  allowedKeys: Set<string>,
): boolean {
  const k = phoneKey(senderPhone);
  return !!k && allowedKeys.has(k);
}

export interface HandleApprovalInput {
  supabase: SupabaseClient;
  superAdminConsultantId: string;
  senderPhone: string; // dígitos do remetente (remoteJid sem @s.whatsapp.net)
  messageText: string;
  sender: ApprovalSender; // Whapi sender para confirmar de volta
  remoteJid: string; // para responder ao super admin
}

export interface HandleApprovalOutput {
  handled: boolean; // true = era comando do super admin; webhook deve dar early-return
  approvedConsultantId?: string;
}

// Núcleo: tenta tratar a mensagem como comando de aprovação do super admin.
// Retorna handled=false quando NÃO é (mensagem segue o fluxo normal).
export async function handleSuperAdminApproval(
  input: HandleApprovalInput,
): Promise<HandleApprovalOutput> {
  const { supabase, superAdminConsultantId, senderPhone, messageText, sender, remoteJid } = input;

  const cmd = parseApprovalCommand(messageText);
  if (!cmd) return { handled: false };

  // Confirma que é o super admin pelo telefone (segurança).
  const allowed = await loadSuperAdminPhoneKeys(supabase, superAdminConsultantId);
  if (!isSuperAdminPhone(senderPhone, allowed)) {
    // Não é o super admin: não trata como aprovação (segue fluxo normal).
    return { handled: false };
  }

  // Busca cadastros pendentes (approved=false), mais recentes primeiro.
  const { data: pendentes, error } = await supabase
    .from("consultants")
    .select("id, name, license, phone, created_at")
    .eq("approved", false)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    await sender.sendText(remoteJid, `⚠️ Erro ao buscar cadastros pendentes: ${error.message}`);
    return { handled: true };
  }

  const lista = (pendentes as any[]) || [];

  if (lista.length === 0) {
    await sender.sendText(remoteJid, "✅ Não há cadastros pendentes de aprovação no momento.");
    return { handled: true };
  }

  // Escolhe qual aprovar.
  let alvo: any | null = null;

  if (cmd.target) {
    // Super admin especificou nome/license: casa por inclusão (case-insensitive).
    const alvoLower = cmd.target.toLowerCase();
    const matches = lista.filter((c) =>
      String(c.name || "").toLowerCase().includes(alvoLower) ||
      String(c.license || "").toLowerCase().includes(alvoLower)
    );
    if (matches.length === 0) {
      await sender.sendText(
        remoteJid,
        `⚠️ Não encontrei cadastro pendente com "${cmd.target}".\n\nPendentes:\n` +
          lista.map((c) => `• ${c.name || "(sem nome)"} (${c.license || "—"})`).join("\n"),
      );
      return { handled: true };
    }
    if (matches.length > 1) {
      await sender.sendText(
        remoteJid,
        `⚠️ Mais de um cadastro casou com "${cmd.target}". Seja mais específico:\n` +
          matches.map((c) => `• ${c.name || "(sem nome)"} (${c.license || "—"})`).join("\n"),
      );
      return { handled: true };
    }
    alvo = matches[0];
  } else if (lista.length === 1) {
    // Só um pendente: aprova direto.
    alvo = lista[0];
  } else {
    // Vários pendentes e nenhum especificado: pede desambiguação.
    await sender.sendText(
      remoteJid,
      `❓ Há ${lista.length} cadastros pendentes. Responda *SIM <nome>* para escolher:\n` +
        lista.map((c) => `• ${c.name || "(sem nome)"} (${c.license || "—"})`).join("\n"),
    );
    return { handled: true };
  }

  // Aprova o alvo.
  const { error: updErr } = await supabase
    .from("consultants")
    .update({ approved: true } as any)
    .eq("id", alvo.id);

  if (updErr) {
    await sender.sendText(remoteJid, `⚠️ Erro ao aprovar ${alvo.name || alvo.id}: ${updErr.message}`);
    return { handled: true };
  }

  // Auditoria (best-effort).
  try {
    await supabase.from("admin_audit_log").insert({
      admin_user_id: superAdminConsultantId,
      action: "approve_consultant",
      target_type: "consultant",
      target_id: String(alvo.id),
      metadata: { via: "whatsapp_sim", approved: true },
    } as any);
  } catch (_) { /* best-effort */ }

  await sender.sendText(
    remoteJid,
    `✅ *${alvo.name || "Consultor"}* aprovado!\n` +
      `Já pode acessar o painel.` +
      (lista.length > 1 ? `\n\n_Ainda restam ${lista.length - 1} cadastro(s) pendente(s)._` : ""),
  );

  return { handled: true, approvedConsultantId: String(alvo.id) };
}
