-- The static web client uses the anon database role. Keep the custom session
-- gateway unavailable to unrelated Supabase Auth users.
revoke execute on function public.create_app_session(text, text) from authenticated;
revoke execute on function public.arana_app_rpc(text, text, jsonb) from authenticated;


