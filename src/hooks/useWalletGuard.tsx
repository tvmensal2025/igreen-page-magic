import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WalletGuardState {
  open: boolean;
  consultantId: string | null;
  balanceCents: number;
  debtCents: number;
  pausedCampaigns: Array<{ id: string; name: string; daily_budget_cents: number; rejection_reason: string | null }>;
  reason: "balance_zero" | "paused_no_balance" | null;
}

const SNOOZE_KEY = "wallet_guard_snooze_until";

/**
 * Monitora o saldo do consultor logado em tempo real. Quando o saldo zera
 * OU existe alguma campanha pausada com motivo "saldo*", abre o popup
 * obrigatório de recarga. Persiste snooze de 24h via localStorage.
 */
export function useWalletGuard() {
  const [state, setState] = useState<WalletGuardState>({
    open: false,
    consultantId: null,
    balanceCents: 0,
    debtCents: 0,
    pausedCampaigns: [],
    reason: null,
  });

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setState((s) => ({ ...s, open: false, consultantId: null }));
      return;
    }
    const consultantId = user.id;

    const [{ data: wallet }, { data: paused }] = await Promise.all([
      supabase.from("consultant_wallet")
        .select("balance_cents,debt_cents")
        .eq("consultant_id", consultantId)
        .maybeSingle(),
      supabase.from("facebook_campaigns")
        .select("id,name,daily_budget_cents,rejection_reason,status")
        .eq("consultant_id", consultantId)
        .eq("status", "paused")
        .ilike("rejection_reason", "%saldo%"),
    ]);

    const balance = Number((wallet as any)?.balance_cents ?? 0);
    const debt = Number((wallet as any)?.debt_cents ?? 0);
    const pausedCamps = (paused || []) as any[];

    const snoozeUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    const snoozed = snoozeUntil > Date.now();

    let reason: WalletGuardState["reason"] = null;
    if (debt > 0) reason = "balance_zero";
    else if (balance <= 0 && pausedCamps.length > 0) reason = "paused_no_balance";
    else if (pausedCamps.length > 0) reason = "paused_no_balance";

    setState({
      open: !!reason && !snoozed,
      consultantId,
      balanceCents: balance,
      debtCents: debt,
      pausedCampaigns: pausedCamps.map((p) => ({
        id: p.id, name: p.name, daily_budget_cents: p.daily_budget_cents, rejection_reason: p.rejection_reason,
      })),
      reason,
    });
  }, []);

  useEffect(() => {
    refresh();
    // Realtime na carteira do consultor
    let channel: any;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      channel = supabase
        .channel(`wallet-guard-${user.id}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "consultant_wallet",
          filter: `consultant_id=eq.${user.id}`,
        }, () => refresh())
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "facebook_campaigns",
          filter: `consultant_id=eq.${user.id}`,
        }, () => refresh())
        .subscribe();
    })();
    // Poll fallback (5 min) caso realtime esteja off
    const t = setInterval(refresh, 5 * 60_000);
    return () => {
      clearInterval(t);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  const snooze24h = useCallback(() => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60_000));
    setState((s) => ({ ...s, open: false }));
  }, []);

  const clearSnooze = useCallback(() => {
    localStorage.removeItem(SNOOZE_KEY);
    refresh();
  }, [refresh]);

  return { ...state, refresh, snooze24h, clearSnooze, setOpen: (open: boolean) => setState((s) => ({ ...s, open })) };
}
