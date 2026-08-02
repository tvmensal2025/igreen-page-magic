import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * `React.lazy` tolerante a chunk velho / deploy misturado.
 *
 * Sintoma que isso resolve:
 *   "Cannot read properties of undefined (reading 'DashboardTab')"
 * Acontece quando o index.html novo referencia um chunk antigo (cache do
 * navegador / CDN). O módulo resolve `undefined` e o `.then(m => m.X)` quebra
 * a tela inteira.
 *
 * Aqui: se o módulo (ou o export nomeado) vier vazio, recarrega a página UMA
 * vez para buscar o bundle novo. Se mesmo assim falhar, aí sim propaga o erro.
 */
export function lazyNamed<P extends object>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
): LazyExoticComponent<ComponentType<P>> {
  const flag = `chunk-reload:${exportName}`;
  return lazy(async () => {
    let mod: Record<string, unknown> | undefined;
    let loadError: unknown;
    try {
      mod = await loader();
    } catch (e) {
      loadError = e;
    }

    const comp = mod?.[exportName] as ComponentType<P> | undefined;
    if (comp) {
      try {
        sessionStorage.removeItem(flag);
      } catch {
        /* storage bloqueado — ignora */
      }
      return { default: comp };
    }

    let alreadyRetried = true;
    try {
      alreadyRetried = sessionStorage.getItem(flag) === "1";
      if (!alreadyRetried) sessionStorage.setItem(flag, "1");
    } catch {
      /* storage bloqueado — não tenta recarregar em loop */
    }

    if (!alreadyRetried && typeof window !== "undefined") {
      window.location.reload();
      // Componente vazio só para segurar até o reload acontecer.
      return { default: (() => null) as unknown as ComponentType<P> };
    }

    throw loadError instanceof Error
      ? loadError
      : new Error(`${exportName} export missing (chunk desatualizado)`);
  });
}
