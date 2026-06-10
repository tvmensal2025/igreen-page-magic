// ProtectedRoute — guarda de rota para as áreas internas (/admin, /super-admin).
//
// Verifica a sessão do Supabase ANTES de renderizar a página. Se não houver
// sessão, redireciona para /auth sem montar o conteúdo protegido (evita o
// "flash" de tela admin e o download de código a' toa por quem não está logado).
//
// Defesa em profundidade: as próprias páginas continuam fazendo a checagem
// delas (e o banco é protegido por RLS). Este guard é a primeira barreira.
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  children: ReactNode;
}

type AuthState = "checking" | "authed" | "anon";

export default function ProtectedRoute({ children }: Props) {
  const location = useLocation();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let alive = true;

    // 1) Checagem imediata da sessão atual.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return;
      setState(session ? "authed" : "anon");
    });

    // 2) Acompanha mudanças (login/logout em outra aba, refresh de token).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setState(session ? "authed" : "anon");
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  if (state === "checking") {
    // Tela de carregamento curta enquanto confirma a sessão.
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === "anon") {
    // Manda para o login, guardando de onde veio (para voltar depois do login).
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
