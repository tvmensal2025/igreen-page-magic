import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Cake, Gift, MessageCircle, PartyPopper, Send, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  BIRTHDAY_MESSAGE_TEMPLATES,
  fillBirthdayMessage,
  firstNameFrom,
  isValidWhatsAppPhone,
  openBirthdayWhatsApp,
  pickRandomBirthdayMessage,
} from "@/lib/birthdayMessages";

/** Templates locais de reativação — usam {{nome}} igual aniversário. */
const REACTIVATION_TEMPLATES: readonly string[] = [
  `Oi *{{nome}}*! Tudo bem? Faz um tempinho que a gente não conversa. Passei aqui pra saber se posso te ajudar com alguma coisa. 🌱`,
  `Oi *{{nome}}*, aqui é da iGreen. Vi que seu cadastro ficou pendente — quer que eu te ajude a finalizar? Leva 2 minutinhos. 💚`,
  `*{{nome}}*, tudo certo? Notei que ficamos um bom tempo sem falar. Se quiser, posso te mandar de novo como funciona a economia na conta de luz. ⚡`,
  `Oi *{{nome}}*! Já já a gente fecha as vagas do mês. Se quiser garantir o desconto na sua conta de luz, me chama aqui. 👋`,
  `*{{nome}}*, tudo joia? Só passando pra lembrar que sua economia com a iGreen ainda tá te esperando. Bora conversar? 🌿`,
  `Oi *{{nome}}*, sumida(o)! 😅 Tô aqui se precisar de qualquer coisa sobre a iGreen. Qualquer dúvida é só chamar.`,
];

function pickRandom(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}


interface Customer {
  id: string;
  name?: string | null;
  phone_whatsapp?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  data_nascimento?: string | null;
}

const daysSince = (iso?: string | null) => {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
};

// data_nascimento: "YYYY-MM-DD" ou "DD/MM/YYYY"
function parseBirth(s?: string | null): { year: number; month: number; day: number } | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!month || !day || month > 12 || day > 31) return null;
    return { year, month, day };
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s.trim());
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (br[3].length === 2) year = 2000 + year;
    if (!month || !day || month > 12 || day > 31) return null;
    return { year, month, day };
  }
  return null;
}

function ageThisYear(year: number): number {
  return new Date().getFullYear() - year;
}

function previewMessage(text: string): string {
  return text.replace(/\*([^*]+)\*/g, "$1").replace(/\n+/g, " ").trim();
}

