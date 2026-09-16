-- Route request_id and grouped stock audit through the secure RPC dispatcher.
alter function public.arana_app_rpc(text,text,jsonb) rename to arana_app_rpc_legacy;
create or replace function public.arana_app_rpc(p_session_token text,p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_actor record;v_id uuid;
begin
 if p_action='save_stock_log' then
  select * into v_actor from private.require_app_session(p_session_token); perform private.require_role(v_actor.role,array['Frontdesk','Audit','Admin']); perform private.require_branch(v_actor.role,v_actor.branch_name,p_payload->>'p_branch_name');
  v_id:=public.save_stock_log(p_payload->>'p_branch_name',nullif(p_payload->>'p_to_branch_name',''),p_payload->>'p_product_code',p_payload->>'p_direction',p_payload->>'p_move_type',(p_payload->>'p_qty')::numeric,p_payload->>'p_note',v_actor.user_id,nullif(p_payload->>'p_source',''),nullif(p_payload->>'p_request_id','')::uuid); return to_jsonb(v_id);
 elsif p_action='audit_stock_request' then
  select * into v_actor from private.require_app_session(p_session_token); perform private.require_role(v_actor.role,array['Audit','StockAudit','Admin']); perform public.audit_stock_request((p_payload->>'p_request_id')::uuid,p_payload->>'p_status',v_actor.user_id,nullif(p_payload->>'p_note','')); return 'true'::jsonb;
 end if;
 return public.arana_app_rpc_legacy(p_session_token,p_action,p_payload);
end;$$;
grant execute on function public.arana_app_rpc(text,text,jsonb) to anon,authenticated;