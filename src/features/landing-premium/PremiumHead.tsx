import { useEffect } from "react";

/**
 * Se `false`, a LP premium sai do índice do Google (`noindex, follow`).
 *
 * Contexto: a premium e a LP atual (`/:licenca`) falam do mesmo produto. Duas
 * URLs indexadas com o mesmo conteúdo competem entre si. Enquanto a premium
 * estiver em teste, deixar `true` mantém a rota indexável com canonical própria;
 * trocar para `false` protege 100% o ranking da página original.
 *
 * Mudança de uma linha, sem tocar em nenhuma outra parte da página.
 */
const PREMIUM_INDEXABLE = true;

interface PremiumHeadProps {
  title: string;
  description: string;
  /** Nome público do consultor, usado no JSON-LD. */
  consultantName?: string;
  /** Imagem para compartilhamento (og:image). Precisa ser URL absoluta. */
  imageUrl?: string;
}

/** Cria (ou reaproveita) uma <meta> e devolve o valor anterior para restaurar. */
function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  let created = false;

  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
    created = true;
  }

  const previous = el.getAttribute("content");
  el.setAttribute("content", value);

  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute("content", previous);
  };
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  let created = false;

  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
    created = true;
  }

  const previous = el.getAttribute("href");
  el.setAttribute("href", href);

  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute("href", previous);
  };
}

/**
 * Head da LP premium: title, description, Open Graph, Twitter, canonical,
 * robots e JSON-LD.
 *
 * Todo efeito é revertido no unmount. Isso é obrigatório num SPA: sem cleanup,
 * o visitante que sai da premium para outra rota levaria as tags dela junto,
 * poluindo as outras páginas (inclusive a LP original).
 */
const PremiumHead = ({ title, description, consultantName, imageUrl }: PremiumHeadProps) => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const url = window.location.href.split("#")[0];
    const image = imageUrl || `${window.location.origin}/images/logo-colorida-igreen.png`;

    const cleanups = [
      setMeta("name", "description", description),
      setMeta("name", "robots", PREMIUM_INDEXABLE ? "index, follow" : "noindex, follow"),
      setMeta("property", "og:type", "website"),
      setMeta("property", "og:title", title),
      setMeta("property", "og:description", description),
      setMeta("property", "og:url", url),
      setMeta("property", "og:image", image),
      setMeta("property", "og:locale", "pt_BR"),
      setMeta("name", "twitter:card", "summary_large_image"),
      setMeta("name", "twitter:title", title),
      setMeta("name", "twitter:description", description),
      setMeta("name", "twitter:image", image),
      setLink("canonical", url),
    ];

    // JSON-LD: descreve a oferta e o atendimento local. Só fatos que já
    // constam na LP (não inventa nota, preço nem quantidade de avaliações).
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.dataset.lpxPremium = "true";
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "iGreen Energy",
          url: "https://www.igreenenergy.com.br",
          foundingDate: "2021",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Uberlândia",
            addressRegion: "MG",
            addressCountry: "BR",
          },
        },
        {
          "@type": "Service",
          name: "Conexão Green — energia solar por assinatura",
          serviceType: "Assinatura de energia solar",
          description,
          areaServed: { "@type": "Country", name: "Brasil" },
          provider: { "@type": "Organization", name: "iGreen Energy" },
          ...(consultantName ? { agent: { "@type": "Person", name: consultantName } } : {}),
        },
      ],
    });
    document.head.appendChild(ld);

    return () => {
      document.title = previousTitle;
      for (const undo of cleanups) undo();
      ld.remove();
    };
  }, [title, description, consultantName, imageUrl]);

  return null;
};

export default PremiumHead;
