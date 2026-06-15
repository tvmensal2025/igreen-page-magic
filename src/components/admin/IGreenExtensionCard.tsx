import { useEffect, useState } from "react";
import { Download, Plus, Trash2, Copy, Check, Chrome, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface TokenRow {
  id: string;
  label: string;
  token_prefix: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function IGreenExtensionCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("igreen_extension_tokens")
      .select("id, label, token_prefix, expires_at, revoked_at, last_used_at, created_at")
      .eq("consultant_id", userId)
      .order("created_at", { ascending: false });
    setTokens((data || []) as TokenRow[]);
    setLoading(false);
  };

  useEffect(() => { if (userId) load(); }, [userId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const token = randomToken();
      const token_hash = await sha256Hex(token);
      const token_prefix = token.slice(0, 8);
      const { error } = await supabase.from("igreen_extension_tokens").insert({
        consultant_id: userId,
        label: `Extensao ${new Date().toLocaleDateString("pt-BR")}`,
        token_hash, token_prefix,
      });
      if (error) throw error;
      setNewToken(token);
      load();
    } catch (e) {
      toast({ title: "Erro ao gerar chave", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const removeToken = async (id: string, prefix: string) => {
    if (!confirm(`Excluir a chave ${prefix}…?\nEsta ação é permanente e a extensão ligada a esta chave deixará de funcionar imediatamente.`)) return;
    const { error } = await supabase
      .from("igreen_extension_tokens")
      .delete()
      .eq("id", id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Chave excluída", description: "Pareamento removido permanentemente." });
      load();
    }
  };

  const copyToken = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadExtension = () => {
    fetch("/igreen-sync-extension.zip")
      .then((r) => { if (!r.ok) throw new Error("Falha no download"); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "igreen-sync-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        setShowInstructions(true);
      })
      .catch((e) => toast({ title: "Erro", description: e.message, variant: "destructive" }));
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Chrome className="h-4 w-4" /> Sincronizacao iGreen via Extensao</h3>
          <p className="text-xs text-muted-foreground mt-1">
            A extensao usa sua propria sessao logada no portal para baixar automaticamente os Excel de <b>Mapa de Clientes</b> e <b>Mapa de Rede</b> e enviar para o iGreen Cloud. Sem login automatizado, sem risco de bloqueio.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadExtension} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Baixar extensao
        </Button>
        <Button onClick={() => setShowInstructions(true)} variant="ghost" size="sm">
          Como instalar
        </Button>
        <Button onClick={generate} disabled={generating} size="sm" className="ml-auto">
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Gerar token
        </Button>
      </div>

      <div className="space-y-1">
        {loading && <p className="text-xs text-muted-foreground">Carregando...</p>}
        {!loading && tokens.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma chave gerada ainda.</p>}
        {tokens.map((t) => {
          const expired = new Date(t.expires_at).getTime() < Date.now();
          const status = t.revoked_at ? "Revogado" : expired ? "Expirado" : "Ativo";
          const statusColor = t.revoked_at || expired ? "text-muted-foreground" : "text-primary";
          return (
            <div key={t.id} className="flex items-center justify-between text-xs border rounded p-2">
              <div>
                <div className="font-mono">{t.token_prefix}••••••••</div>
                <div className={`${statusColor}`}>
                  {status}
                  {t.last_used_at && ` • Último uso: ${new Date(t.last_used_at).toLocaleString("pt-BR")}`}
                  {!t.last_used_at && ` • Nunca usado`}
                </div>
              </div>
              <Button onClick={() => removeToken(t.id, t.token_prefix)} variant="ghost" size="sm" title="Excluir chave permanentemente">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Modal: novo token gerado */}
      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave gerada</DialogTitle>
            <DialogDescription>
              Copie agora — ela não será mostrada de novo. Cole na extensão no campo de chave: ela é salva sozinha e some da tela.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={newToken || ""} readOnly className="font-mono text-xs" />
            <Button onClick={copyToken} size="sm">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: instrucoes */}
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Chrome className="h-5 w-5 text-primary" /> Instalar em 4 passos
            </DialogTitle>
            <DialogDescription className="sr-only">
              Passo a passo para carregar a extensão iGreen Sync no Chrome.
            </DialogDescription>
          </DialogHeader>

          <ol className="space-y-3 text-sm">
            {[
              <>Descompacte o arquivo <code className="px-1 rounded bg-muted text-xs">igreen-sync-extension.zip</code>.</>,
              <>Abra <code className="px-1 rounded bg-muted text-xs">chrome://extensions</code> e ative o <b>Modo desenvolvedor</b>.</>,
              <>Clique em <b>Carregar sem compactação</b> e selecione a pasta. <span className="text-muted-foreground">(Se já estava instalada, clique em ↻ Atualizar.)</span></>,
              <>Clique no ícone <b className="text-primary">G</b> da extensão, cole a chave gerada aqui e pronto.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-2 text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
            Mantenha uma aba logada em <code>escritorio.igreenenergy.com.br</code> aberta — a extensão usa a sua sessão pra exportar os Excel.
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
