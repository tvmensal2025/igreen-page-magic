// Geração e envio do "welcome header" (saudação + protocolo de atendimento).
//
// Idempotente: se `customers.tracking_protocol` já estiver preenchido,
// NÃO regera nem reenvia.
//
// Formato do PROTOCOLO DE ATENDIMENTO (ticket do cliente):
//   IGR-{XXX}-{seq4}  ex.: IGR-RFF-0042
//   - XXX = short_code do parceiro OU 3 iniciais do nome (pad 'X' se curto).
//   - seq4 = sequência global crescente por parceiro (não zera por dia).
//
// IMPORTANTE — não confundir com o PROTOCOLO DA CAMPANHA (2026-####),
// que vai no anúncio Meta e é usado pra casar o lead com a campanha/rodízio.
// Esse aqui é o "número do chamado" que fica com o cliente pra suporte.


import { greetingForNow, partnerInitials } from "./greeting.ts";

export interface AssignProtocolResult {
  protocol: string;
  isNew: boolean;
}

export async function assignProtocolToCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
  opts: {
    partnerId?: string | null;
    partnerName?: string | null;
    consultantId?: string | null;
    consultantName?: string | null;
  },
): Promise<AssignProtocolResult | null> {
  try {
    const { data: existing } = await supabase
      .from("customers")
      .select("tracking_protocol")
      .eq("id", customerId)
      .maybeSingle();

    if (existing?.tracking_protocol) {
      return { protocol: existing.tracking_protocol, isNew: false };
    }

    // Bucket da sequência: parceiro > consultor > customer (sempre UUID válido)
    const partnerId = opts.partnerId || opts.consultantId || customerId;

    // Busca short_code + nome do parceiro para a RPC (chave estável)
    let partnerName = opts.partnerName || null;
    let shortCode: string | null = null;
    if (opts.partnerId) {
      const { data: p } = await supabase
        .from("referral_partners")
        .select("nome, short_code")
        .eq("id", opts.partnerId)
        .maybeSingle();
      if (p) {
        partnerName = partnerName || (p as any).nome || null;
        shortCode = (p as any).short_code ? String((p as any).short_code) : null;
      }
    }

    // Sem nome do consultor → busca no banco (evita IGR-IGR-####).
    let consultantName = String(opts.consultantName || "").trim();
    if (!consultantName && opts.consultantId) {
      const { data: cons } = await supabase
        .from("consultants")
        .select("name, display_name")
        .eq("id", opts.consultantId)
        .maybeSingle();
      consultantName = String(
        (cons as { display_name?: string } | null)?.display_name ||
          (cons as { name?: string } | null)?.name ||
          "",
      ).trim();
    }

    // _initials: short_code do parceiro > iniciais humanas. Nunca "IGR" no meio
    // (senão vira IGR-IGR-4900 — bug Leandro 2026-07-28).
    let initialsHint = shortCode || partnerInitials(partnerName || consultantName || "");
    if (!initialsHint || initialsHint.toUpperCase() === "IGR") {
      const fromCons = partnerInitials(consultantName);
      if (fromCons && fromCons.toUpperCase() !== "IGR") initialsHint = fromCons;
      else initialsHint = "XXX";
    }

    const { data: gen, error } = await supabase.rpc("generate_partner_protocol_v2", {
      _partner_id: partnerId,
      _initials: initialsHint,
    });
    if (error || !gen) {
      console.warn("[protocol] rpc v2 falhou:", error?.message);
      // Fallback local no MESMO formato IGR-XXX-####
      const rawIni = String(initialsHint || "XXX")
        .toUpperCase().replace(/[^A-Z0-9]/g, "");
      let ini3 = (rawIni.length >= 3 ? rawIni.slice(0, 3) : rawIni.padEnd(3, "X"));
      if (ini3 === "IGR") ini3 = "XXX";
      const seq4 = String(Math.floor(1000 + Math.random() * 9000));
      const protocol = `IGR-${ini3}-${seq4}`;
      await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId);
      return { protocol, isNew: true };
    }

    let protocol = String(gen);
    // RPC ainda pode devolver IGR-IGR se _initials veio vazio no passado — saneia.
    if (/^IGR-IGR-/i.test(protocol)) {
      const seq = protocol.split("-").pop() || String(Math.floor(1000 + Math.random() * 9000));
      const rawIni = String(initialsHint || "XXX").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let ini3 = (rawIni.length >= 3 ? rawIni.slice(0, 3) : rawIni.padEnd(3, "X"));
      if (ini3 === "IGR") ini3 = "XXX";
      protocol = `IGR-${ini3}-${seq}`;
    }
    await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId);
    return { protocol, isNew: true };
  } catch (e) {
    console.warn("[protocol] assign falhou:", (e as Error).message);
    return null;
  }
}


