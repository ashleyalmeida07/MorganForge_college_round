-- =====================================================================
-- Verity — grant admin role to listed users (idempotent)
-- Only affects users who already signed up (profiles row exists).
-- =====================================================================

update public.profiles
   set role = 'admin'
 where lower(email) in ('rhinepereira0@gmail.com');
