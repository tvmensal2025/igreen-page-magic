import { useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { hardReset } from "@/lib/hardReset";

// Componente "headless" (não renderiza nada visível). Apenas escuta o evento
// `igreen:update-available` disparado pelo version gate em src/main.tsx e
// mostra um toast persistente com botão "Atualizar agora".
//
// O auto-reload silencioso continua funcionando em paralelo: o que acontecer
// primeiro (usuário clicar OU app encontrar janela ociosa segura) aplica a
// atualização. O toast garante que usuários com modal aberto o dia todo
// também tenham um caminho visível para atualizar.
export function UpdateAvailableToast() {
  useEffect(() => {
    function show(e: Event) {
      const detail = (e as CustomEvent<{ buildId?: string }>).detail;
      toast("Nova versão disponível", {
        id: "update-available", // evita toasts duplicados em checks consecutivos
        description: "Atualize para receber as últimas melhorias. Você precisará entrar novamente.",
        duration: Infinity,
        dismissible: true,
        action: {
          label: "Atualizar agora",
          onClick: () => {
            void hardReset(`user-clicked-update-toast:${detail?.buildId ?? "?"}`);
          },
        },
      });
    }

    window.addEventListener("igreen:update-available", show as EventListener);
    return () => window.removeEventListener("igreen:update-available", show as EventListener);
  }, []);

  return null;
}
