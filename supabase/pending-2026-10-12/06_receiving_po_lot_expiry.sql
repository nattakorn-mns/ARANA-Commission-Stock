-- ============================================================
-- รับของเข้า: เก็บเลขที่ PO / ผู้ขาย (ต่อใบ) และ ล็อต / วันหมดอายุ (ต่อบรรทัด)
-- สร้างเมื่อ 12/10/2569  (รันหลังไฟล์ 02 รอบ 26/09 ซึ่งรันแล้ว)  รันซ้ำได้
--
-- ทำไม: ERP หลักรับของผูกกับใบสั่งซื้อ และสินค้าที่คุมล็อตต้องมีล็อตกับวันหมดอายุ
--       เก็บไว้ตั้งแต่ตอนพนักงานรับของ บัญชีจะได้ไม่ต้องตามถามทีหลัง และไฟล์ Export เข้า ERP จะครบ
-- ============================================================
begin;

alter table public.stock_logs
  add column if not exists po_no text,
  add column if not exists supplier_name text,
  add column if not exists lot_no text,
  add column if not exists expire_date date;

-- save_stock_request: รับ p_po_no / p_supplier_name ระดับใบ และ lot_no / expire_date ระดับบรรทัด
create or replace function private.save_stock_request(p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request_id uuid := nullif(p_payload->>'p_request_id', '')::uuid;
  v_move_type text := p_payload->>'p_move_type';
  v_direction text;
  v_branch_id uuid;
  v_to_branch_id uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_log_date date := coalesce(nullif(p_payload->>'p_log_date', '')::date, v_today);
  v_lines jsonb := coalesce(p_payload->'p_lines', '[]'::jsonb);
  v_images jsonb := coalesce(p_payload->'p_images', '[]'::jsonb);
  v_po text := nullif(trim(coalesce(p_payload->>'p_po_no', '')), '');
  v_supplier text := nullif(trim(coalesce(p_payload->>'p_supplier_name', '')), '');
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_exp date;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_img jsonb;
begin
  if v_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_logs where request_id = v_request_id) then
    if exists (select 1 from public.stock_logs where request_id = v_request_id and created_by <> p_actor) then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = '22023';
    end if;
    select array_agg(id order by created_at, id) into v_ids from public.stock_logs where request_id = v_request_id;
    return jsonb_build_object('request_id', v_request_id, 'log_ids', to_jsonb(v_ids), 'line_count', cardinality(v_ids), 'duplicate', true);
  end if;

  if v_move_type not in ('OUT', 'IN', 'TRANSFER') then
    raise exception 'INVALID_MOVE_TYPE' using errcode = '22023';
  end if;
  v_direction := case when v_move_type = 'IN' then 'IN' else 'OUT' end;

  select id into v_branch_id from public.branches where name = p_payload->>'p_branch_name';
  if v_branch_id is null then raise exception 'UNKNOWN_BRANCH' using errcode = '22023'; end if;
  if v_move_type = 'TRANSFER' then
    select id into v_to_branch_id from public.branches where name = p_payload->>'p_to_branch_name';
    if v_to_branch_id is null or v_to_branch_id = v_branch_id then
      raise exception 'INVALID_TO_BRANCH' using errcode = '22023';
    end if;
  end if;
  if v_log_date > v_today then
    raise exception 'FUTURE_DATE' using errcode = '22023', hint = 'วันที่เบิกต้องไม่เกินวันนี้';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 100 then
    raise exception 'INVALID_LINES' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) = 0 or jsonb_array_length(v_images) > 10 then
    raise exception 'EVIDENCE_REQUIRED' using errcode = '22023', hint = 'ต้องแนบรูปอย่างน้อย 1 รูป (ไม่เกิน 10 รูป)';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    select id into v_product_id from public.products where code = v_line->>'product_code';
    if v_product_id is null then
      raise exception 'UNKNOWN_PRODUCT' using errcode = '22023', detail = coalesce(v_line->>'product_code', '');
    end if;
    v_qty := nullif(v_line->>'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then
      raise exception 'INVALID_QTY' using errcode = '22023', detail = coalesce(v_line->>'product_code', '');
    end if;
    v_exp := nullif(v_line->>'expire_date', '')::date;
    if v_move_type = 'IN' and v_exp is not null and v_exp < v_log_date then
      raise exception 'EXPIRED_ON_RECEIPT' using errcode = '22023', detail = coalesce(v_line->>'product_code', ''),
        hint = 'วันหมดอายุต้องไม่ก่อนวันที่รับของ';
    end if;
    insert into public.stock_logs (branch_id, to_branch_id, product_id, direction, move_type, qty, note,
                                   created_by, audit_status, source, request_id, log_date, stock_applied, dest_applied,
                                   po_no, supplier_name, lot_no, expire_date)
    values (v_branch_id, v_to_branch_id, v_product_id, v_direction, v_move_type, round(v_qty, 3),
            nullif(v_line->>'note', ''), p_actor, 'รอตรวจสอบ', nullif(p_payload->>'p_source', ''),
            v_request_id, v_log_date, false, false,
            case when v_move_type = 'IN' then v_po end, case when v_move_type = 'IN' then v_supplier end,
            nullif(trim(coalesce(v_line->>'lot_no', '')), ''), v_exp)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  for v_img in select * from jsonb_array_elements(v_images) loop
    perform public.save_stock_log_image(v_ids[1], v_img #>> '{}');
  end loop;

  return jsonb_build_object('request_id', v_request_id, 'log_ids', to_jsonb(v_ids), 'line_count', cardinality(v_ids), 'duplicate', false);
end;
$$;
revoke all on function private.save_stock_request(uuid, jsonb) from public;

-- หน้าตรวจของบัญชีเห็น PO / ผู้ขาย / ล็อต / วันหมดอายุ ด้วย
drop function if exists public.get_pending_stock_logs();
create function public.get_pending_stock_logs()
returns table(id uuid, request_id uuid, log_date date, created_at timestamptz, branch_name text, to_branch_name text, move_type text,
              product_code text, product_name text, qty numeric, unit text, created_by_name text, audit_status text, note text, source text,
              po_no text, supplier_name text, lot_no text, expire_date date)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  select sl.id, sl.request_id, sl.log_date, sl.created_at, br.name, tbr.name, sl.move_type, p.code, p.name, sl.qty, p.unit, u.name,
         sl.audit_status, sl.note, sl.source, sl.po_no, sl.supplier_name, sl.lot_no, sl.expire_date
  from stock_logs sl
  left join branches br on br.id = sl.branch_id
  left join branches tbr on tbr.id = sl.to_branch_id
  left join products p on p.id = sl.product_id
  left join users u on u.id = sl.created_by
  where sl.audit_status = 'รอตรวจสอบ' and sl.opd_bill_id is null and sl.superseded_at is null
  order by sl.created_at;
end;
$$;
revoke all on function public.get_pending_stock_logs() from public, anon, authenticated;

-- Export เข้า ERP เห็นช่องเหล่านี้ด้วย
create or replace function public.list_stock_logs_erp_sync(p_session_token text, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor record;
  v_result jsonb;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Audit', 'StockAudit', 'Admin']);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_result
  from (
    select sl.id, coalesce(sl.request_id, sl.id) as request_id, sl.log_date, sl.created_at, sl.move_type,
           br.name as branch_name, tbr.name as to_branch_name, p.code as product_code, p.name as product_name,
           sl.qty, sl.source, sl.note, sl.audit_status, sl.erp_sync_status, sl.erp_ref, sl.erp_synced_at, sl.erp_sync_error,
           sl.opd_bill_id is not null as is_opd, sl.audited_at as approved_at, au.name as approved_by_name,
           sl.po_no, sl.supplier_name, sl.lot_no, sl.expire_date
    from public.stock_logs sl
    left join public.branches br on br.id = sl.branch_id
    left join public.branches tbr on tbr.id = sl.to_branch_id
    left join public.products p on p.id = sl.product_id
    left join public.users au on au.id = sl.audited_by
    where (sl.audit_status = 'อนุมัติแล้ว' or sl.erp_sync_status = 'ต้องยกเลิกที่ ERP')
      and (p_status is null or sl.erp_sync_status = p_status)
    order by sl.created_at desc
    limit 300
  ) x;
  return v_result;
end;
$$;
grant execute on function public.list_stock_logs_erp_sync(text, text) to anon, authenticated;

-- แผนใหม่ (12/10): รับของเข้าส่งเข้า ERP ด้วย (เดิมตั้งไว้ว่าไม่ต้องส่ง) — เฉพาะ OPD ที่ยังไม่ส่ง
create or replace function private.stock_logs_erp_scope()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.opd_bill_id is not null then
    new.erp_sync_status := 'ไม่ต้องส่ง';
  end if;
  return new;
end;
$$;
update public.stock_logs set erp_sync_status = 'รอส่ง'
where erp_sync_status = 'ไม่ต้องส่ง' and opd_bill_id is null and move_type = 'IN' and audit_status <> 'ตีกลับ';

commit;
select column_name from information_schema.columns where table_name = 'stock_logs' and column_name in ('po_no','supplier_name','lot_no','expire_date');