function BirthdayMessageButton({ customer }: { customer: Customer }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const hasPhone = isValidWhatsAppPhone(customer.phone_whatsapp);

  const send = (template: string) => {
    const msg = fillBirthdayMessage(template, customer.name);
    if (!openBirthdayWhatsApp(customer.phone_whatsapp || "", msg)) {
      toast({
        title: "Sem WhatsApp cadastrado",
        description: "Este cliente não tem celular válido para envio.",
        variant: "destructive",
      });
      return;
    }
    setOpen(false);
    toast({ title: "🎂 Mensagem pronta!", description: `Abrindo WhatsApp para ${customer.name || "o cliente"}.` });
  };

  const sendRandom = () => send(pickRandomBirthdayMessage());

  if (!hasPhone) {
    return (
      <span className="text-[10px] text-muted-foreground" title="Sem celular cadastrado">
        sem zap
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[10px] rounded-lg border-accent/40 text-accent hover:bg-accent/10"
          title="Parabenizar no WhatsApp"
        >
          <Gift className="w-3 h-3" />
          <span className="hidden sm:inline">Parabenizar</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,22rem)] p-0" align="end">
        <div className="px-3 py-2.5 border-b border-border/50 bg-accent/5">
          <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Cake className="w-3.5 h-3.5 text-accent" />
            Parabenizar {customer.name?.split(/\s+/)[0] || "cliente"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">10 mensagens prontas — sem IA</p>
        </div>
        <div className="p-2 border-b border-border/40">
          <Button
            type="button"
            size="sm"
            className="w-full h-8 gap-1.5 text-xs font-bold"
            onClick={sendRandom}
          >
            <Shuffle className="w-3.5 h-3.5" />
            Enviar mensagem aleatória
          </Button>
        </div>
        <ul className="max-h-[240px] overflow-y-auto divide-y divide-border/30">
          {BIRTHDAY_MESSAGE_TEMPLATES.map((tpl, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                onClick={() => send(tpl)}
              >
                <span className="text-[10px] font-bold text-accent uppercase tracking-wide">
                  Mensagem {i + 1}
                </span>
                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                  {previewMessage(fillBirthdayMessage(tpl, customer.name))}
                </p>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-3 py-2 border-t border-border/40 bg-muted/20">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <MessageCircle className="w-3 h-3" />
            Abre o WhatsApp com a mensagem formatada
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RetentionCard({ customers }: { customers: Customer[] | undefined }) {
  const list = customers ?? [];
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curDay = now.getDate();

  const parados = list
    .filter((c) => {
      const s = (c.status || "").toLowerCase();
      const stale = s === "pending" || s === "devolutiva" || s === "lead" || s === "data_complete";
      return stale && daysSince(c.created_at) >= 30;
    })
    .sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at));

  const withBirth = list
    .map((c) => ({ c, b: parseBirth(c.data_nascimento) }))
    .filter((x): x is { c: Customer; b: { year: number; month: number; day: number } } => x.b !== null);

  const aniversariantesHoje = withBirth
    .filter((x) => x.b.month === curMonth && x.b.day === curDay)
    .sort((a, b) => (a.c.name || "").localeCompare(b.c.name || ""));

  const aniversariantesMes = withBirth
    .filter((x) => x.b.month === curMonth)
    .sort((a, b) => a.b.day - b.b.day || (a.c.name || "").localeCompare(b.c.name || ""));

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <div>
            <h3 className="font-heading font-black text-sm tracking-tight">REATIVAR CLIENTES PARADOS</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sem avanço há +30 dias — mande um oi</p>
          </div>
        </header>
        {parados.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum cliente parado. 🎉</p>
        ) : (
          <ol className="divide-y divide-border/40 max-h-[320px] overflow-y-auto">
            {parados.map((c) => (
              <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-2.5 hover:bg-muted/30">
                <p className="text-sm font-semibold text-foreground truncate">{c.name || "Sem nome"}</p>
                <span className="text-xs tabular-nums text-destructive font-bold">{daysSince(c.created_at)}d</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <Cake className="w-4 h-4 text-accent" />
          <div>
            <h3 className="font-heading font-black text-sm tracking-tight">ANIVERSARIANTES</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Hoje e do mês — bom momento pra parabenizar</p>
          </div>
        </header>

        {withBirth.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma data de nascimento cadastrada.</p>
        ) : (
          <div className="divide-y divide-border/40">
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <PartyPopper className="w-3.5 h-3.5 text-accent" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-accent font-bold">
                  Hoje ({aniversariantesHoje.length})
                </span>
              </div>
              {aniversariantesHoje.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém faz aniversário hoje.</p>
              ) : (
                <ul className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {aniversariantesHoje.map(({ c, b }) => (
                    <li key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">{c.name || "Sem nome"}</p>
                      <span className="text-xs tabular-nums text-accent font-bold">{ageThisYear(b.year)} anos</span>
                      <BirthdayMessageButton customer={c} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Cake className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
                  Este mês ({aniversariantesMes.length})
                </span>
              </div>
              {aniversariantesMes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém este mês.</p>
              ) : (
                <ul className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {aniversariantesMes.map(({ c, b }) => {
                    const isToday = b.month === curMonth && b.day === curDay;
                    return (
                      <li
                        key={c.id}
                        className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-0.5 ${isToday ? "bg-accent/5 -mx-2 px-2 rounded-lg" : ""}`}
                      >
                        <p className="text-sm font-semibold text-foreground truncate">{c.name || "Sem nome"}</p>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {String(b.day).padStart(2, "0")}/{String(b.month).padStart(2, "0")}
                        </span>
                        <span className="text-xs tabular-nums text-accent font-bold w-[52px] text-right">
                          {ageThisYear(b.year)}a
                        </span>
                        {isToday ? <BirthdayMessageButton customer={c} /> : <span className="w-[72px]" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
