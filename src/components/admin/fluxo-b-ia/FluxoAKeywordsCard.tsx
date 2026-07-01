import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, X, Plus, KeyRound, Globe2, User } from "lucide-react";

const TARGET_KEY = "fluxo_a_cadastro";
const DEFAULT_KEYWORDS = ["fazer o cadastro"];

interface Props {
  consultantId: string;
}

type Rule = {
  id: string;
  consultant_id: string | null;
  trigger_keywords: string[] | null;
  target_flow_key: string;
  priority: number | null;
  is_active: boolean | null;
};

export default function FluxoAKeywordsCard({ consultantId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalRule, setGlobalRule] = useState<Rule | null>(null);
  const [consultantRule, setConsultantRule] = useState<Rule | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [draft, setDraft] = useState("");

  // O consultor edita SEMPRE a sua própria regra (override). Se ele ainda
  // não tem uma, mostramos as keywords herdadas do global e ao salvar
  // criamos a regra dele.
  const inheritsFromGlobal = !consultantRule;

  useEffect(() => {
    if (!consultantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("flow_router_rules")
        .select("id, consultant_id, trigger_keywords, target_flow_key, priority, is_active")
        .eq("target_flow_key", TARGET_KEY)
        .or(`consultant_id.is.null,consultant_id.eq.${consultantId}`);
      if (cancelled) return;
      if (error) {
        toast({ title: "Erro carregando regras", description: error.message, variant: "destructive" });
      }
      const rows = (data || []) as Rule[];
      const g = rows.find((r) => r.consultant_id === null) || null;
      const c = rows.find((r) => r.consultant_id === consultantId) || null;
      setGlobalRule(g);
      setConsultantRule(c);
      const source = c || g;
      setKeywords(source?.trigger_keywords?.length ? source.trigger_keywords : DEFAULT_KEYWORDS);
      setIsActive(source ? !!source.is_active : true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [consultantId, toast]);

  function addKeyword() {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (keywords.includes(v)) { setDraft(""); return; }
    setKeywords((prev) => [...prev, v]);
    setDraft("");
  }
  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k));
  }

  async function save() {
    setSaving(true);
    const payload = {
      consultant_id: consultantId,
      target_flow_key: TARGET_KEY,
      target_flow_label: "CEMIG — Cadastro direto",
      trigger_keywords: keywords,
      priority: 100,
      is_active: isActive,
    };
    let error: any = null;
    if (consultantRule) {
      const r = await supabase
        .from("flow_router_rules")
        .update(payload)
        .eq("id", consultantRule.id);
      error = r.error;
    } else {
      const r = await supabase
        .from("flow_router_rules")
        .insert(payload)
        .select("id, consultant_id, trigger_keywords, target_flow_key, priority, is_active")
        .maybeSingle();
      error = r.error;
      if (!error && r.data) setConsultantRule(r.data as Rule);
    }
    setSaving(false);
    if (error) {
      toast({ title: "Erro salvando", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Palavras-chave salvas", description: "Aplicado a novos leads deste consultor." });
  }

  async function resetToGlobal() {
    if (!consultantRule) return;
    setSaving(true);
    const { error } = await supabase
      .from("flow_router_rules")
      .delete()
      .eq("id", consultantRule.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro removendo override", description: error.message, variant: "destructive" });
      return;
    }
    setConsultantRule(null);
    setKeywords(globalRule?.trigger_keywords?.length ? globalRule.trigger_keywords : DEFAULT_KEYWORDS);
    setIsActive(globalRule ? !!globalRule.is_active : true);
    toast({ title: "Override removido", description: "Consultor voltou a usar as palavras-chave globais." });
  }

  const dirty = useMemo(() => {
    const source = consultantRule || globalRule;
    const baseline = source?.trigger_keywords?.length ? source.trigger_keywords : DEFAULT_KEYWORDS;
    const sortedA = [...keywords].sort().join("|");
    const sortedB = [...baseline].sort().join("|");
    const activeBaseline = source ? !!source.is_active : true;
    return sortedA !== sortedB || isActive !== activeBaseline || (inheritsFromGlobal && keywords.length > 0);
  }, [keywords, isActive, consultantRule, globalRule, inheritsFromGlobal]);

  if (loading) return <Card><CardContent className="flex justify-center p-8"><Loader2 className="animate-spin" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />Palavras-chave do CEMIG
        </CardTitle>
        <CardDescription>
          Quando o cliente digitar uma dessas palavras, o bot pula direto para o cadastro (foto da conta de luz).
          Não interfere nas palavras-chave de parceiros — são gatilhos independentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-xs">
          {inheritsFromGlobal ? (
            <Badge variant="secondary" className="gap-1"><Globe2 className="w-3 h-3" />Usando regra global</Badge>
          ) : (
            <Badge className="gap-1"><User className="w-3 h-3" />Regra personalizada deste consultor</Badge>
          )}
          {globalRule && (
            <span className="text-muted-foreground">Global: {(globalRule.trigger_keywords || []).join(", ") || "—"}</span>
          )}
        </div>

        <div>
          <Label className="text-xs uppercase text-muted-foreground">Palavras-chave</Label>
          <div className="mt-2 flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md bg-muted/20">
            {keywords.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhuma palavra cadastrada.</span>
            )}
            {keywords.map((k) => (
              <Badge key={k} variant="outline" className="gap-1 pl-2 pr-1 py-1">
                {k}
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  className="ml-1 rounded-sm hover:bg-destructive/20 p-0.5"
                  aria-label={`Remover ${k}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
              placeholder="Ex.: quero cadastrar"
              className="h-9"
            />
            <Button type="button" size="sm" variant="secondary" onClick={addKeyword} disabled={!draft.trim()}>
              <Plus className="w-4 h-4 mr-1" />Adicionar
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="kw-active" className="font-medium">Ativar gatilho</Label>
            <p className="text-xs text-muted-foreground">Desligue para pausar a ativação automática sem perder a lista.</p>
          </div>
          <Switch id="kw-active" checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <div className="flex items-center justify-between gap-2">
          {!inheritsFromGlobal ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetToGlobal} disabled={saving}>
              Voltar para regra global
            </Button>
          ) : <span />}
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
