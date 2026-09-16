-- Group non-OPD inventory rows created in one submission.
alter table public.stock_logs add column if not exists request_id uuid;
create index if not exists stock_logs_request_id_idx on public.stock_logs(request_id);
drop function if exists public.save_stock_log(text,text,text,text,text,numeric,text,uuid,text);
drop function if exists public.get_pending_stock_logs();
create function public.save_stock_log(p_branch_name text,p_to_branch_name text,p_product_code text,p_direction text,p_move_type text,p_qty numeric,p_note text,p_created_by uuid,p_source text default null,p_request_id uuid default null) returns uuid language plpgsql security definer set search_path=public,extensions as $function$
declare v_branch_id uuid; v_to_branch_id uuid; v_product_id uuid; v_log_id uuid;
begin
 select id into v_branch_id from branches where name=p_branch_name; select id into v_product_id from products where code=p_product_code;
 if p_to_branch_name is not null then select id into v_to_branch_id from branches where name=p_to_branch_name; end if;
 if v_branch_id is null then raise exception 'ไม่พบสาขา %',p_branch_name; end if; if v_product_id is null then raise exception 'ไม่พบสินค้า %',p_product_code; end if;
 insert into stock_logs(branch_id,to_branch_id,product_id,direction,move_type,qty,note,created_by,audit_status,source,request_id) values(v_branch_id,v_to_branch_id,v_product_id,p_direction,p_move_type,p_qty,p_note,p_created_by,'รอตรวจสอบ',p_source,p_request_id) returning id into v_log_id;
 insert into branch_stock(branch_id,product_id,qty_on_hand) values(v_branch_id,v_product_id,case when p_direction='IN' then p_qty else -p_qty end) on conflict(branch_id,product_id) do update set qty_on_hand=branch_stock.qty_on_hand+(case when p_direction='IN' then p_qty else -p_qty end),updated_at=now();
 return v_log_id;
end;$function$;
create function public.get_pending_stock_logs() returns table(id uuid,request_id uuid,log_date date,created_at timestamptz,branch_name text,to_branch_name text,move_type text,product_code text,product_name text,qty numeric,unit text,created_by_name text,audit_status text,note text,source text) language plpgsql security definer set search_path=public,extensions as $function$
begin return query select sl.id,sl.request_id,sl.log_date,sl.created_at,br.name,tbr.name,sl.move_type,p.code,p.name,sl.qty,p.unit,u.name,sl.audit_status,sl.note,sl.source from stock_logs sl left join branches br on br.id=sl.branch_id left join branches tbr on tbr.id=sl.to_branch_id left join products p on p.id=sl.product_id left join users u on u.id=sl.created_by where sl.audit_status='รอตรวจสอบ' order by sl.created_at; end;$function$;
create or replace function public.audit_stock_request(p_request_id uuid,p_status text,p_audit_by uuid,p_note text) returns void language plpgsql security definer set search_path=public,extensions as $function$
declare r record; begin if p_request_id is null then raise exception 'ไม่พบรหัสคำขอ'; end if; for r in select id from stock_logs where request_id=p_request_id and audit_status='รอตรวจสอบ' loop perform public.audit_stock_log(r.id,p_status,p_audit_by,p_note); end loop; end;$function$;