/** Remove cargo/título grudado no nome (ex.: "Rafael Ferreira, Gestor"). */
export function stripConsultantRoleSuffix(name: string | null | undefined): string {
  return String(name || "")
    .replace(/[,–—\-]\s*(gestor|gestora|consultor|consultora)\b.*$/i, "")
    .replace(/\s+\*?(gestor|gestora|consultor|consultora)\*?\s*$/i, "")
    .trim();
}

/** True se o label é só o substantivo de papel — nunca vai entre *asteriscos* na abertura. */
export function isConsultantRoleNounLabel(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim().toLowerCase();
  return /^(seu |sua )?(consultor|consultora)$/.test(s);
}

/**
 * Remove vazamentos legados na abertura (bug 2026-07-28 Leandro):
 * - `, *Gestor*` hardcoded (buildWelcome antigo)
 * - `*consultora*` / `*consultor*` no lugar do nome
 * - artigo órfão após nome vazio (`Aqui é o  da`)
 */
export function scrubLegacyWelcomeRoleLeak(text: string): string {
  let out = String(text || "");
  // ", *Gestor*" / ", gestor" imediatamente antes de "da iGreen"
  out = out.replace(/,\s*\*?gestor(?:a)?\*?\s+(?=da\b)/gi, " ");
  // Nome + cargo no mesmo bold: "*Rafael, Gestor*" → "*Rafael*"
  out = out.replace(
    /\*([^*\n]+?),\s*(gestor|gestora|consultor|consultora)\*/gi,
    (_m, nome: string) => `*${String(nome).trim()}*`,
  );
  // Substantivo de papel no lugar do nome humano
  out = out.replace(
    /Aqui é\s+(o|a)\s+\*?(seu |sua )?(consultor|consultora)\*?\s+da/gi,
    "Aqui é o atendimento da",
  );
  // Artigo órfão quando {{consultor}} veio vazio: "Aqui é o  da" / "Aqui é a * * da"
  out = out.replace(/Aqui é\s+(o|a)\s+\*?\s*\*?\s+da/gi, "Aqui é o atendimento da");
  out = out.replace(/👤\s*Consultor\(a\):\s*\*?[^*\n]*\*?\s*/gi, "");
  return out
    .replace(/\*\s*\*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildWelcomeHeaderGreeting(consultantName?: string | null): string {
  const who = stripConsultantRoleSuffix(consultantName);
  const lines = [
    `Olá! ${greetingForNow()}`,
    "Este é o canal de atendimento especializado da *iGreen Energy*.",
  ];
  if (who && !isConsultantRoleNounLabel(who)) {
    lines.push(`Você será atendido(a) por *${who}*.`);
  }
  return lines.join("\n");
}

/**
 * Bloco profissional de abertura (marca + protocolo).
 * Artigo o/a conforme gender do consultor (nunca "Aqui é consultor" sem artigo).
 * Sem nome humano → "Aqui é o atendimento da iGreen" (nunca "a *consultora*").
 * Nunca hardcodar cargo (Gestor/Gestora).
 */
export function buildWelcomeHeaderProtocol(
  protocol: string,
  consultantName?: string | null,
  opts?: { gender?: "consultor" | "consultora" | string | null },
): string {
  const whoRaw = stripConsultantRoleSuffix(consultantName);
  const who = whoRaw && !isConsultantRoleNounLabel(whoRaw) ? whoRaw : "";
  const oa = String(opts?.gender || "").trim() === "consultora" ? "a" : "o";
  const proto = String(protocol || "").trim();
  const intro = who
    ? `Olá! Aqui é ${oa} *${who}* da *iGreen*.`
    : "Olá! Aqui é o atendimento da *iGreen*.";
  return scrubLegacyWelcomeRoleLeak([
    "*iGreen | Conta de Luz Mais Barata 🌱*",
    "",
    intro,
    "",
    "Seu atendimento foi iniciado com sucesso e eu vou acompanhar você durante todo o processo.",
    proto ? `\n📋 *Protocolo:* ${proto}` : null,
  ].filter((l) => l !== null).join("\n"));
}

/** Texto único A1 / abertura: cabeçalho + pedido do nome. */
export function buildGrupoAOpenAttendanceText(opts: {
  consultantName?: string | null;
  protocol?: string | null;
  gender?: "consultor" | "consultora" | string | null;
}): string {
  const header = buildWelcomeHeaderProtocol(
    String(opts.protocol || "").trim(),
    opts.consultantName,
    { gender: opts.gender },
  );
  return `${header}\n\nPara agilizar seu atendimento, por favor, informe seu *primeiro nome*.`;
}
