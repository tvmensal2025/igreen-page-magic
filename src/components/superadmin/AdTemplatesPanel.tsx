import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Loader2, Plus, Trash2, Upload, X, Eye, EyeOff, ImageIcon, Pencil, Sparkles, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import {
  AdTemplate, AdTemplatePhoto, listAdTemplates, upsertAdTemplate,
  deleteAdTemplate, uploadAdTemplateImage,
} from "@/services/adTemplates";
import { supabase } from "@/integrations/supabase/client";
import { DISTRIBUIDORAS_PRESETS } from "@/data/distribuidoraPresets";
import { AdImagePreview } from "./AdImagePreview";
import { TemplateInfoCard } from "@/components/admin/ads/TemplateInfoCard";

const empty: Partial<AdTemplate> = {
  title: "",
  description: "",
  photos: [],
  headline: "",
  primary_text: "",
  description_text: "",
  headline_variants: [],
  primary_text_variants: [],
  age_min: 30,
  age_max: 60,
  genders: [],
  suggested_daily_budget_cents: 3000,
  status: "draft",
  target_distribuidora_ids: [],
  target_cidades: [],
};

const FORMAT_RATIO: Record<AdPhotoFormat, { w: number; h: number; label: string }> = {
  square:   { w: 1, h: 1,  label: "1:1 (1080x1080)" },
  vertical: { w: 4, h: 5,  label: "4:5 (1080x1350)" },
  story:    { w: 9, h: 16, label: "9:16 (1080x1920)" },
};

type AdPhotoFormat = AdTemplatePhoto["format"];

interface ImageValidation {
  ok: boolean;
  score?: number;
  text_coverage_pct?: number;
  has_face?: boolean;
  face_in_safe_area?: boolean;
  issues?: { type: string; severity: "warning" | "error"; suggestion: string }[];
  summary?: string;
}

function readImageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem inválida")); };
    img.src = url;
  });
}

