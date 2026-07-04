## Diagnóstico

**1) Links de consultores 404/vazios (Rafael Ferreira e todos os outros)** — a página LP carrega, mas o dado do consultor vem vazio. Motivo: a view `public.consultants_public` **não tem GRANT para `anon`**, e como está com `security_invoker=on`, o anon também precisaria de SELECT na tabela `consultants` — que também não tem grant.

Teste ao vivo:
```
GET /rest/v1/consultants_public?license=eq.rafael-ferreira
→ 42501 "permission denied for table consultants"
```

Mesma coisa afeta `whatsapp_instances_public` (usada pelo botão WhatsApp), `products` (páginas `/conexao-*`) e `page_views` (tracking).

**2) Fluxo M (MG)** — no banco já está `is_public=true, is_active=true` (id `449f72b2-…`, nome "Fluxo MG", 16 passos, todos com 4 mídias no `media_order`). Existe SÓ um Fluxo M no sistema (o do super-admin), então nenhum consultor tem custom pra sobrescrever — todos que caírem em variant='M' pegam esse fluxo direto. Não precisa migração de propagação.

## Correção — migração SQL

Uma migration única com GRANT/RLS pra destravar acesso anônimo às superfícies públicas. Nada é criado ou removido, só permissão de leitura ajustada:

```sql
-- 1) consultants_public: view usada por TODA página /:licenca e /conexao-*/:licenca
GRANT SELECT ON public.consultants_public TO anon, authenticated;

-- Como a view usa security_invoker=on, o anon precisa também de SELECT na base,
-- mas RESTRITO pelas colunas expostas — a view já filtra. Damos SELECT direto:
GRANT SELECT (id, license, name, phone, cadastro_url, photo_url, igreen_id,
              licenciada_cadastro_url, facebook_pixel_id, google_analytics_id,
              created_at, referred_by)
  ON public.consultants TO anon, authenticated;
-- (nenhum dado sensível: telefone público, licença, foto — mesmo conjunto da view)

-- Política de leitura anônima para os campos públicos (linhas com license não nula):
CREATE POLICY IF NOT EXISTS "Anon read public consultant fields"
  ON public.consultants FOR SELECT TO anon, authenticated
  USING (license IS NOT NULL AND license <> '');

-- 2) whatsapp_instances_public — botão WhatsApp
GRANT SELECT ON public.whatsapp_instances_public TO anon, authenticated;
-- (view também segue mesma lógica; se precisar, grant coluna equivalente na base)

-- 3) products — landing /conexao-*/:licenca
GRANT SELECT ON public.products TO anon, authenticated;
CREATE POLICY IF NOT EXISTS "Anon read active products"
  ON public.products FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- 4) page_views — tracking (insert de leitura de página)
GRANT INSERT ON public.page_views TO anon, authenticated;
CREATE POLICY IF NOT EXISTS "Anyone can insert page views"
  ON public.page_views FOR INSERT TO anon, authenticated
  WITH CHECK (true);
```

Antes de rodar, vou reconferir o schema real de cada tabela/view (colunas, RLS já existente, se a policy já existe com outro nome) — a migration final vai só o que faz falta, sem duplicar.

## Fluxo M — verificação, sem alterar

- ✅ 1 registro, `is_public=true`, `is_active=true`, variant='M'.
- ✅ 16 steps ativos, todos com `media_order` preenchido (4 mídias cada).
- ✅ Passos-chave presentes: `d_welcome`, `d_pedir_conta` (OCR), `d_resultado` (simulação com `{{economia_mensal}}` — agora já com 28% via `discountRates`), `d_pedir_documento`, `d_pedir_email`, `d_confirmar_telefone`, `d_finalizar` (portal + OTP), `d_simular_*` (branch valor direto).
- ✅ Cálculo 10-28% já ativo em todos os renderizadores (mudança da conversa anterior).

Sem migração de propagação (não existem Fluxos M próprios de outros consultores para sincronizar). Novo consultor com variant='M' cai automaticamente no público.

## Teste pós-deploy

Vou rodar 3 checagens via curl (não muda dado):
1. `GET consultants_public?license=eq.rafael-ferreira` deve retornar 1 linha em vez de 42501.
2. `GET whatsapp_instances_public?consultant_id=eq.<id>` idem.
3. `GET products?slug=eq.conexao-seguros` retorna a landing.

Se tudo OK, os links `/rafael-ferreira` e `/conexao-seguros/rafael-ferreira` — e de qualquer outro consultor — voltam a carregar publicamente.

## Fora de escopo

- Não altero o auth/portal do consultor autenticado.
- Não abro tabelas com PII (CPF, endereço, e-mail privado, chaves de token) para anon — só as colunas já expostas pela view atual.
- Não mexo em textos/mídias do Fluxo M.
