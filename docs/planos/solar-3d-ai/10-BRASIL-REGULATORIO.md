# 10 — Brasil: regulatório, tarifas e disclaimers

---

## 10.1 Marco legal

| Norma | Impacto no módulo |
|-------|-------------------|
| **Lei 14.300/2022** | Geração distribuída, SCEE |
| **RN ANEEL 1.059/2023** | Regras compensação (TUSD fio B gradual) |
| **Inmetro / concessionária** | Homologação pós-venda — reforçar no UX |

O módulo é **ferramenta comercial**, não projeto executivo.

---

## 10.2 Produtos iGreen — mensagens corretas

### Conexão Placas (`conexao-placas`)

- Sistema **no telhado do cliente**.
- Copy existente: até 95% economia, visita técnica após aceite.
- Simulação deve usar faixa **conservadora** (ex.: 70–90%) na UI; marketing pode citar "até 95%" com asterisco.

### Conexão Solar (`conexao-solar`)

- **Sem placas no imóvel** — energia de fazendas.
- **Não** mostrar painéis no telhado do cliente (enganoso).
- Módulo solar 3D = **desabilitado** ou modo "só economia estimada" sem overlay.

---

## 10.3 Distribuidoras

Campo `customers.distribuidora` já capturado.

**v1 economia:** `bill_value × offset%`  
**v2:** tabela `distribuidora_tariffs` (CSV):

- TE média R$/kWh
- Limite potência monofásico/trifásico
- Regras mínimos por concessionária

---

## 10.4 Disclaimers obrigatórios (UI)

Exibir em **toda** tela com métricas:

> **Estimativa comercial** baseada em imagens de satélite e dados públicos.  
> Valores finais dependem de **vistoria técnica no local**, medição real do telhado,  
> sombreamento, padrão de entrada e homologação na concessionária.  
> Não constitui projeto executivo nem garantia de geração.

Proposta pública: mesmo texto em rodapé da seção solar.

---

## 10.5 LGPD

| Dado | Base legal | Tratamento |
|------|------------|------------|
| Endereço | Execução contrato / legítimo interesse | Geocoding |
| Coordenadas | Idem | Cache 30d |
| Imagem telhado Google | Licença Google ToS | Não redistribuir raw |
| Preview PNG | Interno | Storage iGreen |

- Política privacidade: adicionar seção "Análise solar" na Fase 3.
- Cliente pode solicitar exclusão → cascade snapshots.

---

## 10.6 Condomínios e multifamiliar

- Solar API pode retornar edifício errado em condomínios.
- UX: permitir ajuste manual + aviso "em prédios, vistoria é obrigatória".
- Não qualificar automaticamente como "apto" sem confirmação.

---

## 10.7 Financiamento

Copy existente: até 120x, bancos listados em `FINANCING_BANKS`.

Módulo solar **não calcula** parcelas automaticamente v1 — consultor preenche no builder (já suportado).

---

## 10.8 Comparação com PV\*SOL

| | PV\*SOL | Módulo iGreen |
|---|---------|---------------|
| Objetivo | Projeto técnico / homologação | Venda |
| Precisão | Alta | Média-alta remota |
| Público | Projetista | Consultor/vendedor |

Posicionamento interno: **complementar**, não substituto.
