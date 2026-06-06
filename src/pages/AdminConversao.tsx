import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Rota legada: /admin/conversao agora é apenas um redirect para a aba
 * Conversão dentro do shell padrão do Admin, preservando o filtro `partner`.
 */
export default function AdminConversao() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set("tab", "conversao");
    const partner = params.get("partner");
    if (partner) sp.set("partner", partner);
    navigate(`/admin?${sp.toString()}`, { replace: true });
  }, [navigate, params]);
  return null;
}
