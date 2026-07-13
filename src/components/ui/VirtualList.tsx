import { useRef, type ReactNode, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps<T> {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
  getItemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Altura do container (obrigatório para scroll interno). Ex: "100%" ou 400 */
  height?: string | number;
}

/**
 * Lista virtual leve — só monta itens visíveis no DOM.
 * Não remove itens da fonte de dados; só da árvore React.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 8,
  className,
  style,
  getItemKey,
  renderItem,
  height = "100%",
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: getItemKey
      ? (index) => getItemKey(items[index]!, index)
      : (index) => index,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        height,
        overflow: "auto",
        contain: "strict",
        ...style,
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]!;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
