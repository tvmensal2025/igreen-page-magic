import { useState, useMemo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginatedListProps<T> {
  items: T[];
  pageSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  renderEmpty: () => ReactNode;
  /** Quando true, a lista cresce naturalmente e só o container externo rola
      (evita "scroll dentro de scroll"). Default: false (mantém scroll interno). */
  flow?: boolean;
  /** Espaçamento entre itens (classe Tailwind). Default: space-y-3. */
  gapClassName?: string;
}

export function PaginatedList<T>({ items, pageSize, renderItem, renderEmpty, flow = false, gapClassName = "space-y-3" }: PaginatedListProps<T>) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);

  const pageItems = useMemo(
    () => items.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize),
    [items, clampedPage, pageSize]
  );

  if (items.length === 0) return <>{renderEmpty()}</>;

  return (
    <div>
      <div className={flow ? gapClassName : `max-h-[calc(100vh-460px)] overflow-y-auto ${gapClassName} pr-1`}>
        {pageItems.map((item, i) => renderItem(item, clampedPage * pageSize + i))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-border/30 mt-3">
          <p className="text-xs text-muted-foreground">
            {clampedPage * pageSize + 1}–{Math.min((clampedPage + 1) * pageSize, items.length)} de {items.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)} className="h-8 w-8 p-0">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">{clampedPage + 1} / {totalPages}</span>
            <Button variant="ghost" size="sm" disabled={clampedPage >= totalPages - 1} onClick={() => setPage(clampedPage + 1)} className="h-8 w-8 p-0">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
