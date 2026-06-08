
# Auditoria — Plano anterior, Suporte Remoto e mercado

## 1. O plano antigo (`.lovable/plan.md`) — veredito

O plano cobre 3 frentes (variantes A-E, "Passo removido", suporte remoto) e a maior parte já foi executada nas últimas iterações. Status real hoje:

| Item do plano | Estado | Observação |
|---|---|---|
| RPC `ensure_bot_flow_variant` com permissão relaxada + erro legível | ✅ feito (migration `20260608205444…`) | Falta UI mostrar de qual variante foi clonada |
| Remap de `fallback.success_goto_step_id` + `captures.*.goto_step_id` no clone | ✅ feito | OK |
| Migration de reparo idempotente (Bruna) | ✅ feito | Verificar se ainda há refs órfãs com `SELECT` antes de fechar |
| Aviso "sync_mode=public" + botão "Re-clonar" no editor | ⚠️ parcial | Migration entrega o backend, mas **não vi o botão na UI do `FluxoBuilder.tsx`** |
| Remote support: `controlEnabled=true` por padrão (v2 prefs) | ✅ feito | |
| Cursor virtual visível em `pointerleave` | ✅ feito | |
| `focus()` antes do click (Radix) | ✅ feito | |
| Overlay "Controle remoto ativo" no consultor | ❌ não feito | Plano previa, mas não foi implementado |
| Logs `[remote-support]` por evento de mouse | ⚠️ só `logAction` no servidor — sem `console.log` local | |

**Conclusão:** o plano é sólido e foi 80% executado. Faltam 2 entregas visíveis (botão re-clonar + overlay no consultor) que são as que o usuário continua sentindo na pele.

---

## 2. Auditoria do fluxo de **mouse remoto** (vai funcionar?)

Fluxo atual:

```text
Operador (overlay) ──pointerdown/click──► sendCmd (DataChannel)
        │                                       │
        │ raf coalescing                        ▼
        ▼                              Consultor (actionHandler.ts)
   cursor virtual                      ├─ elementFromPoint(x,y)
                                       ├─ normalizeInteractiveTarget (sobe até botão/Radix)
                                       ├─ focus() em editáveis e triggers
                                       └─ pointerover→down→up + mousedown→up + click
```

### O que está **certo** e vai funcionar
- Sequência pointer + mouse + click cobre Radix/shadcn (Select, Dropdown, Dialog).
- `normalizeInteractiveTarget` resolve o caso "cliquei no `<span>` filho do botão".
- Coordenadas normalizadas + `preferCurrentTab: true` na `getDisplayMedia` deixam pixel-a-pixel.
- Coalescing por `requestAnimationFrame` evita inundar o DataChannel.
- Detecção de drag por threshold (4px) evita "todo click virar drag".

### Riscos reais que ainda travam o mouse
1. **`object-contain` + cálculo de offset**: `toNorm` calcula `dispW/dispH` pelo `videoWidth`, mas se o `<video>` ainda não tem metadata (`videoWidth=0`), cai no `rect.width` e os cliques saem fora do alvo nos primeiros 200–500 ms. Precisa esperar `loadedmetadata`.
2. **Foco no iframe / página com `tabindex=-1`**: `typeChar` usa `document.activeElement`. Quando o consultor tem um modal Radix aberto que rouba foco, a tecla vai pro lugar errado. Falta `focusEl?.focus()` antes de cada `key`.
3. **`elementFromPoint` ignora `pointer-events:none`**: alguns overlays do próprio app do consultor (toasts, splash) podem cobrir e devolver `null` → `"no element"`. Não há fallback para `document.elementsFromPoint` (plural) que ignora a primeira camada.
4. **Sem retry/ACK por comando**: se o DataChannel está `connecting` ou cai por 200 ms, o click é perdido silenciosamente. Falta uma fila com TTL.
5. **iframes cross-origin** (ex.: gateway de pagamento, painel embutido): WebRTC + `dispatchEvent` **não atravessam** iframe cross-origin. Hoje o usuário vai sentir como "o mouse parou de funcionar nesta tela" — precisa avisar.
6. **Inputs nativos `<select>`**: o sistema operacional desenha o popup; nenhum `dispatchEvent` consegue escolher uma opção. Precisa fallback `el.value = …` + `change`.

---

## 3. Como **outras empresas** fazem (TeamViewer, AnyDesk, Chrome Remote Desktop, Zoom)

| Empresa | Captura | Controle | Por que funciona em 100% |
|---|---|---|---|
| **TeamViewer / AnyDesk** | Driver de tela em kernel | Driver de mouse/teclado em kernel (HID virtual) | Não dispara eventos no DOM — injeta no SO. Funciona em qualquer app, inclusive popups nativos. |
| **Chrome Remote Desktop** | `getDisplayMedia` no host + Native Messaging | Extensão nativa + helper instalado | Mesma coisa: o helper local injeta no SO via APIs do Windows/Mac. |
| **Zoom Remote Control** | Compartilhamento de tela do Zoom | Cliente nativo do Zoom recebe eventos | Idem. |
| **Lovable (vocês hoje)** | `getDisplayMedia` (browser) | `dispatchEvent` no DOM via WebRTC DataChannel | **Limitação fundamental**: só funciona dentro da **mesma aba**, no DOM, em elementos same-origin. |

