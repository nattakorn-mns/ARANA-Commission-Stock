-- Restore deposit review access for the Audit role.
do $migration$
declare v_def text;
begin
  select pg_get_functiondef('public.arana_app_rpc(text,text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'array[''CommissionAudit'',''Admin'']',
    'array[''Audit'',''CommissionAudit'',''Admin'']');
  execute v_def;
end $migration$;

do $migration$
declare v_def text;
begin
  select pg_get_functiondef('public.audit_deposit(uuid,text,uuid,text)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'role in (''Admin'',''CommissionAudit'')',
    'role in (''Admin'',''Audit'',''CommissionAudit'')');
  execute v_def;
end $migration$;