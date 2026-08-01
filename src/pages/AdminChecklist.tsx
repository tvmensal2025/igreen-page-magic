import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  CHECKLIST_GROUPS,
  ZERO_LEAD_CHECKLIST,
  runZeroLeadAutoAudit,
  type AutoCheckResult,
  type ChecklistGroup,
  type ChecklistItem,
} from "@/lib/zeroLeadChecklist";
import { useConfirm } from "@/components/ui/confirm-dialog";

function renderRich(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

const GROUP_ORDER: ChecklistGroup[] = [
  "seguro",
  "motor",
  "grupoA",
  "grupoB",
  "grupoC",
  "temas",
  "sms",
  "voz",
  "meta",
  "ops",
];

export default function AdminChecklist() {
  const confirm = useConfirm();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState<AutoCheckResult[]>([]);
  const [autoLoading, setAutoLoading] = useState(false);

  const loadDone = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("admin_setup_checklist")
      .select("item_key")
      .eq("user_id", u.user.id);
    setDone(new Set((data ?? []).map((r) => r.item_key)));
  }, []);

  const refreshAuto = useCallback(async () => {
    setAutoLoading(true);
    try {
      const rows = await runZeroLeadAutoAudit(supabase);
      setAuto(rows);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no auto-check");
    } finally {
      setAutoLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadDone();
      await refreshAuto();
      setLoading(false);
    })();
  }, [loadDone, refreshAuto]);

  const autoMap = useMemo(() => {
    const m = new Map<string, AutoCheckResult>();
    for (const r of auto) m.set(r.key, r);
    return m;
  }, [auto]);

  const toggle = async (key: string, checked: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (checked) {
      const { error } = await supabase
        .from("admin_setup_checklist")
        .upsert({ user_id: u.user.id, item_key: key }, { onConflict: "user_id,item_key" });
      if (error) return toast.error(error.message);
      setDone((s) => new Set(s).add(key));
      toast.success("Marcado como validado");
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

  const systemDone = useMemo(() => {
    const okKeys = new Set(auto.filter((a) => a.ok === true).map((a) => a.key));
    return new Set(
      ZERO_LEAD_CHECKLIST.filter((it) => it.autoKey && okKeys.has(it.autoKey)).map((it) => it.key),
    );
  }, [auto]);

  const effectiveDone = useMemo(() => {
    const merged = new Set(done);
    for (const key of systemDone) merged.add(key);
    return merged;
  }, [done, systemDone]);

  const visible = useMemo(
    () => (showDone ? ZERO_LEAD_CHECKLIST : ZERO_LEAD_CHECKLIST.filter((i) => !effectiveDone.has(i.key))),
    [effectiveDone, showDone],
  );
  const total = ZERO_LEAD_CHECKLIST.length;
  const completed = effectiveDone.size;
  const pct = Math.round((completed / Math.max(total, 1)) * 100);

  const autoOk = auto.filter((a) => a.ok === true).length;
  const autoFail = auto.filter((a) => a.ok === false).length;
  const autoAllOk = auto.length > 0 && autoFail === 0;

  const grouped = useMemo(() => {
    const g: Partial<Record<ChecklistGroup, ChecklistItem[]>> = {};
    for (const it of visible) {
      (g[it.group] ??= []).push(it);
    }
    return g;
  }, [visible]);

  const reset = async () => {
    const ok = await confirm({
      title: "Reabrir todos os itens do checklist?",
      description: "Todos os itens marcados voltam a aparecer como pendentes.",
      confirmText: "Reabrir checklist",
      cancelText: "Cancelar",
      tone: "info",
    });
    if (!ok) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("admin_setup_checklist").delete().eq("user_id", u.user.id);
    setDone(new Set());
    toast.success("Checklist reaberto");
  };

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Checklist — Zero Lead Perdido v5
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-2xl">
          Valide <strong className="text-foreground">segurança</strong>,{" "}
          <strong className="text-foreground">motor</strong>,{" "}
          <strong className="text-foreground">todos os textos</strong> (leads novos / quem esfriou, temas, SMS, voz)
          e Meta antes de ligar qualquer automação. O auto-check lê o banco em tempo real.
        </p>
      </div>

      {/* Auto-audit */}
      <Card className="p-5 md:p-6 space-y-4 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold flex items-center gap-2 text-base">
              <ShieldCheck className={`w-5 h-5 ${autoAllOk ? "text-emerald-500" : "text-amber-500"}`} />
              Verificação automática (produção)
            </div>
            <p className="text-sm text-muted-foreground">
              {autoLoading
                ? "Consultando toggles, cap, estágios e Meta…"
                : autoAllOk
                  ? "Tudo OK no que o sistema consegue medir sozinho."
                  : `${autoFail} ponto(s) precisam atenção · ${autoOk}/${auto.length} OK`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAuto} disabled={autoLoading}>
            {autoLoading ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1.5" />
            )}
            Reverificar
          </Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {auto.map((r) => (
            <div
              key={r.key}
              className="flex items-start gap-2 rounded-lg border bg-background/80 px-3 py-2 text-sm"
            >
              {r.ok === true ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              ) : r.ok === false ? (
                <CircleAlert className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              ) : (
                <CircleDashed className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground truncate">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Progresso manual */}
      <Card className="p-6 md:p-7 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Progresso validado
            </div>
            <div className="text-3xl font-bold mt-1">
              {completed}{" "}
              <span className="text-muted-foreground text-lg font-normal">
                de {total} itens
              </span>
            </div>
            {systemDone.size > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {systemDone.size} item(ns) reconhecido(s) automaticamente pela produção.
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Ocultar concluídos" : "Ver concluídos"}
            </Button>
            <Button variant="outline" size="sm" onClick={reset} disabled={completed === 0}>
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Reabrir
            </Button>
          </div>
        </div>
        <Progress value={pct} className="h-2.5" />

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-relaxed">
          <strong className="text-foreground">Não há botão “ligar tudo”</strong> nesta tela —
          envio em massa só depois de validar item a item na{" "}
          <Link to="/admin?tab=agendamentos" className="underline font-medium">
            Central de Automações
          </Link>
          , um consultor por vez.
        </div>
      </Card>

      {loading ? (
        <div className="text-muted-foreground text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : visible.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <div className="text-2xl font-bold">Checklist marcado como OK</div>
          <div className="text-muted-foreground max-w-md mx-auto">
            Revise o auto-check acima. Se estiver verde, liberar piloto na Central — nunca recalls + reheat juntos.
          </div>
          <Button asChild>
            <Link to="/admin?tab=agendamentos">Abrir Central de Automações</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {GROUP_ORDER.map((groupKey) => {
            const items = grouped[groupKey];
            if (!items?.length) return null;
            const meta = CHECKLIST_GROUPS[groupKey];
            return (
              <div key={groupKey} className="space-y-3">
                <div className="space-y-0.5 pb-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-lg tracking-tight">{meta.label}</h2>
                    <Badge variant="secondary" className="font-semibold">
                      {items.length}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.hint}</p>
                </div>
                <div className="space-y-3">
                  {items.map((it) => {
                    const isSystemDone = systemDone.has(it.key);
                    const isDone = effectiveDone.has(it.key);
                    const autoStatus = it.autoKey ? autoMap.get(it.autoKey) : undefined;
                    return (
                      <Card
                        key={it.key}
                        className={`p-5 flex items-start gap-4 transition hover:shadow-sm ${
                          isDone ? "opacity-60" : ""
                        }`}
                      >
                        <Checkbox
                          checked={isDone}
                          disabled={isSystemDone && !done.has(it.key)}
                          onCheckedChange={(v) => toggle(it.key, Boolean(v))}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className={`font-semibold text-base ${isDone ? "line-through" : ""}`}>
                              {it.title}
                            </div>
                            {autoStatus && (
                              <Badge
                                variant={autoStatus.ok ? "default" : "secondary"}
                                className={
                                  autoStatus.ok
                                    ? "bg-emerald-600 hover:bg-emerald-600"
                                    : "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                                }
                              >
                                auto: {autoStatus.ok ? "OK" : "checar"}
                              </Badge>
                            )}
                            {isSystemDone && !done.has(it.key) && (
                              <Badge variant="outline">validado pela produção</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground leading-relaxed">
                            {renderRich(it.desc)}
                          </div>
                          {autoStatus && (
                            <div className="text-xs text-muted-foreground">
                              Sistema: {autoStatus.detail}
                            </div>
                          )}
                        </div>
                        <Button asChild variant="outline" size="sm" className="shrink-0">
                          <Link to={it.link}>
                            Abrir <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Link>
                        </Button>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
