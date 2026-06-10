// Floating "+10 XP" widget that animates upward and fades. Stacks multiple
// concurrent gains using a queue keyed by timestamp.
//
// Usage:
//   const floater = useXpFloater();
//   floater.show(10); // shows "+10 XP" rising and fading
//
// Visual: bottom-right of viewport on desktop, just above the composer on
// mobile (controlled by the host via `position` prop).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface FloatItem {
  id: string;
  amount: number;
  bonus?: string;
  createdAt: number;
}

interface XpFloaterCtx {
  show: (amount: number, bonus?: string) => void;
}

const Ctx = createContext<XpFloaterCtx | null>(null);

export function XpFloaterProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FloatItem[]>([]);

  const show = useCallback((amount: number, bonus?: string) => {
    if (!amount) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev, { id, amount, bonus, createdAt: Date.now() }]);
  }, []);

  // Auto-remove items after 1.6s
  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => {
      const cutoff = Date.now() - 1600;
      setItems((prev) => prev.filter((i) => i.createdAt > cutoff));
    }, 200);
    return () => clearTimeout(t);
  }, [items]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        {items.map((item, idx) => (
          <div
            key={item.id}
            className="absolute right-4 bottom-24 flex items-center gap-1 font-black text-primary drop-shadow-[0_0_10px_hsl(142_76%_45%/0.7)] animate-game-float-up"
            style={{
              transform: `translateY(${idx * -34}px)`,
              fontSize: "1.5rem",
            }}
          >
            <span>+{item.amount}</span>
            <span className="text-warning text-xs uppercase tracking-wider">XP</span>
            {item.bonus && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-warning text-warning text-[10px] uppercase font-black">
                {item.bonus}
              </span>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useXpFloater(): XpFloaterCtx {
  const c = useContext(Ctx);
  if (!c) {
    // Headless fallback: no floater mounted in this tree, no-op.
    return { show: () => {} };
  }
  return c;
}
