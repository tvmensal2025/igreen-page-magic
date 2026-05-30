import React, { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, Check, X, Edit3, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Step } from "./flowTypes";
import { supabase } from "@/integrations/supabase/client";

export interface ReviewIssue {
  step_id?: string | null;
  step_key?: string | null;
  severity: "critical" | "warning" | "info";
  category: string;
  problem: string;
  suggestion: string;
  patch?: Record<string, any> | null;
}

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: ReviewResult | null;
  loading: boolean;
  error: string | null;
  steps: Step[];
  flowId: string | null;
  consultantId: string | null;
  onApplied: () => void;
  onJumpToStep: (stepId: string) => void;
}

const SEVERITY_STYLES: Record<ReviewIssue["severity"], { label: string; cls: string }> = {
  critical: { label: "Crítico", cls: "bg-destructive text-destructive-foreground" },
  warning: { label: "Atenção", cls: "bg-orange-500 text-white" },
  info: { label: "Sugestão", cls: "bg-blue-500 text-white" },
};

export default function FlowReviewPanel({
  open,
  onOpenChange,
  result,
  loading,
  error,
  steps,
  flowId,
  consultantId,
  onApplied,
  onJumpToStep,
}: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editedPatches, setEditedPatches] = useState<Record<number, string>>({});
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (!open) {
      setEditingIdx(null);
      setEditedPatches({});
      setAppliedIdx(new Set());
      setConfirmIdx(null);
    }
  }, [open]);

  const getEffectivePatch = (idx: number, issue: ReviewIssue) => {
    if (editedPatches[idx] !== undefined) {
      try {
        return JSON.parse(editedPatches[idx]);
      } catch {
        return null;
      }
    }
    return issue.patch ?? null;
  };

  const handleApprove = async (idx: number) => {
    if (!result || !flowId) return;
    const issue = result.issues[idx];
    const patch = getEffectivePatch(idx, issue);
    if (!patch || !issue.step_id) {
      toast.error("Patch inválido ou sem passo alvo");
      return;
    }
    setSaving(true);
    try {
      const before = steps.find((s) => s.id === issue.step_id);
      const allowedKeys = [
        "message_text",
        "title",
        "summary",
        "captures",
        "transitions",
        "fallback",
        "step_type",
        "is_active",
        "auto_detect_doc_type",
        "text_delay_ms",
      ];
      const cleanPatch: Record<string, any> = {};
      for (const k of Object.keys(patch)) {
        if (allowedKeys.includes(k)) cleanPatch[k] = patch[k];
      }
      if (Object.keys(cleanPatch).length === 0) {
        toast.error("Nenhum campo válido no patch");
        setSaving(false);
        return;
      }
      const { error: updErr } = await supabase
        .from("bot_flow_steps")
        .update(cleanPatch as any)
        .eq("id", issue.step_id);
      if (updErr) throw updErr;
      await (supabase as any).from("bot_flow_audit_log").insert({
        flow_id: flowId,
        step_id: issue.step_id,
        consultant_id: consultantId,
        action: "ai_review_apply",
        source: "ai_review",
        before: before ? { ...before } : null,
        after: cleanPatch,
        summary: issue.suggestion?.slice(0, 200) ?? null,
        user_id: consultantId,
      });
      setAppliedIdx((prev) => new Set(prev).add(idx));
      toast.success("Alteração salva e registrada na auditoria");
      onApplied();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message ?? String(e)));
    } finally {
      setSaving(false);
      setConfirmIdx(null);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              Revisão IA do Fluxo (GPT-5.5)
            </SheetTitle>
            <SheetDescription>
              Sugestões geradas por IA. Você pode editar cada patch antes de confirmar — nada é salvo sem aprovação.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 -mx-6 px-6 mt-3">
            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                <div className="text-sm">GPT-5.5 analisando o fluxo… pode levar 30-60s</div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>{error}</div>
                </div>
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4 pb-6">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Resumo</div>
                  <div className="text-sm whitespace-pre-wrap">{result.summary}</div>
                </div>

                {result.issues.length === 0 && (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-sm">
                    ✅ Nenhum problema relevante encontrado.
                  </div>
                )}

                {result.issues.map((issue, idx) => {
                  const stepTitle = issue.step_id
                    ? steps.find((s) => s.id === issue.step_id)?.title ?? issue.step_key ?? "?"
                    : "Global";
                  const sev = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info;
                  const isApplied = appliedIdx.has(idx);
                  const isEditing = editingIdx === idx;
                  const patchText =
                    editedPatches[idx] ??
                    (issue.patch ? JSON.stringify(issue.patch, null, 2) : "");

                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 ${isApplied ? "border-green-500/40 bg-green-500/5" : ""}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={sev.cls + " text-[10px]"}>{sev.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{issue.category}</Badge>
                        {issue.step_id ? (
                          <button
                            type="button"
                            onClick={() => onJumpToStep(issue.step_id!)}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            #{stepTitle}
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">Global</span>
                        )}
                        {isApplied && (
                          <Badge variant="secondary" className="ml-auto text-[10px] bg-green-500/20 text-green-700">
                            <Check className="h-3 w-3 mr-1" /> Aplicado
                          </Badge>
                        )}
                      </div>

                      <div className="text-sm font-medium mb-1">{issue.problem}</div>
                      <div className="text-sm text-muted-foreground mb-2 whitespace-pre-wrap">
                        💡 {issue.suggestion}
                      </div>

                      {issue.patch && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase">
                              Patch proposto (JSON)
                            </span>
                            {!isApplied && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px]"
                                onClick={() => setEditingIdx(isEditing ? null : idx)}
                              >
                                <Edit3 className="h-3 w-3 mr-1" />
                                {isEditing ? "Pronto" : "Editar"}
                              </Button>
                            )}
                          </div>
                          {isEditing ? (
                            <Textarea
                              value={patchText}
                              onChange={(e) =>
                                setEditedPatches((prev) => ({ ...prev, [idx]: e.target.value }))
                              }
                              className="font-mono text-xs h-40"
                            />
                          ) : (
                            <pre className="bg-muted/40 rounded p-2 text-[11px] overflow-auto max-h-40">
                              {patchText}
                            </pre>
                          )}
                        </div>
                      )}

                      {!isApplied && issue.patch && issue.step_id && (
                        <div className="mt-3 flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAppliedIdx((prev) => new Set(prev).add(idx))}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Rejeitar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setConfirmIdx(idx)}
                            disabled={saving}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Aprovar e salvar
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmIdx !== null} onOpenChange={(o) => !o && setConfirmIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alteração no banco?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  Você está prestes a salvar a sugestão da IA no passo{" "}
                  <strong>
                    {confirmIdx !== null && result
                      ? steps.find((s) => s.id === result.issues[confirmIdx]?.step_id)?.title ?? "?"
                      : "?"}
                  </strong>
                  .
                </div>
                <div className="text-xs">A alteração será registrada na auditoria com seu usuário.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => confirmIdx !== null && handleApprove(confirmIdx)}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Confirmar e salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
