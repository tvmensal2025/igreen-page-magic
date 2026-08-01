import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Volume2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import {
  displaySofiaName,
  groupIntroRowsByName,
  isApprovedNomeSlot,
  isApprovedOlaSlot,
  isRiskyNomeSlot,
  pickBestIntroRow,
  storagePathFromUrl,
  type MediaRow,
} from "@/lib/sofiaNameAudioAudit";
import { useConfirm } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 40;

type FilterMode = "all" | "risk" | "approved" | "missing";

function statusBadge(row: MediaRow | null, kind: "ola" | "nome") {
  if (!row) {
    return <Badge variant="outline" className="text-muted-foreground">Sem áudio</Badge>;
  }
  if (kind === "nome" && isRiskyNomeSlot(row.slot_key)) {
    return <Badge variant="destructive">Risco espanhol</Badge>;
  }
  if (kind === "nome" && isApprovedNomeSlot(row.slot_key, row.active)) {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">ptbr3 ✓</Badge>;
  }
  if (kind === "ola" && isApprovedOlaSlot(row.slot_key, row.active)) {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Aprovado</Badge>;
  }
  if (row.active) {
    return <Badge variant="secondary">Ativo</Badge>;
  }
  return <Badge variant="outline">Inativo</Badge>;
}

function AudioCell({
  row,
  kind,
  onApprove,
  onDelete,
  busy,
}: {
  row: MediaRow | null;
  kind: "ola" | "nome";
  onApprove: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  const play = () => {
    if (!row?.url) {
      toast.error("Nenhum MP3 neste slot");
      return;
    }
    const audio = new Audio(row.url);
    setPlaying(true);
    audio.play().catch(() => toast.error("Erro ao reproduzir"));
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      toast.error("Áudio indisponível");
    };
  };

  return (
    <div className="flex flex-col gap-2 min-w-[200px]">
      <div className="flex items-center gap-2 flex-wrap">
        {statusBadge(row, kind)}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!row?.url || busy}
          onClick={play}
          className="h-8 gap-1"
        >
          {playing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Play
        </Button>
      </div>
      <div className="flex gap-1 flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
          disabled={busy}
          onClick={onApprove}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Aprovar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-8 gap-1"
          disabled={busy || !row}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>
      {row?.slot_key && (
        <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px]" title={row.slot_key}>
          {row.slot_key}
        </p>
      )}
    </div>
  );
}

