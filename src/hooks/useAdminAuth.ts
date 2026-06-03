import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

const DEFAULT_CONSULTANT_FORM = {
  name: "", license: "", phone: "", notification_phone: "", cadastro_url: "", igreen_id: "",
  licenciada_cadastro_url: "", facebook_pixel_id: "", google_analytics_id: "",
  igreen_portal_email: "", igreen_portal_password: "",
  // Portal 1 ('digital') = Playwright UI; Portal 2 ('autoconexao') = API direta.
  // Default 'digital' mantém comportamento atual; consultor opta pelo novo no painel.
  portal_kind: "digital" as "digital" | "autoconexao",
};

export type ConsultantForm = typeof DEFAULT_CONSULTANT_FORM;

function buildPendingConsultantDefaults(uid: string, email?: string | null) {
  const rawBase = (email?.split("@")[0] || `consultor-${uid.slice(0, 8)}`)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const slugBase = rawBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || `consultor-${uid.slice(0, 6)}`;
  return {
    id: uid, name: email?.split("@")[0] || "Novo consultor",
    license: `${slugBase}-${uid.slice(0, 4)}`, phone: "", cadastro_url: "", approved: false,
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
        phone: (consultant.phone as string) || "",
        notification_phone: (consultant.notification_phone as string) || "",
        igreen_id: id,
        cadastro_url: id ? `https://digital.igreenenergy.com.br/?id=${id}&sendcontract=true` : (consultant.cadastro_url as string) || "",
        licenciada_cadastro_url: id ? `https://expansao.igreenenergy.com.br/?id=${id}&checkout=true` : (consultant.licenciada_cadastro_url as string) || "",
        facebook_pixel_id: (consultant.facebook_pixel_id as string) || "", google_analytics_id: (consultant.google_analytics_id as string) || "",
        igreen_portal_email: (consultant.igreen_portal_email as string) || "", igreen_portal_password: (consultant.igreen_portal_password as string) || "",
        portal_kind: ((consultant.portal_kind as string) === "autoconexao" ? "autoconexao" : "digital"),
      });
      if (consultant.photo_url) setPhotoPreview(consultant.photo_url as string);
    };
    try {
      const { data, error } = await supabase.from("consultants").select("*").eq("id", uid).maybeSingle();
      if (isStale()) return; if (error) throw error;
      if (data) { applyConsultantData(data); return; }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (isStale()) return; if (userError) throw userError;
      const pendingConsultant = buildPendingConsultantDefaults(uid, userData.user?.email);
      const { data: createdData, error: createError } = await supabase.from("consultants").upsert(pendingConsultant, { onConflict: "id" }).select("*").single();
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
