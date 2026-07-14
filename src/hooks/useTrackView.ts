import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTrackingMeta } from "./useTrackEvent";

/** pageType: "client" | "licenciada" | "cadastro" | slug do produto (ex.: "conexao-telecom") */
export function useTrackView(consultantId: string | undefined, pageType: string) {
  useEffect(() => {
    if (!consultantId) return;
    const meta = getTrackingMeta();
    supabase.from("page_views").insert({
      consultant_id: consultantId,
      page_type: pageType,
      ...meta,
    }).then(() => {});
  }, [consultantId, pageType]);
}
