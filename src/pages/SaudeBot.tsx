// SaudeBot — página de saúde do bot por consultor.
// O conteúdo vive em BotHealthDashboard (reaproveitado também dentro da aba
// "Atendente IA" → Desempenho & Saúde). Esta página só adiciona o chrome
// (voltar + título) e resolve o userId da sessão.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import BotHealthDashboard from "@/components/admin/saude/BotHealthDashboard";

export default function SaudeBot() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { navigate("/auth"); return; }
      setUserId(data.user.id);
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Saúde do bot</h1>
            <p className="text-xs text-muted-foreground">Tudo que precisa da sua atenção pra Camila não travar.</p>
          </div>
        </div>

        {userId && <BotHealthDashboard userId={userId} />}
      </div>
    </div>
  );
}
