// Ambient shims so the Vite/TS build can typecheck test files in `src/test`
// that import Deno-hosted modules from `supabase/functions/_shared/*`.
// These modules only run inside Supabase Edge Functions (Deno) — the tests
// import them for parity/property testing; at typecheck time we just need
// the names to resolve.

declare module "https://esm.sh/@supabase/supabase-js@*" {
  export * from "@supabase/supabase-js";
}

declare const Deno: {
  env: {
    get(name: string): string | undefined;
    set(name: string, value: string): void;
    delete(name: string): void;
    toObject(): Record<string, string>;
  };
  // Loose escape hatch for any other Deno.* access in shared modules.
  [key: string]: any;
};
