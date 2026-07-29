// useCtwaPreflight
// ────────────────
// Aglutina os 4 checks que precisam estar verdes pro consultor publicar um
// anúncio Click-to-WhatsApp:
//   1. Bot WhatsApp conectado (Whapi AUTH / instance whapi* OU Evolution connected_phone)
//   2. Facebook plataforma OK (ctwa-status)
//   3. Pixel (recomendado, não bloqueante)
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

function isWhapiInstanceName(name: string | null | undefined): boolean {
  return !!name && /^whapi/i.test(String(name));
}

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

    // 1) Bot conectado — Whapi (primário) OU Evolution (legado)
    try {
      const { data: settingsRows } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["superadmin_consultant_id", "whapi_connected_phone"]);
      const settingsMap = Object.fromEntries(
        ((settingsRows as Array<{ key: string; value: string }> | null) || []).map((s) => [s.key, s.value]),
      );
      const isSuper = settingsMap.superadmin_consultant_id === consultantId;

      if (isSuper) {
        const phone = (settingsMap.whapi_connected_phone || "").replace(/\D/g, "");
        setBot({
          status: "ok",
          label: "WhatsApp conectado",
          detail: phone ? `Whapi +${phone}` : "WhatsApp (Whapi)",
        });
      } else {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("connected_phone,status,instance_name")
          .eq("consultant_id", consultantId)
          .maybeSingle();

        const whapiNamed = isWhapiInstanceName(inst?.instance_name);
        if (whapiNamed) {
          // Canal Whapi: health real via edge (AUTH). Sem AUTH → fail com hint certo.
          try {
            const { data: health } = await supabase.functions.invoke("whapi-proxy", {
              body: { action: "health_check", payload: {} },
            });
            const status = String((health as any)?.status || "").toUpperCase();
            const phone =
              String((health as any)?.phone || inst?.connected_phone || "").replace(/\D/g, "") || null;
            if (status === "AUTH") {
              setBot({
                status: "ok",
                label: "WhatsApp conectado",
                detail: phone ? `Whapi +${phone}` : "WhatsApp (Whapi)",
              });
            } else {
              setBot({
                status: "fail",
                label: "WhatsApp (Whapi) offline",
                hint: "Abra a aba WhatsApp e reconecte o canal Whapi (status AUTH) para atender os leads.",
                detail: status || undefined,
              });
            }
          } catch {
            // Se o health falhar mas há telefone gravado, avisa sem bloquear à toa.
            if (inst?.connected_phone) {
              setBot({
                status: "ok",
                label: "WhatsApp conectado",
                detail: `Whapi +${String(inst.connected_phone).replace(/\D/g, "")}`,
              });
            } else {
              setBot({
                status: "fail",
                label: "WhatsApp ainda não conectado",
                hint: "Abra a aba WhatsApp e conecte o canal (Whapi) para atender os clientes.",
              });
            }
          }
        } else if (inst?.connected_phone) {
          setBot({
            status: "ok",
            label: "WhatsApp conectado",
            detail: `+${String(inst.connected_phone).replace(/\D/g, "")}`,
          });
        } else {
          setBot({
            status: "fail",
            label: "WhatsApp ainda não conectado",
            hint: "Abra a aba WhatsApp e conecte seu número para poder atender os clientes dos anúncios.",
          });
        }
      }
    } catch (e) {
      console.warn("[ctwa-preflight] bot check failed", e);
      setBot({ status: "fail", label: "Erro ao verificar WhatsApp" });
    }

    // 2) Facebook + Pixel — consulta o status consolidado da CONTA PLATAFORMA
    //    (platform_facebook_account). Não usamos mais facebook_connections do
    //    consultor — o pixel é travado e o token é compartilhado.
    let platformPageOk = false;
    try {
      const { data, error } = await supabase.functions.invoke("ctwa-status");
      if (error || !data?.ok) {
        setFacebook({ status: "fail", label: "Erro ao verificar Facebook", hint: (data as any)?.error || error?.message });
        setPixel({ status: "fail", label: "Erro ao verificar rastreamento" });
      } else {
        setFacebook(data.facebook);
        setPixel(data.pixel);
        platformPageOk = data.facebook?.status === "ok";
      }
    } catch (e) {
      console.warn("[ctwa-preflight] ctwa-status failed", e);
      setFacebook({ status: "fail", label: "Erro ao verificar Facebook" });
      setPixel({ status: "fail", label: "Erro ao verificar rastreamento" });
    }



    // 3) WABA via edge function (só faz sentido se Facebook OK)
    if (platformPageOk) {
      try {
        const { data, error } = await supabase.functions.invoke("facebook-detect-waba");
        if (error || !data?.ok) {
          setWaba({
            status: "fail",
            label: "WhatsApp Business não encontrado",
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
            label: "Número diferente do cadastrado na Meta",
            detail: `Números na Meta: ${data.numbers?.map((n: any) => n.display).join(", ")}`,
            hint: "Escolha um dos números oficiais em Anúncios e clique em Reverificar.",
          });
        } else {
          setWaba({
            status: "ok",
            label: "WhatsApp Business ligado à Página",
            detail: data.numbers?.[0]?.display || data.current_number,
          });
        }
      } catch (e: any) {
        console.warn("[ctwa-preflight] waba check failed", e);
        setWaba({ status: "fail", label: "Erro ao consultar WhatsApp Business", detail: e?.message });
      }
    } else {
      setWaba({ status: "fail", label: "WhatsApp Business não verificado", hint: "Conecte a Página primeiro." });
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
