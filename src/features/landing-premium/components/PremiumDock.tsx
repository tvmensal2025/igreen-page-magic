import { useCallback, useState } from "react";
import { useScrolledPast } from "../useReveal";

interface PremiumDockProps {
  whatsappUrl: string;
  cadastroUrl: string;
  onWhatsAppClick: () => void;
  onCadastroClick: () => void;
  /** Rótulo do botão principal (WhatsApp). */
  rotuloPrincipal?: string;
  /** Rótulo do botão secundário. */
  rotuloSecundario?: string;
  /**
   * Destino do botão secundário. Se for uma âncora (`#algo`), rola na página
   * em vez de abrir o cadastro externo — útil nos produtos em que a próxima
   * dúvida é "quanto custa" e não "quero assinar".
   */
  hrefSecundario?: string;
}

/**
 * Barra fixa de ação no rodapé — só no mobile (o CSS esconde a partir de 900px).
 *
 * Por que existe: no celular a pessoa lê rolando, e o CTA do hero sai de vista
 * em poucos segundos. Em vez de repetir botão a cada seção (o que engorda a
 * página), uma barra sempre ao alcance do polegar resolve.
 *
 * Só aparece depois de ~1 tela de rolagem: enquanto o hero está visível o CTA
 * dele já está na frente da pessoa, e a barra apenas cobriria conteúdo.
 */
const PremiumDock = ({
  whatsappUrl,
  cadastroUrl,
  onWhatsAppClick,
  onCadastroClick,
  rotuloPrincipal = "Falar agora",
  rotuloSecundario = "Fazer cadastro",
  hrefSecundario,
}: PremiumDockProps) => {
  const [visible, setVisible] = useState(false);
  const handleChange = useCallback((past: boolean) => setVisible(past), []);
  useScrolledPast(520, handleChange);

  const ehAncora = hrefSecundario?.startsWith("#");
  const destinoSecundario = hrefSecundario || cadastroUrl;

  return (
    <div
      className="lpx-dock"
      data-visible={visible}
      // Enquanto recolhida, sai do leitor de tela e do Tab. Não há perda de
      // acesso: os mesmos links existem no conteúdo da página.
      aria-hidden={!visible}
    >
      <a
        href={destinoSecundario}
        // Âncora interna não abre aba nova nem precisa de rel de segurança.
        {...(ehAncora ? {} : { target: "_blank", rel: "noopener noreferrer" })}
        onClick={ehAncora ? undefined : onCadastroClick}
        className="lpx-btn lpx-btn--ghost"
        tabIndex={visible ? undefined : -1}
      >
        {rotuloSecundario}
      </a>
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onWhatsAppClick}
        className="lpx-btn lpx-btn--wa"
        tabIndex={visible ? undefined : -1}
      >
        <svg viewBox="0 0 32 32" width="17" height="17" fill="currentColor" aria-hidden="true">
          <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16.004c0 3.5 1.132 6.744 3.054 9.378L1.056 31.2l6.06-1.94A15.9 15.9 0 0016.004 32C24.826 32 32 24.826 32 16.004S24.826 0 16.004 0zm9.31 22.606c-.39 1.1-1.932 2.014-3.164 2.28-.844.18-1.946.324-5.66-1.216-4.752-1.97-7.81-6.79-8.046-7.106-.228-.316-1.9-2.53-1.9-4.826s1.2-3.424 1.628-3.892c.39-.426 1.028-.638 1.64-.638.198 0 .376.01.536.018.468.02.702.048 1.012.784.386.918 1.328 3.242 1.444 3.478.118.236.236.556.076.872-.15.326-.282.47-.518.74-.236.27-.46.476-.696.766-.216.254-.46.526-.196.994.264.46 1.174 1.936 2.52 3.136 1.732 1.544 3.192 2.024 3.644 2.248.352.174.77.136 1.044-.156.348-.37.778-.982 1.216-1.586.31-.432.702-.486 1.092-.326.396.15 2.508 1.182 2.938 1.398.43.216.716.326.822.502.104.176.104 1.024-.286 2.13z" />
        </svg>
        {rotuloPrincipal}
      </a>
    </div>
  );
};

export default PremiumDock;
