import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CAPACIDADES,
  CRONS_ESPERADOS,
  STATUS_LABEL,
  SUGESTOES,
  type CapacidadeItem,
} from "@/lib/sistemaCapacidadesMapa";

function StatusBadge({ status }: { status: CapacidadeItem["status"] }) {
  const variant =
    status === "pronto_on"
      ? "default"
      : status === "pronto_off"
        ? "secondary"
        : status === "parcial"
          ? "outline"
          : "destructive";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function PrioBadge({ p }: { p: "alta" | "media" | "baixa" }) {
  const cls =
    p === "alta"
      ? "bg-amber-500/15 text-amber-800 border-amber-500/30"
      : p === "media"
        ? "bg-sky-500/10 text-sky-800 border-sky-500/20"
        : "bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cls}>{p.toUpperCase()}</Badge>;
}

type Props = {
  /** Texto curto no botão (opcional) */
  label?: string;
  className?: string;
};

/**
 * Botão "?" — mapa do que o sistema pode fazer + sugestões.
 * Não liga nenhuma automação.
 */
export function SistemaCapacidadesHelp({ label = "O que podemos fazer?", className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`gap-1.5 rounded-full ${className ?? ""}`}
          title="Ver o que o sistema pode fazer e o que melhorar"
        >
          <HelpCircle className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">?</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mapa do sistema — o que podemos fazer</DialogTitle>
          <DialogDescription>
            Nada aqui liga automação. Use a Central de Agendamentos para ligar/desligar com segurança.
            Hoje a maioria das automações está <strong>DESLIGADA</strong> de propósito.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="capacidades" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="capacidades">Capacidades</TabsTrigger>
            <TabsTrigger value="sugestoes">Melhorar</TabsTrigger>
            <TabsTrigger value="crons">Crons</TabsTrigger>
          </TabsList>

          <TabsContent value="capacidades" className="space-y-3 mt-4">
            {CAPACIDADES.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm">{c.nome}</div>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground">{c.oQueFaz}</p>
                <p className="text-[11px] text-muted-foreground">
                  Onde: {c.onde}
                  {c.toggle ? ` · Toggle: ${c.toggle}` : ""}
                </p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="sugestoes" className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground">
              Ordem sugerida para não perder lead sem spammar: checker 6h → nudge FAQ → follow-up completo.
            </p>
            {SUGESTOES.map((s, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <PrioBadge p={s.prioridade} />
                  <span className="font-medium text-sm">{s.titulo}</span>
                </div>
                <p className="text-xs"><span className="text-muted-foreground">Por quê:</span> {s.porque}</p>
                <p className="text-xs"><span className="text-muted-foreground">Como:</span> {s.como}</p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="crons" className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground">
              Jobs prontos no banco. O cron pode existir e mesmo assim <strong>não enviar</strong> se o toggle estiver OFF.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Job</th>
                    <th className="text-left p-2">Para quê</th>
                    <th className="text-left p-2">Toggle</th>
                  </tr>
                </thead>
                <tbody>
                  {CRONS_ESPERADOS.map((r) => (
                    <tr key={r.job} className="border-t">
                      <td className="p-2 font-mono">{r.job}</td>
                      <td className="p-2">{r.paraQue}</td>
                      <td className="p-2 font-mono text-muted-foreground">{r.toggle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
