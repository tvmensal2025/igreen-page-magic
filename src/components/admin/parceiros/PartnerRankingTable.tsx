import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Pencil,
  QrCode,
  Search,
  Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ReferralPartner } from "./hooks/useReferralPartners";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  partners: ReferralPartner[];
  analytics: PartnerAnalytics[];
  onEdit: (p: ReferralPartner) => void;
  onDelete: (id: string) => void;
  onQrCode: (p: ReferralPartner) => void;
}

export function PartnerRankingTable({
  partners,
  analytics,
  onEdit,
  onDelete,
  onQrCode,
}: Props) {
  const [query, setQuery] = useState("");
  const confirm = useConfirm();
  const handleDeleteClick = async (partner: ReferralPartner) => {
    const ok = await confirm({
      title: "Excluir parceiro?",
      description: `O parceiro "${partner.nome}" será removido e deixará de receber atribuição de novos leads. Esta ação não pode ser desfeita pela interface.`,
      confirmText: "Excluir",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (ok) onDelete(partner.id);
  };


  const rows = useMemo(() => {
    const aMap = new Map(analytics.map((a) => [a.partner_id, a]));
    return partners
      .map((p) => {
        const a = aMap.get(p.id);
        const total = a?.leads_total ?? 0;
        const last30 = a?.leads_30d ?? 0;
        const prev30 = a?.leads_prev_30d ?? 0;
        const aprov = a?.aprovados ?? 0;
        const conv = total > 0 ? Math.round((aprov / total) * 100) : 0;
        const trend =
          prev30 === 0
            ? last30 > 0
              ? 100
              : 0
            : Math.round(((last30 - prev30) / prev30) * 100);
        return { partner: p, total, last30, prev30, aprov, conv, trend };
      })
      .filter((r) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          r.partner.nome.toLowerCase().includes(q) ||
          (r.partner.keywords ?? []).some((k) => k.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.total - a.total);
  }, [partners, analytics, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar parceiro ou palavra-chave..."
          className="pl-9"
        />
      </div>
      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parceiro</TableHead>
              <TableHead className="hidden md:table-cell">Keywords</TableHead>
              <TableHead className="text-right">Clientes interessados</TableHead>
              <TableHead className="text-right hidden sm:table-cell">
                Aprovados
              </TableHead>
              <TableHead className="text-right">Conv%</TableHead>
              <TableHead className="text-right hidden md:table-cell">
                30 dias
              </TableHead>
              <TableHead className="text-right hidden lg:table-cell">
                vs anterior
              </TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  Nenhum parceiro encontrado.
                </TableCell>
              </TableRow>
            )}
            {rows.map(
              ({ partner, total, last30, aprov, conv, trend, prev30 }) => {
                const initials = partner.nome
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                const trendPositive = trend >= 0;
                return (
                  <TableRow key={partner.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold ring-1 ring-primary/20">
                          {initials}
                        </div>
                        <div>
                          <p className="font-medium leading-tight">
                            {partner.nome}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {partner.cli}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(partner.keywords ?? []).slice(0, 3).map((kw) => (
                          <Badge
                            key={kw}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {kw}
                          </Badge>
                        ))}
                        {(partner.keywords?.length ?? 0) > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{(partner.keywords?.length ?? 0) - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">
                      {total}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums hidden sm:table-cell">
                      {aprov}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={conv >= 30 ? "default" : "secondary"}
                        className="font-mono"
                      >
                        {conv}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums hidden md:table-cell">
                      {last30}
                    </TableCell>
                    <TableCell className="text-right hidden lg:table-cell">
                      {prev30 === 0 && last30 === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            trendPositive ? "text-primary" : "text-destructive"
                          }`}
                        >
                          {trendPositive ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )}
                          {Math.abs(trend)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onQrCode(partner)}>
                            <QrCode className="h-4 w-4 mr-2" /> QR Code
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEdit(partner)}>
                            <Pencil className="h-4 w-4 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDeleteClick(partner)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              },
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
