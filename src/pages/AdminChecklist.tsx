import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertTriangle,
  Zap,
  MessageSquare,
  Brain,
  Kanban,
  Settings,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Power,
} from "lucide-react";

type Item = {
  key: string;
  title: string;
  desc: string;
  link: string;
  external?: boolean;
  group: "bloq" | "ops" | "msg" | "ia" | "crm" | "fino";
};

const ITEMS: Item[] = [
  // BLOQUEADORES
  { key: "1_toggles", title: "1. Automações mestre", desc: "0 de 31 toggles ligados. Deixe DESLIGADO por enquanto — vamos ligar tudo no final.", link: "/admin?tab=agendamentos", group: "bloq" },
  { key: "2_whatsapp", title: "2. Instâncias WhatsApp", desc: "2 de 6 conectadas. Reconecte as 4 restantes por QR.", link: "/admin/whatsapp-clients", group: "bloq" },
  { key: "3_pools", title: "3. Pools de rodízio", desc: "Nenhum pool ativo. Sem pool, todo lead vai para revisão manual.", link: "/admin?tab=rodizio", group: "bloq" },
  { key: "4_campanhas", title: "4. Campanhas Meta ativas", desc: "Vincule cada campanha ativa a um pool antes de subir criativo.", link: "/admin/meta-ads", group: "bloq" },

  // OPERACIONAL
  { key: "5_motor", title: "5. Estágios da cadência (9 estágios)", desc: "Delay, canal, janela BRT, máx envios/lead, dias da semana.", link: "/admin/motor", group: "ops" },
  { key: "6_pizza", title: "6. Ciclo diário — Pizza", desc: "Prioridade A/B, cap WhatsApp, janela e Dry-run vs Ao Vivo.", link: "/admin", group: "ops" },
  { key: "7_feriados", title: "7. Feriados", desc: "0 feriados cadastrados. Cadastre para evitar disparos em feriado.", link: "/admin?tab=agendamentos", group: "ops" },

  // MENSAGENS
  { key: "8_stage_msgs", title: "8. Mensagens automáticas por estágio", desc: "6/9 estágios configurados. Complete os 3 restantes com texto+áudio+variáveis.", link: "/admin?tab=agendamentos", group: "msg" },
  { key: "9_reativacao", title: "9. Templates de reativação", desc: "Apenas 1 template. Crie 5–8 variações para rotação A/B.", link: "/admin/reaquecimento", group: "msg" },
  { key: "10_consultor_msgs", title: "10. Templates por consultor", desc: "24 templates para 11 consultores. Cada consultor precisa dos seus.", link: "/consultor/mensagens", group: "msg" },
  { key: "11_voz", title: "11. Ligações (voz)", desc: "Só 1 template. Configure saudação, corpo, CTA e encerramento por variante.", link: "/admin/voz", group: "msg" },
  { key: "12_sms", title: "12. SMS (Velip)", desc: "Texto curto por estágio (160 chars) + link de rastreio + remetente.", link: "/admin?tab=agendamentos", group: "msg" },
  { key: "13_audios", title: "13. Biblioteca de áudio", desc: "21 áudios. Marque quais são boas-vindas, reativação 7d/30d e última chance.", link: "/admin/sofia-audios", group: "msg" },
  { key: "14_pos_venda", title: "14. Pós-venda", desc: "Mensagens automáticas: boleto, primeiro pagamento, aniversário.", link: "/admin?tab=agendamentos", group: "msg" },

  // IA
  { key: "15_conhecimento", title: "15. IA — Conhecimento (27 seções)", desc: "Revise cada objeção, benefício e script de resposta.", link: "/admin/conhecimento", group: "ia" },
  { key: "16_personalidade", title: "16. IA — Personalidade", desc: "Tom de voz, palavras proibidas, regras de handoff para humano.", link: "/admin/conhecimento?tab=personalidade", group: "ia" },
  { key: "17_fluxos", title: "17. Fluxos do bot (15 ativos)", desc: "Auditar Sofia variantes A/B/C/D/E/F passo a passo.", link: "/admin/fluxos", group: "ia" },
  { key: "18_router", title: "18. Regras de roteamento", desc: "Gatilhos (cidade, campanha, hora) → variante do fluxo.", link: "/admin/fluxos", group: "ia" },

  // CRM
  { key: "19_kanban", title: "19. Estágios do Kanban", desc: "Nome, cor, ordem, mensagem automática ao entrar no estágio.", link: "/admin", group: "crm" },
  { key: "20_esteira", title: "20. Templates da esteira de venda", desc: "Documentos obrigatórios, mídias padrão, cobrança de doc.", link: "/admin", group: "crm" },
  { key: "21_regras_entrada", title: "21. Regras de entrada por consultor", desc: "Cidades aceitas, tipos de conta, ticket mínimo.", link: "/consultor", group: "crm" },
];

