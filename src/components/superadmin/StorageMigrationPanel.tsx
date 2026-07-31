import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { HardDriveDownload, Loader2 } from "lucide-react";

type RunResult = {
  bucket: string;
  total: number;
  pending: number;
  processed: number;
  ok: number;
  fail: number;
  errors?: string[];
};

/**
 * Migração Supabase Storage → MinIO.
 * Padrão do projeto: mídia e documento moram no MinIO (`documentos/...`,
 * `whatsapp/...`), o Supabase Storage fica só como fallback.
 */
export function StorageMigrationPanel() {
  const { toast } = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);

  const run = async (label: string, body: Record<string, unknown>) => {
    setRunning(label);
    try {
      const { data, error } = await supabase.functions.invoke("migrate-supabase-to-minio", { body });
      if (error) throw error;
      const res = (data as any)?.results as RunResult[] | undefined;
      setResults(res || []);
      const ok = (res || []).reduce((a, r) => a + (r.ok || 0), 0);
      const fail = (res || []).reduce((a, r) => a + (r.fail || 0), 0);
      toast({
        title: `Migração: ${ok} ok · ${fail} falha(s)`,
        description: (res || []).map((r) => `${r.bucket}: ${r.pending} pendente(s)`).join(" · "),
        variant: fail ? "destructive" : "default",
      });
    } catch (e: any) {
      toast({ title: "Falha na migração", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDriveDownload className="h-4 w-4" />
          Storage → MinIO
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Move os arquivos que ainda estão no Supabase Storage para o MinIO e atualiza as
          referências no banco (documentos do cliente, templates e fotos do consultor).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!!running}
            onClick={() => run("docs", { buckets: ["whatsapp-media"], prefix: "captacao/", batchSize: 50 })}
          >
            {running === "docs" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Migrar documentos da captação
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!!running}
            onClick={() => run("base64", { buckets: ["base64_no_banco"], batchSize: 50 })}
          >
            {running === "base64" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tirar base64 do banco (50)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!running}
            onClick={() => run("all", { buckets: ["whatsapp-media", "consultant-photos"], batchSize: 50 })}
          >
            {running === "all" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Migrar lote geral (50)
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.bucket} className="rounded-md border p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{r.bucket}</Badge>
                  <span>total {r.total}</span>
                  <span>pendente {r.pending}</span>
                  <span className="text-primary">ok {r.ok}</span>
                  {r.fail > 0 && <span className="text-destructive">falha {r.fail}</span>}
                </div>
                {r.errors?.length ? (
                  <ul className="mt-1 list-disc pl-4 text-destructive">
                    {r.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StorageMigrationPanel;
