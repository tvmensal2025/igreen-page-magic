import consultantDefault from "@/assets/consultant.jpg";
import BrandLogo from "@/components/common/BrandLogo";
import { FAQ, DESCONTO_MAX_PCT } from "../content";

/* ══════════════════════════════════════════════════════════════
   FAQ
   ══════════════════════════════════════════════════════════════ */

/**
 * FAQ com `<details>`/`<summary>` nativos.
 *
 * Escolha deliberada: o elemento nativo já vem com semântica de expansão,
 * navegação por teclado (Tab + Enter/Espaço) e anúncio correto no leitor de
 * tela — de graça, sem uma linha de JS e sem componente de accordion no bundle.
 */
export const PremiumFaq = () => (
  <section id="faq" className="lpx-section lpx-section--tint lpx-anchor">
    <div className="lpx-wrap">
      <div className="text-center max-w-[600px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Perguntas frequentes</p>
        <h2 className="lpx-h2 mt-4">Ainda ficou dúvida?</h2>
        <p className="lpx-lead mt-3">
          As respostas abaixo cobrem o que mais aparece antes de decidir.
        </p>
      </div>

      <div className="lpx-faq mt-8 md:mt-10 max-w-[760px] mx-auto" data-reveal>
        {FAQ.map((item) => (
          <details key={item.q} className="lpx-faq__item">
            <summary className="lpx-faq__q">
              <span>{item.q}</span>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lpx-faq__chev"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <p className="lpx-faq__a">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Consultor
   ══════════════════════════════════════════════════════════════ */

interface PremiumConsultantProps {
  name: string;
  photoUrl?: string | null;
  igreenId?: string | null;
  whatsappUrl: string;
  cadastroUrl: string;
  onWhatsAppClick: () => void;
  onCadastroClick: () => void;
}

/**
 * Quem vai atender. Rosto e nome reduzem a sensação de "formulário no vazio" —
 * a pessoa sabe com quem vai falar antes de clicar.
 */
export const PremiumConsultant = ({
  name,
  photoUrl,
  igreenId,
  whatsappUrl,
  cadastroUrl,
  onWhatsAppClick,
  onCadastroClick,
}: PremiumConsultantProps) => (
  <section id="consultor" className="lpx-section lpx-anchor">
    <div className="lpx-wrap">
      <div className="lpx-consultant max-w-[900px] mx-auto">
        <div className="lpx-consultant__photo" data-reveal>
          <img
            src={photoUrl || consultantDefault}
            alt={`${name}, consultor(a) iGreen Energy`}
            width={480}
            height={480}
            loading="lazy"
            decoding="async"
          />
        </div>

        <div data-reveal>
          <p className="lpx-eyebrow">Seu atendimento</p>
          <h2 className="lpx-h2 mt-4 break-words">{name}</h2>
          <p className="lpx-body mt-2 font-semibold !text-[hsl(var(--primary-text))]">
            Consultor(a) iGreen Energy
            {igreenId ? ` · ID ${igreenId}` : ""}
          </p>

          <p className="lpx-lead mt-5">
            Quando você chamar no WhatsApp, é comigo que você fala. Eu confiro a cobertura no
            seu endereço, calculo o desconto real a partir da sua fatura e acompanho o cadastro
            até o desconto entrar no boleto.
          </p>

          <ul className="grid grid-cols-1 gap-2.5 mt-6 list-none p-0">
            {[
              "Análise da sua conta sem compromisso",
              "Explico o cálculo antes de qualquer cadastro",
              "Continuo disponível depois da adesão",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[hsl(var(--primary-text))] shrink-0 mt-[3px]"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="lpx-body !text-[0.9375rem]">{item}</span>
              </li>
            ))}
          </ul>

          <div className="lpx-actions mt-7">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onWhatsAppClick}
              className="lpx-btn lpx-btn--wa"
            >
              Falar com {name.split(" ")[0]}
            </a>
            <a
              href={cadastroUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCadastroClick}
              className="lpx-btn lpx-btn--ghost"
            >
              Fazer cadastro
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   CTA final + rodapé
   ══════════════════════════════════════════════════════════════ */

interface PremiumFinalProps {
  consultantName: string;
  igreenId?: string | null;
  whatsappUrl: string;
  cadastroUrl: string;
  onWhatsAppClick: () => void;
  onCadastroClick: () => void;
}

export const PremiumFinal = ({
  consultantName,
  igreenId,
  whatsappUrl,
  cadastroUrl,
  onWhatsAppClick,
  onCadastroClick,
}: PremiumFinalProps) => (
  <>
    <section className="lpx-section lpx-final">
      <div className="lpx-wrap">
        <div className="text-center max-w-[640px] mx-auto">
          <p className="lpx-eyebrow">
            <span className="lpx-eyebrow__dot" aria-hidden="true" />
            Último passo
          </p>
          <h2 className="lpx-h2 mt-5">
            Uma foto da sua conta.{" "}
            <span className="lpx-grad">É só isso que falta.</span>
          </h2>
          <p className="lpx-lead mt-4">
            Você manda a fatura no WhatsApp, recebe o cálculo do seu desconto e decide com o
            número na mão. Sem custo para analisar, sem compromisso de fechar e sem fidelidade
            se fechar.
          </p>

          <div className="lpx-actions mt-8 max-w-[440px] sm:max-w-none mx-auto">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onWhatsAppClick}
              className="lpx-btn lpx-btn--wa"
            >
              Enviar minha conta agora
            </a>
            <a
              href={cadastroUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCadastroClick}
              className="lpx-btn lpx-btn--ghost"
            >
              Ir direto ao cadastro
            </a>
          </div>

          <p className="lpx-body !text-xs mt-5">
            Desconto de até {DESCONTO_MAX_PCT}% · Sem taxa de adesão · Sem mensalidade · Sem
            fidelidade
          </p>
        </div>
      </div>
    </section>

    <footer className="lpx-footer">
      <div className="lpx-wrap">
        <BrandLogo className="w-[132px] mx-auto" />
        <p className="lpx-body !text-xs mt-3 uppercase tracking-[0.1em] break-words">
          {consultantName.toUpperCase()} · CONSULTOR(A) IGREEN ENERGY
          {igreenId ? ` · ID ${igreenId}` : ""}
        </p>
        <p className="lpx-footer__legal lpx-measure mx-auto">
          Os percentuais citados são valores máximos divulgados pela iGreen Energy e dependem de
          análise da fatura, da distribuidora e da disponibilidade no endereço de consumo. O
          desconto incide sobre a parte de energia da conta; encargos e tributos seguem as regras
          da distribuidora. Migração amparada pela Lei Federal 14.300, de 6 de janeiro de 2022.
        </p>
        <p className="lpx-footer__legal">
          <a href="/politica-privacidade" className="lpx-textlink !font-normal">
            Política de Privacidade
          </a>
        </p>
      </div>
    </footer>
  </>
);
