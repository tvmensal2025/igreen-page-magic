import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { ArrowLeft, Save, RotateCcw, Sparkles } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Template = {
  id: string;
  consultant_id: string | null;
  template_key: string;
  label: string;
  description: string | null;
  category: string;
  text_content: string;
  audio_url: string | null;
  typing_delay_ms: number;
  is_active: boolean;
  variables: string[];
};

type Draft = {
  text_content: string;
  audio_url: string;
  typing_delay_ms: number;
  is_active: boolean;
  dirty: boolean;
};

export default function ConsultantMessages() {
  const confirm = useConfirm();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("consultant_message_templates")
      .select("*")
      .or(`consultant_id.eq.${userId},consultant_id.is.null`);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data || []) as Template[];
    // for each template_key: prefer consultant's own; expose default text as base
    const byKey = new Map<string, Template>();
    for (const r of list) {
      const cur = byKey.get(r.template_key);
      if (!cur || (r.consultant_id === userId && cur.consultant_id === null)) byKey.set(r.template_key, r);
    }
    const merged = Array.from(byKey.values()).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    setRows(merged);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  function draftOf(t: Template): Draft {
    return drafts[t.template_key] ?? {
      text_content: t.text_content,
      audio_url: t.audio_url ?? "",
      typing_delay_ms: t.typing_delay_ms ?? 1500,
      is_active: t.is_active,
      dirty: false,
    };
  }

  function patchDraft(key: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [key]: { ...draftOf(rows.find(r => r.template_key === key)!), ...patch, dirty: true } }));
  }

  async function save(t: Template) {
    if (!userId) return;
    const d = draftOf(t);
    setSaving(t.template_key);
    const payload = {
      consultant_id: userId,
      template_key: t.template_key,
      label: t.label,
      description: t.description,
      category: t.category,
      text_content: d.text_content,
      audio_url: d.audio_url.trim() || null,
      typing_delay_ms: d.typing_delay_ms,
      is_active: d.is_active,
      variables: t.variables,
    };
    const { error } = await supabase
      .from("consultant_message_templates")
      .upsert(payload, { onConflict: "consultant_id,template_key" });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${t.label}" salvo.`);
    setDrafts(prev => { const c = { ...prev }; delete c[t.template_key]; return c; });
    load();
  }

  async function resetToDefault(t: Template) {
    if (!userId) return;
    const ok = await confirm({
      title: "Voltar ao padrão da plataforma?",
      description: "Esta mensagem volta ao texto oficial da plataforma.",
      confirmText: "Restaurar padrão",
      cancelText: "Cancelar",
      tone: "info",
    });
    if (!ok) return;
    if (t.consultant_id === userId) {
      const { error } = await supabase.from("consultant_message_templates").delete().eq("id", t.id);
      if (error) { toast.error(error.message); return; }
    }
    setDrafts(prev => { const c = { ...prev }; delete c[t.template_key]; return c; });
    toast.success("Restaurado ao padrão.");
    load();
  }

  const grouped = useMemo(() => {
    const g: Record<string, Template[]> = {};
    for (const r of rows) (g[r.category] ||= []).push(r);
    return g;
  }, [rows]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0"><Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold">Minhas mensagens</h1>
            <p className="text-sm text-muted-foreground">
              Personalize o que o sistema envia no seu nome. As variáveis entre <code>{"{{ }}"}</code> são substituídas automaticamente.
            </p>
          </div>
        </div>

        {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}

        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{cat}</h2>
            {list.map(t => {
              const d = draftOf(t);
              const isOwn = t.consultant_id === userId;
              return (
                <Card key={t.template_key} className={d.dirty ? "border-primary/50" : ""}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                      {t.label}
                      {isOwn ? <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">personalizado</Badge>
                             : <Badge variant="outline" className="text-[10px]">padrão da plataforma</Badge>}
                      {d.dirty && <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">não salvo</Badge>}
                    </CardTitle>
                    {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      value={d.text_content}
                      onChange={e => patchDraft(t.template_key, { text_content: e.target.value })}
                      rows={4}
                      className="font-mono text-sm"
                    />
                    {t.variables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        <span>Variáveis disponíveis:</span>
                        {t.variables.map(v => (
                          <code key={v} className="bg-muted px-1.5 py-0.5 rounded">{`{{${v}}}`}</code>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="min-w-0">
                        <label className="text-xs text-muted-foreground">URL do áudio (opcional)</label>
                        <Input
                          value={d.audio_url}
                          placeholder="https://…/audio.ogg"
                          onChange={e => patchDraft(t.template_key, { audio_url: e.target.value })}
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="text-xs text-muted-foreground">"Digitando..." (ms)</label>
                        <Input
                          type="number"
                          value={d.typing_delay_ms}
                          onChange={e => patchDraft(t.template_key, { typing_delay_ms: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <Switch
                          checked={d.is_active}
                          onCheckedChange={v => patchDraft(t.template_key, { is_active: v })}
                        />
                        <span className="text-sm">{d.is_active ? "Ativa" : "Desativada"}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {isOwn && (
                        <Button variant="ghost" size="sm" onClick={() => resetToDefault(t)}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Voltar ao padrão
                        </Button>
                      )}
                      <Button size="sm" disabled={!d.dirty || saving === t.template_key} onClick={() => save(t)}>
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {saving === t.template_key ? "Salvando…" : "Salvar"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
