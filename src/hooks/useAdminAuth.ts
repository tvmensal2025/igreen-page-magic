import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { buildClubCadastroUrl } from "@/lib/clubCadastroUrl";

const DEFAULT_CONSULTANT_FORM = {
  name: "", license: "", phone: "", notification_phone: "", cadastro_url: "", igreen_id: "",
  // Nome humano de exibição usado nas mensagens enviadas ao lead (ex.: "Abel Olympio").
  // Quando vazio, o sistema cai pro `name`; se `name` for slug (ex.: "abelolympio"),
  // usa o genérico "consultor" para não vazar username.
  display_name: "",
  licenciada_cadastro_url: "",
  club_cadastro_url: "",
  facebook_pixel_id: "", google_analytics_id: "",
  igreen_portal_email: "", igreen_portal_password: "",
  // Nome da assistente virtual (IA) + gênero do representante (do/da).
  assistant_name: "", gender: "" as "" | "consultor" | "consultora",
  // Portal 1 ('digital') = Playwright UI; Portal 2 ('autoconexao') = API direta.
  // Default 'digital' mantém comportamento atual; consultor opta pelo novo no painel.
  portal_kind: "digital" as "digital" | "autoconexao",
};

export type ConsultantForm = typeof DEFAULT_CONSULTANT_FORM;

/** Só Auth cria a linha de consultor. Aqui só lemos / completamos se metadata tiver WhatsApp. */
function buildPendingConsultantDefaults(
  uid: string,
  email?: string | null,
  meta?: { full_name?: string; phone?: string } | null,
) {
  const phoneClean = String(meta?.phone || "").replace(/\D/g, "");
  if (phoneClean.length < 10) return null;
  const rawName = (meta?.full_name || email?.split("@")[0] || `consultor-${uid.slice(0, 8)}`).trim();
  const rawBase = rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const slugBase = rawBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || `consultor-${uid.slice(0, 6)}`;
  const license = `${slugBase}-${uid.slice(0, 4)}`;
  return {
    id: uid,
    name: rawName || "Novo consultor",
    license,
    phone: phoneClean,
    cadastro_url: license,
    approved: false,
  } satisfies Database["public"]["Tables"]["consultants"]["Insert"];
}

