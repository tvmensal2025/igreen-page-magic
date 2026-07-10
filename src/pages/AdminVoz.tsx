import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Compat: /admin/voz redireciona para a aba dentro do Admin (sem sair do shell).
 */
export default function AdminVoz() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/admin?tab=voz", { replace: true });
  }, [navigate]);

  return (
    <div className="painel-elite grid min-h-screen place-items-center" style={{ background: "var(--pe-bg)" }}>
      <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--pe-emerald)" }} />
    </div>
  );
}
