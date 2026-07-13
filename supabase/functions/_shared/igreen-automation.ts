// =============================================================================
// iGreen automation helpers (edge) — toggles e enfileiramento sem envio
// =============================================================================
// NÃO envia WhatsApp daqui. Só decide se o consultor pediu automação e monta
// alertas/fila. O envio real exige automation_toggles master + dryRun=false.
// =============================================================================

// deno-lint-ignore no-explicit-any
type SB = any;

export type IgreenWaKind = "boleto" | "aniversario";

export function isProactiveWaEnabled(
  toggles: Record<string, boolean>,
  kind: IgreenWaKind,
): boolean {
  if (kind === "boleto") return !!toggles.auto_wa_boleto_vencendo;
  return !!toggles.auto_wa_aniversariante;
}

export function isCrossSellBotEnabled(toggles: Record<string, boolean>): boolean {
  return !!toggles.cross_sell_bot;
}

/**
 * Enfileira candidatos de WA proativo como alertas (sem enviar mensagem).
 * Dedup por alert_type + idcliente (ou data para aniversário).
 */
export async function enqueueProactiveWaCandidates(
  supabase: SB,
  consultantId: string,
  toggles: Record<string, boolean>,
  data: {
    boletos?: Array<Record<string, unknown>>;
    metrics?: { rotina_diaria?: { aniversariantes?: Array<Record<string, unknown>> } };
  },
): Promise<{ queued: number }> {
  const want: string[] = [];
  if (isProactiveWaEnabled(toggles, "boleto")) want.push("igreen_wa_boleto_queued");
  if (isProactiveWaEnabled(toggles, "aniversario")) want.push("igreen_wa_aniversario_queued");
  if (want.length === 0) return { queued: 0 };

  const openKeys = new Set<string>();
  const { data: existing } = await supabase
    .from("bot_handoff_alerts")
    .select("alert_type, metadata")
    .eq("consultant_id", consultantId)
    .is("resolved_at", null)
    .in("alert_type", want);
  for (const e of (existing || []) as Array<{ alert_type: string; metadata: Record<string, unknown> | null }>) {
    const idc = e.metadata?.idcliente ?? e.metadata?.dedup ?? "_";
    openKeys.add(`${e.alert_type}|${idc}`);
  }

  const rows: Record<string, unknown>[] = [];
  const pushOnce = (alert_type: string, idcliente: unknown, row: Record<string, unknown>) => {
    const key = `${alert_type}|${idcliente ?? "_"}`;
    if (openKeys.has(key)) return;
    openKeys.add(key);
    rows.push(row);
  };

  const today = new Date();
  const inDays = (iso: string, min: number, max: number) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
    return diff >= min && diff <= max;
  };

  if (isProactiveWaEnabled(toggles, "boleto")) {
    for (const b of data.boletos || []) {
      const st = String(b.status || "").toLowerCase();
      if (st.includes("pago") || st.includes("baixad")) continue;
      const vencRaw = String(b.vencimento || "");
      let iso = vencRaw;
      const m = vencRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (!iso || !inDays(iso, -3, 3)) continue;
      pushOnce("igreen_wa_boleto_queued", b.idcliente, {
        consultant_id: consultantId,
        alert_type: "igreen_wa_boleto_queued",
        reason: `Fila WA (dry): boleto de ${b.nome || "cliente"} vence ${b.vencimento || "?"} — sem envio automático`,
        phone: null,
        metadata: {
          dry_run: true,
          idcliente: b.idcliente,
          vencimento: b.vencimento,
          url_boleto: b.url_boleto ?? b.link ?? null,
          mes_referencia: b.mes_referencia ?? b.mesReferencia ?? null,
        },
      });
    }
  }

  if (isProactiveWaEnabled(toggles, "aniversario")) {
    const list = data.metrics?.rotina_diaria?.aniversariantes || [];
    const ymd = today.toISOString().slice(0, 10);
    for (const a of list) {
      const idc = a.idcliente ?? a.id ?? a.nome;
      pushOnce("igreen_wa_aniversario_queued", `${idc}|${ymd}`, {
        consultant_id: consultantId,
        alert_type: "igreen_wa_aniversario_queued",
        reason: `Fila WA (dry): aniversário de ${a.nome || "cliente"} — sem envio automático`,
        phone: null,
        metadata: {
          dry_run: true,
          idcliente: a.idcliente ?? a.id ?? null,
          dedup: `${idc}|${ymd}`,
          nome: a.nome ?? null,
        },
      });
    }
  }

  if (rows.length === 0) return { queued: 0 };
  const { error } = await supabase.from("bot_handoff_alerts").insert(rows);
  if (error) {
    console.warn("[igreen-automation] enqueue falhou:", error.message);
    return { queued: 0 };
  }
  return { queued: rows.length };
}
