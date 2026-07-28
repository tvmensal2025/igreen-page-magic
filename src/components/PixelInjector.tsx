import { useEffect } from "react";

/**
 * Pixel global da plataforma (igreen-app-oficial).
 * Sempre dispara nas landings; o Pixel do consultor (Dados) soma quando informado.
 */
export const PLATFORM_FB_PIXEL_ID = "1521037349653769";

interface PixelInjectorProps {
  facebookPixelId?: string | null;
  googleAnalyticsId?: string | null;
}

function sanitizeFbPixelId(raw?: string | null): string | null {
  const id = String(raw || "").replace(/\D/g, "");
  return id.length >= 10 ? id : null;
}

function sanitizeGaId(raw?: string | null): string | null {
  const id = String(raw || "").trim();
  if (!id) return null;
  // GA4 (G-XXXX) ou UA legado (UA-XXXX)
  if (/^(G|UA)-[A-Z0-9-]+$/i.test(id)) return id;
  return null;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __igreenPixelBoot?: string;
  }
}

/**
 * Injeta Facebook Pixel + Google Analytics nas landings públicas.
 * - FB: sempre plataforma; + pixel do consultor se diferente e válido.
 * - GA: só se o consultor preencheu GA4/UA em Dados.
 */
const PixelInjector = ({ facebookPixelId, googleAnalyticsId }: PixelInjectorProps) => {
  const consultantFb = sanitizeFbPixelId(facebookPixelId);
  const gaId = sanitizeGaId(googleAnalyticsId);

  useEffect(() => {
    const nodes: Array<HTMLScriptElement | HTMLElement> = [];
    const fbIds = Array.from(
      new Set([PLATFORM_FB_PIXEL_ID, consultantFb].filter((id): id is string => !!id)),
    );
    const bootKey = `fb:${fbIds.join(",")}|ga:${gaId || ""}`;

    // Evita reinjetar o mesmo bundle em navegação SPA entre landings do mesmo consultor.
    if (window.__igreenPixelBoot === bootKey && typeof window.fbq === "function") {
      window.fbq("track", "PageView");
      return;
    }
    window.__igreenPixelBoot = bootKey;

    if (fbIds.length > 0) {
      const fbScript = document.createElement("script");
      fbScript.dataset.igreenPixel = "fb";
      const inits = fbIds.map((id) => `fbq('init','${id}');`).join("\n");
      const noscriptImgs = fbIds
        .map(
          (id) =>
            `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/>`,
        )
        .join("");
      fbScript.innerHTML = `
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
        (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        ${inits}
        fbq('track','PageView');
      `;
      document.head.appendChild(fbScript);
      nodes.push(fbScript);

      const noscript = document.createElement("noscript");
      noscript.dataset.igreenPixel = "fb-noscript";
      noscript.innerHTML = noscriptImgs;
      document.head.appendChild(noscript);
      nodes.push(noscript);
    }

    if (gaId) {
      const gaLoader = document.createElement("script");
      gaLoader.async = true;
      gaLoader.dataset.igreenPixel = "ga-loader";
      gaLoader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
      document.head.appendChild(gaLoader);
      nodes.push(gaLoader);

      const gaInit = document.createElement("script");
      gaInit.dataset.igreenPixel = "ga-init";
      gaInit.innerHTML = `
        window.dataLayer=window.dataLayer||[];
        function gtag(){dataLayer.push(arguments);}
        gtag('js',new Date());
        gtag('config','${gaId}');
      `;
      document.head.appendChild(gaInit);
      nodes.push(gaInit);
    }

    return () => {
      // Scripts de tracking ficam no head; remoção agressiva quebra SPA.
      // Só limpa nós marcados se o bootKey mudar no próximo mount.
      void nodes;
    };
  }, [consultantFb, gaId]);

  return null;
};

export default PixelInjector;
