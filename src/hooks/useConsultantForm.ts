import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import type { ConsultantForm } from "./useAdminAuth";

function normalizeLicenseValue(value: string, uid: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `consultor-${uid.slice(0, 8).toLowerCase()}`;
}

function buildFallbackLicense(value: string, uid: string) {
  return `${value.replace(/-+$/g, "")}-${uid.slice(0, 8).toLowerCase()}`;
}

export function useConsultantForm(
  userId: string | null,
  form: ConsultantForm,
  setForm: (fn: (prev: ConsultantForm) => ConsultantForm) => void,
  setPhotoPreview: (url: string | null) => void,
) {
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setPhotoFile(file); setLocalPhotoPreview(URL.createObjectURL(file)); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    try {
      let photo_url: string | undefined;
      if (photoFile) {
        try {
          const { uploadMedia } = await import("@/services/minioUpload");
          const result = await uploadMedia(photoFile, undefined, {
            scope: "avatar",
            consultant_id: userId,
            kind: "avatar",
          });
          photo_url = `${result.url}?t=${Date.now()}`;
        } catch (e) {
          // Fallback Supabase Storage caso MinIO offline
          const ext = photoFile.name.split(".").pop();
          const path = `${userId}/photo.${ext}`;
          const { error: uploadError } = await supabase.storage.from("consultant-photos").upload(path, photoFile, { upsert: true });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from("consultant-photos").getPublicUrl(path);
          photo_url = `${urlData.publicUrl}?t=${Date.now()}`;
        }
      }
      const normalizedLicense = normalizeLicenseValue(form.license, userId);
      const [existingResult, conflictingResult] = await Promise.all([
        supabase.from("consultants").select("id, license").eq("id", userId).maybeSingle(),
        supabase.from("consultants").select("id, license").eq("license", normalizedLicense).neq("id", userId).maybeSingle(),
      ]);
      if (existingResult.error) throw existingResult.error;
      if (conflictingResult.error) throw conflictingResult.error;
      const existingConsultant = existingResult.data;
      const conflictingConsultant = conflictingResult.data;
      let finalLicense = normalizedLicense;
      let licenseAdjusted = false;
      if (conflictingConsultant) {
        finalLicense = buildFallbackLicense(normalizedLicense, userId);
        licenseAdjusted = true;
      }
      const consultantFields: Database["public"]["Tables"]["consultants"]["Update"] = {
        name: form.name, license: finalLicense, phone: form.phone.replace(/\D/g, ""),
        notification_phone: form.notification_phone ? form.notification_phone.replace(/\D/g, "") : null,
        cadastro_url: form.cadastro_url, igreen_id: form.igreen_id || null,
        licenciada_cadastro_url: form.licenciada_cadastro_url || null,
        facebook_pixel_id: form.facebook_pixel_id || null, google_analytics_id: form.google_analytics_id || null,
        igreen_portal_email: form.igreen_portal_email || null,
        portal_kind: form.portal_kind === "autoconexao" ? "autoconexao" : "digital",
      };
      // Só envia a senha se o usuário digitou um valor novo (campo vem vazio do banco por segurança).
      if (form.igreen_portal_password && form.igreen_portal_password.trim()) {
        consultantFields.igreen_portal_password = form.igreen_portal_password;
      }
      if (photo_url) consultantFields.photo_url = photo_url;
      const saveConsultant = async (licenseToSave: string) => {
        const fieldsToSave = { ...consultantFields, license: licenseToSave };
        if (existingConsultant) {
          return supabase.from("consultants").update(fieldsToSave).eq("id", userId).select("license, photo_url").single();
        }
        const insertPayload: Database["public"]["Tables"]["consultants"]["Insert"] = {
          id: userId, name: form.name, license: licenseToSave, phone: form.phone.replace(/\D/g, ""),
          notification_phone: form.notification_phone ? form.notification_phone.replace(/\D/g, "") : null,
          cadastro_url: form.cadastro_url, igreen_id: form.igreen_id || null,
          licenciada_cadastro_url: form.licenciada_cadastro_url || null,
          facebook_pixel_id: form.facebook_pixel_id || null, google_analytics_id: form.google_analytics_id || null,
          igreen_portal_email: form.igreen_portal_email || null,
          portal_kind: form.portal_kind === "autoconexao" ? "autoconexao" : "digital",
          ...(form.igreen_portal_password && form.igreen_portal_password.trim() ? { igreen_portal_password: form.igreen_portal_password } : {}),
          ...(photo_url ? { photo_url } : {}),
        };
        return supabase.from("consultants").insert(insertPayload).select("license, photo_url").single();
      };
      let { data: savedConsultant, error } = await saveConsultant(finalLicense);
      if (error?.code === "23505" && `${error.message || ""}`.includes("consultants_license_key")) {
        finalLicense = buildFallbackLicense(normalizedLicense, userId);
        licenseAdjusted = true;
        ({ data: savedConsultant, error } = await saveConsultant(finalLicense));
      }
      if (error) throw error;
      setForm((prev) => ({ ...prev, license: savedConsultant?.license || finalLicense }));
      if (savedConsultant?.photo_url) { setPhotoPreview(savedConsultant.photo_url); setPhotoFile(null); setLocalPhotoPreview(null); }

      // Auto-ativa telefone principal como destino dos anúncios do Facebook.
      const phoneDigits = form.phone.replace(/\D/g, "");
      if (phoneDigits) {
        try {
          await supabase.from("consultant_ad_settings").upsert(
            { consultant_id: userId, whatsapp_destination_number: phoneDigits },
            { onConflict: "consultant_id" },
          );
        } catch (adsErr) {
          console.warn("[useConsultantForm] falha ao sincronizar whatsapp_destination_number", adsErr);
        }
      }

      toast({ title: "✅ Dados salvos com sucesso!", ...(licenseAdjusted ? { description: `A licença foi ajustada automaticamente para ${savedConsultant?.license || finalLicense}.` } : {}) });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
      toast({ title: "Erro ao salvar", description: msg || "Erro desconhecido", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return {
    saving,
    photoPreview: localPhotoPreview,
    handlePhotoChange,
    handleSave,
  };
}
