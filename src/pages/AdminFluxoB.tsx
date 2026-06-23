import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Sparkles, ArrowLeft, FlaskConical, BookOpen, User } from "lucide-react";
import PersonaPanel from "@/components/admin/fluxo-b-ia/PersonaPanel";
import SimulatorPanel from "@/components/admin/fluxo-b-ia/SimulatorPanel";
import ConsultantVariantsCard from "@/components/admin/fluxo-b-ia/ConsultantVariantsCard";
import FluxoAKeywordsCard from "@/components/admin/fluxo-b-ia/FluxoAKeywordsCard";
import AdminKnowledge from "@/pages/AdminKnowledge";

interface Consultant { id: string; name: string }

export default function AdminFluxoB() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<"persona" | "knowledge" | "simulator" | "consultor">(() => {
    if (typeof window === "undefined") return "persona";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (t === "knowledge" || t === "simulator" || t === "consultor" || t === "persona") ? t : "persona";
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("consultants").select("id, name").order("name");
      if (error) {
        toast({ title: "Erro carregando consultores", description: error.message, variant: "destructive" });
      } else if (data) {
        setConsultants(data as Consultant[]);
        if (data.length > 0) setSelectedId((data[0] as Consultant).id);
      }
      setLoading(false);
    })();
  }, [toast]);

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Admin</Button></Link>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-primary" />Painel da IA — Fluxo B
            </h1>
            <p className="text-sm text-muted-foreground">
              Persona, base de conhecimento, simulador e distribuição por consultor.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="persona"><Sparkles className="h-4 w-4 mr-2" />Persona</TabsTrigger>
            <TabsTrigger value="knowledge"><BookOpen className="h-4 w-4 mr-2" />Conhecimento</TabsTrigger>
            <TabsTrigger value="simulator"><FlaskConical className="h-4 w-4 mr-2" />Simulador</TabsTrigger>
            <TabsTrigger value="consultor"><User className="h-4 w-4 mr-2" />Por Consultor</TabsTrigger>
          </TabsList>

          <TabsContent value="persona" className="mt-4">
            <PersonaPanel />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-4">
            <AdminKnowledge embedded />
          </TabsContent>

          <TabsContent value="simulator" className="mt-4 space-y-4">
            {selectedId && (
              <Card>
                <CardHeader><CardTitle>Consultor de teste</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {consultants.map(c => (
                      <Button key={c.id} variant={c.id === selectedId ? "default" : "outline"} size="sm" onClick={() => setSelectedId(c.id)}>
                        {c.name}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {selectedId && <SimulatorPanel consultantId={selectedId} />}
          </TabsContent>

          <TabsContent value="consultor" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle>Selecione o consultor</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {consultants.map(c => (
                    <Button key={c.id} variant={c.id === selectedId ? "default" : "outline"} size="sm" onClick={() => setSelectedId(c.id)}>
                      {c.name}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
            {selectedId && <ConsultantVariantsCard consultantId={selectedId} />}
            {selectedId && <FluxoAKeywordsCard consultantId={selectedId} />}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
