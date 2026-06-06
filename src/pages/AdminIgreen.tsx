import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, RefreshCw, Wifi, WifiOff, Clock } from "lucide-react";

type Consultant = {
  id: string;
  name: string;
  igreen_portal_email: string | null;
  igreen_connect_code: string | null;
  igreen_token_updated_at: string | null;
  igreen_token_expires_at: string | null;
  igreen_token_expired: boolean;
};

const APP_ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "https://igreen.cloud";

function buildBookmarklet(code: string): string {
  // Reads iGreen accessToken from local/sessionStorage and opens our
  // /igreen-connect page on this app's origin with the token in the URL.
  // No fetch() from the iGreen origin → no CSP problems.
  const src = `(function(){try{var t=null;var ss=[localStorage,sessionStorage];for(var s=0;s<ss.length;s++){var st=ss[s];for(var i=0;i<st.length;i++){var k=st.key(i);var v=st.getItem(k);if(!v)continue;if(/^eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(v)){t=v;break;}try{var p=JSON.parse(v);var c=p&&(p.accessToken||p.access_token||p.token||(p.user&&(p.user.accessToken||p.user.token))||(p.state&&p.state.accessToken));if(c&&/^eyJ/.test(c)){t=c;break;}}catch(e){}}if(t)break;}if(!t){alert('Token iGreen não encontrado. Faça login em escritorio.igreenenergy.com.br e tente de novo.');return;}window.open('${APP_ORIGIN}/igreen-connect?code=${code}&t='+encodeURIComponent(t),'_blank');}catch(e){alert('Erro: '+e.message);}})();`;
  return "javascript:" + encodeURI(src);
}

function statusOf(c: Consultant): { label: string; color: string; icon: JSX.Element } {
  if (!c.igreen_token_updated_at) {
    return { label: "Nunca conectou", color: "text-muted-foreground", icon: <WifiOff className="w-4 h-4" /> };
  }
  if (c.igreen_token_expired) {
    return { label: "Token expirou — reconectar", color: "text-amber-600", icon: <Clock className="w-4 h-4" /> };
  }
  if (c.igreen_token_expires_at && new Date(c.igreen_token_expires_at) < new Date()) {
    return { label: "Token vencido", color: "text-amber-600", icon: <Clock className="w-4 h-4" /> };
  }
  return { label: "Conectado", color: "text-green-600", icon: <Wifi className="w-4 h-4" /> };
}

const AdminIgreen = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Consultant[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("consultants")
      .select(
        "id, name, igreen_portal_email, igreen_connect_code, igreen_token_updated_at, igreen_token_expires_at, igreen_token_expired"
      )
      .order("name");
    if (error) {
      toast({ title: "Erro ao carregar consultores", description: error.message, variant: "destructive" });
    } else {
      setItems((data || []) as Consultant[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.igreen_portal_email?.toLowerCase().includes(q),
    );
  }, [items, query]);

  const open = items.find((c) => c.id === openId) || null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/admin">
              <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Conexão iGreen</h1>
              <p className="text-sm text-muted-foreground">
                Conecte cada consultor ao portal iGreen via bookmarklet (sem captcha, sem senha exposta).
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <input
          type="text"
          placeholder="Buscar por nome ou e-mail…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full mb-4 px-4 py-2 border rounded-lg bg-card"
        />

        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Consultor</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Atualizado</th>
                <th className="text-right p-3">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const s = statusOf(c);
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{c.name || "(sem nome)"}</div>
                      <div className="text-xs text-muted-foreground">{c.igreen_portal_email || "—"}</div>
                    </td>
                    <td className={`p-3 ${s.color}`}>
                      <span className="inline-flex items-center gap-1.5">{s.icon}{s.label}</span>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {c.igreen_token_updated_at
                        ? new Date(c.igreen_token_updated_at).toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenId(c.id)}>
                        Gerar link
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    Nenhum consultor encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {open && open.igreen_connect_code && (
          <ConnectModal consultant={open} onClose={() => setOpenId(null)} />
        )}
      </div>
    </div>
  );
};

const ConnectModal = ({
  consultant,
  onClose,
}: {
  consultant: Consultant;
  onClose: () => void;
}) => {
  const { toast } = useToast();
  const bm = buildBookmarklet(consultant.igreen_connect_code!);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bm);
      toast({ title: "Copiado!", description: "Cole na barra de favoritos como link." });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Conectar iGreen — {consultant.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Siga os 3 passos abaixo. Não precisa de senha aqui — você loga direto no iGreen.
          </p>
        </div>

        <div className="p-6 space-y-5">
          <Step n={1} title="Arraste este botão para a barra de favoritos do seu navegador">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={bm}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium shadow"
                onClick={(e) => e.preventDefault()}
                draggable
              >
                ⚡ Conectar iGreen
              </a>
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="w-4 h-4 mr-2" /> Copiar código
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Se arrastar não funcionar, copie o código e crie um favorito manualmente colando-o em "URL".
            </p>
          </Step>

          <Step
            n={2}
            title="Abra o portal iGreen e faça login normalmente"
          >
            <a
              href="https://escritorio.igreenenergy.com.br/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              escritorio.igreenenergy.com.br
            </a>
            <p className="text-xs text-muted-foreground mt-1">
              Resolva o captcha como sempre. Você só precisa fazer isso uma vez.
            </p>
          </Step>

          <Step n={3} title="Já logado, clique no favorito ⚡ Conectar iGreen">
            <p className="text-xs text-muted-foreground">
              Uma aba vai abrir confirmando "Conectado com sucesso". Pronto — o sync passa a usar
              seu token automaticamente. Se o token expirar, repita o passo 2 e 3.
            </p>
          </Step>
        </div>

        <div className="p-4 border-t flex justify-end">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
};

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
      {n}
    </div>
    <div className="flex-1">
      <h3 className="font-semibold mb-1">{title}</h3>
      <div>{children}</div>
    </div>
  </div>
);

export default AdminIgreen;