export default function AdminSofiaNameAudios() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [page, setPage] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (cid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ai_media_library")
        .select("id, slot_key, url, active, label, created_at, storage_path")
        .eq("consultant_id", cid)
        .like("slot_key", "intro:%")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data || []) as MediaRow[]);
    } catch (e) {
      toast.error("Falha ao carregar áudios", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setConsultantId(user.id);
      await load(user.id);
    })();
  }, [load, navigate]);

  const grouped = useMemo(() => groupIntroRowsByName(rows), [rows]);

  const entries = useMemo(() => {
    const list = [...grouped.entries()].map(([nameNorm, nameRows]) => {
      const ola = pickBestIntroRow(nameRows, "ola");
      const nome = pickBestIntroRow(nameRows, "nome");
      return { nameNorm, display: displaySofiaName(nameNorm), ola, nome, all: nameRows };
    });

    const q = search.trim().toLowerCase();
    let filtered = list;
    if (q) {
      filtered = filtered.filter(
        (e) => e.nameNorm.includes(q) || e.display.toLowerCase().includes(q),
      );
    }

    if (filter === "risk") {
      filtered = filtered.filter(
        (e) => !e.nome || isRiskyNomeSlot(e.nome.slot_key) || (e.nome.active && isRiskyNomeSlot(e.nome.slot_key)),
      );
    } else if (filter === "approved") {
      filtered = filtered.filter(
        (e) =>
          isApprovedOlaSlot(e.ola?.slot_key, !!e.ola?.active) &&
          isApprovedNomeSlot(e.nome?.slot_key, !!e.nome?.active),
      );
    } else if (filter === "missing") {
      filtered = filtered.filter((e) => !e.ola?.url || !e.nome?.url);
    }

    filtered.sort((a, b) => a.display.localeCompare(b.display, "pt-BR"));
    return filtered;
  }, [grouped, search, filter]);

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const stats = useMemo(() => {
    let risky = 0;
    let approved = 0;
    for (const [, nameRows] of grouped) {
      const nome = pickBestIntroRow(nameRows, "nome");
      if (nome && isRiskyNomeSlot(nome.slot_key)) risky++;
      const ola = pickBestIntroRow(nameRows, "ola");
      if (isApprovedNomeSlot(nome?.slot_key, !!nome?.active) && isApprovedOlaSlot(ola?.slot_key, !!ola?.active)) {
        approved++;
      }
    }
    return { total: grouped.size, risky, approved };
  }, [grouped]);

  const deletePermanent = async (nameNorm: string, kind: "ola" | "nome" | "both") => {
    if (!consultantId) return;
    const label = kind === "both" ? "TODOS os intros" : kind === "ola" ? "Olá+nome" : "só nome";
    const ok = await confirm({
      title: `Excluir ${label} de "${displaySofiaName(nameNorm)}"?`,
      description: "Exclusão permanente do áudio e dos arquivos associados.",
      confirmText: "Excluir permanentemente",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;

    setBusyKey(`${nameNorm}:${kind}:del`);
    try {
      const nameRows = grouped.get(nameNorm) || [];
      const targets = nameRows.filter((r) => {
        if (kind === "both") return true;
        return r.slot_key?.startsWith(kind === "ola" ? "intro:ola:" : "intro:nome:");
      });

      for (const row of targets) {
        const path = row.storage_path || storagePathFromUrl(row.url);
        if (path) {
          await supabase.storage.from("ai-agent-media").remove([path]).catch(() => {});
        }
        const { error } = await supabase.from("ai_media_library").delete().eq("id", row.id);
        if (error) throw error;
      }

      // Stitches com esse nome
      if (kind === "nome" || kind === "both") {
        const { data: stitches } = await supabase
          .from("ai_media_library")
          .select("id, url, storage_path")
          .eq("consultant_id", consultantId)
          .like("slot_key", `%:${nameNorm}`);
        for (const s of stitches || []) {
          const path = s.storage_path || storagePathFromUrl(s.url);
          if (path) await supabase.storage.from("ai-agent-media").remove([path]).catch(() => {});
          await supabase.from("ai_media_library").delete().eq("id", s.id);
        }
      }

      toast.success(`Excluído: ${displaySofiaName(nameNorm)}`);
      await load(consultantId);
    } catch (e) {
      toast.error("Falha ao excluir", { description: (e as Error).message });
    } finally {
      setBusyKey(null);
    }
  };

  const approve = async (nameNorm: string, kind: "ola" | "nome") => {
    if (!consultantId) return;
    setBusyKey(`${nameNorm}:${kind}:ok`);
    try {
      const display = displaySofiaName(nameNorm);

      if (kind === "nome") {
        const { error: fnErr } = await supabase.functions.invoke("wa-audio-prewarm", {
          body: {
            consultant_id: consultantId,
            names: [display],
            mode: "nome_only",
            limit: 1,
            include_common: false,
            include_platform: false,
          },
        });
        if (fnErr) throw fnErr;

        const slotKey = `intro:nome:ptbr3:${nameNorm}`;
        await supabase
          .from("ai_media_library")
          .update({ active: false })
          .eq("consultant_id", consultantId)
          .like("slot_key", `intro:nome:%:${nameNorm}`);

        const { data: fresh } = await supabase
          .from("ai_media_library")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("slot_key", slotKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fresh?.id) {
          await supabase.from("ai_media_library").update({ active: true }).eq("id", fresh.id);
        }
        toast.success(`Nome "${display}" regerado em ptbr3 (PT-BR)`);
      } else {
        const { error: fnErr } = await supabase.functions.invoke("wa-audio-prewarm", {
          body: {
            consultant_id: consultantId,
            names: [display],
            mode: "ola_only",
            limit: 1,
            include_common: false,
            include_platform: false,
          },
        });
        if (fnErr) throw fnErr;

        // ptbr4 = “Olá, Nome! Tudo bem?” — mesmo namespace que o motor / ligação.
        const slotKey = `intro:ola:ptbr4:${nameNorm}`;
        await supabase
          .from("ai_media_library")
          .update({ active: false })
          .eq("consultant_id", consultantId)
          .like("slot_key", `intro:ola:%:${nameNorm}`);

        const { data: fresh } = await supabase
          .from("ai_media_library")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("slot_key", slotKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fresh?.id) {
          await supabase.from("ai_media_library").update({ active: true }).eq("id", fresh.id);
        }
        toast.success(`Olá+Nome "${display}" aprovado`);
      }

      await load(consultantId);
    } catch (e) {
      toast.error("Falha ao aprovar", { description: (e as Error).message });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--pe-bg,#0a0f0d)] text-foreground">
      <header className="border-b border-border/40 px-4 py-4 md:px-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/fluxos")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Volume2 className="h-5 w-5 text-emerald-500" />
              Sofia — Áudios Olá+nome e Nome
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ouça, aprove (PT-BR) ou exclua permanentemente. Motor usa só <code className="text-xs">ptbr3</code> no nome.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline">{stats.total} nomes</Badge>
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {stats.risky} risco
          </Badge>
          <Badge className="bg-emerald-700">{stats.approved} ok</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !consultantId}
            onClick={() => consultantId && load(consultantId)}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </header>

      <main className="px-4 md:px-8 py-6 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar nome…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(
              [
                ["all", "Todos"],
                ["risk", "Risco espanhol"],
                ["missing", "Incompletos"],
                ["approved", "Aprovados"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={filter === id ? "default" : "outline"}
                onClick={() => {
                  setFilter(id);
                  setPage(0);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-3 font-medium">Nome</th>
                    <th className="text-left p-3 font-medium">Olá + Nome</th>
                    <th className="text-left p-3 font-medium">Só Nome</th>
                  </tr>
                </thead>
                <tbody>
                  {pageEntries.map((entry) => {
                    const busyOla = busyKey?.startsWith(`${entry.nameNorm}:ola`);
                    const busyNome = busyKey?.startsWith(`${entry.nameNorm}:nome`);
                    return (
                      <tr key={entry.nameNorm} className="border-t border-border/30 align-top">
                        <td className="p-3 font-medium">{entry.display}</td>
                        <td className="p-3">
                          <AudioCell
                            row={entry.ola}
                            kind="ola"
                            busy={!!busyOla}
                            onApprove={() => approve(entry.nameNorm, "ola")}
                            onDelete={() => deletePermanent(entry.nameNorm, "ola")}
                          />
                        </td>
                        <td className="p-3">
                          <AudioCell
                            row={entry.nome}
                            kind="nome"
                            busy={!!busyNome}
                            onApprove={() => approve(entry.nameNorm, "nome")}
                            onDelete={() => deletePermanent(entry.nameNorm, "nome")}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {pageEntries.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-muted-foreground">
                        Nenhum nome encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {entries.length} nomes · página {page + 1}/{pageCount}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
