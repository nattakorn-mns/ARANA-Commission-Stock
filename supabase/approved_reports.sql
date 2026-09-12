create or replace function private.approved_reports(p_user_id uuid,p_role text,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
select coalesce(jsonb_agg(to_jsonb(r) order by r.date desc,r.id),'[]'::jsonb) from (
select 'service-'||s.id as id,b.id as "billId",b.bill_date as date,br.name as branch,
s.created_by as "employeeId",u.name as "employeeName",b.customer_name as "customerName",
'service'::text as category,''::text as "saleType",''::text as "oldProgram",p.name as "newProgram",
0::numeric as "amountPaid",0::numeric as "commissionBase",0::numeric as "commissionPct",s.commission as "commissionAmt"
from public.bill_services s join public.bills b on b.id=s.bill_id
join public.branches br on br.id=b.branch_id left join public.users u on u.id=s.created_by
left join public.programs p on p.id=s.program_id
where b.commission_status='อนุมัติแล้ว' and s.commission>0
and b.bill_date between p_from and p_to
and (p_role in ('Admin','Audit','CommissionAudit') or s.created_by=p_user_id)
union all
select 'sale-'||s.id,b.id,b.bill_date,br.name,s.created_by,u.name,b.customer_name,
'commission',s.sale_type,s.old_program_name,s.new_program_name,s.amount_paid,s.commission_base,s.commission_pct,s.commission_amt
from public.bill_sales s join public.bills b on b.id=s.bill_id
join public.branches br on br.id=b.branch_id left join public.users u on u.id=s.created_by
where b.commission_status='อนุมัติแล้ว' and s.commission_amt>0
and b.bill_date between p_from and p_to
and (p_role in ('Admin','Audit','CommissionAudit') or s.created_by=p_user_id)
union all
select 'deposit-'||d.id,coalesce(d.linked_bill_id,d.id),d.deposit_date,br.name,d.created_by,u.name,d.customer_name,
'commission','Deposit','',d.program_name,d.deposit_amount,d.deposit_amount,d.commission_pct,d.commission_amt
from public.deposits d join public.branches br on br.id=d.branch_id left join public.users u on u.id=d.created_by
where d.commission_status='ได้สิทธิ์แล้ว' and d.payment_status in ('ยืนยันแล้ว','เชื่อม OPD แล้ว') and d.commission_amt>0
and d.deposit_date between p_from and p_to
and (p_role in ('Admin','Audit','CommissionAudit') or d.created_by=p_user_id)
) r;
$$;
revoke all on function private.approved_reports(uuid,text,date,date) from public,anon,authenticated;

do $migration$
declare v_def text; v_marker text := '  if p_action = ''logout'' then';
begin
 select pg_get_functiondef('public.arana_app_rpc(text,text,jsonb)'::regprocedure) into v_def;
 if position(v_marker in v_def)=0 then raise exception 'Gateway insertion point missing'; end if;
 if position('p_action = ''get_approved_reports''' in v_def)>0 then raise exception 'Report action already exists'; end if;
 v_def := replace(v_def,v_marker,$code$
  if p_action = 'get_approved_reports' then
    perform private.require_role(v_actor.role,array['Admin','Audit','CommissionAudit','Frontdesk','OnlineSales']);
    return private.approved_reports(v_actor.user_id,v_actor.role,
      coalesce(nullif(v_payload->>'from','')::date,date_trunc('month',current_date)::date),
      coalesce(nullif(v_payload->>'to','')::date,current_date));
  end if;
  if p_action = 'logout' then$code$);
 execute v_def;
end $migration$;