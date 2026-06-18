import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "build",
      "supabase/functions/**",
      "supabase/.temp/**",
      "whapi-analysis/**",
      "worker-portal/**",
      "screenshots/**",
      "fixtures/**",
      "scripts/manual-tests/**",
      "**/*.min.js",
    ],
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Regras gerais (frontend React + libs).
  // ─────────────────────────────────────────────────────────────────────────
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // `any` vira warn no nível geral — código legado tem 657 ocorrências
      // espalhadas; refatorar todas seria um trabalho de semanas com risco
      // de regressão. Ainda aparece no PR review (warning visível) mas não
      // quebra o CI nem bloqueia deploy.
      //
      // Para código NOVO (módulos do core e os componentes do v3), a regra
      // continua "error" via override abaixo — quem escreve novo precisa
      // tipar direito. Quem mexe em legado pode adicionar `any` se já era
      // `any` antes (continuidade), mas vai ver o warning.
      "@typescript-eslint/no-explicit-any": "warn",
      // `catch {}` é padrão amplamente usado neste projeto para fail-open
      // explícito (best-effort sem propagar exceção). Permitido.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `Type = {}` (no-empty-object-type) e `foo && bar()` aparecem em
      // alguns lugares legados — viram warnings.
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-useless-escape": "warn",
      // Warnings de hooks continuam — são úteis para apontar bugs reais
      // (deps faltando geram stale closures).
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Override: código novo do whatsapp-flow-architecture-v3 mantém `any` strict.
  // ─────────────────────────────────────────────────────────────────────────
  {
    files: [
      "src/components/admin/saude/FlowEngineHealthCard.tsx",
      "src/components/admin/flow-builder/canonicalStepTypes.ts",
      "src/components/admin/flow-builder/channelPreview.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Override: arquivos de configuração (Tailwind, PostCSS, Vite plugins
  // que usam o ecossistema CommonJS do shadcn) podem usar `require()`.
  // ─────────────────────────────────────────────────────────────────────────
  {
    files: ["tailwind.config.ts", "tailwind.config.js", "postcss.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Convenção (não ESLint): no core do flow architecture v3, use o
  // logger central em vez de console.log direto.
  // Os arquivos do core estão em `supabase/functions/_shared/{flow-engine,
  // channels,captation,conversion,performance}/**` — ignorados pelo ESLint
  // (Deno usa typecheck próprio). A regra é enforced via code review.
  // ─────────────────────────────────────────────────────────────────────────
);
