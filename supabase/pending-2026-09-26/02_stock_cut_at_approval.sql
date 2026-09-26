-- ============================================================
-- ตัดสต็อก "ตอนบัญชีอนุมัติ" + ถอยการอนุมัติแล้วคืนของเข้าคลัง + เช็คสต๊อกรายสัปดาห์เก็บในฐานข้อมูลกลาง
-- สร้างเมื่อ 26/09/2026 (รอบแก้ตามรายงาน Codex)
--
-- สิ่งที่ไฟล์นี้ทำ
--   1) ใบเบิกใช้ / รับเข้า / โอนสาขา ที่ส่งใหม่ จะ "ยังไม่ตัดสต็อก" จนกว่าบัญชีกดอนุมัติ
--      - อนุมัติ  -> ตัดสต็อกสาขาต้นทาง (โอนสาขา: เพิ่มเข้าสาขาปลายทางด้วย)
--      - ตีกลับ (ยังไม่เคยอนุมัติ) -> ไม่มีอะไรต้องคืน เพราะยังไม่เคยตัด
--      - ถอยการอนุมัติ (เคยอนุมัติแล้ว) -> คืนของเข้าคลัง แล้วเปลี่ยนสถานะเป็น "ตีกลับ"
--        ถ้ารายการนั้นเคยส่งเข้า ERP สำเร็จแล้ว จะขึ้นสถานะ "ต้องยกเลิกที่ ERP" ให้ตามไปแก้ฝั่ง ERP
--   2) ใบเบิกหลายรายการในครั้งเดียว บันทึกพร้อมกันทั้งใบ (สำเร็จทั้งใบ หรือไม่บันทึกเลย) พร้อมรูปแนบ
--      และวันที่ที่พนักงานเลือกจะถูกบันทึกจริง
--   3) สต๊อกการ์ดแสดงยอดคงเหลือทีละบรรทัด (ไม่ใช่ยอดสุดท้ายซ้ำทุกบรรทัด)
--   4) เช็คสต๊อกรายสัปดาห์ บันทึกเข้าฐานข้อมูลกลาง (เดิมเก็บแค่ในเครื่อง)
--
-- รายการเก่าที่มีอยู่แล้ว: ระบบเดิมตัดสต็อกไปตั้งแต่ตอนส่ง จึงถูกบันทึกว่า "ตัดแล้ว"
--   ไม่มีการตัดซ้ำ และถ้าตีกลับ/ถอยการอนุมัติ ก็คืนของให้ถูกต้อง
-- รายการเบิกจาก OPD ยังใช้วิธีเดิมไปก่อน (รอดูโครงสร้างฟังก์ชัน OPD จากไฟล์ 00 ก่อนปรับ)
--
-- วิธีใช้: copy ทั้งหมด วางใน SQL Editor ของ Supabase (โปรเจกต์ส่วนขยาย) แล้วกด Run
-- รันซ้ำได้ ไม่เสียหาย
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) คอลัมน์ "ตัดสต็อกไปแล้วหรือยัง" ต่อรายการ
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'stock_logs' and column_name = 'stock_applied') then
    alter table public.stock_logs add column stock_applied boolean;
    alter table public.stock_logs add column dest_applied boolean;
    -- The old save path cut stock at submit, so pending and approved rows are already applied.
    update public.stock_logs set stock_applied = true where audit_status in ('รอตรวจสอบ', 'อนุมัติแล้ว');
    -- The old save path never credited the destination at submit.
    -- Approved transfers stay NULL (unknown) and must be corrected by hand if ever reverted.
    update public.stock_logs set dest_applied = false where move_type = 'TRANSFER' and audit_status = 'รอตรวจสอบ';
  end if;
end $$;

-- Rows still inserted by the old paths (OPD supplies) keep cutting at submit, so the default stays "applied".
alter table public.stock_logs alter column stock_applied set default true;
alter table public.stock_logs alter column dest_applied set default false;

alter table public.stock_logs
  add column if not exists audited_by uuid references public.users(id),
  add column if not exists audited_at timestamptz,
  add column if not exists audit_note text;

