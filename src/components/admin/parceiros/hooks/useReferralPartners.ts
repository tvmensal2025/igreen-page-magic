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
      return (data ?? []) as ReferralPartner[];
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
      input: Omit<ReferralPartner, "id" | "is_active" | "created_at">,
    ) => {
      // RLS-aware insert: WITH CHECK (consultant_id = auth.uid()) requires
      // the column to be present in the payload. Frontend resolves the
      // current user via auth.getUser() and stamps consultant_id explicitly.
      const { data: authData } = await supabase.auth.getUser();
      const consultantId = authData?.user?.id;
      if (!consultantId) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("referral_partners")
        .insert({ ...input, consultant_id: consultantId });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["referral-partners"] }),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<ReferralPartner> & { id: string }) => {
      const { error } = await supabase
        .from("referral_partners")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
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
