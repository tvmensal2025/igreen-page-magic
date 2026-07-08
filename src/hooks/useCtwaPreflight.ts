// useCtwaPreflight
// ────────────────
// Aglutina os 4 checks que precisam estar verdes pro consultor publicar um
// anúncio Click-to-WhatsApp:
//   1. Bot WhatsApp conectado (whatsapp_instances.connected_phone)
//   2. Facebook conectado e token válido (facebook_connections.status='active' + expira > now)
//   3. Pixel configurado (facebook_connections.pixel_id)
//   4. WABA registrado na Página + bate com whatsapp_destination_number
//      (chamada à edge facebook-detect-waba sob demanda)
//
// Devolve loading + cada check separado + ready (todos verdes) +
// um refresh() pra forçar nova consulta após o consultor configurar algo.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CheckStatus = "ok" | "warn" | "fail" | "loading";

export interface CtwaCheck {
  status: CheckStatus;
  label: string;
  detail?: string;
  hint?: string;
}

export interface CtwaPreflightState {
  loading: boolean;
  ready: boolean;
  bot: CtwaCheck;
  facebook: CtwaCheck;
  pixel: CtwaCheck;
  waba: CtwaCheck;
  refresh: () => Promise<void>;
}

const LOADING: CtwaCheck = { status: "loading", label: "Verificando..." };

export function useCtwaPreflight(consultantId: string | null): CtwaPreflightState {
  const [loading, setLoading] = useState(true);
  const [bot, setBot] = useState<CtwaCheck>(LOADING);
  const [facebook, setFacebook] = useState<CtwaCheck>(LOADING);
  const [pixel, setPixel] = useState<CtwaCheck>(LOADING);
  const [waba, setWaba] = useState<CtwaCheck>(LOADING);

  const run = useCallback(async () => {
    if (!consultantId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // 1) Bot conectado (Evolution OU Whapi via super admin)
    try {
      const { data: settingsRows } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["superadmin_consultant_id"]);
      const isSuper =
        (settingsRows as Array<{ key: string; value: string }> | null)?.find(
          (s) => s.key === "superadmin_consultant_id"
        )?.value === consultantId;


      if (isSuper) {
        setBot({ status: "ok", label: "WhatsApp do bot conectado", detail: "Whapi (super admin)" });
      } else {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("connected_phone,status")
          .eq("consultant_id", consultantId)
          .maybeSingle();
        if (inst?.connected_phone) {
          setBot({
            status: "ok",
            label: "WhatsApp do bot conectado",
            detail: `+${inst.connected_phone}`,
          });
        } else {
          setBot({
            status: "fail",
            label: "WhatsApp do bot NÃO conectado",
            hint: "Abra a aba WhatsApp e escaneie o QR Code para o bot poder responder leads.",
          });
        }
      }
    } catch (e) {
      console.warn("[ctwa-preflight] bot check failed", e);
      setBot({ status: "fail", label: "Erro ao verificar bot" });
    }

    // 2) Facebook + Pixel — consulta o status consolidado da CONTA PLATAFORMA
    //    (platform_facebook_account). Não usamos mais facebook_connections do
    //    consultor — o pixel é travado e o token é compartilhado.
    let platformPageOk = false;
    try {
      const { data, error } = await supabase.functions.invoke("ctwa-status");
      if (error || !data?.ok) {
        setFacebook({ status: "fail", label: "Erro ao verificar Facebook", hint: (data as any)?.error || error?.message });
        setPixel({ status: "fail", label: "Erro ao verificar Pixel" });
      } else {
        setFacebook(data.facebook);
        setPixel(data.pixel);
        platformPageOk = data.facebook?.status === "ok";
      }
    } catch (e) {
      console.warn("[ctwa-preflight] ctwa-status failed", e);
      setFacebook({ status: "fail", label: "Erro ao verificar Facebook" });
      setPixel({ status: "fail", label: "Erro ao verificar Pixel" });
    }



    // 3) WABA via edge function (só faz sentido se Facebook OK)
    if (platformPageOk) {
      try {
        const { data, error } = await supabase.functions.invoke("facebook-detect-waba");
        if (error || !data?.ok) {
          setWaba({
            status: "fail",
            label: "WABA não detectado",
            hint: data?.hint || "Vincule seu WhatsApp Business à Página no Meta Business Suite.",
          });
        } else if (!data.connected) {
          setWaba({
            status: "fail",
            label: "Página sem WhatsApp Business vinculado",
            hint: data.hint,
          });
        } else if (!data.matches) {
          setWaba({
            status: "fail",
            label: "Número não bate com a WABA",
            detail: `WABA tem ${data.numbers?.map((n: any) => n.display).join(", ")}`,
            hint: "Escolha um dos números oficiais da WABA em Anúncios → Configurações e clique em Reverificar.",
          });
        } else {
          setWaba({
            status: "ok",
            label: "WABA validado",
            detail: data.numbers?.[0]?.display || data.current_number,
          });
        }
      } catch (e: any) {
        console.warn("[ctwa-preflight] waba check failed", e);
        setWaba({ status: "fail", label: "Erro ao consultar WABA", detail: e?.message });
      }
    } else {
      setWaba({ status: "fail", label: "WABA não verificado", hint: "Conecte a Página primeiro." });
    }

    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    run();
  }, [run]);

  const ready =
    bot.status === "ok" &&
    facebook.status === "ok" &&
    (pixel.status === "ok" || pixel.status === "warn") && // pixel é recomendado, não bloqueante
    waba.status === "ok";

  return { loading, ready, bot, facebook, pixel, waba, refresh: run };
}
