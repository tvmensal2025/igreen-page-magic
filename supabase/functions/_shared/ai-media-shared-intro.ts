/**
 * Intros “Olá, Nome! Tudo bem?” compartilhados entre consultores.
 *
 * - Slot canônico: intro:ola:ptbr4:{nome}
 * - Legado: intro:ola:{nome}
 * - is_public=true → qualquer consultor reusa (Zap / ligação / pós-venda)
 * - Nunca regenera ElevenLabs se já existir URL própria ou pública
 */

export function olaIntroSlotCandidates(nameNorm: string): string[] {
  const n = String(nameNorm || "").trim();
  if (!n) return [];
  return [`intro:ola:ptbr4:${n}`, `intro:ola:${n}`];
}

export type SharedIntroHit = {
  url: string;
  slotKey: string;
  /** true se veio de is_public (outro ou mesmo consultor marcado público) */
  fromPublic: boolean;
  consultantId: string | null;
};

type AdminLike = {
  from: (table: string) => any;
};

async function findOwnedUrl(
  admin: AdminLike,
  consultantId: string,
  slotKey: string,
  active: boolean,
): Promise<{ url: string; consultantId: string } | null> {
  const q = admin
    .from("ai_media_library")
    .select("url, consultant_id")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", active)
    .order("created_at", { ascending: active ? false : true })
    .limit(1)
    .maybeSingle();
  const { data } = await q;
  if (!data?.url) return null;
  return { url: String(data.url), consultantId: String(data.consultant_id || consultantId) };
}

async function findPublicUrl(
  admin: AdminLike,
  slotKey: string,
  active: boolean,
): Promise<{ url: string; consultantId: string | null } | null> {
  const { data } = await admin
    .from("ai_media_library")
    .select("url, consultant_id")
    .eq("slot_key", slotKey)
    .eq("is_public", true)
    .eq("active", active)
    .order("created_at", { ascending: active ? false : true })
    .limit(1)
    .maybeSingle();
  if (!data?.url) return null;
  return {
    url: String(data.url),
    consultantId: data.consultant_id ? String(data.consultant_id) : null,
  };
}

/**
 * Ordem: ativo próprio → ativo público → inativo próprio → inativo público.
 */
export async function findSharedIntroUrl(
  admin: AdminLike,
  opts: {
    consultantId: string;
    slotCandidates: string[];
  },
): Promise<SharedIntroHit | null> {
  const seen = new Set<string>();
  for (const slotKey of opts.slotCandidates) {
    if (!slotKey || seen.has(slotKey)) continue;
    seen.add(slotKey);

    const ownActive = await findOwnedUrl(admin, opts.consultantId, slotKey, true);
    if (ownActive) {
      return {
        url: ownActive.url,
        slotKey,
        fromPublic: false,
        consultantId: ownActive.consultantId,
      };
    }

    const pubActive = await findPublicUrl(admin, slotKey, true);
    if (pubActive) {
      return {
        url: pubActive.url,
        slotKey,
        fromPublic: true,
        consultantId: pubActive.consultantId,
      };
    }

    const ownInactive = await findOwnedUrl(admin, opts.consultantId, slotKey, false);
    if (ownInactive) {
      return {
        url: ownInactive.url,
        slotKey,
        fromPublic: false,
        consultantId: ownInactive.consultantId,
      };
    }

    const pubInactive = await findPublicUrl(admin, slotKey, false);
    if (pubInactive) {
      return {
        url: pubInactive.url,
        slotKey,
        fromPublic: true,
        consultantId: pubInactive.consultantId,
      };
    }
  }
  return null;
}

/** Atalho: candidatos Olá canônicos + legado. */
export async function findSharedOlaIntroUrl(
  admin: AdminLike,
  consultantId: string,
  nameNorm: string,
): Promise<SharedIntroHit | null> {
  return findSharedIntroUrl(admin, {
    consultantId,
    slotCandidates: olaIntroSlotCandidates(nameNorm),
  });
}

/**
 * Grava intro sob o consultor com is_public=true (reuso global).
 * Não apaga linhas antigas — só desativa o ativo do mesmo consultant+slot.
 */
export async function upsertPublicIntro(
  admin: AdminLike,
  opts: {
    consultantId: string;
    slotKey: string;
    url: string;
    label: string;
    transcript?: string;
    intentTags?: string[];
  },
): Promise<void> {
  const slotKey = String(opts.slotKey || "").trim();
  if (!slotKey || !opts.url) return;

  try {
    await admin
      .from("ai_media_library")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("consultant_id", opts.consultantId)
      .eq("slot_key", slotKey)
      .eq("active", true);
  } catch { /* ok */ }

  await admin.from("ai_media_library").insert({
    consultant_id: opts.consultantId,
    slot_key: slotKey,
    url: opts.url,
    kind: "audio",
    label: String(opts.label || "").slice(0, 120),
    transcript: String(opts.transcript || "").slice(0, 500),
    active: true,
    is_public: true,
    is_draft: false,
    step_tags: [],
    intent_tags: opts.intentTags?.length
      ? opts.intentTags
      : ["wa_intro", "call_intro"],
    priority: 0,
  });
}

/** Saudação pós-venda fixa — também pública entre consultores. */
export function saudacaoSlotKey(bucket: "manha" | "tarde" | "noite"): string {
  return `pv_saudacao:${bucket}:v1`;
}

export async function findSharedFixedClipUrl(
  admin: AdminLike,
  consultantId: string,
  slotKey: string,
): Promise<SharedIntroHit | null> {
  return findSharedIntroUrl(admin, {
    consultantId,
    slotCandidates: [slotKey],
  });
}
