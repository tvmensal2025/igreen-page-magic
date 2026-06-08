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
      toast({ title: "Erro ao gerar token", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from("igreen_extension_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Erro ao revogar", variant: "destructive" });
    else load();
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
        {!loading && tokens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum token gerado ainda.</p>}
        {tokens.map((t) => {
          const expired = new Date(t.expires_at).getTime() < Date.now();
          const status = t.revoked_at ? "Revogado" : expired ? "Expirado" : "Ativo";
          const statusColor = t.revoked_at || expired ? "text-muted-foreground" : "text-green-600";
          return (
            <div key={t.id} className="flex items-center justify-between text-xs border rounded p-2">
              <div>
                <div className="font-mono">{t.token_prefix}••••••••</div>
                <div className={`${statusColor}`}>
                  {status}
                  {t.last_used_at && ` • Ultimo uso: ${new Date(t.last_used_at).toLocaleString("pt-BR")}`}
                  {!t.last_used_at && ` • Nunca usado`}
                </div>
              </div>
              {!t.revoked_at && (
                <Button onClick={() => revoke(t.id)} variant="ghost" size="sm">
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal: novo token gerado */}
      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token gerado</DialogTitle>
            <DialogDescription>
              Copie agora — ele nao sera mostrado de novo. Cole na extensao em "Token de pareamento".
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Como instalar a extensao</DialogTitle>
          </DialogHeader>
          <ol className="text-sm space-y-2 list-decimal pl-5">
            <li>Descompacte o arquivo <code>igreen-sync-extension.zip</code> baixado.</li>
            <li>Abra <code>chrome://extensions</code> no Chrome (ou Edge, Brave, Opera).</li>
            <li>Ative o <b>Modo desenvolvedor</b> (canto superior direito).</li>
            <li>Clique em <b>Carregar sem compactacao</b> e selecione a pasta descompactada.</li>
            <li>No painel, clique em <b>Gerar token</b> e copie o token.</li>
            <li>Clique no icone da extensao, cole o token e clique em <b>Salvar token</b>.</li>
            <li>Faca login em <code>escritorio.igreenenergy.com.br</code> normalmente.</li>
            <li>Clique em <b>Sincronizar agora</b> na extensao.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}