### O que isso significa para vocês
- Para **operar dentro do app** de vocês (consultor mexendo no próprio painel): a abordagem atual é a **correta e suficiente** — só precisa polir os 6 riscos acima.
- Para **operar fora do app** (WhatsApp Web em outra aba, Portal igreen, Excel): **impossível sem extensão/nativo**. Se isso for requisito, o caminho é:
  1. Extensão Chrome (já têm `extension/igreen-sync`) com permissão `debugger` → injeta eventos via CDP em qualquer aba.
  2. Ou app desktop (Tauri/Electron) com `robotjs` / `nut.js` no consultor.

Recomendação pragmática: ficar com a abordagem DOM (escopo realista) e deixar **muito explícito na UI** que "controle remoto funciona dentro do painel iGreen; em outras abas só visualização".

---

## 4. Análise rápida do código (pontos críticos encontrados)

| Arquivo | Problema | Impacto |
|---|---|---|
| `actionHandler.ts` L307 | `key` usa `document.activeElement` sem refoco — perde tecla se foco mudou | Médio |
| `actionHandler.ts` L37 | `elementFromPoint` único — não atravessa overlays transparentes | Médio |
| `actionHandler.ts` (geral) | Sem ACK/retry, sem console.log estruturado | Diagnóstico difícil |
| `SuperAdminRemoteSupport.tsx` L497 | `RemoteControlOverlay` só monta com `controlEnabled` — toggle apaga overlay sem aviso visual | Baixo |
| `SuperAdminRemoteSupport.tsx` L760 | `toNorm` quebra antes do `loadedmetadata` do vídeo | **Alto** — clique cai fora nos primeiros segundos |
| `screenShare.ts` L249 | `preferCurrentTab: true` é Chromium-only — Firefox/Safari já erram aqui | Médio |
| `useRequesterSession.ts` | Não trata `track.onended` quando o consultor "para de compartilhar" pelo botão do navegador | Médio — fica fantasma "ativo" |
| `RemoteSupportProvider.tsx` L51 | Botão de ajuda some quando há sessão — bom; mas não há indicador visual de "alguém está te controlando" | Privacidade/UX |

---

## 5. Plano de correção proposto (curto, focado no que está doendo)

### A. Mouse — destravar de verdade (alta prioridade)
1. `toNorm` espera `videoWidth>0` (listener `loadedmetadata` em `videoRef`); enquanto não estiver pronto, mostra "Carregando vídeo…" sobre o overlay.
2. `actionHandler.ts`: 
   - `elementsFromPoint` (plural) com fallback — pula camadas com `pointer-events:none` reais.
   - `key`: refoca `focusable(elAt(lastMouseX, lastMouseY))` antes de despachar.
   - `<select>` nativo: se alvo for `HTMLSelectElement`, setar `value` + `dispatchEvent('change')`.
3. Fila de comandos no operador com retry (até 3×, TTL 1s) quando DataChannel `connecting`.
4. Console logs `[remote-support][cmd]` em cada `sendCmd` e cada `executeCommand` para diagnóstico do próximo caso.

### B. Feedback visual (UX)
5. Banner pequeno e persistente no consultor: "🔴 Suporte remoto controlando sua tela — pausar" (já existe `togglePause`; falta o botão flutuante).
6. Aviso no operador quando o vídeo ainda está sem metadata.
7. Toast curto "Controle ativo" ao abrir sessão (3s).

### C. Editor de fluxos — fechar o que faltou do plano antigo
8. Botão **"Re-clonar do público"** em `FluxoBuilder.tsx` (visível quando `sync_mode='public'` ou quando `flowHasBrokenRefs(steps) === true`).
9. Banner amarelo no topo do editor: "Esta variante está espelhando o público — clique em Personalizar para editar".

### D. Honestidade de escopo (decisão)
10. Adicionar nota fixa no painel do operador: **"Controle remoto funciona apenas dentro do painel iGreen na aba compartilhada. Para WhatsApp Web, Portal ou outras abas, é só visualização."** — alinhamento de expectativa.

---

## Arquivos que vou tocar

- `src/features/remote-support/actionHandler.ts` (A2, A4)
- `src/pages/SuperAdminRemoteSupport.tsx` (A1, A3, B2, B3, D)
- `src/features/remote-support/RemoteSupportProvider.tsx` ou novo `RemoteControlIndicator.tsx` (B1)
- `src/pages/FluxoBuilder.tsx` (C8, C9)

Nada de banco. Tudo frontend e bem isolado. Posso começar?
