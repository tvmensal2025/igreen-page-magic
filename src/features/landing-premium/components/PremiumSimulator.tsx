import { useMemo, useState } from "react";
import { DESCONTO_MAX_PCT } from "../content";

interface PremiumSimulatorProps {
  /** Recebe o valor informado para montar a mensagem do WhatsApp. */
  buildWhatsAppUrl: (billValue: number) => string;
  onWhatsAppClick: () => void;
}

const MIN_BILL = 100;
const MAX_BILL = 3000;
const DEFAULT_BILL = 400;

const brl = (value: number) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

/**
 * Simulador de economia.
 *
 * O cálculo é a aplicação direta do desconto divulgado (até 20%) sobre o valor
 * que a própria pessoa informa. Não há tabela secreta nem número inventado:
 * é `valor × 20%`, e o texto deixa claro que é estimativa e que o número final
 * depende da análise da fatura.
 *
 * Por que isso converte: transforma "até 20%" (abstrato) em "R$ 80 por mês"
 * (concreto, no orçamento da pessoa). E o valor informado viaja junto na
 * mensagem do WhatsApp, então a conversa já começa qualificada.
 */
const PremiumSimulator = ({ buildWhatsAppUrl, onWhatsAppClick }: PremiumSimulatorProps) => {
  const [bill, setBill] = useState(DEFAULT_BILL);

  const { monthly, yearly, newBill } = useMemo(() => {
    const safe = Number.isFinite(bill) ? Math.max(0, bill) : 0;
    const saving = (safe * DESCONTO_MAX_PCT) / 100;
    return {
      monthly: saving,
      yearly: saving * 12,
      newBill: safe - saving,
    };
  }, [bill]);

  /** Aceita só dígitos e limita ao teto, evitando estado inválido. */
  const handleTyped = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setBill(digits ? Math.min(Number(digits), MAX_BILL) : 0);
  };

  return (
    <section id="simulador" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <div className="text-center max-w-[640px] mx-auto" data-reveal>
          <p className="lpx-eyebrow">Simulação</p>
          <h2 className="lpx-h2 mt-4">Quanto isso vale no seu bolso?</h2>
          <p className="lpx-lead mt-3">
            Coloque o valor médio da sua conta de luz e veja a estimativa de desconto.
          </p>
        </div>

        <div className="lpx-card lpx-card--edge mt-8 md:mt-10 max-w-[980px] mx-auto" data-reveal>
          <div className="lpx-sim">
            <div>
              <div className="lpx-field">
                <label htmlFor="lpx-bill">Sua conta de luz hoje (média mensal)</label>
                <div className="lpx-input-money">
                  <span className="lpx-input-money__prefix" aria-hidden="true">
                    R$
                  </span>
                  <input
                    id="lpx-bill"
                    // `text` + inputMode numeric: abre teclado numérico no
                    // celular sem herdar as setas do input[type=number].
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={bill ? String(bill) : ""}
                    onChange={(e) => handleTyped(e.target.value)}
                    placeholder="400"
                    aria-describedby="lpx-bill-help"
                  />
                </div>
              </div>

              <input
                type="range"
                className="lpx-range mt-4"
                min={MIN_BILL}
                max={MAX_BILL}
                step={10}
                value={Math.min(Math.max(bill, MIN_BILL), MAX_BILL)}
                onChange={(e) => setBill(Number(e.target.value))}
                aria-label="Ajustar o valor da conta de luz"
                aria-valuetext={`${brl(bill)} por mês`}
              />

              <div className="flex justify-between lpx-body !text-xs">
                <span>{brl(MIN_BILL)}</span>
                <span>{brl(MAX_BILL)}+</span>
              </div>

              <p id="lpx-bill-help" className="lpx-body !text-xs mt-4">
                Conta acima de {brl(MAX_BILL)}? O desconto continua valendo — fale com o
                consultor para a análise do seu caso.
              </p>
            </div>

            <div className="lpx-result">
              <p className="lpx-result__k">Economia estimada por mês</p>
              {/* aria-live: quem usa leitor de tela ouve o valor mudar. */}
              <p className="lpx-result__v lpx-result__v--hero" aria-live="polite">
                {brl(monthly)}
              </p>

              <div className="mt-3">
                <div className="lpx-result__row">
                  <span className="lpx-result__k">Em 12 meses</span>
                  <span className="lpx-result__v">{brl(yearly)}</span>
                </div>
                <div className="lpx-result__row">
                  <span className="lpx-result__k">Valor estimado com desconto</span>
                  <span className="lpx-result__v">{brl(newBill)}</span>
                </div>
                <div className="lpx-result__row">
                  <span className="lpx-result__k">Custo para participar</span>
                  <span className="lpx-result__v">R$ 0</span>
                </div>
              </div>

              <a
                href={buildWhatsAppUrl(bill)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onWhatsAppClick}
                className="lpx-btn lpx-btn--wa lpx-btn--block mt-5"
              >
                Confirmar meu desconto real
              </a>

              <p className="lpx-result__note">
                Estimativa baseada no desconto de até {DESCONTO_MAX_PCT}% sobre o valor
                informado. O desconto incide sobre a parte de energia da fatura; encargos e
                tributos seguem as regras da distribuidora. O valor exato é confirmado na
                análise da sua conta.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PremiumSimulator;
