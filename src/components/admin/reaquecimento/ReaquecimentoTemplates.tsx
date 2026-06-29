import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { KNOWN_REACTIVATION_STEPS, getSuggestedReactivationText, getStepLabel } from "@/lib/reactivation-steps";

interface Template {
  id: string;
  consultant_id: string;
  conversation_step: string;
  message_text: string;
  is_active: boolean;
  auto_reactivate: boolean;
  created_at: string;
}

interface Props {
  consultantId: string;
  availableSteps: string[];
}

export function ReaquecimentoTemplates({ consultantId, availableSteps }: Props) {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newStep, setNewStep] = useState<string>("");
  const [newMessage, setNewMessage] = useState<string>("");

  // União: etapas com leads parados (passadas via props) + catálogo canônico
  // de etapas conhecidas. Garante que o admin sempre veja todas as etapas,
  // mesmo quando nenhum lead está parado no momento.
  const mergedSteps = useMemo(() => {
    const set = new Set<string>([
      ...availableSteps,
      ...KNOWN_REACTIVATION_STEPS.map((s) => s.step),
    ]);
    return Array.from(set);
  }, [availableSteps]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId]);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("reactivation_templates")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("conversation_step");
    if (error) {
      toast.error("Erro ao carregar templates: " + error.message);
    } else {
      setTemplates((data as Template[]) || []);
    }
    setLoading(false);
  }

  async function createTemplate() {
    if (!newStep.trim() || !newMessage.trim()) {
      toast.error("Selecione um passo e digite a mensagem");
      return;
    }
    if (newMessage.length > 4096) {
      toast.error("Mensagem muito longa (max 4096 caracteres)");
      return;
    }
    setCreating(true);
    // Desativa template anterior do mesmo step (UNIQUE partial)
    await (supabase as any)
      .from("reactivation_templates")
      .update({ is_active: false })
      .eq("consultant_id", consultantId)
      .eq("conversation_step", newStep)
      .eq("is_active", true);

    const { error } = await (supabase as any)
      .from("reactivation_templates")
      .insert({
        consultant_id: consultantId,
        conversation_step: newStep,
        message_text: newMessage,
        is_active: true,
      });
    setCreating(false);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Template criado");
    setNewStep("");
    setNewMessage("");
    load();
  }

  async function updateTemplate(id: string, patch: Partial<Template>) {
    const { error } = await (supabase as any)
      .from("reactivation_templates")
      .update(patch)
      .eq("id", id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Atualizado");
    load();
  }

  async function deleteTemplate(id: string) {
    const ok = await confirm({ title: "Remover este template?", description: "Os envios passados ficam preservados.", confirmText: "Remover", tone: "danger" });
    if (!ok) return;
    const { error } = await (supabase as any)
      .from("reactivation_templates")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Removido");
    load();
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Criar novo */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Novo template</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <div>
            <Label className="text-xs">Passo do fluxo</Label>
            <Select value={newStep} onValueChange={(v) => {
              setNewStep(v);
              // Pré-preenche com a sugestão oficial se a mensagem ainda estiver vazia
              if (!newMessage.trim()) {
                const sug = getSuggestedReactivationText(v);
                if (sug) setNewMessage(sug);
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um passo" />
              </SelectTrigger>
              <SelectContent>
                {mergedSteps.map((s) => (
                  <SelectItem key={s} value={s}>{getStepLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Mensagem
                <span className="ml-2 text-muted-foreground">
                  Variáveis: {`{{valor_conta}} {{representante}}`}
                </span>
              </Label>
              {newStep && getSuggestedReactivationText(newStep) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setNewMessage(getSuggestedReactivationText(newStep))}
                >
                  <Sparkles className="h-3 w-3" />
                  Usar sugerido
                </Button>
              )}
            </div>
            <Textarea
              rows={3}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Oi! Vi que você ficou sem responder. Posso te ajudar a continuar?"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Dica: evite usar nome do lead — em muitos casos ele ainda não foi capturado.
              Frases neutras funcionam melhor.
            </p>
          </div>
        </div>
        <Button onClick={createTemplate} disabled={creating}>
          {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
          Criar template
        </Button>
      </Card>

      {/* Lista de templates */}
      {templates.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum template ainda. Crie o primeiro acima.
        </p>
      ) : (
        templates.map((t) => (
          <Card key={t.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{getStepLabel(t.conversation_step)}</span>
                  <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{t.conversation_step}</span>
                  {t.is_active && <span className="text-[10px] font-medium text-primary">ATIVO</span>}
                  {!t.is_active && <span className="text-[10px] font-medium text-muted-foreground">INATIVO</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Criado em {new Date(t.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {getSuggestedReactivationText(t.conversation_step) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={() => updateTemplate(t.id, { message_text: getSuggestedReactivationText(t.conversation_step) })}
                  >
                    <Sparkles className="h-3 w-3" />
                    Restaurar sugerido
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => deleteTemplate(t.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Textarea
              key={t.message_text}
              rows={3}
              defaultValue={t.message_text}
              onBlur={(e) => {
                if (e.target.value !== t.message_text) {
                  updateTemplate(t.id, { message_text: e.target.value });
                }
              }}
            />
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2">
                <Switch
                  checked={t.is_active}
                  onCheckedChange={(v) => updateTemplate(t.id, { is_active: v })}
                />
                Ativo
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={t.auto_reactivate}
                  onCheckedChange={(v) => updateTemplate(t.id, { auto_reactivate: v })}
                />
                Reaquecimento automático (cron)
              </label>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