export function AdTemplatesPanel() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<AdTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<AdTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiContext, setAiContext] = useState<string>("");
  const [validations, setValidations] = useState<Record<string, ImageValidation | "loading">>({});

  const availableCities = useMemo(() => {
    const ids = editing?.target_distribuidora_ids ?? [];
    if (!ids.length) return [];
    const set = new Set<string>();
    DISTRIBUIDORAS_PRESETS.filter(p => ids.includes(p.id)).forEach(p => p.cidades.forEach(c => set.add(c)));
    return Array.from(set).sort();
  }, [editing?.target_distribuidora_ids]);

  async function validateImage(url: string, format: AdPhotoFormat) {
    const key = `${url}::${format}`;
    setValidations(v => ({ ...v, [key]: "loading" }));
    try {
      const { data, error } = await supabase.functions.invoke("ad-image-validator", {
        body: { url, format },
      });
      if (error) throw error;
      setValidations(v => ({ ...v, [key]: data as ImageValidation }));
    } catch (e: any) {
      setValidations(v => ({ ...v, [key]: { ok: true, summary: "IA indisponível: " + (e?.message || "") } }));
    }
  }

  async function reload() {
    setLoading(true);
    try { setItems(await listAdTemplates()); }
    catch (e: any) { toast({ title: "Erro ao carregar", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function handleAIGenerate() {
    if (!editing) return;
    setAiLoading(true);
    try {
      const ctx = aiContext.trim()
        ? aiContext.split(",").map(s => s.trim()).filter(Boolean)
        : (editing.title?.trim() ? [editing.title.trim()] : ["Brasil"]);
      const { data, error } = await supabase.functions.invoke("ad-creative-builder", {
        body: { cities: ctx },
      });
      if (error) throw error;
      const headlines: string[] = data?.headlines || [];
      const primaries: string[] = data?.primary_texts || [];
      if (!headlines.length || !primaries.length) throw new Error("IA não retornou copy. Tente novamente.");
      setEditing({
        ...editing,
        headline: editing.headline?.trim() ? editing.headline : headlines[0],
        primary_text: editing.primary_text?.trim() ? editing.primary_text : primaries[0],
        description_text: editing.description_text?.trim() ? editing.description_text : (data?.description || ""),
        headline_variants: headlines.slice(1, 5),
        primary_text_variants: primaries.slice(1, 4),
      });
      toast({ title: "Copy gerada pela IA ✨", description: "Revise e ajuste o que quiser antes de salvar." });
    } catch (e: any) {
      toast({ title: "Erro na IA", description: e.message || "Tente novamente", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.title?.trim()) return toast({ title: "Título obrigatório", variant: "destructive" });
    if (!editing.headline?.trim() || !editing.primary_text?.trim())
      return toast({ title: "Headline e texto principal obrigatórios", variant: "destructive" });
    if (!editing.photos?.length)
      return toast({ title: "Adicione ao menos 1 imagem", variant: "destructive" });
    setSaving(true);
    try {
      await upsertAdTemplate(editing);
      toast({ title: "Template salvo" });
      setEditing(null);
      await reload();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function togglePublish(t: AdTemplate) {
    try {
      await upsertAdTemplate({ ...t, status: t.status === "published" ? "draft" : "published" });
      await reload();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ title: "Excluir este template?", description: "Campanhas já criadas não são afetadas.", confirmText: "Excluir", tone: "danger" });
    if (!ok) return;
    try { await deleteAdTemplate(id); await reload(); }
    catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
  }

  async function addPhoto(file: File, format: AdTemplatePhoto["format"]) {
    if (!editing) return;
    if ((editing.photos?.length || 0) >= 5) return toast({ title: "Máx 5 imagens", variant: "destructive" });
    if (!/^image\//.test(file.type)) return toast({ title: "Use JPG/PNG/WebP", variant: "destructive" });
    if (file.size > 8 * 1024 * 1024) return toast({ title: "Imagem >8MB", variant: "destructive" });

    // Validação 4a: proporção
    let dims: { w: number; h: number };
    try { dims = await readImageDims(file); }
    catch { return toast({ title: "Imagem inválida", variant: "destructive" }); }
    const spec = FORMAT_RATIO[format];
    const expected = spec.w / spec.h;
    const actual = dims.w / dims.h;
    const diff = Math.abs(actual - expected) / expected;
    if (diff > 0.05) {
      return toast({
        title: "Proporção errada",
        description: `Imagem é ${dims.w}x${dims.h} (ratio ${actual.toFixed(2)}). Para ${spec.label} envie nessa proporção. Recorte antes de enviar.`,
        variant: "destructive",
      });
    }
    if (dims.w < 600) {
      return toast({ title: "Resolução baixa", description: `Mínimo 1080px de largura — esta tem ${dims.w}px.`, variant: "destructive" });
    }
    try {
      const tempId = editing.id || crypto.randomUUID();
      const url = await uploadAdTemplateImage(file, tempId);
      setEditing({ ...editing, id: editing.id ?? tempId, photos: [...(editing.photos || []), { url, format }] });
      // dispara IA em background
      validateImage(url, format);
    } catch (e: any) {
      toast({ title: "Falha no upload", description: e.message, variant: "destructive" });
    }
  }

  if (editing) {
    return (
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{editing.id ? "Editar template" : "Novo template"}</h3>
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Segmentação */}
        <div className="rounded-lg border-2 border-warning/40 bg-warning/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-warning dark:text-warning">🎯 Para quais distribuidoras este template serve?</div>
              <div className="text-[11px] text-muted-foreground">Vazio = todas. Marque para que apareça só para consultores dessas distribuidoras.</div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                onClick={() => setEditing({ ...editing, target_distribuidora_ids: DISTRIBUIDORAS_PRESETS.map(p => p.id) })}>
                Todas
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                onClick={() => setEditing({ ...editing, target_distribuidora_ids: [], target_cidades: [] })}>
                Limpar
              </Button>
            </div>
          </div>
          {(["alto", "medio", "sem_bonus"] as const).map((tier) => {
            const items = DISTRIBUIDORAS_PRESETS.filter(p => p.tier === tier);
            if (!items.length) return null;
            const tierLabel = tier === "alto" ? "🟢 Bônus alto" : tier === "medio" ? "🟡 Bônus médio" : "⚪ Sem bônus";
            return (
              <div key={tier} className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{tierLabel}</div>
                <div className="flex flex-wrap gap-1">
                  {items.map((p) => {
                    const sel = (editing.target_distribuidora_ids ?? []).includes(p.id);
                    return (
                      <button key={p.id} type="button"
                        onClick={() => {
                          const cur = editing.target_distribuidora_ids ?? [];
                          const next = sel ? cur.filter(x => x !== p.id) : [...cur, p.id];
                          // se remove distribuidora, limpa cidades dela
                          const stillCities = next.length ? new Set<string>() : new Set<string>();
                          DISTRIBUIDORAS_PRESETS.filter(d => next.includes(d.id)).forEach(d => d.cidades.forEach(c => stillCities.add(c)));
                          setEditing({
                            ...editing,
                            target_distribuidora_ids: next,
                            target_cidades: (editing.target_cidades ?? []).filter(c => stillCities.has(c)),
                          });
                        }}
                        className={`text-[11px] px-2 py-1 rounded-full border ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                        {p.nome} <span className="opacity-60">{p.uf}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {availableCities.length > 0 && (
            <div className="pt-2 border-t border-warning/20 space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-muted-foreground">Cidades específicas (opcional, vazio = todas)</div>
                {(editing.target_cidades?.length ?? 0) > 0 && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                    onClick={() => setEditing({ ...editing, target_cidades: [] })}>Limpar cidades</Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {availableCities.map((c) => {
                  const sel = (editing.target_cidades ?? []).includes(c);
                  return (
                    <button key={c} type="button"
                      onClick={() => {
                        const cur = editing.target_cidades ?? [];
                        setEditing({ ...editing, target_cidades: sel ? cur.filter(x => x !== c) : [...cur, c] });
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">Gerar copy com IA</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Descreva o público ou cidades-alvo (ex: "Clientes da CPFL em Campinas, Sorocaba"). A IA escreve headline, texto principal, descrição e 4 variações A/B prontas para a Meta — sem termos proibidos.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Clientes da Enel SP, ou: público que paga conta alta de luz"
              value={aiContext}
              onChange={(e) => setAiContext(e.target.value)}
              disabled={aiLoading}
            />
            <Button onClick={handleAIGenerate} disabled={aiLoading} className="gap-2 shrink-0">
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiLoading ? "Gerando..." : "Gerar"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            💡 As tags <code>{"{cidade}"}</code>, <code>{"{distribuidora}"}</code> e <code>{"{nome_consultor}"}</code> são preenchidas automaticamente quando o consultor publica — o nome, telefone e licença vêm do cadastro dele, não precisa pedir.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Título exibido ao consultor</label>
            <Input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Conta de luz mais barata — 3 imagens" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descrição interna (opcional)</label>
            <Input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Imagens ({editing.photos?.length || 0}/5) — escolha o formato
            </label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(["square", "vertical", "story"] as const).map((fmt) => (
                <label key={fmt} className="border-2 border-dashed rounded-lg p-3 text-center text-xs cursor-pointer hover:bg-muted/30">
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f, fmt); e.currentTarget.value = ""; }} />
                  <Upload className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                  {fmt === "square" ? "1:1 Feed" : fmt === "vertical" ? "4:5 Feed" : "9:16 Reels"}
                </label>
              ))}
            </div>
            {!!editing.photos?.length && (
              <div className="space-y-2 mt-2">
                {editing.photos.map((p, i) => {
                  const key = `${p.url}::${p.format}`;
                  const v = validations[key];
                  const isLoading = v === "loading";
                  const val = (v && v !== "loading") ? v : null;
                  const hasError = val?.issues?.some(x => x.severity === "error") || val?.ok === false;
                  return (
                    <div key={i} className="flex gap-3 p-2 rounded border bg-card">
                      <AdImagePreview url={p.url} format={p.format} size={84} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider font-bold">{p.format}</span>
                          {isLoading && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> IA analisando...</span>}
                          {!isLoading && val && (
                            hasError
                              ? <span className="text-[10px] flex items-center gap-1 text-destructive font-bold"><ShieldAlert className="w-3 h-3" /> Risco de corte</span>
                              : (val.issues?.length
                                ? <span className="text-[10px] flex items-center gap-1 text-warning font-bold"><AlertTriangle className="w-3 h-3" /> Atenção</span>
                                : <span className="text-[10px] flex items-center gap-1 text-primary font-bold"><CheckCircle2 className="w-3 h-3" /> Aprovada</span>)
                          )}
                          {val?.score != null && <span className="text-[10px] text-muted-foreground">Score {val.score}/100</span>}
                        </div>
                        {val?.summary && <div className="text-[10px] text-muted-foreground line-clamp-2">{val.summary}</div>}
                        {val?.issues?.slice(0, 3).map((iss, idx) => (
                          <div key={idx} className={`text-[10px] ${iss.severity === "error" ? "text-destructive" : "text-warning"}`}>
                            • {iss.suggestion}
                          </div>
                        ))}
                        {!val && !isLoading && (
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => validateImage(p.url, p.format)}>
                            Analisar com IA
                          </Button>
                        )}
                      </div>
                      <button className="self-start text-muted-foreground hover:text-destructive"
                        onClick={() => setEditing({ ...editing, photos: editing.photos!.filter((_, idx) => idx !== i) })}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Headline (até 40 caracteres)</label>
            <Input value={editing.headline || ""} onChange={(e) => setEditing({ ...editing, headline: e.target.value })} maxLength={60} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Texto principal — use {"{cidade}"} {"{distribuidora}"} {"{nome_consultor}"}
            </label>
            <Textarea rows={4} value={editing.primary_text || ""} onChange={(e) => setEditing({ ...editing, primary_text: e.target.value })}
              placeholder="Reduza até 20% na conta de luz em {cidade}. Cliente {distribuidora} já pode entrar — sem obra, sem instalação. Atendimento direto com {nome_consultor} no WhatsApp." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descrição (link description, opcional)</label>
            <Input value={editing.description_text || ""} onChange={(e) => setEditing({ ...editing, description_text: e.target.value })} />
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
            <div className="text-xs font-bold text-primary">🧪 A/B test automático (opcional)</div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Adicione variações alternativas — uma por linha. O Facebook rotaciona automaticamente e prioriza as que dão mais cliente interessado. Sem variações, usa só a copy padrão acima.
            </p>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Variações de headline (uma por linha, máx 4)</label>
              <Textarea
                rows={3}
                placeholder={"Conta de luz mais barata em {cidade}\nEconomia já no próximo mês\nSem instalação, sem obra"}
                value={(editing.headline_variants || []).join("\n")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    headline_variants: e.target.value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 4),
                  })
                }
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Variações de texto principal (uma por linha, máx 4)</label>
              <Textarea
                rows={4}
                placeholder={"Cliente {distribuidora}? Reduza até 20% sem mudar nada.\nMais de 50 mil clientes já economizam com a iGreen.\nFale com {nome_consultor} no WhatsApp em 1 minuto."}
                value={(editing.primary_text_variants || []).join("\n")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    primary_text_variants: e.target.value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 4),
                  })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Idade mín.</label>
              <Input type="number" value={editing.age_min ?? 30} onChange={(e) => setEditing({ ...editing, age_min: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Idade máx.</label>
              <Input type="number" value={editing.age_max ?? 60} onChange={(e) => setEditing({ ...editing, age_max: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Orçamento sugerido (R$/dia)</label>
              <Input type="number" value={(editing.suggested_daily_budget_cents ?? 3000) / 100}
                onChange={(e) => setEditing({ ...editing, suggested_daily_budget_cents: Math.round(Number(e.target.value) * 100) })} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t">
            <select className="bg-background border rounded px-2 py-1.5 text-sm"
              value={editing.status || "draft"}
              onChange={(e) => setEditing({ ...editing, status: e.target.value as any })}>
              <option value="draft">Rascunho (oculto dos consultores)</option>
              <option value="published">Publicado (visível na galeria)</option>
              <option value="archived">Arquivado</option>
            </select>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar template
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Templates de Anúncio</h2>
          <p className="text-sm text-muted-foreground">Crie modelos prontos para o consultor publicar em 1 toque pelo celular.</p>
        </div>
        <Button onClick={() => setEditing({ ...empty })} className="gap-2"><Plus className="w-4 h-4" /> Novo template</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
          Nenhum template ainda. Clique em "Novo template" para criar o primeiro.
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((t) => (
            <TemplateInfoCard
              key={t.id}
              template={t}
              mode="manage"
              onEdit={() => setEditing(t)}
              onTogglePublish={() => togglePublish(t)}
              onDelete={() => handleDelete(t.id)}
              onDuplicate={async () => {
                try {
                  const { duplicateAdTemplate } = await import("@/services/adTemplates");
                  await duplicateAdTemplate(t);
                  toast({ title: "Template duplicado como rascunho" });
                  await reload();
                } catch (e: any) {
                  toast({ title: "Erro ao duplicar", description: e.message, variant: "destructive" });
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
