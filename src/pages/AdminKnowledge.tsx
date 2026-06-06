import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Zap, Brain, UserCheck, BookOpen, Loader2 } from "lucide-react";
import FaqSection from "@/components/admin/fluxo/FaqSection";
import AdminFaq from "./AdminFaq";

export default function AdminKnowledge() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "ia" ? "ia" : "atalhos";

  const [loading, setLoading] = useState(true);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [shortcutsCount, setShortcutsCount] = useState<number | null>(null);
  const [iaCount, setIaCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { navigate("/auth"); return; }

      const { data: flows } = await supabase
        .from("bot_flows").select("id").eq("consultant_id", uid).eq("is_active", true)
        .order("created_at").limit(1);
      let fid = flows?.[0]?.id ?? null;
      if (!fid) {
        const { data } = await supabase.rpc("seed_default_camila_flow", { _consultant_id: uid });
        fid = (data as string) ?? null;
      }
      setFlowId(fid);

      if (fid) {
        const { count: scCount } = await supabase
          .from("bot_flow_qa")
          .select("id", { count: "exact", head: true })
          .eq("flow_id", fid)
          .eq("is_opening", false)
          .eq("is_closing", false);
        setShortcutsCount(scCount ?? 0);
      }

      const { count: ic } = await supabase
        .from("ai_knowledge_sections")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      setIaCount(ic ?? 0);

      setLoading(false);
    })();
  }, [navigate]);

  function setTab(v: string) {
    setParams({ tab: v });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <BookOpen className="h-6 w-6 text-primary" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold truncate">Conhecimento do bot</h1>
            <p className="text-xs text-muted-foreground">
              Como a Camila responde quando o cliente pergunta algo fora do fluxo
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Banner de cascata */}
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="flex gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">1. Atalhos rápidos</p>
                <p className="text-xs text-muted-foreground">Resposta exata por palavra-chave. Com áudio/vídeo opcional.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">2. Base da IA</p>
                <p className="text-xs text-muted-foreground">Se nenhum atalho casar, a IA lê este conteúdo e responde.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                <UserCheck className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">3. Handoff humano</p>
                <p className="text-xs text-muted-foreground">Sem confiança ou tema sensível? Bot pausa e te avisa.</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
            Em qualquer um dos três, o passo atual do fluxo <strong>não muda</strong> — depois de responder a dúvida, a Camila retoma de onde parou.
          </p>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="atalhos" className="gap-2">
              <Zap className="h-4 w-4" />
              Atalhos rápidos
              {shortcutsCount !== null && (
                <Badge variant="secondary" className="ml-1">{shortcutsCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ia" className="gap-2">
              <Brain className="h-4 w-4" />
              Base da IA
              {iaCount !== null && (
                <Badge variant="secondary" className="ml-1">{iaCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="atalhos" className="mt-4">
            {flowId ? (
              <FaqSection flowId={flowId} />
            ) : (
              <Card className="p-6 text-center text-muted-foreground text-sm">
                Nenhum fluxo ativo encontrado.
              </Card>
            )}
          </TabsContent>

          <TabsContent value="ia" className="mt-4 space-y-4">
            <EmbeddingsControl />
            <AdminFaq embedded />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
