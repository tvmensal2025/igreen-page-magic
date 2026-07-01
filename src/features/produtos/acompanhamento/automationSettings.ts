// Hook de configurações de automação iGreen (toggles por consultor).
// Tudo começa DESLIGADO — o consultor ativa cada recurso individualmente.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AutomationSettings {
  consultant_id: string;
  // captura
  capture_devolutivas: boolean;
  capture_cashback: boolean;
  capture_boletos: boolean;
  capture_telecom: boolean;
  capture_seguros: boolean;
  // alertas
  alert_boletos_vencendo: boolean;
  alert_devolutivas: boolean;
  alert_licencas_expirando: boolean;
  rotinas_tarefas: boolean;
  // whatsapp proativo
  auto_wa_boleto_vencendo: boolean;
  auto_wa_aniversariante: boolean;
  cross_sell_bot: boolean;
}

const DEFAULTS: Omit<AutomationSettings, "consultant_id"> = {
  // Capturas: SEMPRE ligadas — o sync do iGreen tem que buscar e salvar tudo.
  capture_devolutivas: true,
  capture_cashback: true,
  capture_boletos: true,
  capture_telecom: true,
  capture_seguros: true,
  alert_boletos_vencendo: true,
  alert_devolutivas: true,
  alert_licencas_expirando: true,
  rotinas_tarefas: true,
  auto_wa_boleto_vencendo: false,
  auto_wa_aniversariante: false,
  cross_sell_bot: false,
};

export function useAutomationSettings(consultantId?: string) {
  return useQuery({
    queryKey: ["igreen-automation-settings", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<AutomationSettings> => {
      const { data, error } = await supabase
        .from("igreen_automation_settings" as never)
        .select("*")
        .eq("consultant_id", consultantId!)
        .maybeSingle();
      if (error) throw error;
      return { consultant_id: consultantId!, ...DEFAULTS, ...(data as object || {}) } as AutomationSettings;
    },
  });
}

export function useUpdateAutomationSetting(consultantId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AutomationSettings>) => {
      const row = { consultant_id: consultantId, ...patch };
      const { error } = await supabase
        .from("igreen_automation_settings" as never)
        .upsert(row as never, { onConflict: "consultant_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["igreen-automation-settings", consultantId] }),
  });
}
