## Diagnóstico

**Sync está funcionando.** O worker gravou corretamente para o consultor Rafael (`0c2711ad-…`, portal 124170):

| Onde | Total | Origem correta |
|---|---|---|
| `customers` | 611 | 562 com `customer_origin='igreen_sync'` |
| `igreen_customer_boletos` | 21 | ✅ |
| `igreen_customer_devolutivas` | 5 | ✅ |
| `network_members` | 31 | ✅ |
| `igreen_telecom_customers` | 5 | ✅ |
| `igreen_seguros_customers` | 5 | ✅ |

RLS não bloqueia: Rafael tem `has_role admin` (policy `Admins read all customers`) + é dono via `consultant_id = auth.uid()`.

Os dados **não aparecem porque a UI está escondendo por 3 motivos independentes**:

1. **Aba errada**: em `WhatsAppClientsPage.tsx:94` o `originTab` default é `"whatsapp_lead"`. Os 562 iGreen só aparecem quando o usuário clica na aba **"Clientes iGreen"** (`igreen_sync`). O `<CarteiraGreenPanel>` também só é montado com `!isLeadsTab` (linha 291) — então na aba WhatsApp o painel Carteira Green nem existe.
2. **Kanban CRM Pós-Venda**: também renderizado só com `!isLeadsTab`. Os 562 clientes iGreen ficam invisíveis quando na aba padrão.
3. **Página `/clientes-igreen` (se existir menu direto)**: sem nada — o painel está montado dentro de `WhatsAppClientsPage`.

## Correção proposta

### Fase 1 — Default correto na aba (1 linha)
`src/pages/WhatsAppClientsPage.tsx:94`
```tsx
const [originTab, setOriginTab] = useState<OriginTab>("igreen_sync");
```
Salvar a última aba em `localStorage("whatsapp-clients:tab")` para não perder ao navegar.

### Fase 2 — Contador nas abas (visibilidade imediata)
Mostrar badge com contagem em cada `TabsTrigger`:
- `WhatsApp / Leads (49)`  
- `Clientes iGreen (562)`

Assim o consultor vê na hora que existem 562 e clica.

### Fase 3 — Banner "primeiro uso"
Quando `clientesIgreen.length > 0` e `originTab === "whatsapp_lead"`, exibir alerta amarelo:  
> "Você tem **562 clientes iGreen** sincronizados. Ver na aba Clientes iGreen →"  
com botão que troca a aba.

### Fase 4 — Rota direta `/clientes-igreen`
Adicionar rota no `App.tsx` que carrega `WhatsAppClientsPage` já com `originTab="igreen_sync"` via query param (`?tab=igreen`). Adicionar item no menu lateral "Clientes iGreen" para acesso em 1 clique.

### Fase 5 — Log de "carteira vazia" (defesa)
No `CarteiraGreenPanel`, quando `boletos.length===0` mas `customers` do consultor têm `customer_origin='igreen_sync'`, mostrar sub-mensagem explicativa em vez de "Sem dados sincronizados" — evita a impressão de que o sync não rodou.

## Fora de escopo (não vou mexer agora)

- Endpoints 404 de `seguros/cashback/*` — resolver via botão **"Rodar probe"** do card Diagnóstico já entregue. Só depois trocar os paths chutados pelos que a API confirmar como 200.
- Sync individual dos consultores subordinados (Silvia, Abel etc.) — hoje só o Rafael tem credencial iGreen. Se quiser dados por consultor, cada um precisa cadastrar `igreen_portal_email/password` em `consultants`.

## Arquivos afetados

- `src/pages/WhatsAppClientsPage.tsx` (default tab, persistência, badges de contagem, banner)
- `src/App.tsx` (rota `/clientes-igreen`)
- Menu lateral (componente de navegação principal — identificar ao implementar)
- `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` (mensagem de estado vazio)

Nenhuma migração SQL, nenhum edge function, nenhuma mudança no worker.