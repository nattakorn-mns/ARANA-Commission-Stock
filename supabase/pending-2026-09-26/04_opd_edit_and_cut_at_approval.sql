-- ============================================================
-- แก้ไขบิล OPD + คำขอแก้ไขบิล + เบิกจาก OPD ตัดสต็อกตอนอนุมัติ
-- สร้างเมื่อ 26/09/2569 (ต้องรันไฟล์ 02 ก่อน)
--
-- กติกา (ตามที่คุณออมกำหนด)
--   - บิลแยก 2 ส่วน: (ก) ค่ามือ/ค่าคอม  (ข) รายการเบิกยา/วัสดุ
--   - ส่วนที่ยังไม่อนุมัติ: คนบันทึกกดแก้เองได้เลย
--   - ส่วนที่อนุมัติแล้ว: ต้องกด "ขอแก้ไข" -> แอดมิน/บัญชีอนุมัติคำขอ -> จึงแก้ได้
--   - แก้ส่วนไหน ส่วนนั้นกลับเป็น "รอตรวจสอบ" ส่วนที่ไม่ได้แก้คงสถานะเดิม
--   - แก้รายการเบิก: ของเดิมคืนเข้าคลัง ของใหม่ตัดตอนบัญชีอนุมัติ
--   - รายการเดิมไม่ถูกลบ เก็บไว้เป็นประวัติ "แก้ไขแล้ว"
--   - เบิกจาก OPD (บิลใหม่/พ่วง) ตัดสต็อกตอนอนุมัติ เหมือนใบเบิก
--
-- วิธีใช้: copy ทั้งหมด วางใน SQL Editor ของ Supabase (โปรเจกต์ส่วนขยาย) แล้วกด Run  รันซ้ำได้
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('private.stock_approve_row(uuid,uuid,text)') is null then
    raise exception 'กรุณารันไฟล์ 02 ก่อนไฟล์นี้';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1) ปรับข้อมูลเก่าตามที่เห็นจากไฟล์ 00
-- ------------------------------------------------------------
-- The old approval never credited the destination branch of a transfer.
update public.stock_logs set dest_applied = false
where move_type = 'TRANSFER' and audit_status = 'อนุมัติแล้ว' and dest_applied is null;
-- The old reject always gave the stock back.
update public.stock_logs set stock_applied = false
where audit_status = 'ตีกลับ' and stock_applied is null;

-- ------------------------------------------------------------
-- 2) คอลัมน์ใหม่: เก็บประวัติรายการที่ถูกแก้ + ข้อมูลการขายที่เดิมหายไป
-- ------------------------------------------------------------
alter table public.bill_services
  add column if not exists is_superseded boolean not null default false,
  add column if not exists superseded_at timestamptz;
alter table public.bill_sales
  add column if not exists is_superseded boolean not null default false,
  add column if not exists superseded_at timestamptz,
  add column if not exists new_price numeric,
  add column if not exists pay_type text,
  add column if not exists installment_no text,
  add column if not exists commission_base_manual boolean not null default false,
  add column if not exists commission_note text;
alter table public.bill_supplies
  add column if not exists is_superseded boolean not null default false,
  add column if not exists superseded_at timestamptz,
  add column if not exists program_id uuid references public.programs(id),
  add column if not exists stock_log_id uuid references public.stock_logs(id);
alter table public.stock_logs
  add column if not exists superseded_at timestamptz;

create table if not exists public.bill_edit_requests (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id),
  requested_by uuid not null references public.users(id),
  reason text not null,
  status text not null default 'รออนุมัติ' check (status in ('รออนุมัติ', 'อนุมัติแล้ว', 'ไม่อนุมัติ', 'ใช้แล้ว')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists bill_edit_requests_open_uidx
  on public.bill_edit_requests (bill_id, requested_by) where status in ('รออนุมัติ', 'อนุมัติแล้ว');
create index if not exists bill_edit_requests_status_idx on public.bill_edit_requests (status, created_at);
alter table public.bill_edit_requests enable row level security;
revoke all on public.bill_edit_requests from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) ฟังก์ชันภายใน
-- ------------------------------------------------------------
-- OPD rows can now be rolled back too (edit or revert returns the stock).
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

