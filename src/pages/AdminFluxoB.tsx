import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Sparkles, ArrowLeft, FlaskConical, BarChart3 } from "lucide-react";
import FluxoBEditor from "@/components/admin/flow-builder/FluxoBEditor";
import VariantsPanel from "@/components/admin/flow-builder/VariantsPanel";

interface Consultant { id: string; name: string }

export default function AdminFluxoB() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<"editor" | "variants">("editor");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("consultants")
        .select("id, name")
        .order("name");
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
            <h1 className="text-3xl font-bold flex items-center gap-2"><Sparkles className="w-7 h-7 text-primary" />Fluxo B — IA Livre</h1>
            <p className="text-sm text-muted-foreground">A IA conversa do início ao fim. A v1 fecha o cadastro sozinha quando tem tudo.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="editor"><FlaskConical className="h-4 w-4 mr-2" />Editor & Tester</TabsTrigger>
            <TabsTrigger value="variants"><BarChart3 className="h-4 w-4 mr-2" />Variantes (A/B/N)</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="space-y-6 mt-4">
            <Card>
              <CardHeader><CardTitle>Consultor</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {consultants.map(c => (
                    <Button
                      key={c.id}
                      variant={c.id === selectedId ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedId(c.id)}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
            {selectedId && <FluxoBEditor consultantId={selectedId} />}
          </TabsContent>

          <TabsContent value="variants" className="mt-4">
            <VariantsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
