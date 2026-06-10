import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Facebook, CheckCircle2, AlertCircle, Loader2, RefreshCw, LogOut, Settings2, Users } from "lucide-react";
import {
  startFacebookOAuth,
  listFacebookAssets,
  selectFacebookAssets,
  syncAudiences,
  type FbAssets,
} from "@/services/facebookAds";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { FacebookConnection } from "@/hooks/useFacebookConnection";

function formatWhats(digits: string): string {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length < 12) return d;
  // 55 11 97125-4913
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, d.length - 4)}-${d.slice(-4)}`;
}

interface Props {
  connection: FacebookConnection | null;
  onReconnect?: () => void;
}

export function ConnectFacebookCard({ connection, onReconnect }: Props) {
  const [loading, setLoading] = useState(false);
  const [syncingAud, setSyncingAud] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assets, setAssets] = useState<FbAssets | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [savingAssets, setSavingAssets] = useState(false);
  const [selAdAccount, setSelAdAccount] = useState<string>("");
  const [selPage, setSelPage] = useState<string>("");
  const [selPixel, setSelPixel] = useState<string>("");
  const [manualMode, setManualMode] = useState(false);
  const [manualAdAccount, setManualAdAccount] = useState("");
  const [manualPage, setManualPage] = useState("");
  const [manualPixel, setManualPixel] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const { toast } = useToast();

  const handleConnect = async (mode: "connect" | "switch" = "connect") => {
    try {
      setLoading(true);
      const res = await startFacebookOAuth(mode);
      window.location.href = res.url;
    } catch (err) {
      toast({ title: "Erro ao iniciar conexão", description: (err as Error).message, variant: "destructive" });
      setLoading(false);
    }
  };

  const handleLogoutAndSwitch = async () => {
    try {
      setLoading(true);
      const res = await startFacebookOAuth("switch");
      // Abre logout do Facebook e redireciona pro OAuth (se o navegador respeitar)
      const logoutUrl = `https://www.facebook.com/logout.php`;
      window.open(logoutUrl, "_blank", "noopener,noreferrer");
      // Aguarda 1.2s para o usuário ver, depois inicia o fluxo OAuth na aba atual
      setTimeout(() => { window.location.href = res.url; }, 1200);
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
      setLoading(false);
    }
  };

  const openAssets = async () => {
    setAssetsOpen(true);
    setAssetsLoading(true);
    setManualMode(false);
    try {
      const a = await listFacebookAssets();
      setAssets(a);
      setSelAdAccount(connection?.ad_account_id || "");
      setSelPage(connection?.page_id || "");
      setSelPixel(connection?.pixel_id || "");
      setManualAdAccount(connection?.ad_account_id || "");
      setManualPage(connection?.page_id || "");
      setManualPixel(connection?.pixel_id || "");
      setWaNumber(connection?.whatsapp_destination_number || "");
      // Se Meta não devolveu páginas E nem contas, força modo manual.
      if ((a.ad_accounts?.length || 0) === 0 && (a.pages?.length || 0) === 0) {
        setManualMode(true);
      }
    } catch (e) {
      toast({ title: "Falha ao listar assets", description: (e as Error).message, variant: "destructive" });
      setManualMode(true);
      setWaNumber(connection?.whatsapp_destination_number || "");
    } finally {
      setAssetsLoading(false);
    }
  };

  const saveAssets = async () => {
    setSavingAssets(true);
    try {
      const waDigits = waNumber.replace(/\D/g, "");
      if (waDigits.length < 12 || waDigits.length > 13) {
        toast({ title: "WhatsApp inválido", description: "Use formato 55 + DDD + número (ex: 5511971254913).", variant: "destructive" });
        setSavingAssets(false);
        return;
      }
      const payload = manualMode
        ? {
            ad_account_id: manualAdAccount.trim() || null,
            page_id: manualPage.trim() || null,
            pixel_id: manualPixel.trim() || null,
            whatsapp_destination_number: waDigits,
          }
        : {
            ad_account_id: selAdAccount || null,
            page_id: selPage || null,
            pixel_id: selPixel || null,
            whatsapp_destination_number: waDigits,
          };
      await selectFacebookAssets(payload);
      toast({ title: "Assets atualizados!" });
      setAssetsOpen(false);
      onReconnect?.();
    } catch (e) {
      toast({ title: "Falha ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingAssets(false);
    }
  };

  if (!connection) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-sm p-6 sm:p-8 space-y-3">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/10 p-3">
            <CheckCircle2 className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-foreground">Pixel da plataforma ativo</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Você já está usando o Pixel oficial da iGreen (<code className="text-xs">igreen-app-oficial</code>). Todos os eventos (PageView, Cliente interessado, Cadastro) são rastreados automaticamente — não precisa conectar nada.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              Quer rodar campanhas no seu próprio Business Manager? Conecte abaixo (opcional).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-[60px]">
          <Button onClick={() => handleConnect("connect")} disabled={loading} variant="outline" size="sm" className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
            {loading ? "Abrindo..." : "Conectar minha conta (opcional)"}
          </Button>
        </div>
        <SwitchConfirmDialog open={switchOpen} setOpen={setSwitchOpen} onConfirm={handleLogoutAndSwitch} />
      </div>
    );
  }


  const isExpired = connection.status !== "active";
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;
  const daysLeft = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {isExpired ? (
            <div className="rounded-xl bg-destructive/10 p-3"><AlertCircle className="w-6 h-6 text-destructive" /></div>
          ) : (
            <div className="rounded-xl bg-primary/10 p-3"><CheckCircle2 className="w-6 h-6 text-primary" /></div>
          )}
          <div>
            <h3 className="text-lg font-bold text-foreground">{isExpired ? "Reconexão necessária" : "Conectado ao Facebook"}</h3>
            <p className="text-xs text-muted-foreground">{connection.fb_user_name}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={openAssets} disabled={loading} className="gap-1.5 text-xs">
            <Settings2 className="w-3.5 h-3.5" /> Selecionar assets
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={syncingAud}
            className="gap-1.5 text-xs"
            onClick={async () => {
              setSyncingAud(true);
              try {
                const r = await syncAudiences();
                toast({
                  title: "Audiências sincronizadas",
                  description: `${r.uploaded} clientes enviados. Lookalike: ${r.lal_status === "created" ? "criada" : "processando"} (Meta leva ~6h pra liberar).`,
                });
              } catch (e) {
                toast({ title: "Falha ao sincronizar", description: (e as Error).message, variant: "destructive" });
              } finally {
                setSyncingAud(false);
              }
            }}
          >
            {syncingAud ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
            Sincronizar Lookalike
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSwitchOpen(true)} disabled={loading} className="gap-1.5 text-xs">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Trocar conta
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <Field label="Business Manager" value={connection.business_name} />
        <Field label="Conta de Anúncios" value={connection.ad_account_name} sub={connection.ad_account_currency} />
        <Field label="Página" value={connection.page_name} />
        <Field label="Instagram" value={connection.ig_account_username ? `@${connection.ig_account_username}` : null} />
        <Field label="Pixel" value={connection.pixel_name || (connection.pixel_id ? "Pixel detectado" : null)} />
        <Field label="WhatsApp dos clientes interessados" value={connection.whatsapp_destination_number ? formatWhats(connection.whatsapp_destination_number) : null} />
        <Field label="Conexão expira em" value={daysLeft !== null ? `${daysLeft} dias` : null} />
      </div>

      <SwitchConfirmDialog open={switchOpen} setOpen={setSwitchOpen} onConfirm={handleLogoutAndSwitch} />

      <Dialog open={assetsOpen} onOpenChange={setAssetsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" /> Selecionar assets do Facebook</DialogTitle>
          </DialogHeader>
          {assetsLoading || !assets ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              {(assets.errors?.ad_accounts || assets.errors?.pages) && (
                <div className="text-xs rounded-md border border-warning/30 bg-warning/10 p-2 text-warning space-y-1">
                  {assets.errors?.ad_accounts && <div>⚠️ Contas: {assets.errors.ad_accounts}</div>}
                  {assets.errors?.pages && <div>⚠️ Páginas: {assets.errors.pages}</div>}
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {manualMode ? "Modo manual ativo" : "Selecionando da lista do Facebook"}
                </span>
                <button
                  type="button"
                  onClick={() => setManualMode(m => !m)}
                  className="text-primary hover:underline"
                >
                  {manualMode ? "Voltar para lista automática" : "Inserir IDs manualmente"}
                </button>
              </div>

              {manualMode ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground rounded-md border border-border/60 bg-background/40 p-2 leading-relaxed">
                    Cole os IDs do Meta Business / Gerenciador de Anúncios. Use isto se sua lista vier vazia (permissões da Meta ainda em revisão).
                    <br />• <strong>Conta de anúncios</strong>: começa com <code>act_</code> (ex.: <code>act_1234567890</code>) — pegue em Gerenciador de Anúncios → canto superior esquerdo.
                    <br />• <strong>Página</strong>: ID numérico — pegue em <code>facebook.com/SUAPAGINA/about_profile_transparency</code>.
                    <br />• <strong>Pixel</strong> (opcional): Eventos → Fontes de dados → Pixel.
                  </div>
                  <div>
                    <Label className="text-xs">ID da Conta de Anúncios *</Label>
                    <Input placeholder="act_1234567890" value={manualAdAccount} onChange={e => setManualAdAccount(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">ID da Página do Facebook *</Label>
                    <Input placeholder="1234567890123456" value={manualPage} onChange={e => setManualPage(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">ID do Pixel (opcional)</Label>
                    <Input placeholder="1234567890" value={manualPixel} onChange={e => setManualPixel(e.target.value)} />
                  </div>
                </div>
              ) : (
              <>
              <div>
                <Label className="text-xs">Conta de Anúncios</Label>
                <Select value={selAdAccount} onValueChange={(v) => { setSelAdAccount(v); setSelPixel(""); }}>
                  <SelectTrigger><SelectValue placeholder="Escolha uma conta" /></SelectTrigger>
                  <SelectContent>
                    {assets.ad_accounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency}) — {a.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Página do Facebook</Label>
                <Select value={selPage} onValueChange={setSelPage}>
                  <SelectTrigger><SelectValue placeholder="Escolha uma página" /></SelectTrigger>
                  <SelectContent>
                    {assets.pages.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.instagram_username ? ` · @${p.instagram_username}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selAdAccount && (assets.pixels_by_ad_account[selAdAccount] || []).length > 0 && (
                <div>
                  <Label className="text-xs">Pixel (recomendado)</Label>
                  <Select value={selPixel} onValueChange={setSelPixel}>
                    <SelectTrigger><SelectValue placeholder="Sem pixel" /></SelectTrigger>
                    <SelectContent>
                      {(assets.pixels_by_ad_account[selAdAccount] || []).map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name} — {p.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              </>
              )}

              <div className="border-t border-border/50 pt-3 space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  📱 WhatsApp Business que vai receber os clientes interessados *
                </Label>
                <Input
                  placeholder="5511971254913"
                  value={waNumber}
                  onChange={e => setWaNumber(e.target.value)}
                  inputMode="numeric"
                />
                <div className="text-[11px] text-muted-foreground">
                  Formato 55 + DDD + número, só dígitos. Quando alguém clicar no anúncio, abre o WhatsApp neste número com mensagem pronta.
                </div>
                {waNumber.replace(/\D/g, "").length >= 12 && (
                  <a
                    href={`https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Teste de abertura do anúncio iGreen")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Testar abertura no WhatsApp ↗
                  </a>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssetsOpen(false)} disabled={savingAssets}>Cancelar</Button>
            <Button onClick={saveAssets} disabled={savingAssets || assetsLoading}>
              {savingAssets ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Salvando...</> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground truncate">
        {value || <span className="text-muted-foreground/60">— não vinculado</span>}
        {sub && <span className="ml-2 text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function SwitchConfirmDialog({ open, setOpen, onConfirm }: { open: boolean; setOpen: (b: boolean) => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Trocar de conta Facebook</AlertDialogTitle>
          <AlertDialogDescription>
            O Facebook reaproveita os cookies do navegador. Vamos abrir a página de logout do Facebook em uma nova aba e em seguida iniciar a conexão.
            <br /><br />
            <strong>Dica:</strong> se ainda assim abrir a conta errada, use uma janela anônima ou clique em "Não é você?" na tela de login do Facebook.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Continuar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