-- Insert services / sales / supplies of one OPD submission. Supplies are NOT cut here (cut at approval).
create or replace function private.opd_insert_lines(
  p_bill_id uuid, p_branch_id uuid, p_hn text, p_payload jsonb, p_actor uuid, p_note_prefix text,
  p_services boolean, p_sales boolean, p_supplies boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_item jsonb;
  v_program_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_log_id uuid;
  v_has_commission boolean := false;
begin
  if p_services then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'services', '[]'::jsonb)) loop
      select id into v_program_id from public.programs where code = v_item->>'program_code' and is_active = true;
      if v_program_id is null then
        raise exception 'UNKNOWN_PROGRAM' using errcode = '22023', detail = coalesce(v_item->>'program_code', '');
      end if;
      insert into public.bill_services (bill_id, program_id, price, commission, created_by)
      values (p_bill_id, v_program_id, coalesce(nullif(v_item->>'price', '')::numeric, 0),
              coalesce(nullif(v_item->>'commission', '')::numeric, 0), p_actor);
      v_has_commission := v_has_commission or coalesce(nullif(v_item->>'commission', '')::numeric, 0) > 0;
    end loop;
  end if;

  if p_sales then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'sales', '[]'::jsonb)) loop
      insert into public.bill_sales (bill_id, sale_type, old_program_name, old_price, new_program_name, new_price,
        pay_type, installment_no, amount_paid, commission_base, commission_pct, commission_amt,
        commission_base_manual, commission_note, created_by)
      values (p_bill_id, v_item->>'type', v_item->>'old_program', coalesce(nullif(v_item->>'old_price', '')::numeric, 0),
        v_item->>'new_program', nullif(v_item->>'new_price', '')::numeric, nullif(v_item->>'pay_type', ''),
        nullif(v_item->>'installment_no', ''), coalesce(nullif(v_item->>'amount_paid', '')::numeric, 0),
        coalesce(nullif(v_item->>'commission_base', '')::numeric, 0), coalesce(nullif(v_item->>'commission_pct', '')::numeric, 0),
        coalesce(nullif(v_item->>'commission_amt', '')::numeric, 0), coalesce((v_item->>'commission_base_manual')::boolean, false),
        nullif(v_item->>'commission_note', ''), p_actor);
      v_has_commission := v_has_commission or coalesce(nullif(v_item->>'commission_amt', '')::numeric, 0) > 0;
    end loop;
  end if;

  if p_supplies then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'supplies', '[]'::jsonb)) loop
      select id into v_product_id from public.products where code = v_item->>'product_code' and is_active = true;
      if v_product_id is null then
        raise exception 'UNKNOWN_PRODUCT' using errcode = '22023', detail = coalesce(v_item->>'product_code', '');
      end if;
      v_qty := nullif(v_item->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 or v_qty > 100000 then
        raise exception 'INVALID_QTY' using errcode = '22023', detail = coalesce(v_item->>'product_code', '');
      end if;
      insert into public.stock_logs (opd_bill_id, branch_id, product_id, direction, move_type, qty, note, created_by,
                                     audit_status, source, log_date, stock_applied, dest_applied)
      values (p_bill_id, p_branch_id, v_product_id, 'OUT', 'OUT', round(v_qty, 3),
              p_note_prefix || ' (HN: ' || coalesce(p_hn, '-') || ')', p_actor, 'รอตรวจสอบ', 'ห้องตรวจ',
              (select bill_date from public.bills where id = p_bill_id), false, false)
      returning id into v_log_id;
      insert into public.bill_supplies (bill_id, product_id, qty, created_by, program_id, stock_log_id)
      values (p_bill_id, v_product_id, round(v_qty, 3), p_actor,
              (select id from public.programs where code = v_item->>'program_code'), v_log_id);
    end loop;
  end if;
  return v_has_commission;
end;
$$;

create or replace function private.create_opd_bill_v2(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_bill_id uuid;
  v_branch_id uuid;
  v_deposit_id uuid;
  v_date date := nullif(p_payload->>'date', '')::date;
  v_item jsonb;
begin
  select id into v_branch_id from public.branches where name = p_payload->>'branch_name';
  if v_branch_id is null then raise exception 'UNKNOWN_BRANCH' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_payload->>'hn', '')), '') is null or nullif(trim(coalesce(p_payload->>'customer_name', '')), '') is null then
    raise exception 'HN_AND_CUSTOMER_REQUIRED' using errcode = '22023';
  end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'INVALID_DATE' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payload->'services', '[]'::jsonb)) + jsonb_array_length(coalesce(p_payload->'sales', '[]'::jsonb)) = 0 then
    raise exception 'EMPTY_BILL' using errcode = '22023';
  end if;

  insert into public.bills (hn, customer_name, bill_date, branch_id, status, commission_status, created_by)
  values (trim(p_payload->>'hn'), trim(p_payload->>'customer_name'), v_date, v_branch_id, 'รอตรวจสอบ', 'รอตรวจสอบ', p_actor)
  returning id into v_bill_id;
  perform private.opd_insert_lines(v_bill_id, v_branch_id, trim(p_payload->>'hn'), p_payload, p_actor, 'เบิกจาก OPD', true, true, true);
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb)) loop
    insert into public.bill_images (bill_id, file_url, file_name) values (v_bill_id, v_item->>'data', v_item->>'name');
  end loop;

  v_deposit_id := nullif(p_payload->>'linked_deposit_id', '')::uuid;
  if v_deposit_id is not null then
    update public.deposits set linked_bill_id = v_bill_id, payment_status = 'เชื่อม OPD แล้ว', updated_at = now()
    where id = v_deposit_id and branch_id = v_branch_id and payment_status = 'ยืนยันแล้ว' and linked_bill_id is null;
    if not found then raise exception 'ยอดมัดจำนี้ไม่พร้อมเชื่อม หรือถูกเชื่อมไปแล้ว'; end if;
  end if;
  return v_bill_id;