comment on column public.stock_logs.stock_applied is 'true = ตัด/เพิ่มสต็อกสาขาต้นทางแล้ว, false = ยังไม่ตัด (รออนุมัติ หรือคืนแล้ว), null = รายการเก่าที่ตีกลับไปก่อนมีระบบนี้';
comment on column public.stock_logs.dest_applied is 'เฉพาะโอนสาขา: true = เพิ่มเข้าสาขาปลายทางแล้ว, null = รายการเก่าที่ไม่ทราบ';

-- สถานะ ERP เพิ่ม "ต้องยกเลิกที่ ERP"
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.stock_logs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%erp_sync_status%' loop
    execute format('alter table public.stock_logs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.stock_logs add constraint stock_logs_erp_sync_status_check
  check (erp_sync_status in ('รอส่ง','ส่งสำเร็จ','ส่งไม่สำเร็จ','ไม่ต้องส่ง','ต้องยกเลิกที่ ERP'));

-- ERP หลักรับเฉพาะ "เบิกใช้" กับ "โอนสาขา" — รายการเบิกจาก OPD และรับเข้า ไม่ต้องส่ง
update public.stock_logs set erp_sync_status = 'ไม่ต้องส่ง'
where erp_sync_status = 'รอส่ง' and (opd_bill_id is not null or move_type not in ('OUT', 'TRANSFER'));

create or replace function private.stock_logs_erp_scope()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.opd_bill_id is not null or new.move_type not in ('OUT', 'TRANSFER') then
    new.erp_sync_status := 'ไม่ต้องส่ง';
  end if;
  return new;
end;
$$;
drop trigger if exists stock_logs_erp_scope on public.stock_logs;
create trigger stock_logs_erp_scope before insert on public.stock_logs
  for each row execute function private.stock_logs_erp_scope();

-- ยอดคงเหลือต้องเก็บทศนิยมได้ (ซีซี/ยูนิต)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'branch_stock' and column_name = 'qty_on_hand'
               and data_type in ('integer', 'bigint', 'smallint')) then
    begin
      alter table public.branch_stock alter column qty_on_hand type numeric(14,3);
    exception when others then
      raise notice 'เปลี่ยน qty_on_hand เป็นทศนิยมไม่ได้: %', sqlerrm;
    end;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) ตารางผลเช็คสต๊อกรายสัปดาห์
-- ------------------------------------------------------------
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  week_start date not null,
  counted_qty numeric(14,3) not null check (counted_qty >= 0),
  system_qty numeric(14,3),
  counted_by uuid not null references public.users(id),
  counted_at timestamptz not null default now(),
  unique (branch_id, product_id, week_start)
);
create index if not exists stock_counts_branch_week_idx on public.stock_counts (branch_id, week_start);
alter table public.stock_counts enable row level security;
revoke all on public.stock_counts from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) ฟังก์ชันภายใน (เรียกได้เฉพาะผ่าน arana_app_rpc)
-- ------------------------------------------------------------
create or replace function private.stock_move(p_branch_id uuid, p_product_id uuid, p_delta numeric)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.branch_stock (branch_id, product_id, qty_on_hand)
  values (p_branch_id, p_product_id, p_delta)
  on conflict (branch_id, product_id)
  do update set qty_on_hand = public.branch_stock.qty_on_hand + excluded.qty_on_hand, updated_at = now();
$$;

