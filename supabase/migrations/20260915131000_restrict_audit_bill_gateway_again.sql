-- Correct the gateway after restoring Audit access only for deposit review.
do $migration$
declare v_def text;
begin
  select pg_get_functiondef('public.arana_app_rpc(text,text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'elsif p_action = ''get_pending_bills'' then
    perform private.require_role(v_actor.role, array[''Audit'',''CommissionAudit'',''Admin'']);',
    'elsif p_action = ''get_pending_bills'' then
    perform private.require_role(v_actor.role, array[''CommissionAudit'',''Admin'']);');
  v_def := replace(v_def,
    'elsif p_action = ''audit_bill'' then
    perform private.require_role(v_actor.role, array[''Audit'',''CommissionAudit'',''Admin'']);',
    'elsif p_action = ''audit_bill'' then
    perform private.require_role(v_actor.role, array[''CommissionAudit'',''Admin'']);');
  execute v_def;
end $migration$;