end;
$$;

create or replace function private.append_opd_bill_v2(p_actor uuid, p_bill_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_bill public.bills%rowtype;
  v_item jsonb;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then raise exception 'ไม่พบ OPD ที่เลือก'; end if;
  if v_bill.bill_date < (now() at time zone 'Asia/Bangkok')::date - 7 then raise exception 'พ่วงได้เฉพาะ OPD ภายใน 7 วัน'; end if;
  -- Appended commission lines put the commission part back into the queue (same as before).
  if private.opd_insert_lines(p_bill_id, v_bill.branch_id, v_bill.hn, p_payload, p_actor, 'เบิกจาก OPD พ่วง', true, true, true) then
    update public.bills set status = 'รอตรวจสอบ', commission_status = 'รอตรวจสอบ', commission_audit_by = null,
      commission_audit_date = null, commission_audit_note = null where id = p_bill_id;
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb)) loop
    insert into public.bill_images (bill_id, file_url, file_name) values (p_bill_id, v_item->>'data', v_item->>'name');
  end loop;
  return p_bill_id;
end;
$$;

-- What the actor may change on a bill right now.
create or replace function private.opd_edit_state(p_bill_id uuid, p_actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'commission_locked', b.commission_status = 'อนุมัติแล้ว',
    'supplies_locked', exists (select 1 from public.stock_logs sl where sl.opd_bill_id = b.id and sl.superseded_at is null
                                 and sl.audit_status = 'อนุมัติแล้ว' and sl.created_by = p_actor),
    'has_own_lines', b.created_by = p_actor
       or exists (select 1 from public.bill_services s where s.bill_id = b.id and s.created_by = p_actor and not s.is_superseded)
       or exists (select 1 from public.bill_sales s where s.bill_id = b.id and s.created_by = p_actor and not s.is_superseded)
       or exists (select 1 from public.bill_supplies s where s.bill_id = b.id and s.created_by = p_actor and not s.is_superseded),
    'request_status', (select r.status from public.bill_edit_requests r where r.bill_id = b.id and r.requested_by = p_actor
                         and r.status in ('รออนุมัติ', 'อนุมัติแล้ว') order by r.created_at desc limit 1),
    'last_request', (select jsonb_build_object('status', r.status, 'reason', r.reason, 'decision_note', r.decision_note, 'created_at', r.created_at)
                     from public.bill_edit_requests r where r.bill_id = b.id and r.requested_by = p_actor order by r.created_at desc limit 1)
  )
  from public.bills b where b.id = p_bill_id;
$$;

