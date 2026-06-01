UPDATE public.bot_flow_steps
SET message_text = E'Olha que ótimo! ✨🎉\n\n💡 Sua conta hoje: *{{valor_conta}}*\n\n💚 Economia estimada: *{{economia_range}}* por mês\n\nE o melhor:\n\n✅ Sem investimento\n\n✅ Sem obra\n\n✅ Sem instalação\n\n✅ *Mesma* distribuidora\n\nBora fazer seu *cadastro agora*? 🚀',
    updated_at = now()
WHERE id = 'b1a52222-2222-4222-8222-000000000002';