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

  const removeToken = async (id: string, prefix: string) => {
    if (!confirm(`Excluir o token ${prefix}…?\nEsta ação é permanente e a extensão pareada com este token deixará de funcionar imediatamente.`)) return;
    const { error } = await supabase
      .from("igreen_extension_tokens")
      .delete()
      .eq("id", id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Token excluído", description: "Pareamento removido permanentemente." });
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
                  {t.last_used_at && ` • Último uso: ${new Date(t.last_used_at).toLocaleString("pt-BR")}`}
                  {!t.last_used_at && ` • Nunca usado`}
                </div>
              </div>
              <Button onClick={() => removeToken(t.id, t.token_prefix)} variant="ghost" size="sm" title="Excluir token permanentemente">
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
            <li>Descompacte <code>igreen-sync-extension.zip</code>.</li>
            <li>Abra <code>chrome://extensions</code> (Chrome, Edge, Brave ou Opera).</li>
            <li>Ative o <b>Modo desenvolvedor</b> (canto superior direito).</li>
            <li>Clique em <b>Carregar sem compactacao</b> e selecione a pasta descompactada. Se ja tinha uma versao antiga, clique em <b>Atualizar</b> no card da extensao (icone <b>G</b> verde).</li>
            <li>No painel aqui, clique <b>Gerar token</b> e copie.</li>
            <li>Clique no icone <b>G</b> verde da extensao e cole o token no campo — ele e salvo automaticamente.</li>
            <li>Em outra aba, faca login em <code>escritorio.igreenenergy.com.br</code> e abra <b>/mapa-clientes</b> e <b>/mapa-rede</b> uma vez para conferir que a tabela carrega e o botao <b>Exportar Excel</b> aparece.</li>
            <li>Volte na extensao e clique <b>Sincronizar agora</b>. A extensao baixa <b>primeiro o de Clientes</b> e depois o de Rede (um por vez, para evitar o aviso de varios downloads).</li>
          </ol>
          <div className="mt-4 p-3 rounded bg-muted text-xs space-y-1">
            <p className="font-semibold">Login e captcha do portal iGreen:</p>
            <p>• A extensao <b>nao</b> digita usuario, senha nem resolve captcha por voce. Ela so usa a sessao do navegador onde voce ja esta logado.</p>
            <p>• Faca login em <code>escritorio.igreenenergy.com.br</code> uma vez (resolva o captcha quando aparecer) e deixe a aba aberta.</p>
            <p>• A extensao abre <b>/mapa-clientes</b>, espera carregar, clica <b>Exportar Excel</b>, captura o arquivo e fecha. Depois faz o mesmo com <b>/mapa-rede</b>. Um por vez, para evitar o aviso de "varios downloads".</p>
            <p>• Os dados da <b>Rede</b> agora aparecem automaticamente na aba Rede do sistema apos cada sync.</p>
            <p>• Sincronizacao automatica a cada 6h funciona <b>somente com o navegador aberto e logado no portal</b>.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
