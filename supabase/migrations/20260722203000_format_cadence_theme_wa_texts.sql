-- Temas WA Dia 2/7: negrito + emoji leve (mesmo padrão do Multicanal A/B/C).
-- SMS inalterado. Disclaimers (elegíveis / condições vigentes) preservados.

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! 👋

Boa notícia: agora dá para começar sua *análise* só com o *valor médio* da conta — *sem foto* e *sem burocracia*. ✅

{{frase_disponibilidade}}

*Qual faixa está sua conta hoje?*$wa$,
    updated_at = now()
WHERE theme_id = 'simplified_analysis';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*!

As bandeiras *amarela* e *vermelha* podem aumentar o valor final da conta. ⚡

O benefício de economia pode *ajudar a reduzir* o impacto desses aumentos, conforme o consumo e as condições aplicáveis.

Quer *análise inicial* pelo valor médio? *Qual faixa?*$wa$,
    updated_at = now()
WHERE theme_id = 'tariff_flags';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! 👋

Para conhecer essa possibilidade de economia, *não é necessário* instalar placas solares na sua casa, fazer obra ou alterar sua instalação. ✅

A análise pode começar pelo *valor médio*. Como prefere?$wa$,
    updated_at = now()
WHERE theme_id = 'no_home_panels';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! Aqui é *{{consultor}}*.

🔒 *Reforço importante:* não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

{{frase_disponibilidade}}

Como prefere seguir?$wa$,
    updated_at = now()
WHERE theme_id = 'security';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! 👋

O benefício *não termina* na economia da conta: clientes elegíveis podem ter vantagens em estabelecimentos parceiros, conforme condições vigentes.

*O que você quer conhecer?*$wa$,
    updated_at = now()
WHERE theme_id = 'benefits_club';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! 👋

Além da própria economia, também podem existir *benefícios por indicação*, conforme as regras vigentes.

*O que você quer conhecer?*$wa$,
    updated_at = now()
WHERE theme_id = 'referral_cashback';

UPDATE public.cadence_theme_config
SET wa_text = $wa$Olá, *{{nome}}*! 👋

Além da economia na conta, clientes elegíveis podem acompanhar o benefício pelo *aplicativo*, conforme as condições vigentes. 📱

{{frase_disponibilidade}}

Como prefere seguir?$wa$,
    updated_at = now()
WHERE theme_id = 'digital_app';
