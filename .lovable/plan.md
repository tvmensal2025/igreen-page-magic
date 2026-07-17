# Checklist de Configuração — Zero Lead Perdido

Não vou mexer em código agora. Este é o **mapa completo** do que precisa ser configurado por você para o sistema rodar 100% personalizado, sem teto mas com estratégia clara. Cada item mostra: **onde configurar**, **estado atual real no seu banco**, e **prioridade**.

---

## 🔴 BLOQUEADORES (sem isto nada roda)

### 1. Automações mestre — `/admin/agendamentos`

- **Estado real**: 0 de 31 toggles ligados. O sistema está totalmente parado.
- Ligar: `cadence-tick`, `daily-reheat-cron`, `whapi-inbound`, `evolution-inbound`, `voice-dialer-tick`, `sms-cron`.

### 2. Instâncias WhatsApp — `/admin/whatsapp`

- **Estado real**: 2 de 6 conectadas. 4 precisam de QR ou reset.
- Sem isso: nenhuma mensagem sai.

### 3. Pools de rodízio — `/admin/rodizio`

- **Estado real**: 0 pools ativos. 23 parceiros cadastrados sem pool ativo.
- Sem pool ativo, todo lead novo vai para revisão manual.

### 4. Campanhas Meta ativas — `/admin/campanhas`

- **Estado real**: 0 campanhas com status ACTIVE no banco.
- Vincular cada campanha a um pool de rodízio antes de subir criativo.

---

## 🟡 CONTROLE OPERACIONAL (define o "como" das mensagens)

### 5. Estágios da cadência — `/admin/motor`

- **Estado real**: 9 estágios criados. Precisa revisar cada um:
  - Delay em horas até disparar
  - Canal (WhatsApp / Ligação / SMS)
  - Janela de horário (início/fim BRT)
  - Máx. envios por lead
  - Dias da semana permitidos

### 6. Ciclo diário em lote — cockpit da Pizza (`/admin`)

- Prioridade: Fila A (novos) primeiro ou Fila B (frios)
- Cap WhatsApp (hoje 60/dia — pode subir ou tirar)
- Janela BRT do lote
- Dry-run vs Ao Vivo

### 7. Feriados — `/admin/calendario`

- **Estado real**: 0 feriados cadastrados. Sistema vai disparar em feriado nacional.

---

## 🟢 PERSONALIZAÇÃO DE CADA TOQUE (o "o quê" da mensagem)

### 8. Mensagens de estágio automático — `/admin/textos` aba Cadência

- **Estado real**: 6 mensagens configuradas para os 9 estágios (faltam 3).
- Cada estágio precisa: texto WhatsApp, áudio opcional, variáveis `{{nome}}`, `{{parceiro}}`.

### 9. Templates de reativação — `/admin/textos` aba Reativação

- **Estado real**: apenas 1 template. Recomendado 5–8 variações para rotação A/B.

### 10. Templates por consultor — `/consultor/mensagens`

- **Estado real**: 24 templates para 11 consultores (~2 por consultor). Cada um precisa criar os seus.

### 11. Ligações — `/admin/voz`

- **Estado real**: 1 template de voz, 2 blocos, 2 áudios de nome.
- Configurar por variante: saudação, corpo, CTA, encerramento.
- Personagem/voz TTS por campanha.
- Áudios de nome (`voice_name_clips`) para leads sem TTS dinâmico.

### 12. SMS Velip — `/admin/textos` aba SMS

- Texto curto por estágio (160 caracteres).
- Link de rastreio automático.
- Remetente/short code.

### 13. Biblioteca de áudio — `/admin/audios`

- **Estado real**: 21 áudios. Marcar quais são "boas-vindas", "reativação 7d", "reativação 30d", "última chance".

### 14. Pós-venda — `/consultor/pos-venda` e `/admin/pos-venda-global`

- Mensagens automáticas após venda (boleto, primeiro pagamento, aniversário).

---

## 🔵 IA E FLUXOS (o "cérebro")

### 15. IA Conhecimento — `/admin/ia/conhecimento`

- **Estado real**: 27 seções. Revisar cada uma: objeção, benefício, script de resposta.

### 16. IA Personalidade — `/admin/ia/personalidade`

- Tom de voz, palavras proibidas, regras de handoff para humano.

### 17. Fluxos de bot — `/admin/fluxos`

- **Estado real**: 15 fluxos ativos. Auditar cada passo dos fluxos principais (Sofia Variante A/B/C/D/E/F).

### 18. Regras de roteamento — `/admin/fluxos/router`

- Que gatilho (cidade, campanha, hora) manda para qual variante.

---

## 🟣 CRM E ESTEIRA DE VENDA

### 19. Estágios do Kanban — `/admin/kanban`

- Nome, cor, ordem, mensagem automática ao entrar no estágio.

### 20. Templates da esteira de venda — `/admin/esteira`

- Documentos obrigatórios, mídias padrão, mensagens de cobrança de doc.

### 21. Regras de entrada por consultor — `/consultor/regras-entrada`

- Cidades aceitas, tipos de conta, ticket mínimo.

---

## ⚙️ CONTROLES FINOS (deixar para depois se apertar o tempo)

- **Comissões** — `/admin/comissoes`
- **Bônus de anúncio** — `/admin/ad-bonus`
- **Carteira / topup** — `/admin/wallet`
- **Segurança de campanha** — trigger DB (já ativo, só validar)
- **Retargeting Meta** — sync automático já roda, mas precisa do Pixel/CAPI configurado
- **Solar API** — chave configurada, revisar limites de uso

---

## 📋 Ordem sugerida de ataque

```text
Dia 1: Bloqueadores (1–4)  →  sistema volta a rodar
Dia 2: Controle operacional (5–7)  →  ritmo e janelas
Dia 3: Personalizar cada toque (8–14)  →  todas as mensagens sob seu controle
Dia 4: IA e fluxos (15–18)  →  cérebro afinado
Dia 5: CRM (19–21)  →  esteira de venda apertada
```

---

## O que eu preciso de você para começar

Confirme em qual dos 5 dias você quer que eu monte a **tela de checklist interativa** dentro do admin — cada item vira um card com estado "pendente / feito", link direto para a página de configuração, e barra de progresso geral. Assim você navega tudo sem se perder e nada fica de fora.

Ou, se preferir, diga **por onde começar hoje** que eu abro apenas essa parte e faço o passo-a-passo com você.  
  
liste todas para mim, ligar tudo automatico apenas no final, depois de seguir o checkliste, o cheklist vai apagando apos salvar oque foi feito, analise temos que ajustar tudo sem deixar nada  
  
eu acho que tem muitos lugares muitas configuracaoa fazer por isso fico perdido,  , tem que listr o link direto para eu ir ate a pagina, ou oque achar melhor