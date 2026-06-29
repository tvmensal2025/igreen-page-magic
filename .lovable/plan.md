## Objetivo

Deixar a aba **Captação** limpa, sem botão e banner de "Buscar novos do WhatsApp", e mover o painel **"Já conversados"** para fora da lista principal — ele vira uma **aba própria** ao lado de "Novos leads".

---

## 1. Remover botão e banner de sincronização

Em `src/components/captacao/CapturedLeadsPanel.tsx`:

- Remover o botão **"Buscar novos do WhatsApp"** (com badge `+N`) do header.
- Remover o banner amarelo **"Temos N novos contatos do WhatsApp esperando..."**.
- Remover o estado/efeito que faz o `countPendingWhatsappLeads` (consulta deixa de existir na UI).
- Manter a chamada de `captacao-backfill-ctwa` rodando em background uma vez no mount (silencioso), para que novos leads do WhatsApp continuem chegando sem o usuário precisar clicar. Sem toast de sucesso/erro visível — só log no console.

## 2. Separar "Já conversados" em aba própria

Hoje "Já conversados" é um painel lateral fixo (desktop) + Sheet (mobile). Vai virar **aba** no topo da Captação, ao lado da lista de novos:

```text
[ Novos leads (X) ]  [ Já conversados (Y) ]
```

- Em `src/components/captacao/CaptacaoPanel.tsx` (ou onde o `CapturedLeadsPanel` é montado): envolver o conteúdo num `Tabs` com duas abas.
  - **Novos leads** → tabela atual filtrada (só não contactados, comportamento já existente).
  - **Já conversados** → mesma lista que hoje está no painel lateral (busca por nome/telefone, lista compacta com avatar + canal + data, botão "Reabrir conversa").
- Remover do `CapturedLeadsPanel.tsx`:
  - O `aside` lateral fixo da direita (desktop).
  - O botão flutuante "Já conversados (N)" + `Sheet` (mobile).
  - O chip "Já conversados: Z" no subtítulo (vira o próprio nome da aba com o contador).
- Extrair o conteúdo do painel lateral para um componente novo `AlreadyContactedList.tsx` reusado pela aba.

## 3. Limpar o header da Captação

- Subtítulo: manter só **"Novos: X · Selecionados: Y"** (o "Já conversados" sai daqui — já está no nome da aba).
- Manter ações essenciais: seleção, disparo em massa, cadastrar lead. Nada mais no topo.

## 4. Arquivos afetados

```text
src/components/captacao/CapturedLeadsPanel.tsx     (remove botão/banner/aside/sheet, simplifica header)
src/components/captacao/CaptacaoPanel.tsx          (envolve em Tabs Novos/Já conversados)
src/components/captacao/AlreadyContactedList.tsx   (NOVO — conteúdo do antigo painel lateral)
```

Sem mudança de banco, edge function ou tipos. Só UI.

## 5. Validação

- Aba **Novos leads**: só leads não contactados, sem banner, sem botão de sync no topo.
- Aba **Já conversados**: lista os disparados, busca funciona, "Reabrir conversa" abre o chat.
- Disparar um lead → ele sai de "Novos" e aparece em "Já conversados" automaticamente.
- Mobile: as duas abas funcionam sem painel lateral / sheet.
- Backfill de CTWA continua rodando em segundo plano (verificar via console.log que a função é chamada no mount).