-- Edit the actor's own lines of a bill. Each part that changes goes back to "รอตรวจสอบ"; the other part keeps its status.
create or replace function private.edit_opd_bill(p_actor uuid, p_bill_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_bill public.bills%rowtype;
  v_state jsonb;
  v_edit_commission boolean := coalesce((p_payload->>'edit_commission')::boolean, false);
  v_edit_supplies boolean := coalesce((p_payload->>'edit_supplies')::boolean, false);
  v_need_request boolean;
  v_request_id uuid;
  v_date date;
  v_log record;
  v_item jsonb;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND' using errcode = '22023'; end if;
  v_state := private.opd_edit_state(p_bill_id, p_actor);
  if not (v_state->>'has_own_lines')::boolean then
    raise exception 'NOT_YOUR_BILL' using errcode = '42501', hint = 'แก้ไขได้เฉพาะรายการที่ตัวเองบันทึก';
  end if;
  if not v_edit_commission and not v_edit_supplies and p_payload->'images' is null then
    raise exception 'NOTHING_TO_EDIT' using errcode = '22023';
  end if;

  v_need_request := (v_edit_commission and (v_state->>'commission_locked')::boolean)
                 or (v_edit_supplies and (v_state->>'supplies_locked')::boolean);
  if v_need_request then
    select id into v_request_id from public.bill_edit_requests
    where bill_id = p_bill_id and requested_by = p_actor and status = 'อนุมัติแล้ว'
    order by decided_at desc limit 1 for update;
    if v_request_id is null then
      raise exception 'EDIT_REQUEST_REQUIRED' using errcode = '42501', hint = 'ส่วนนี้อนุมัติแล้ว ต้องกดขอแก้ไขและรอแอดมิน/บัญชีอนุมัติก่อน';
    end if;
    update public.bill_edit_requests set status = 'ใช้แล้ว', used_at = now() where id = v_request_id;
  end if;

  -- Header (HN / name / date) belongs to the bill owner and travels with the commission part.
  if v_edit_commission and v_bill.created_by = p_actor then
    v_date := coalesce(nullif(p_payload->>'date', '')::date, v_bill.bill_date);
    if v_date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'INVALID_DATE' using errcode = '22023'; end if;
    update public.bills
    set hn = coalesce(nullif(trim(coalesce(p_payload->>'hn', '')), ''), hn),
        customer_name = coalesce(nullif(trim(coalesce(p_payload->>'customer_name', '')), ''), customer_name),
        bill_date = v_date
    where id = p_bill_id
    returning * into v_bill;
  end if;

  if v_edit_commission then
    update public.bill_services set is_superseded = true, superseded_at = now()
    where bill_id = p_bill_id and created_by = p_actor and not is_superseded;
    update public.bill_sales set is_superseded = true, superseded_at = now()
    where bill_id = p_bill_id and created_by = p_actor and not is_superseded;
    perform private.opd_insert_lines(p_bill_id, v_bill.branch_id, v_bill.hn, p_payload, p_actor, 'เบิกจาก OPD', true, true, false);
    update public.bills
    set status = 'รอตรวจสอบ', commission_status = 'รอตรวจสอบ', commission_audit_by = null,
        commission_audit_date = null, commission_audit_note = null
    where id = p_bill_id;
    insert into public.audit_logs (action, target_type, target_id, audit_by, old_status, new_status, note)
    values ('แก้ไขบิล', 'commission', p_bill_id, p_actor, v_bill.commission_status, 'รอตรวจสอบ', 'แก้ไขค่ามือ/ค่าคอม');
  end if;

  if v_edit_supplies then
    -- Old lines give their stock back and stay as history; new lines are cut when accounting approves.
    for v_log in select id, audit_status from public.stock_logs
                 where opd_bill_id = p_bill_id and created_by = p_actor and superseded_at is null
                 for update loop
      if v_log.audit_status in ('รอตรวจสอบ', 'อนุมัติแล้ว') then
        perform private.stock_unapply(v_log.id);
        update public.stock_logs
        set audit_status = 'ตีกลับ', erp_sync_status = 'ไม่ต้องส่ง', audited_by = p_actor, audited_at = now(),
            audit_note = 'แทนที่ด้วยการแก้ไขบิล'
        where id = v_log.id;
      end if;
      update public.stock_logs set superseded_at = now() where id = v_log.id;
    end loop;
    update public.bill_supplies set is_superseded = true, superseded_at = now()
    where bill_id = p_bill_id and created_by = p_actor and not is_superseded;
    perform private.opd_insert_lines(p_bill_id, v_bill.branch_id, v_bill.hn, p_payload, p_actor, 'เบิกจาก OPD (แก้ไข)', false, false, true);
    insert into public.audit_logs (action, target_type, target_id, audit_by, old_status, new_status, note)
    values ('แก้ไขบิล', 'opd_stock_request', p_bill_id, p_actor, null, 'รอตรวจสอบ', 'แก้ไขรายการเบิก');
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb)) loop
    insert into public.bill_images (bill_id, file_url, file_name) values (p_bill_id, v_item->>'data', v_item->>'name');
  end loop;

  return private.opd_edit_state(p_bill_id, p_actor);