const GROUPS = {
  bloq: { label: "Bloqueadores", icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10" },
  ops: { label: "Controle operacional", icon: Settings, color: "text-amber-500", bg: "bg-amber-500/10" },
  msg: { label: "Personalização de cada toque", icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ia: { label: "IA e fluxos", icon: Brain, color: "text-blue-500", bg: "bg-blue-500/10" },
  crm: { label: "CRM e esteira", icon: Kanban, color: "text-purple-500", bg: "bg-purple-500/10" },
  fino: { label: "Controles finos", icon: Settings, color: "text-muted-foreground", bg: "bg-muted" },
} as const;

// toggles críticos que serão LIGADOS no final
const CRITICAL_TOGGLES = [
  "cadence-tick",
  "daily-reheat-cron",
  "whapi-inbound",
  "evolution-inbound",
  "voice-dialer-tick",
  "sms-cron",
];

export default function AdminChecklist() {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [powering, setPowering] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("admin_setup_checklist")
        .select("item_key")
        .eq("user_id", u.user.id);
      setDone(new Set((data ?? []).map((r) => r.item_key)));
      setLoading(false);
    })();
  }, []);

  const toggle = async (key: string, checked: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (checked) {
      const { error } = await supabase
        .from("admin_setup_checklist")
        .upsert({ user_id: u.user.id, item_key: key }, { onConflict: "user_id,item_key" });
      if (error) return toast.error(error.message);
      setDone((s) => new Set(s).add(key));
      toast.success("Salvo — item removido da lista");
    } else {
      await supabase
        .from("admin_setup_checklist")
        .delete()
        .eq("user_id", u.user.id)
        .eq("item_key", key);
      setDone((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  const visible = useMemo(
    () => (showDone ? ITEMS : ITEMS.filter((i) => !done.has(i.key))),
    [done, showDone],
  );
  const total = ITEMS.length;
  const completed = done.size;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    for (const it of visible) {
      (g[it.group] ??= []).push(it);
    }
    return g;
  }, [visible]);

  const powerOnEverything = async () => {
    if (!allDone) {
      toast.error("Complete todos os 21 itens antes de ligar as automações.");
      return;
    }
    setPowering(true);
    try {
      const { error } = await supabase
        .from("automation_toggles")
        .update({ enabled: true })
        .in("key", CRITICAL_TOGGLES);
      if (error) throw error;
      toast.success("🚀 Automações críticas ligadas!");
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao ligar automações");
    } finally {
      setPowering(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reabrir todos os itens do checklist?")) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("admin_setup_checklist").delete().eq("user_id", u.user.id);
    setDone(new Set());
    toast.success("Checklist reaberto");
  };

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Checklist de configuração</h1>
        <p className="text-muted-foreground mt-1">
          Siga cada item e marque como feito. Ao final de tudo, um único botão liga as automações.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm text-muted-foreground">Progresso</div>
            <div className="text-2xl font-semibold">
              {completed} <span className="text-muted-foreground text-base">de {total}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Ocultar concluídos" : "Ver concluídos"}
            </Button>
            <Button variant="outline" size="sm" onClick={reset} disabled={completed === 0}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Reabrir
            </Button>
          </div>
        </div>
        <Progress value={pct} className="h-2" />

        <div className="mt-5 flex items-center justify-between rounded-lg border p-4 bg-muted/30">
          <div>
            <div className="font-medium flex items-center gap-2">
              <Power className={allDone ? "text-emerald-500 w-4 h-4" : "text-muted-foreground w-4 h-4"} />
              Ligar todas as automações críticas
            </div>
            <div className="text-sm text-muted-foreground">
              Libera <code className="text-xs">cadence-tick</code>, <code className="text-xs">daily-reheat-cron</code>, inbounds WhatsApp, voz e SMS.
            </div>
          </div>
          <Button
            onClick={powerOnEverything}
            disabled={!allDone || powering}
            size="lg"
            className={allDone ? "bg-emerald-600 hover:bg-emerald-700" : ""}
          >
            <Zap className="w-4 h-4 mr-2" />
            {powering ? "Ligando..." : allDone ? "Ligar tudo agora" : `Faltam ${total - completed}`}
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="text-muted-foreground text-sm">Carregando…</div>
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <div className="text-xl font-semibold">Tudo configurado!</div>
          <div className="text-muted-foreground mt-1">
            Clique em "Ligar tudo agora" acima para ativar as automações.
          </div>
        </Card>
      ) : (
        Object.entries(grouped).map(([groupKey, items]) => {
          const g = GROUPS[groupKey as keyof typeof GROUPS];
          const Icon = g.icon;
          return (
            <div key={groupKey} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-md ${g.bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${g.color}`} />
                </div>
                <h2 className="font-semibold">{g.label}</h2>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.map((it) => {
                  const isDone = done.has(it.key);
                  return (
                    <Card
                      key={it.key}
                      className={`p-4 flex items-start gap-3 transition ${
                        isDone ? "opacity-60" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isDone}
                        onCheckedChange={(v) => toggle(it.key, Boolean(v))}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${isDone ? "line-through" : ""}`}>
                          {it.title}
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">{it.desc}</div>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link to={it.link}>
                          Abrir <ArrowRight className="w-3 h-3 ml-1" />
                        </Link>
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
