import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, Sparkles, Wand2, Loader2 } from "lucide-react";
import {
  Step,
  getButtons,
  resolveGotoLabel,
  Variant,
  VARIANT_LABEL,
  STEP_TYPE_OPTIONS,
} from "./flowTypes";
import { rowsToCsv, downloadCsv } from "@/lib/flowSpreadsheetExport";
import { cn } from "@/lib/utils";

interface Props {
  steps: Step[];
  flowId: string | null;
  variant: Variant;
  mediaCounts: Record<string, { audio: number; image: number; video: number }>;
  onOpenStep: (stepId: string) => void;
  onReviewAll: () => void;
  onSuggestForStep: (stepId: string) => void;
  reviewing: boolean;
  suggestingStepId: string | null;
}

const COLUMNS: { key: string; label: string; width: string }[] = [
  { key: "pos", label: "Pos", width: "w-14" },
  { key: "step_key", label: "Step key", width: "w-40" },
  { key: "title", label: "Título", width: "w-48" },
  { key: "type", label: "Tipo", width: "w-32" },
  { key: "variant", label: "Variante", width: "w-20" },
  { key: "message_text", label: "Mensagem", width: "w-96" },
  { key: "buttons", label: "Botões", width: "w-48" },
  { key: "media", label: "Mídias", width: "w-32" },
  { key: "transitions", label: "Transições", width: "w-72" },
  { key: "fallback", label: "Fallback", width: "w-48" },
  { key: "captures", label: "Capturas", width: "w-40" },
  { key: "status", label: "Status", width: "w-24" },
  { key: "issues", label: "Problemas detectados", width: "w-72" },
  { key: "actions", label: "", width: "w-32" },
];

function detectLocalIssues(s: Step, all: Step[]): string[] {
  const issues: string[] = [];
  if (!s.message_text || !s.message_text.trim()) issues.push("Sem mensagem de texto");
  if (s.is_active === false) issues.push("Inativo");
  if ((s.transitions || []).length === 0 && s.step_type === "message") {
    issues.push("Sem transições (fluxo morre)");
  }
  for (const t of s.transitions || []) {
    if (!t.goto_step_id && !t.goto_special) issues.push(`Trigger "${t.trigger_intent}" sem destino`);
    if (t.goto_step_id) {
      const tgt = all.find((x) => x.id === t.goto_step_id);
      if (!tgt) issues.push(`Trigger "${t.trigger_intent}" aponta para passo removido`);
      else if (!tgt.is_active) issues.push(`Trigger "${t.trigger_intent}" aponta para passo inativo`);
    }
  }
  const dupKey = s.step_key && all.filter((x) => x.step_key === s.step_key).length > 1;
  if (dupKey) issues.push("step_key duplicado");
  return issues;
}