end;
$$;

create or replace function private.request_bill_edit(p_actor uuid, p_bill_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_state jsonb; v_id uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023', hint = 'กรุณาระบุเหตุผลที่ขอแก้ไข';
  end if;
  v_state := private.opd_edit_state(p_bill_id, p_actor);
  if v_state is null then raise exception 'BILL_NOT_FOUND' using errcode = '22023'; end if;
  if not (v_state->>'has_own_lines')::boolean then raise exception 'NOT_YOUR_BILL' using errcode = '42501'; end if;
  if not ((v_state->>'commission_locked')::boolean or (v_state->>'supplies_locked')::boolean) then
    raise exception 'EDIT_WITHOUT_REQUEST' using errcode = '22023', hint = 'บิลนี้ยังไม่อนุมัติ แก้ไขได้เลยไม่ต้องขอ';
  end if;
  if v_state->>'request_status' is not null then
    raise exception 'REQUEST_ALREADY_OPEN' using errcode = '22023', hint = 'มีคำขอแก้ไขบิลนี้ค้างอยู่แล้ว';
  end if;
  insert into public.bill_edit_requests (bill_id, requested_by, reason) values (p_bill_id, p_actor, trim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.decide_bill_edit_request(p_actor uuid, p_request_id uuid, p_approve boolean, p_note text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_n integer;
begin
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023', hint = 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;
  update public.bill_edit_requests
  set status = case when p_approve then 'อนุมัติแล้ว' else 'ไม่อนุมัติ' end,
      decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_request_id and status = 'รออนุมัติ';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.audit_logs (action, target_type, target_id, audit_by, old_status, new_status, note)
    select case when p_approve then 'อนุมัติคำขอแก้ไข' else 'ไม่อนุมัติคำขอแก้ไข' end, 'bill_edit_request', bill_id, p_actor,
           'รออนุมัติ', status, decision_note
    from public.bill_edit_requests where id = p_request_id;
  end if;
  return v_n;
end;
$$;

create or replace function private.list_bill_edit_requests(p_status text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select r.id, r.bill_id, r.reason, r.status, r.created_at, r.decided_at, r.decision_note,
           u.name as requested_by_name, d.name as decided_by_name,
           b.hn, b.customer_name, b.bill_date, br.name as branch_name, b.commission_status,
           exists (select 1 from public.stock_logs sl where sl.opd_bill_id = b.id and sl.superseded_at is null
                   and sl.audit_status = 'อนุมัติแล้ว' and sl.created_by = r.requested_by) as supplies_approved
    from public.bill_edit_requests r
    join public.bills b on b.id = r.bill_id
    left join public.branches br on br.id = b.branch_id
    left join public.users u on u.id = r.requested_by
    left join public.users d on d.id = r.decided_by
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit 300
  ) x;
$$;

create or replace function private.audit_opd_stock_request_v2(p_bill_id uuid, p_status text, p_actor uuid, p_note text, p_from_approved boolean)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v_id uuid; v_n integer := 0;
begin
  if p_status not in ('อนุมัติแล้ว', 'ตีกลับ') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  if p_from_approved and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023', hint = 'กรุณาระบุเหตุผลที่ถอยการอนุมัติ';
  end if;
  for v_id in select id from public.stock_logs
              where opd_bill_id = p_bill_id and superseded_at is null
                and audit_status = case when p_from_approved then 'อนุมัติแล้ว' else 'รอตรวจสอบ' end
              order by created_at, id loop
    if p_status = 'อนุมัติแล้ว' and not p_from_approved then
      if private.stock_approve_row(v_id, p_actor, p_note) then v_n := v_n + 1; end if;
    else
      if private.stock_send_back_row(v_id, p_actor, p_note, p_from_approved) then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function private.opd_insert_lines(uuid, uuid, text, jsonb, uuid, text, boolean, boolean, boolean) from public;
revoke all on function private.create_opd_bill_v2(uuid, jsonb) from public;
revoke all on function private.append_opd_bill_v2(uuid, uuid, jsonb) from public;
revoke all on function private.opd_edit_state(uuid, uuid) from public;
revoke all on function private.edit_opd_bill(uuid, uuid, jsonb) from public;
revoke all on function private.request_bill_edit(uuid, uuid, text) from public;
revoke all on function private.decide_bill_edit_request(uuid, uuid, boolean, text) from public;
revoke all on function private.list_bill_edit_requests(text) from public;
revoke all on function private.audit_opd_stock_request_v2(uuid, text, uuid, text, boolean) from public;

-- ------------------------------------------------------------
-- 4) ฟังก์ชันที่หน้าเว็บอ่าน: แสดงเฉพาะรายการปัจจุบัน (รายการที่ถูกแก้แล้วเก็บเป็นประวัติ)
-- ------------------------------------------------------------
create or replace function public.get_bill_detail(p_bill_id uuid)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'bill', (select row_to_json(x) from (select b.id, b.hn, b.customer_name, b.bill_date, br.name branch_name, u.name created_by_name,
      b.created_by, b.status, b.commission_status, b.audit_note, b.commission_audit_note
      from public.bills b left join public.branches br on br.id = b.branch_id left join public.users u on u.id = b.created_by where b.id = p_bill_id) x),
    'services', (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) from
      (select bs.id, bs.price, bs.commission, p.name program_name, p.code program_code, bs.created_by, u.name created_by_name, bs.created_at
       from public.bill_services bs left join public.programs p on p.id = bs.program_id left join public.users u on u.id = bs.created_by
       where bs.bill_id = p_bill_id and not bs.is_superseded) x),
    'sales', (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) from
      (select bs.id, bs.sale_type, bs.old_program_name, bs.old_price, bs.new_program_name, bs.new_price, bs.pay_type, bs.installment_no,
       bs.amount_paid, bs.commission_base, bs.commission_pct, bs.commission_amt, bs.commission_base_manual, bs.commission_note,
       bs.created_by, u.name created_by_name, bs.created_at
       from public.bill_sales bs left join public.users u on u.id = bs.created_by
       where bs.bill_id = p_bill_id and not bs.is_superseded) x),
    'supplies', (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) from
      (select bs.id, p.code product_code, p.name product_name, p.category, bs.qty, p.unit, pg.code program_code, pg.name program_name,
       bs.created_by, u.name created_by_name, bs.created_at, sl.audit_status stock_status
       from public.bill_supplies bs left join public.products p on p.id = bs.product_id left join public.programs pg on pg.id = bs.program_id
       left join public.users u on u.id = bs.created_by left join public.stock_logs sl on sl.id = bs.stock_log_id
       where bs.bill_id = p_bill_id and not bs.is_superseded) x),
    'images', (select coalesce(jsonb_agg(row_to_json(i) order by i.uploaded_at), '[]'::jsonb) from public.bill_images i where i.bill_id = p_bill_id),
    'deposit', (select row_to_json(x) from (select d.id, d.deposit_no, d.deposit_amount, d.commission_amt, d.commission_status, u.name created_by_name
      from public.deposits d left join public.users u on u.id = d.created_by where d.linked_bill_id = p_bill_id order by d.created_at limit 1) x),
    'history', jsonb_build_object(
      'services', (select coalesce(jsonb_agg(jsonb_build_object('program_name', p.name, 'price', bs.price, 'commission', bs.commission,
                     'superseded_at', bs.superseded_at) order by bs.superseded_at), '[]'::jsonb)
                   from public.bill_services bs left join public.programs p on p.id = bs.program_id where bs.bill_id = p_bill_id and bs.is_superseded),
      'sales', (select coalesce(jsonb_agg(jsonb_build_object('sale_type', bs.sale_type, 'new_program_name', bs.new_program_name,
                  'commission_amt', bs.commission_amt, 'superseded_at', bs.superseded_at) order by bs.superseded_at), '[]'::jsonb)
                from public.bill_sales bs where bs.bill_id = p_bill_id and bs.is_superseded),
      'supplies', (select coalesce(jsonb_agg(jsonb_build_object('product_name', p.name, 'qty', bs.qty, 'unit', p.unit,
                     'superseded_at', bs.superseded_at) order by bs.superseded_at), '[]'::jsonb)
                   from public.bill_supplies bs left join public.products p on p.id = bs.product_id where bs.bill_id = p_bill_id and bs.is_superseded))
  );
