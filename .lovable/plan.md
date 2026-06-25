
## Diagnóstico

Hoje só 2 dos 6 consultores têm os dados completos no banco (`phone`, `igreen_id`, `assistant_name`, `gender`). Os outros 4 caem no `OnboardingGate`, tentam salvar e algo falha — o modal reabre porque o `isComplete()` continua `false`. Sem console logs para ver o erro real.

Três problemas distintos por trás do relato:

1. **Modal recorrente + "dá erro ao clicar Consultor/Consultora"** → O salvar está estourando, mas o toast de erro está sumindo rápido e o usuário só vê o modal reaparecer. Provável causa: validação fraca (telefone curto, license duplicada, etc.) e mensagem genérica.
2. **"WhatsApp errado / não manda msg"** → O `phone` digitado no onboarding é jogado direto em `consultant_ad_settings.whatsapp_destination_number` sem nenhuma validação de formato e sem confrontar com o `connected_phone` da instância Evolution. Se o consultor digita 10 dígitos, escreve com 9 a mais, ou usa um número diferente do que está conectado, os disparos vão para o lugar errado.
3. **"Para não bloquear o WhatsApp"** → Não há trava: o sistema dispara mesmo com phone inválido / não confirmado.

## O que vou fazer

### 1. Onboarding mais robusto (`OnboardingGate` + `useConsultantForm`)
- Validar telefone brasileiro (13 dígitos, DDD válido, começa com 55, celular 9 na frente). Bloquear "Liberar painel" e mostrar erro inline por campo.
- Validar `igreen_id` (só números, mínimo 4 dígitos).
- Trocar o toast genérico "Erro ao salvar" por mensagem clara apontando o campo (license duplicada → "Outro consultor já usa esse nome, vamos ajustar"; RLS → "Sessão expirou, faça login"; coluna não nula → nome do campo faltando).
- Logar erro completo em `console.error` com prefixo `[onboarding-save]` pra debug futuro.
- Botão Consultor/Consultora: garantir `type="button"` (já está) e não dispare nada além de mudar state — verificar se algum handler de submit pega o click.

### 2. Validação de telefone WhatsApp + trava de envio
- Nova função `validateBrazilPhone(phone)` em `src/lib/phone.ts` (formato 55 + DDD + 9 + 8 dígitos).
- Ao salvar consultor: se `phone` inválido, **não** gravar em `consultant_ad_settings.whatsapp_destination_number`. Hoje grava sem checar.
- Adicionar coluna `consultants.phone_verified_at` (timestamptz) e função RPC `check_consultant_phone_match(consultant_id)` que compara `phone` ↔ `whatsapp_instances.connected_phone`. Se bater, marca verificado.
- Card no Dashboard mostrando estado: ✅ Verificado / ⚠️ Diferente da instância conectada / ❌ Não conectado.

### 3. Bloqueio de envio quando telefone inválido
Pontos onde o envio em massa / agendado é disparado:
- `bulk-scheduler` (edge function)
- `reactivation-send`
- `outbound-media-flush-cron`

Em todos eles, antes de criar o sender Evolution:
- Buscar consultor → checar `phone_verified_at` recente (≤ 7 dias) **ou** `phone` casando com `whatsapp_instances.connected_phone`.
- Se falhar: pular o envio, gravar em novo log `outbound_blocked_log` (motivo: `phone_mismatch` / `phone_missing` / `not_verified`), incrementar alerta `bot_handoff_alerts`.
- **Não** bloqueia respostas do `evolution-webhook` (atendimento ativo continua), só os envios proativos / massa, que são os que banem conta.

### 4. Evolution — nome + telefone do cliente
Olhar `parseEvolutionMessage` em `_shared/evolution-api.ts` e o trecho no `evolution-webhook` que cria/atualiza `customers`: garantir que `pushName` e `remoteJid` sejam sempre persistidos. Adicionar fallback: se nome vier vazio, usar `Cliente <últimos 4 dígitos>`.

### 5. Migration
```sql
ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.outbound_blocked_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  reason text NOT NULL,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.outbound_blocked_log TO authenticated;
GRANT ALL ON public.outbound_blocked_log TO service_role;
ALTER TABLE public.outbound_blocked_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read blocked log" ON public.outbound_blocked_log
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'));
```

## O que NÃO vou mexer
- Fluxo D (já está liberado para todos).
- Reset de senha (já refeito antes).
- Tabela `consultants` em si — só adiciona uma coluna.

## Confirmações antes de começar
- Os 4 consultores incompletos (Silvia, Olímpia, Abel) ainda não conseguiram logar e salvar? Quero pedir que um deles tente novamente após o fix pra confirmar o erro real (vou deixar o console.error verboso pra isso).
- O bloqueio de envio quando phone não confere: você prefere **pular silenciosamente** o disparo ou **mostrar alerta no painel do consultor** pedindo pra ele revalidar? (Recomendo alerta no painel — assim ele corrige rápido.)
