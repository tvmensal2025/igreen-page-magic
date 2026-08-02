import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ReferralPartner {
  id: string;
  nome: string;
  keywords: string[];
  cli: string | null;
  qr_phrase: string | null;
  partner_igreen_id: string | null;
  notification_phone: string | null;
  /** Código curto numérico (gerado no banco) usado no link /r/{licenca}/{short_code}. */
  short_code: string | null;
  /** Token da página pública do parceiro (/p/{token}). */
  portal_token?: string | null;
  /** Limiar de alerta 24h (0 = off). */
  banner_alert_threshold?: number | null;
  is_active: boolean;
  created_at: string;
}

export interface PartnerMetric {
  partner_id: string;
  partner_nome: string;
  lead_count: number;
}

export function useReferralPartners() {
  const queryClient = useQueryClient();

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["referral-partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReferralPartner[];
    },
  });

  const { data: metrics = [] } = useQuery({
    queryKey: ["referral-partner-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_referral_partner_metrics",
      );
      if (error) throw error;
      return (data ?? []) as PartnerMetric[];
    },
  });

  const create = useMutation({
    mutationFn: async (
      input: Omit<
        ReferralPartner,
        "id" | "is_active" | "created_at" | "short_code"
      >,
    ) => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(`Sessão inválida: ${authErr.message}`);
      const consultantId = authData?.user?.id;
      if (!consultantId)
        throw new Error("Usuário não autenticado. Faça login novamente.");

      // Sanitiza entrada para nunca falhar por dado sujo
      const nome = (input.nome ?? "").trim();
      if (!nome) throw new Error("Nome é obrigatório");
      const keywords = Array.from(
        new Set(
          (input.keywords ?? [])
            .map((k) => (k ?? "").trim())
            .filter(Boolean),
        ),
      );
      const payload = {
        consultant_id: consultantId,
        nome,
        keywords,
        cli: input.cli?.trim() || null,
        qr_phrase: input.qr_phrase?.trim() || null,
        partner_igreen_id: input.partner_igreen_id?.trim() || null,
        notification_phone: input.notification_phone?.trim() || null,
      };

      // Retry leve para colisões transitórias do short_code (unique constraint)
      let lastErr: any = null;
      for (let i = 0; i < 3; i++) {
        const { data, error } = await supabase
          .from("referral_partners")
          .insert(payload)
          .select("*")
          .single();
        if (!error && data) return data as unknown as ReferralPartner;
        lastErr = error;
        const msg = (error?.message || "").toLowerCase();
        const isTransient =
          error?.code === "23505" ||
          msg.includes("short_code") ||
          msg.includes("duplicate");
        if (!isTransient) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      throw new Error(lastErr?.message || "Falha ao salvar parceiro");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["referral-partners"] }),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<ReferralPartner> & { id: string }) => {
      const normalizedPatch = {
        ...patch,
        ...(patch.qr_phrase !== undefined
          ? { qr_phrase: patch.qr_phrase?.trim().slice(0, 600) || null }
          : {}),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("referral_partners")
        .update(normalizedPatch)
        .eq("id", id)
        .select("id, qr_phrase")
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error("A frase não foi gravada. Atualize a sessão e tente novamente.");
      if (patch.qr_phrase !== undefined) {
        const expected = patch.qr_phrase?.trim().slice(0, 600) || null;
        if (data.qr_phrase !== expected) {
          throw new Error("A confirmação do banco divergiu da frase enviada.");
        }
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["referral-partners"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("referral_partners")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["referral-partners"] }),
  });

  return { partners, metrics, create, update, remove, isLoading };
}