$$;

create or replace function public.get_pending_opd_stock_requests()
returns table(bill_id uuid, bill_date date, branch_name text, hn text, customer_name text, program_summary text, supply_count bigint, created_by_name text, audit_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select b.id, b.bill_date, br.name, b.hn, b.customer_name,
    coalesce((select string_agg(p.name, ', ' order by p.name) from bill_services bs join programs p on p.id = bs.program_id
              where bs.bill_id = b.id and not bs.is_superseded), '-'),
    count(sl.id), u.name, 'รอตรวจสอบ'::text
  from bills b
  join stock_logs sl on sl.opd_bill_id = b.id and sl.audit_status = 'รอตรวจสอบ' and sl.superseded_at is null
  left join branches br on br.id = b.branch_id
  left join users u on u.id = b.created_by
  group by b.id, b.bill_date, br.name, b.hn, b.customer_name, u.name
  order by min(sl.created_at);
end;
$$;

-- "สรุปยอดของฉัน": staff see only their own lines (someone who appended to your bill does not add to your total),
-- with program names, % and the edit state of each bill.
create or replace function public.arana_my_bills(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_actor record;
  v_mine boolean;
  v_bills jsonb; v_services jsonb; v_sales jsonb;
  v_ids uuid[];
begin
  select * into v_actor from private.require_app_session(p_session_token);
  v_mine := coalesce(v_actor.role, '') not in ('Admin', 'Audit', 'CommissionAudit', 'StockAudit', 'Manager');

  select coalesce(array_agg(b.id), '{}') into v_ids
  from public.bills b
  where (not v_mine)
     or b.created_by = v_actor.user_id
     or exists (select 1 from public.bill_services s where s.bill_id = b.id and s.created_by = v_actor.user_id)
     or exists (select 1 from public.bill_sales s where s.bill_id = b.id and s.created_by = v_actor.user_id)
     or exists (select 1 from public.bill_supplies s where s.bill_id = b.id and s.created_by = v_actor.user_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'hn', b.hn, 'customerName', b.customer_name,
           'date', to_char(b.bill_date, 'YYYY-MM-DD'), 'branch', br.name,
           'status', b.status, 'commissionStatus', b.commission_status, 'createdBy', b.created_by,
           'createdAt', b.created_at, 'auditNote', coalesce(b.commission_audit_note, b.audit_note),
           'stockStatus', (select case when count(*) = 0 then null
                                       when bool_or(sl.audit_status = 'รอตรวจสอบ') then 'รอตรวจสอบ'
                                       when bool_and(sl.audit_status = 'อนุมัติแล้ว') then 'อนุมัติแล้ว'
                                       else 'ตีกลับ' end
                           from public.stock_logs sl where sl.opd_bill_id = b.id and sl.superseded_at is null),
           'editState', private.opd_edit_state(b.id, v_actor.user_id)
         ) order by b.bill_date desc, b.created_at desc), '[]'::jsonb)
    into v_bills
  from public.bills b
  left join public.branches br on br.id = b.branch_id
  where b.id = any(v_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'billId', s.bill_id, 'price', s.price, 'commission', s.commission,
           'programCode', p.code, 'programName', p.name, 'createdBy', s.created_by)), '[]'::jsonb)
    into v_services
  from public.bill_services s left join public.programs p on p.id = s.program_id
  where s.bill_id = any(v_ids) and not s.is_superseded and (not v_mine or s.created_by = v_actor.user_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'billId', s.bill_id, 'type', lower(s.sale_type), 'oldProgram', s.old_program_name, 'oldPrice', s.old_price,
           'newProgram', s.new_program_name, 'newPrice', s.new_price, 'payType', s.pay_type, 'installmentNo', s.installment_no,
           'amountPaid', s.amount_paid, 'commissionBase', s.commission_base, 'commissionPct', s.commission_pct,
           'commissionAmt', s.commission_amt, 'commissionBaseManual', s.commission_base_manual, 'commissionNote', s.commission_note,
           'createdBy', s.created_by)), '[]'::jsonb)
    into v_sales
  from public.bill_sales s
  where s.bill_id = any(v_ids) and not s.is_superseded and (not v_mine or s.created_by = v_actor.user_id);

  return jsonb_build_object('bills', v_bills, 'services', v_services, 'sales', v_sales);
