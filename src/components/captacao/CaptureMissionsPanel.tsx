import { useEffect, useState } from "react";
import { Award } from "lucide-react";

interface Mission { id: string; label: string; emoji: string; target: number; current: number; }

const KEY_PREFIX = "capture-missions-v1-";
function todayKey() { return new Date().toLocaleDateString("sv-SE"); }

interface Stored { date: string; leads: number; aiAccepts: number; }

function loadStored(consultantId: string): Stored {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + consultantId);
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (s.date === todayKey()) return s;
    }
  } catch { /* */ }
  return { date: todayKey(), leads: 0, aiAccepts: 0 };
}

function saveStored(consultantId: string, s: Stored) {
  try { localStorage.setItem(KEY_PREFIX + consultantId, JSON.stringify(s)); } catch { /* */ }
}

interface Props { consultantId: string; streak: number; bumpVersion?: number; }

export function CaptureMissionsPanel({ consultantId, streak, bumpVersion = 0 }: Props) {
  const [data, setData] = useState<Stored>(() => loadStored(consultantId));

  useEffect(() => { setData(loadStored(consultantId)); }, [consultantId, bumpVersion]);

  const missions: Mission[] = [
    { id: "leads", label: "Capturar 3 clientes interessados", emoji: "🎯", target: 3, current: data.leads },
    { id: "streak", label: "Streak 5 dias", emoji: "🔥", target: 5, current: streak },
    { id: "ai", label: "Aceitar 5 IA", emoji: "🤖", target: 5, current: data.aiAccepts },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {missions.map((m) => {
        const pct = Math.min(100, Math.round((m.current / m.target) * 100));
        const done = m.current >= m.target;
        return (
          <div
            key={m.id}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] ${
              done ? "border-warning/60 bg-warning/10 text-warning" : "border-border bg-card/60"
            }`}
            title={`${m.label} — ${m.current}/${m.target}`}
          >
            <span>{m.emoji}</span>
            <span className="font-semibold tabular-nums">{Math.min(m.current, m.target)}/{m.target}</span>
            <div className="w-10 h-1 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full ${done ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
            </div>
            {done && <Award className="w-3 h-3" />}
          </div>
        );
      })}
    </div>
  );
}

export function bumpMission(consultantId: string, kind: "leads" | "aiAccepts") {
  const s = loadStored(consultantId);
  s[kind] = (s[kind] || 0) + 1;
  saveStored(consultantId, s);
}
