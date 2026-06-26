## O que muda (escopo enxuto)

1. **Não mexer na arte** do A4 nem do Banner. Layout, footer, posições do QR — tudo intocado.
2. Adicionar um **campo de frase personalizada** no `PanfletoModal`. Essa frase entra como `?text=` no `wa.me` que o `qr-redirect` monta, de modo que quem escaneia o QR já abre o WhatsApp **com a mensagem pré-preenchida**.
3. Disponibilizar esse campo para **todos os perfis** que usam o panfleto: consultor, pré-consultor, admin e super admin.
4. Corrigir os QRs que **não abrem** para alguns consultores (bug real comprovado no banco).

---

## Passo 1 — Campo "Frase do WhatsApp" no `PanfletoModal`

Arquivo: `src/components/admin/PanfletoModal.tsx` (e nada além de controles — a arte fica idêntica).

- Novo `Textarea` no painel de controles do modal: **"Frase que abre junto com o WhatsApp"**, limite 200 caracteres, placeholder `"Oi! Vi seu panfleto e quero economizar na conta de luz."`.
- Valor inicial: lê de `localStorage[panfleto_msg_${slug}]`; vazio → usa o `DEFAULT_MESSAGE` que o `qr-redirect` já tem.
- A cada alteração:
  - salva em `localStorage`;
  - atualiza `redirectUrl` para `…/qr-redirect?l={licenca}&msg={encoded}`.
- O `qr-redirect` já aceita `?msg=` (linha "msgParam" do `index.ts`), então **não precisa mexer na edge function** para esse passo. O QR e o "Copiar link" passam a refletir a frase imediatamente.
- Botão `Copiar link` continua copiando a URL atualizada.
- Botão `Resetar frase padrão` ao lado do campo.

Verificação: gerar o panfleto, escanear com o celular, confirmar que o WhatsApp abre com a frase digitada já no campo de mensagem.

## Passo 2 — Mesmo campo no `PartnerQrCode` (parceiros)

Arquivo: `src/components/admin/parceiros/PartnerQrCode.tsx`.

- Parceiros já têm `qr_phrase` no banco (resolvida por `resolveQrMessage` em `_shared/qr-phrase.ts`). Reaproveita: o campo de texto edita `referral_partners.qr_phrase` (que já existe) com o mesmo limite de 200 chars (acima de `QR_PHRASE_MAX=90` cai no padrão curto — comportamento atual).
- Sem mudança de schema, sem mudança na lógica de keyword. Só expor o `Textarea` no card do parceiro.

## Passo 3 — Disponibilizar para todos os perfis

O `PanfletoModal` hoje aparece em:
- `/admin` (consultor e pré-consultor — `src/pages/Admin.tsx`).
- Onde mais o super admin/admin gera panfleto? Vou auditar: `rg "PanfletoModal" src/` já confirmou só `Admin.tsx` e `parceiros/`. Se o super admin/admin não tem botão de gerar panfleto em nenhum painel próprio, **adicionar** um botão "Gerar panfleto" na tela onde super admin abre o perfil de um consultor (provavelmente `src/components/superadmin/...`), reutilizando o mesmo `PanfletoModal` com o `slug` do consultor selecionado. Mesmo input de frase aparece automaticamente porque é parte do componente.

Sem schema, sem RLS. Só consumo do componente já existente.

## Passo 4 — Corrigir QRs que não abrem (bug real)

Diagnóstico do banco (6 consultores hoje):

| Consultor | Problema |
|---|---|
| Olimpia Janete (`olimpiajanete15-1e77b5`) | `consultants.phone` vazio **e** `whatsapp_instances.connected_phone` é `5514933005667` — mesmo número do Abel. Escanear o QR dela abre o WhatsApp do Abel. |
| Silvia Claudia (`silviaclaudiaalmeida-66fc34`) | `consultants.phone` vazio. Hoje funciona via instância; se a instância cair, vira `wa.me/55` (link quebrado). |
| Rafael Ferreira | `needs_reconnect`, fallback para `consultants.phone` (OK). |
| Bruna, henzofelipef | Sem instância conectada; dependem do `consultants.phone` (OK). |