end;
$$;

-- ------------------------------------------------------------
-- 5) ประตูหลัก arana_app_rpc (ชุดเต็ม: งานจากไฟล์ 02 + OPD) ที่เหลือส่งต่อให้ของเดิม
-- ------------------------------------------------------------
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
  v_allowed boolean;
  v_n integer;
begin
  if p_action not in ('save_stock_request', 'audit_stock_request', 'audit_stock_log', 'revert_stock_request',
                      'get_stock_movement_v2', 'get_weekly_count', 'save_weekly_count',
                      'create_opd_bill', 'append_opd_bill', 'edit_opd_bill', 'request_bill_edit',
                      'list_bill_edit_requests', 'decide_bill_edit_request',
                      'audit_opd_stock_request', 'revert_opd_stock_request') then
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
    v_week := date_trunc('week', coalesce(nullif(v_payload->>'p_week_start', '')::date,
                                          (now() at time zone 'Asia/Bangkok')::date))::date;
    if p_action = 'save_weekly_count' then
      perform private.save_weekly_count(v_actor.user_id, v_branch_id, v_week, v_payload->'p_items');
    end if;
    return jsonb_build_object('week_start', v_week,
      'items', private.get_weekly_count(v_branch_id, v_week, v_actor.role <> 'Frontdesk'));

  elsif p_action = 'create_opd_bill' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'OnlineSales', 'Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload#>>'{p_payload,branch_name}');
    return to_jsonb(private.create_opd_bill_v2(v_actor.user_id, v_payload->'p_payload'));

  elsif p_action = 'append_opd_bill' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'OnlineSales', 'Admin']);
    select exists (select 1 from public.bills b left join public.branches br on br.id = b.branch_id
                   where b.id = (v_payload->>'p_bill_id')::uuid
                     and (v_actor.role in ('Audit', 'Admin') or br.name = v_actor.branch_name)) into v_allowed;
    if not v_allowed then raise exception 'FORBIDDEN_RECORD' using errcode = '42501'; end if;
    return to_jsonb(private.append_opd_bill_v2(v_actor.user_id, (v_payload->>'p_bill_id')::uuid, v_payload->'p_payload'));

  elsif p_action = 'edit_opd_bill' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'OnlineSales', 'Admin']);
    return private.edit_opd_bill(v_actor.user_id, (v_payload->>'p_bill_id')::uuid, v_payload->'p_payload');

  elsif p_action = 'request_bill_edit' then
    perform private.require_role(v_actor.role, array['Frontdesk', 'Audit', 'OnlineSales', 'Admin']);
    return to_jsonb(private.request_bill_edit(v_actor.user_id, (v_payload->>'p_bill_id')::uuid, v_payload->>'p_reason'));

  elsif p_action = 'list_bill_edit_requests' then
    perform private.require_role(v_actor.role, array['Admin', 'Audit', 'CommissionAudit', 'StockAudit']);
    return private.list_bill_edit_requests(nullif(v_payload->>'p_status', ''));

  elsif p_action = 'decide_bill_edit_request' then
    perform private.require_role(v_actor.role, array['Admin', 'Audit', 'CommissionAudit', 'StockAudit']);
    v_n := private.decide_bill_edit_request(v_actor.user_id, (v_payload->>'p_request_id')::uuid,
      coalesce((v_payload->>'p_approve')::boolean, false), v_payload->>'p_note');
    return jsonb_build_object('affected', v_n);

  elsif p_action in ('audit_opd_stock_request', 'revert_opd_stock_request') then
    perform private.require_role(v_actor.role, array['Audit', 'StockAudit', 'Admin']);
    v_n := private.audit_opd_stock_request_v2((v_payload->>'p_bill_id')::uuid,
      case when p_action = 'revert_opd_stock_request' then 'ตีกลับ' else v_payload->>'p_status' end,
      v_actor.user_id, nullif(v_payload->>'p_note', ''), p_action = 'revert_opd_stock_request');
    return jsonb_build_object('affected', v_n);
  end if;

  raise exception 'UNKNOWN_ACTION' using errcode = '22023';
end;
$$;

revoke all on function public.arana_app_rpc(text, text, jsonb) from public;
grant execute on function public.arana_app_rpc(text, text, jsonb) to anon, authenticated;

-- The browser no longer calls these directly; everything goes through arana_app_rpc.
revoke all on function public.create_opd_bill(jsonb) from public, anon, authenticated;
revoke all on function public.append_opd_bill(uuid, jsonb) from public, anon, authenticated;

commit;

-- ตรวจผล (ดูอย่างเดียว)
select 'คำขอแก้ไขบิล' as "รายการ", count(*)::text as "จำนวน" from public.bill_edit_requests
union all
select 'OPD เบิกรอตรวจ (ยังไม่ตัดสต็อก/ตัดแล้วแบบเดิม)', count(*)::text from public.stock_logs
where opd_bill_id is not null and audit_status = 'รอตรวจสอบ';
