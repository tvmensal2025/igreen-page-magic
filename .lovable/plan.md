## Ajustes no Wizard Pós-Venda

### 1. Upload funcionando hoje
- Trocar o botão "Subir o meu (em breve)" por upload real.
- Usar `uploadMedia` de `@/services/minioUpload` (mesmo helper que `TemplateListItem` já usa) com `scope: "library"` e `kind` correto (audio/image/video).
- Após upload: criar linha em `ai_media_library` (consultant_id, kind, label, url, storage_path, sizes, content_hash via `sha256File`) reusando padrão de `src/lib/mediaHash.ts` para deduplicar.
- Adicionar o item recém-criado à lista `myMedia` localmente e selecioná-lo automaticamente.
- Mostrar `Progress` durante o upload + toast de sucesso/erro.

### 2. Preview de celular ao lado
- Layout do `DialogContent` muda de coluna única para **2 colunas** (esquerda: editor, direita: mockup de WhatsApp).
- `max-w-3xl` → `max-w-5xl`. No mobile vira coluna única (sticky preview some).
- Mockup simples (sem dependências novas): moldura arredondada, header verde "WhatsApp", área de mensagens com bubble verde-claro à direita, scrollável.
- Renderiza, na ordem configurada:
  - **Texto** → bubble com texto.
  - **Áudio** → bubble com player nativo `<audio controls>`.
  - **Imagem** → bubble com `<img>`.
  - **Vídeo** → bubble com `<video controls>`.
- Atualiza em tempo real conforme o consultor escolhe mídias / digita texto.
- Fallback: quando o slot está vazio e `use_default` está marcado, mostrar a mídia pública padrão do estágio (best-effort por label).

### 3. Escolher ordem de envio
- Adicionar campo `send_order: ("text"|"audio"|"image"|"video")[]` na config local (mantém defaults `["text","audio","image","video"]`).
- Persistir como nova coluna `send_order text[]` em `consultant_pos_venda_media` via migration.
- UI: lista compacta acima do preview ("Ordem de envio") com 4 chips arrastáveis (drag handle). Sem libs externas — uso de HTML5 drag & drop nativo (pointerdown + index swap) para manter leve.
- Botões "↑ / ↓" alternativos em cada chip pra acessibilidade.
- O preview à direita respeita a ordem.

### 4. Detalhes técnicos
- Migration: `ALTER TABLE consultant_pos_venda_media ADD COLUMN send_order text[] DEFAULT ARRAY['text','audio','image','video']`.
- Tipos `any` no insert do upsert (até `types.ts` regenerar).
- Sem mudanças no engine — apenas leitura futura do `send_order` quando o disparador for atualizado (fora deste escopo).
- Mantém `Pular` / `Salvar e continuar` e barra de progresso.

### Ordem de implementação
1. Migration `send_order`.
2. Refator do componente: novo layout 2 colunas + reordenação + preview.
3. Substituir botões "em breve" por upload real com dedupe por hash.