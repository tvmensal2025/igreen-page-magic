DELETE FROM auth.users WHERE id <> '0c2711ad-4836-41e6-afba-edd94f698ae3';

-- Garantir roles do Rafael
INSERT INTO public.user_roles (user_id, role)
VALUES 
  ('0c2711ad-4836-41e6-afba-edd94f698ae3', 'super_admin'),
  ('0c2711ad-4836-41e6-afba-edd94f698ae3', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;