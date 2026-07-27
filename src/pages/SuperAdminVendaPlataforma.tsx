/**
 * Rota legada → redireciona para o painel Admin com sidebar.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

const SuperAdminVendaPlataforma = () => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/admin?tab=venda-plataforma", { replace: true });
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

export default SuperAdminVendaPlataforma;