`supabase/functions/qr-redirect/index.ts`:

1. **Resolução determinística de instância**: hoje faz `LIMIT 1` no `whatsapp_instances`. Ordenar por `updated_at desc` e exigir `connected_phone IS NOT NULL`. Quando duas instâncias diferentes têm o mesmo `connected_phone` (caso Abel/Olímpia), logar `console.warn('[qr-redirect] duplicate_connected_phone phone=… consultants=[…]')` e seguir com a do `consultant_id` solicitado (já é o filtro — então na verdade o bug é dado: Olímpia está apontando para a instância do Abel).
2. **Validar phone antes de gerar `wa.me`**: regex `^\d{10,13}$` depois do `normalized = '55…'`. Se inválido → não devolve `wa.me/55`; redireciona para `SITE_URL/{license}?qr_error=phone_missing` (ou só `SITE_URL` quando o slug é numérico).
3. **Tracking de QR quebrado**: já existe insert em `page_events` no caminho feliz; adicionar `event_type='qr_broken'` com o `consultant_id` quando cair no fallback de phone inválido. Isso alimenta um banner futuro de "seu QR está quebrado" no painel do consultor (não escopo agora).

Sem mudança de schema. Sem mudança em RLS. Sem novo endpoint.

## Passo 5 — Fix de dados (somente o que é seguro fazer agora)

- **Olímpia ↔ Abel**: a `whatsapp_instances` da Olímpia (`consultant_id=1e77b55a-…`) está com `connected_phone=5514933005667`, que é o número do Abel. Isso é configuração errada — alguém conectou a instância da Olímpia ao WhatsApp do Abel. **Não vou alterar dados aqui sem confirmação humana**, porque chutar o número correto da Olímpia é pior do que o estado atual. Vai virar item de verificação para o super admin no doc.
- **Silvia, Olímpia (`consultants.phone` vazio)**: idem. Documentar como pendência operacional.

A correção de código do Passo 4 garante que, mesmo enquanto esses dados estiverem errados, o usuário **não cai em `wa.me/55` quebrado** — cai numa landing que pelo menos comunica algo.

## Passo 6 — Documentar

`docs/auditoria/abelolympio-2026-06-26.md` → nova seção **5.7 QR + frase pré-formatada**:
- snapshot do bug Olímpia↔Abel e a Silvia sem phone,
- o que o código novo faz quando o phone está inválido,
- como o consultor usa o campo de frase no panfleto,
- checklist para o super admin resolver as pendências de dado.

---

## Arquivos tocados

- `src/components/admin/PanfletoModal.tsx` — novo `Textarea` de frase + persistência em `localStorage` + atualização do `redirectUrl` com `?msg=`. **Zero mudança em canvas, posições, footer, templates.**
- `src/components/admin/parceiros/PartnerQrCode.tsx` — expor o mesmo `Textarea` ligado a `referral_partners.qr_phrase` (já existe no schema).
- (Se necessário) `src/components/superadmin/…` — botão "Gerar panfleto" que abre o `PanfletoModal` com o slug do consultor selecionado.
- `supabase/functions/qr-redirect/index.ts` — validação do phone + log de duplicidade + insert em `page_events` quando QR está quebrado.
- `docs/auditoria/abelolympio-2026-06-26.md` — seção 5.7.

**Sem migration. Sem RLS. Sem mudança na arte do A4/Banner.**

## Riscos

- Frase muito longa no `?text=` gera URL grande. Limite de 200 chars cabe folgadamente no `wa.me` (o WhatsApp aceita até ~1k); o QR continua escaneável até com URL longa (nível H + qrcode.react escala).
- Mudar o `qr-redirect` para não devolver `wa.me/55` quando o phone está inválido vai mudar o comportamento para Olímpia e Silvia se a instância delas cair — mas o comportamento atual já era quebrado (abre o WhatsApp em conversa nenhuma). É melhoria.
- Botão de panfleto no super admin: se essa tela não existir hoje, vou anexar à listagem de consultores onde já há ações por linha — sem rota nova.
