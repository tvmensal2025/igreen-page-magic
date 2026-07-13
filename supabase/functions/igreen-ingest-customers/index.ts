// Função retirada do código ativo (ingest XLSX/customers via outros caminhos).
// Stub mantido para o `supabase functions deploy` (all) não quebrar —
// config.toml ainda referencia [functions.igreen-ingest-customers].
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((_req) =>
  new Response(
    JSON.stringify({
      error: "gone",
      message: "igreen-ingest-customers foi descontinuada. Use o fluxo atual de captura/sync.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