export function useAdminAuth() {
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<ConsultantForm>({ ...DEFAULT_CONSULTANT_FORM });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const navigate = useNavigate();
  const loadingUidRef = useRef<string | null>(null);
  const activeUidRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const resetConsultantState = () => {
    setApproved(false);
    setForm({ ...DEFAULT_CONSULTANT_FORM });
    setPhotoPreview(null);
  };

  useEffect(() => {
    const handleSession = (session: { user: { id: string } } | null) => {
      if (!session) {
        activeUidRef.current = null; loadingUidRef.current = null; loadRequestIdRef.current += 1;
        setUserId(null); resetConsultantState(); setLoading(false); navigate("/auth"); return;
      }
      const uid = session.user.id;
      if (loadingUidRef.current === uid || activeUidRef.current === uid) return;
      loadingUidRef.current = uid; activeUidRef.current = uid;
      const requestId = ++loadRequestIdRef.current;
      setLoading(true); resetConsultantState(); setUserId(uid);
      void loadConsultant(uid, requestId);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => { handleSession(session); });
    supabase.auth.getSession().then(({ data: { session } }) => { handleSession(session); });
    return () => { subscription.unsubscribe(); activeUidRef.current = null; loadingUidRef.current = null; loadRequestIdRef.current += 1; };
  }, [navigate]);

  const loadConsultant = async (uid: string, requestId: number) => {
    const isStale = () => activeUidRef.current !== uid || loadRequestIdRef.current !== requestId;
    const applyConsultantData = (consultant: Record<string, unknown>) => {
      if (isStale()) return;
      const id = (consultant.igreen_id as string) || "";
      setApproved(consultant.approved === true);
      const consultantName = (consultant.name as string) || "";
      const regeneratedLicense = consultantName.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || (consultant.license as string) || "";
      setForm({
        ...DEFAULT_CONSULTANT_FORM, name: consultantName, license: regeneratedLicense,
        display_name: (consultant.display_name as string) || "",
        phone: (consultant.phone as string) || "",
        notification_phone: (consultant.notification_phone as string) || "",
        igreen_id: id,
        cadastro_url: id ? `https://digital.igreenenergy.com.br/?id=${id}&sendcontract=true` : (consultant.cadastro_url as string) || "",
        licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : (consultant.licenciada_cadastro_url as string) || "",
        club_cadastro_url: id ? buildClubCadastroUrl(id) : (consultant.club_cadastro_url as string) || "",
        facebook_pixel_id: (consultant.facebook_pixel_id as string) || "", google_analytics_id: (consultant.google_analytics_id as string) || "",
        igreen_portal_email: (consultant.igreen_portal_email as string) || "", igreen_portal_password: "",
        assistant_name: (consultant.assistant_name as string) || "",
        gender: ((consultant.gender as string) === "consultora" ? "consultora" : (consultant.gender as string) === "consultor" ? "consultor" : ""),
        portal_kind: ((consultant.portal_kind as string) === "autoconexao" ? "autoconexao" : "digital"),
      });
      if (consultant.photo_url) setPhotoPreview(consultant.photo_url as string);
    };
    try {
      const { data, error } = await supabase.from("consultants").select("id, igreen_id, approved, name, display_name, license, phone, notification_phone, cadastro_url, licenciada_cadastro_url, club_cadastro_url, facebook_pixel_id, google_analytics_id, igreen_portal_email, assistant_name, gender, portal_kind, photo_url").eq("id", uid).maybeSingle();
      if (isStale()) return; if (error) throw error;
      if (data) { applyConsultantData(data); return; }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (isStale()) return; if (userError) throw userError;
      const meta = (userData.user?.user_metadata || {}) as { full_name?: string; phone?: string };
      const pendingConsultant = buildPendingConsultantDefaults(uid, userData.user?.email, meta);
      // Sem WhatsApp no metadata = Auth ainda não gravou. NÃO cria stub vazio.
      // Poll curto: o insert do /auth pode estar a milissegundos de concluir.
      if (!pendingConsultant) {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if (isStale()) return;
          const { data: again } = await supabase
            .from("consultants")
            .select("id, igreen_id, approved, name, display_name, license, phone, notification_phone, cadastro_url, licenciada_cadastro_url, club_cadastro_url, facebook_pixel_id, google_analytics_id, igreen_portal_email, assistant_name, gender, portal_kind, photo_url")
            .eq("id", uid)
            .maybeSingle();
          if (again) {
            applyConsultantData(again);
            return;
          }
        }
        console.warn("[useAdminAuth] consultant row still missing after wait — not creating stub");
        resetConsultantState();
        return;
      }
      const { data: createdData, error: createError } = await supabase.from("consultants").upsert(pendingConsultant, { onConflict: "id" }).select("id, igreen_id, approved, name, display_name, license, phone, notification_phone, cadastro_url, licenciada_cadastro_url, club_cadastro_url, facebook_pixel_id, google_analytics_id, igreen_portal_email, assistant_name, gender, portal_kind, photo_url").single();
      if (isStale()) return; if (createError) throw createError;
      applyConsultantData(createdData);
    } catch (e) {
      if (isStale()) return;
      console.error("[useAdminAuth] loadConsultant failed:", e);
      resetConsultantState();
    }
    finally {
      // `return` em finally é unsafe (no-unsafe-finally) — substituiria
      // qualquer return/throw do try/catch silenciosamente. Aqui só queremos
      // pular `setLoading(false)` quando stale. Forma segura: condicionar
      // a chamada dentro do bloco em vez de retornar do finally.
      if (!isStale()) {
        setLoading(false);
        loadingUidRef.current = null;
      }
    }
  };

  const handleFormChange = (updates: Record<string, string>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/auth"); };

  return {
    loading, approved, userId, form, photoPreview,
    setPhotoPreview, handleFormChange, handleLogout,
    setForm,
  };
}
