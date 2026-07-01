import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Página legada — todo o conteúdo (Carteira iGreen + lista de clientes)
 * foi absorvido pela aba "Clientes" do Admin. Aqui só redirecionamos.
 */
export default function WhatsAppClientsPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/admin?tab=clientes", { replace: true });
  }, [navigate]);
  return null;
}
