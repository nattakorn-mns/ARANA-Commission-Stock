-- Restrict legacy Audit role from commission, deposit and earnings-report access.
-- Stock review permissions remain unchanged.
do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('private.approved_reports(uuid,text,date,date)'::regprocedure) into v_def;
  v_def := replace(v_def,
    '(p_role in (''Admin'',''Audit'',''CommissionAudit'') or',
    '(p_role in (''Admin'',''CommissionAudit'') or');
  execute v_def;
end $migration$;

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.audit_bill(uuid,text,uuid,text)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'role in (''Admin'',''Audit'',''CommissionAudit'')',
    'role in (''Admin'',''CommissionAudit'')');
  execute v_def;
end $migration$;

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.audit_deposit(uuid,text,uuid,text)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'role in (''Admin'',''Audit'',''CommissionAudit'')',
    'role in (''Admin'',''CommissionAudit'')');
  execute v_def;
end $migration$;

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.arana_app_rpc(text,text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def,
    'array[''Audit'',''CommissionAudit'',''Admin'']',
    'array[''CommissionAudit'',''Admin'']');
  v_def := replace(v_def,
    'array[''Admin'',''Audit'',''CommissionAudit'',''Frontdesk'',''OnlineSales'']',
    'array[''Admin'',''CommissionAudit'',''Frontdesk'',''OnlineSales'']');
  execute v_def;
end $migration$;