-- Best effort: the stock_logs.audited_* columns always hold the trail even if audit_logs differs.
create or replace function private.stock_audit_trail(p_log_id uuid, p_actor uuid, p_action text, p_old text, p_new text, p_note text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.audit_logs (action, target_type, target_id, audit_by, old_status, new_status, note)
  values (p_action, 'stock_log', p_log_id, p_actor, p_old, p_new, coalesce(p_note, ''));
exception when undefined_table or undefined_column or datatype_mismatch or check_violation or not_null_violation then
  null;
end;
$$;

-- Reverse whatever this row has put into branch_stock. Caller holds the row lock.
create or replace function private.stock_unapply(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare r public.stock_logs%rowtype;
begin
  select * into r from public.stock_logs where id = p_log_id;
  if coalesce(r.stock_applied, false) then
    perform private.stock_move(r.branch_id, r.product_id, case when r.direction = 'IN' then -r.qty else r.qty end);
  end if;
  if coalesce(r.dest_applied, false) then
    perform private.stock_move(r.to_branch_id, r.product_id, -r.qty);
  end if;
  update public.stock_logs
  set stock_applied = false,
      dest_applied = case when move_type = 'TRANSFER' then false else dest_applied end
  where id = p_log_id;
end;
$$;

create or replace function private.stock_approve_row(p_log_id uuid, p_actor uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare r public.stock_logs%rowtype;
begin
  select * into r from public.stock_logs where id = p_log_id for update;
  if not found or r.audit_status <> 'รอตรวจสอบ' then return false; end if;
  if not coalesce(r.stock_applied, false) then
    perform private.stock_move(r.branch_id, r.product_id, case when r.direction = 'IN' then r.qty else -r.qty end);
  end if;
  if r.move_type = 'TRANSFER' and r.to_branch_id is not null and not coalesce(r.dest_applied, false) then
    perform private.stock_move(r.to_branch_id, r.product_id, r.qty);
  end if;
  update public.stock_logs
  set audit_status = 'อนุมัติแล้ว', stock_applied = true,
      dest_applied = case when r.move_type = 'TRANSFER' and r.to_branch_id is not null then true else dest_applied end,
      audited_by = p_actor, audited_at = now(), audit_note = p_note
  where id = p_log_id;
  perform private.stock_audit_trail(p_log_id, p_actor, 'อนุมัติ', r.audit_status, 'อนุมัติแล้ว', p_note);
  return true;
end;
$$;

-- p_from_approved = false: send back a pending row. true: roll back an approved row.
create or replace function private.stock_send_back_row(p_log_id uuid, p_actor uuid, p_note text, p_from_approved boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  r public.stock_logs%rowtype;
  v_expected text := case when p_from_approved then 'อนุมัติแล้ว' else 'รอตรวจสอบ' end;
begin
  select * into r from public.stock_logs where id = p_log_id for update;
  if not found or r.audit_status <> v_expected then
    return false;
  end if;
  if p_from_approved and r.opd_bill_id is not null then
    raise exception 'OPD_REVERT_NOT_SUPPORTED' using errcode = '22023',
      hint = 'รายการเบิกจาก OPD ยังถอยการอนุมัติจากหน้านี้ไม่ได้';
  end if;
  if p_from_approved and r.move_type = 'TRANSFER' and r.dest_applied is null then
    raise exception 'LEGACY_TRANSFER_NEEDS_MANUAL_FIX' using errcode = '22023',
      hint = 'รายการโอนสาขารุ่นเก่า ระบบไม่ทราบว่าเคยเพิ่มเข้าสาขาปลายทางแล้วหรือยัง ต้องปรับสต็อกด้วยมือ';
  end if;
  perform private.stock_unapply(p_log_id);
  update public.stock_logs
  set audit_status = 'ตีกลับ',
      erp_sync_status = case when erp_sync_status = 'ส่งสำเร็จ' then 'ต้องยกเลิกที่ ERP' else 'ไม่ต้องส่ง' end,
      audited_by = p_actor, audited_at = now(), audit_note = p_note
  where id = p_log_id;
  perform private.stock_audit_trail(p_log_id, p_actor,
    case when p_from_approved then 'ถอยการอนุมัติ' else 'ตีกลับ' end, r.audit_status, 'ตีกลับ', p_note);
  return true;
end;
$$;

-- A request is matched by request_id; old single rows without one are matched by their own id.
create or replace function private.stock_request_rows(p_request_id uuid, p_status text)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select id from public.stock_logs
  where (request_id = p_request_id or (request_id is null and id = p_request_id))
    and opd_bill_id is null
    and audit_status = p_status
  order by created_at, id;
$$;

create or replace function private.audit_stock_request_v2(p_request_id uuid, p_status text, p_actor uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_id uuid; v_n integer := 0;
begin
  if p_status not in ('อนุมัติแล้ว', 'ตีกลับ') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  for v_id in select * from private.stock_request_rows(p_request_id, 'รอตรวจสอบ') loop
    if p_status = 'อนุมัติแล้ว' then
      if private.stock_approve_row(v_id, p_actor, p_note) then v_n := v_n + 1; end if;
    else
      if private.stock_send_back_row(v_id, p_actor, p_note, false) then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function private.revert_stock_request(p_request_id uuid, p_actor uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_id uuid; v_n integer := 0;
begin
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023', hint = 'กรุณาระบุเหตุผลที่ถอยการอนุมัติ';
  end if;
  for v_id in select * from private.stock_request_rows(p_request_id, 'อนุมัติแล้ว') loop
    if private.stock_send_back_row(v_id, p_actor, p_note, true) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

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
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_img jsonb;
begin
  if v_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = '22023';
  end if;

  -- Retrying the same request (e.g. after a timeout) returns the saved rows instead of saving twice.
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
    insert into public.stock_logs (branch_id, to_branch_id, product_id, direction, move_type, qty, note,
                                   created_by, audit_status, source, request_id, log_date, stock_applied, dest_applied)
    values (v_branch_id, v_to_branch_id, v_product_id, v_direction, v_move_type, round(v_qty, 3),
            nullif(v_line->>'note', ''), p_actor, 'รอตรวจสอบ', nullif(p_payload->>'p_source', ''),
            v_request_id, v_log_date, false, false)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Evidence belongs to the whole request; it is stored on the first line like before.
  for v_img in select * from jsonb_array_elements(v_images) loop
    perform public.save_stock_log_image(v_ids[1], v_img #>> '{}');
  end loop;

  return jsonb_build_object('request_id', v_request_id, 'log_ids', to_jsonb(v_ids), 'line_count', cardinality(v_ids), 'duplicate', false);
end;
$$;

-- Stock card: every movement of a branch, with the balance right after each applied row.
-- The balance is anchored on today's branch_stock and walked backwards, so it always ends at the real on-hand.
create or replace function private.get_stock_movement_v2(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with mv as (
    select sl.id, sl.request_id, sl.log_date, sl.created_at, sl.move_type, sl.direction, sl.product_id, sl.qty,
           sl.audit_status, sl.source, sl.note, sl.created_by, sl.opd_bill_id, false as is_incoming,
           case when sl.direction = 'IN' then sl.qty else -sl.qty end as delta,
           coalesce(sl.stock_applied, false) as applied, tb.name as other_branch
    from public.stock_logs sl
    left join public.branches tb on tb.id = sl.to_branch_id
    where sl.branch_id = p_branch_id and sl.log_date >= p_from
    union all
    select sl.id, sl.request_id, sl.log_date, sl.created_at, sl.move_type, 'IN', sl.product_id, sl.qty,
           sl.audit_status, sl.source, sl.note, sl.created_by, sl.opd_bill_id, true,
           sl.qty, coalesce(sl.dest_applied, false), fb.name
    from public.stock_logs sl
    join public.branches fb on fb.id = sl.branch_id
    where sl.to_branch_id = p_branch_id and sl.move_type = 'TRANSFER' and sl.log_date >= p_from
  ),
  bal as (
    select mv.*,
           coalesce(bs.qty_on_hand, 0) - coalesce(sum(case when mv.applied then mv.delta else 0 end) over (
             partition by mv.product_id
             order by mv.log_date desc, mv.created_at desc, mv.id desc
             rows between unbounded preceding and 1 preceding), 0) as balance_after
    from mv
    left join public.branch_stock bs on bs.branch_id = p_branch_id and bs.product_id = mv.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'request_id', b.request_id, 'log_date', b.log_date, 'created_at', b.created_at,
    'move_type', b.move_type, 'direction', b.direction, 'is_incoming', b.is_incoming, 'other_branch', b.other_branch,
    'product_code', p.code, 'product_name', p.name, 'unit', p.unit, 'qty', b.qty,
    'audit_status', b.audit_status, 'source', b.source, 'note', b.note, 'is_opd', b.opd_bill_id is not null,
    'created_by_name', u.name, 'applies_to_balance', b.applied,
    'balance_after', case when b.applied then b.balance_after end
  ) order by b.log_date desc, b.created_at desc, b.id desc), '[]'::jsonb)
  from (select * from bal where log_date <= p_to order by log_date desc, created_at desc limit 3000) b
  left join public.products p on p.id = b.product_id
  left join public.users u on u.id = b.created_by;
$$;

-- Weekly count screen: active products with this week's count. System qty is hidden from Frontdesk.
create or replace function private.get_weekly_count(p_branch_id uuid, p_week date, p_show_system boolean)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_code', p.code, 'product_name', p.name, 'unit', p.unit, 'category', p.category,
    'counted_qty', sc.counted_qty, 'counted_at', sc.counted_at,
    'system_qty', case when p_show_system then coalesce(sc.system_qty, bs.qty_on_hand, 0) end,
    'is_match', case when sc.id is not null then sc.counted_qty = coalesce(sc.system_qty, 0) end
  ) order by p.code), '[]'::jsonb)
  from public.products p
  left join public.stock_counts sc on sc.product_id = p.id and sc.branch_id = p_branch_id and sc.week_start = p_week
  left join public.branch_stock bs on bs.product_id = p.id and bs.branch_id = p_branch_id
  where p.is_active;
$$;

create or replace function private.save_weekly_count(p_actor uuid, p_branch_id uuid, p_week date, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_item jsonb; v_product_id uuid; v_qty numeric; v_n integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 1000 then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select id into v_product_id from public.products where code = v_item->>'product_code';
    v_qty := nullif(v_item->>'counted_qty', '')::numeric;
    if v_product_id is null or v_qty is null or v_qty < 0 then
      raise exception 'INVALID_COUNT' using errcode = '22023', detail = coalesce(v_item->>'product_code', '');
    end if;
    insert into public.stock_counts (branch_id, product_id, week_start, counted_qty, system_qty, counted_by, counted_at)
    values (p_branch_id, v_product_id, p_week, round(v_qty, 3),
            (select qty_on_hand from public.branch_stock where branch_id = p_branch_id and product_id = v_product_id),
            p_actor, now())
    on conflict (branch_id, product_id, week_start) do update
      set counted_qty = excluded.counted_qty, system_qty = excluded.system_qty,
          counted_by = excluded.counted_by, counted_at = excluded.counted_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function private.stock_move(uuid, uuid, numeric) from public;
revoke all on function private.stock_audit_trail(uuid, uuid, text, text, text, text) from public;
revoke all on function private.stock_unapply(uuid) from public;
revoke all on function private.stock_approve_row(uuid, uuid, text) from public;
revoke all on function private.stock_send_back_row(uuid, uuid, text, boolean) from public;
revoke all on function private.stock_request_rows(uuid, text) from public;
revoke all on function private.audit_stock_request_v2(uuid, text, uuid, text) from public;
revoke all on function private.revert_stock_request(uuid, uuid, text) from public;
revoke all on function private.save_stock_request(uuid, jsonb) from public;
revoke all on function private.get_stock_movement_v2(uuid, date, date) from public;
revoke all on function private.get_weekly_count(uuid, date, boolean) from public;
revoke all on function private.save_weekly_count(uuid, uuid, date, jsonb) from public;

-- ------------------------------------------------------------
-- 4) ประตูหลัก arana_app_rpc: รับงานใหม่ข้างบน ที่เหลือส่งต่อให้ของเดิมเหมือนเดิม
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.arana_app_rpc_legacy2(text,text,jsonb)') is null then
    alter function public.arana_app_rpc(text, text, jsonb) rename to arana_app_rpc_legacy2;
  end if;
end $$;

-- The browser must go through the new gateway only.
revoke all on function public.arana_app_rpc_legacy2(text, text, jsonb) from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.arana_app_rpc_legacy(text,text,jsonb)') is not null then
    revoke all on function public.arana_app_rpc_legacy(text, text, jsonb) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.arana_app_rpc(p_session_token text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor record;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_branch_id uuid;
  v_week date;
  v_from date;
  v_to date;
  v_is_opd boolean;
begin
  if p_action not in ('save_stock_request', 'audit_stock_request', 'audit_stock_log', 'revert_stock_request',
                      'get_stock_movement_v2', 'get_weekly_count', 'save_weekly_count') then
    return public.arana_app_rpc_legacy2(p_session_token, p_action, p_payload);
  end if;

  select * into v_actor from private.require_app_session(p_session_token);

  if p_action = 'save_stock_request' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    return private.save_stock_request(v_actor.user_id, v_payload);

  elsif p_action = 'audit_stock_request' then
    perform private.require_role(v_actor.role, array['Audit', 'StockAudit', 'Admin']);
    return jsonb_build_object('affected', private.audit_stock_request_v2(
      (v_payload->>'p_request_id')::uuid, v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note', '')));

  elsif p_action = 'audit_stock_log' then
    select opd_bill_id is not null into v_is_opd from public.stock_logs where id = (v_payload->>'p_log_id')::uuid;
    if coalesce(v_is_opd, false) then
      return public.arana_app_rpc_legacy2(p_session_token, p_action, p_payload);
    end if;
    perform private.require_role(v_actor.role, array['Audit', 'StockAudit', 'Admin']);
    if v_payload->>'p_status' = 'อนุมัติแล้ว' then
      return jsonb_build_object('affected', private.stock_approve_row(
        (v_payload->>'p_log_id')::uuid, v_actor.user_id, nullif(v_payload->>'p_note', ''))::integer);
    elsif v_payload->>'p_status' = 'ตีกลับ' then
      return jsonb_build_object('affected', private.stock_send_back_row(
        (v_payload->>'p_log_id')::uuid, v_actor.user_id, nullif(v_payload->>'p_note', ''), false)::integer);
    end if;
    raise exception 'INVALID_STATUS' using errcode = '22023';

  elsif p_action = 'revert_stock_request' then
    perform private.require_role(v_actor.role, array['Audit', 'StockAudit', 'Admin']);
    return jsonb_build_object('affected', private.revert_stock_request(
      (v_payload->>'p_request_id')::uuid, v_actor.user_id, v_payload->>'p_note'));

  elsif p_action = 'get_stock_movement_v2' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'StockAudit', 'Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select id into v_branch_id from public.branches where name = v_payload->>'p_branch_name';
    if v_branch_id is null then raise exception 'UNKNOWN_BRANCH' using errcode = '22023'; end if;
    v_to := coalesce(nullif(v_payload->>'p_date_to', '')::date, (now() at time zone 'Asia/Bangkok')::date);
    v_from := coalesce(nullif(v_payload->>'p_date_from', '')::date, v_to - 90);
    if v_from < v_to - 400 then v_from := v_to - 400; end if;
    return private.get_stock_movement_v2(v_branch_id, v_from, v_to);

  elsif p_action in ('get_weekly_count', 'save_weekly_count') then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'StockAudit', 'Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select id into v_branch_id from public.branches where name = v_payload->>'p_branch_name';
    if v_branch_id is null then raise exception 'UNKNOWN_BRANCH' using errcode = '22023'; end if;
    -- Any date inside the week counts as that week (Monday).
    v_week := date_trunc('week', coalesce(nullif(v_payload->>'p_week_start', '')::date,
                                          (now() at time zone 'Asia/Bangkok')::date))::date;
    if p_action = 'save_weekly_count' then
      perform private.save_weekly_count(v_actor.user_id, v_branch_id, v_week, v_payload->'p_items');
    end if;
    return jsonb_build_object('week_start', v_week,
      'items', private.get_weekly_count(v_branch_id, v_week, v_actor.role <> 'Frontdesk'));
  end if;

  raise exception 'UNKNOWN_ACTION' using errcode = '22023';
end;
$$;

revoke all on function public.arana_app_rpc(text, text, jsonb) from public;
grant execute on function public.arana_app_rpc(text, text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 5) หน้า "ส่งเข้า ERP" ของแอดมิน: เห็นเลขใบเบิก และรายการที่ต้องไปยกเลิกที่ ERP
--    (แก้ของเดิมที่ limit 200 ไม่ทำงานด้วย)
-- ------------------------------------------------------------
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
           sl.opd_bill_id is not null as is_opd, sl.audited_at as approved_at, au.name as approved_by_name
    from public.stock_logs sl
    left join public.users au on au.id = sl.audited_by
    left join public.branches br on br.id = sl.branch_id
    left join public.branches tbr on tbr.id = sl.to_branch_id
    left join public.products p on p.id = sl.product_id
    where (sl.audit_status = 'อนุมัติแล้ว' or sl.erp_sync_status = 'ต้องยกเลิกที่ ERP')
      and (p_status is null or sl.erp_sync_status = p_status)
    order by sl.created_at desc
    limit 300
  ) x;

  return v_result;
end;
$$;

grant execute on function public.list_stock_logs_erp_sync(text, text) to anon, authenticated;

commit;

-- ------------------------------------------------------------
-- 6) ตรวจผลหลังรัน (ดูอย่างเดียว)
-- ------------------------------------------------------------
select audit_status as "สถานะตรวจ",
       case when stock_applied then 'ตัดแล้ว' when stock_applied = false then 'ยังไม่ตัด' else 'รายการเก่า (ไม่ทราบ)' end as "ตัดสต็อก",
       count(*) as "จำนวนรายการ"
from public.stock_logs
group by 1, 2
order by 1, 2;
