
create or replace function public.cleanup_customer_duplicates(p_consultant_id uuid)
returns table (removed_count int, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_phone text;
    v_ids uuid[];
    v_removed_total int := 0;
begin
    -- Itera sobre grupos de duplicados (mesmo consultant_id e mesmo prefixo de telefone antes do underscore)
    for v_phone, v_ids in
        select 
            coalesce(whatsapp_chat_id, split_part(phone_whatsapp, '_', 1)) as clean_phone,
            array_agg(id order by 
                case when customer_origin in ('igreen_sync', 'igreen_extension') then 0 else 1 end, -- Prioriza sync
                case when name is not null and name != '' then 0 else 1 end, -- Prioriza com nome
                created_at asc -- Prioriza mais antigo
            ) as ids
        from public.customers
        where consultant_id = p_consultant_id
          and phone_whatsapp is not null
          and phone_whatsapp not like 'sem_celular_%'
        group by 1
        having count(*) > 1
    loop
        -- Pausa e marca DNC em todos EXCETO o primeiro (canônico)
        update public.customers
        set 
            bot_paused = true,
            do_not_contact = true,
            bot_paused_reason = 'absorbed_by_cleanup_v2'
        where id = any(v_ids[2:]);
        
        -- Remove do motor de cadência os duplicados
        delete from public.lead_cadence_state
        where customer_id = any(v_ids[2:]);
        
        v_removed_total := v_removed_total + array_length(v_ids[2:], 1);
        removed_count := array_length(v_ids[2:], 1);
        phone := v_phone;
        return next;
    end loop;
end;
$$;

-- Executa para o Rafael
SELECT * FROM public.cleanup_customer_duplicates('0c2711ad-4836-41e6-afba-edd94f698ae3');
