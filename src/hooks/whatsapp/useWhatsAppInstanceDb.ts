/**
 * Persistence layer for WhatsApp instances.
 * Handles all whatsapp_instances table operations.
 */
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchInstances, setInstanceWebhook } from "@/services/evolutionApi";
import type { Database } from "@/integrations/supabase/types";

type WhatsappInstanceUpdate =
  Database["public"]["Tables"]["whatsapp_instances"]["Update"];

export interface UseWhatsAppInstanceDb {
  saveInstance: (name: string) => Promise<void>;
  deleteInstanceDb: () => Promise<void>;
  fetchAndSaveConnectedPhone: (name: string) => Promise<void>;
  ensureWebhook: (name: string) => void;
}

export function useWhatsAppInstanceDb(consultantId: string): UseWhatsAppInstanceDb {
  const saveInstance = useCallback(
    async (name: string) => {
      await supabase
        .from("whatsapp_instances")
        .upsert(
          { consultant_id: consultantId, instance_name: name },
          { onConflict: "consultant_id" },
        );
    },
    [consultantId],
  );

  const deleteInstanceDb = useCallback(async () => {
    await supabase
      .from("whatsapp_instances")
      .delete()
      .eq("consultant_id", consultantId);
  }, [consultantId]);

  const fetchAndSaveConnectedPhone = useCallback(
    async (name: string) => {
      try {
        const instances = await fetchInstances();
        const inst = instances?.find((instance) => {
          const instanceName = instance?.instance?.instanceName ?? instance?.name;
          return instanceName === name;
        });
        const ownerJid =
          inst?.instance?.ownerJid ??
          inst?.instance?.owner ??
          inst?.ownerJid ??
          inst?.owner ??
          "";
        const phone = typeof ownerJid === "string" ? ownerJid.replace(/@.*$/, "") : "";
        const connectedDigits = phone.replace(/\D/g, "");

        if (!connectedDigits) return;

        const update: WhatsappInstanceUpdate = { connected_phone: connectedDigits };
        await supabase
          .from("whatsapp_instances")
          .update(update)
          .eq("consultant_id", consultantId);

        // Espelha no cadastro: sem phone o banner fica pedindo "Revalidar" para sempre
        // e os envios automáticos ficam bloqueados (proactive-send-guard).
        const { data: cons } = await supabase
          .from("consultants")
          .select("phone")
          .eq("id", consultantId)
          .maybeSingle();
        const existingDigits = String(cons?.phone || "").replace(/\D/g, "");
        const sameNumber =
          !!existingDigits &&
          existingDigits.slice(-11) === connectedDigits.slice(-11);

        if (!existingDigits || sameNumber) {
          await supabase
            .from("consultants")
            .update({
              phone: existingDigits || connectedDigits,
              phone_verified_at: new Date().toISOString(),
            })
            .eq("id", consultantId);

          if (!existingDigits) {
            try {
              await supabase.from("consultant_ad_settings").upsert(
                {
                  consultant_id: consultantId,
                  whatsapp_destination_number: connectedDigits,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "consultant_id" },
              );
            } catch {
              /* non-critical */
            }
          }
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("igreen-wa-phone-synced", {
            detail: { consultantId, connectedPhone: connectedDigits },
          }));
        }
      } catch {
        // Non-critical
      }
    },
    [consultantId],
  );

  const ensureWebhook = useCallback((name: string) => {
    setInstanceWebhook(name).catch(() => {
      /* non-critical */
    });
  }, []);

  return { saveInstance, deleteInstanceDb, fetchAndSaveConnectedPhone, ensureWebhook };
}
