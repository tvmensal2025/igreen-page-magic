import consultantDefault from "@/assets/consultant.jpg";

interface PremiumConsultantCardProps {
  nome: string;
  photoUrl?: string | null;
  igreenId?: string | null;
  /** Marca do produto (ex.: "iGreen Telecom"). */
  marca: string;
  whatsappUrl: string;
  cadastroUrl: string;
  /** Nos produtos sem cadastro público direto, esconde o segundo botão. */
  mostrarCadastro?: boolean;
  /** Três compromissos exibidos como lista. */
  promessas: string[];
  /** Texto de abertura. Se ausente, usa um padrão coerente com a marca. */
  intro?: string;
  onWhatsAppClick: () => void;
  onCadastroClick: () => void;
}

/**
 * Cartão do consultor — compartilhado por todas as páginas premium.
 *
 * Por que existe: a pessoa está a um clique de abrir uma conversa. Saber com
 * quem vai falar, ver o rosto e o ID reduz a sensação de "mandar mensagem para
 * o vazio", que é onde muita conversa morre antes de começar.
 *
 * Os dados são os reais do consultor resolvido pela licença da URL — nome,
 * foto e ID iGreen. Nada é inventado; sem foto, entra a imagem padrão do
 * projeto.
 */
export function PremiumConsultantCard({
  nome,
  photoUrl,
  igreenId,
  marca,
  whatsappUrl,
  cadastroUrl,
  mostrarCadastro = true,
  promessas,
  intro,
  onWhatsAppClick,
  onCadastroClick,
}: PremiumConsultantCardProps) {
  const primeiroNome = nome?.trim().split(/\s+/)[0] || "consultor";

  return (
    <section id="consultor" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <div className="lpx-consultant max-w-[900px] mx-auto">
          <div className="lpx-consultant__photo" data-reveal>
            <img
              src={photoUrl || consultantDefault}
              alt={`${nome}, consultor(a) ${marca}`}
              width={480}
              height={480}
              loading="lazy"
              decoding="async"
            />
          </div>

          <div data-reveal>
            <p className="lpx-eyebrow lpx-eyebrow--accent">Seu atendimento</p>
            <h2 className="lpx-h2 mt-4 break-words">{nome}</h2>
            <p className="lpx-body mt-2 font-semibold lpx-accent-text">
              Consultor(a) {marca}
              {igreenId ? ` · ID ${igreenId}` : ""}
            </p>

            <p className="lpx-lead mt-5">
              {intro ??
                `Quando você chamar no WhatsApp, é comigo que você fala. Eu tiro suas dúvidas, mostro as condições reais e acompanho o processo do começo ao fim.`}
            </p>

            <ul className="grid grid-cols-1 gap-2.5 mt-6 list-none p-0">
              {promessas.map((item) => (
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
                    className="lpx-accent-text shrink-0 mt-[3px]"
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
                Falar com {primeiroNome}
              </a>
              {mostrarCadastro && (
                <a
                  href={cadastroUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onCadastroClick}
                  className="lpx-btn lpx-btn--ghost"
                >
                  Fazer cadastro
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PremiumConsultantCard;