export default function FlowSpreadsheet({
  steps,
  flowId,
  variant,
  mediaCounts,
  onOpenStep,
  onReviewAll,
  onSuggestForStep,
  reviewing,
  suggestingStepId,
}: Props) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const typeMeta = STEP_TYPE_OPTIONS.find((o) => o.value === s.step_type);
        const buttons = getButtons(s);
        const buttonsStr = buttons.length
          ? buttons.map((b) => `${b.id}: ${b.title}`).join("\n")
          : "—";
        const transitionsStr = (s.transitions || []).length
          ? s.transitions
              .map((t) => {
                const dest = resolveGotoLabel(steps, t).label;
                const phrases = t.trigger_phrases?.length
                  ? ` (${t.trigger_phrases.slice(0, 3).join(", ")})`
                  : "";
                return `${t.trigger_intent}${phrases} → ${dest}`;
              })
              .join("\n")
          : "—";
        const fallbackStr = (() => {
          const f = s.fallback;
          if (!f) return "—";
          if (f.mode === "repeat") return "🔁 Repetir";
          if (f.mode === "goto") {
            const tgt = steps.find((x) => x.id === f.goto_step_id);
            return `→ ${tgt?.title ?? "passo removido"}`;
          }
          if (f.mode === "ai") return `🤖 IA: ${f.ai_prompt?.slice(0, 60) ?? ""}`;
          if (f.mode === "ai_limit") return `🤖 IA (limite ${f.max_questions ?? "?"}) → ${f.then ?? "humano"}`;
          return f.mode;
        })();
        const capturesStr = (s.captures || [])
          .filter((c) => c.enabled !== false && c.field !== "_buttons")
          .map((c) => c.field)
          .join(", ") || "—";
        const m = s.slot_key ? mediaCounts[s.slot_key] : undefined;
        const mediaStr = m
          ? [
              m.audio ? `🔊 ${m.audio}` : null,
              m.image ? `🖼 ${m.image}` : null,
              m.video ? `🎬 ${m.video}` : null,
            ]
              .filter(Boolean)
              .join(" ") || "—"
          : "—";
        const issues = detectLocalIssues(s, steps);

        const row = {
          id: s.id,
          pos: s.position,
          step_key: s.step_key ?? "—",
          title: s.title,
          type: `${typeMeta?.emoji ?? ""} ${typeMeta?.label ?? s.step_type}`,
          variant,
          message_text: s.message_text ?? "",
          buttons: buttonsStr,
          media: mediaStr,
          transitions: transitionsStr,
          fallback: fallbackStr,
          captures: capturesStr,
          status: s.is_active === false ? "Inativo" : "Ativo",
          issues: issues.length ? issues.join("\n") : "—",
          _issuesCount: issues.length,
          _step: s,
        };

        if (!q) return row;
        const hay = Object.values(row).join(" ").toLowerCase();
        return hay.includes(q) ? row : null;
      })
      .filter(Boolean) as Array<ReturnType<typeof Object.assign> & {
        id: string;
        pos: number;
        step_key: string;
        title: string;
        type: string;
        variant: string;
        message_text: string;
        buttons: string;
        media: string;
        transitions: string;
        fallback: string;
        captures: string;
        status: string;
        issues: string;
        _issuesCount: number;
        _step: Step;
      }>;
  }, [steps, mediaCounts, query, variant]);

  const handleExport = () => {
    const exportCols = COLUMNS.filter((c) => c.key !== "actions");
    const csvRows = rows.map((r) => {
      const out: Record<string, string | number> = {};
      for (const c of exportCols) out[c.key] = (r as any)[c.key] ?? "";
      return out;
    });
    const csv = rowsToCsv(csvRows, exportCols);
    downloadCsv(`fluxo-${variant}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const totalIssues = rows.reduce((n, r) => n + r._issuesCount, 0);

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[500px] flex-col rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
        <div>
          <div className="text-sm font-semibold">
            Planilha — Variante {variant}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {VARIANT_LABEL[variant].replace(/^[A-E]\s*/, "")}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {steps.length} {steps.length === 1 ? "passo" : "passos"}
            {totalIssues > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px]">
                {totalIssues} {totalIssues === 1 ? "problema" : "problemas"} locais
              </Badge>
            )}
            <span className="ml-2">· somente leitura · clique numa linha para editar</span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar em qualquer coluna…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-56 text-xs"
          />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}>
            <Download className="mr-1 h-3 w-3" /> Exportar CSV
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onReviewAll}
            disabled={!flowId || !steps.length || reviewing}
            className="bg-purple-600 hover:bg-purple-700"
            title="GPT-5.5 analisa o fluxo todo e propõe melhorias"
          >
            {reviewing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            Revisar fluxo (IA)
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-muted">
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  className={cn(
                    "border-b border-r px-2 py-2 text-left font-semibold text-muted-foreground",
                    c.width,
                    i === 0 && "sticky left-0 z-30 bg-muted",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum passo corresponde à busca.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const hasIssue = r._issuesCount > 0;
                const isSuggesting = suggestingStepId === r.id;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "group cursor-pointer align-top hover:bg-muted/40",
                      hasIssue && "bg-destructive/5",
                    )}
                    onClick={() => onOpenStep(r.id)}
                  >
                    <td className="sticky left-0 z-10 border-b border-r bg-background px-2 py-2 font-mono text-muted-foreground group-hover:bg-muted/40">
                      {r.pos}
                    </td>
                    <td className="border-b border-r px-2 py-2 font-mono">{r.step_key}</td>
                    <td className="border-b border-r px-2 py-2 font-medium">{r.title}</td>
                    <td className="border-b border-r px-2 py-2">{r.type}</td>
                    <td className="border-b border-r px-2 py-2 text-center">{r.variant}</td>
                    <td className="border-b border-r px-2 py-2 whitespace-pre-wrap break-words">
                      {r.message_text || <span className="italic text-muted-foreground">—</span>}
                    </td>
                    <td className="border-b border-r px-2 py-2 whitespace-pre-wrap">{r.buttons}</td>
                    <td className="border-b border-r px-2 py-2">{r.media}</td>
                    <td className="border-b border-r px-2 py-2 whitespace-pre-wrap">{r.transitions}</td>
                    <td className="border-b border-r px-2 py-2 whitespace-pre-wrap">{r.fallback}</td>
                    <td className="border-b border-r px-2 py-2">{r.captures}</td>
                    <td className="border-b border-r px-2 py-2">
                      <Badge variant={r.status === "Ativo" ? "secondary" : "outline"} className="text-[10px]">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="border-b border-r px-2 py-2 whitespace-pre-wrap text-destructive">
                      {r.issues}
                    </td>
                    <td className="border-b border-r px-2 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSuggestForStep(r.id);
                        }}
                        disabled={isSuggesting || reviewing}
                      >
                        {isSuggesting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="mr-1 h-3 w-3" />
                        )}
                        Sugerir
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
