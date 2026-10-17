-- ============================================================
-- ดึงข้อมูลจาก ERP อัตโนมัติ (อ่านอย่างเดียว ผ่าน ext_read_pull ของ ERP)  สร้าง 12/10/2569  รันซ้ำได้
--
-- ทุกเช้า 05:00 (และกดปุ่ม "ดึงจาก ERP ตอนนี้" ในหน้าแอดมินได้):
--   employees      → สร้าง/อัปเดต/ปิดบัญชีผู้ใช้ตามกติกา 4 ข้อ (คุณออม 12/10)
--   stock_items    → อัปเดตรายชื่อสินค้า
--   stock_balance, open_purchase_orders, service_commissions, deposits → เก็บสำเนาไว้ใช้ "ตรวจเทียบ" เท่านั้น
-- ส่วนขยายไม่เขียนอะไรกลับเข้า ERP
-- ตัวดึงจริงคือ Edge Function "erp-pull" (คีย์ ERP อยู่ใน Secrets ของฟังก์ชัน ไม่อยู่ในฐานข้อมูล/เบราว์เซอร์)
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists private.app_config (key text primary key, value text not null);
revoke all on private.app_config from public, anon, authenticated;

-- จุดที่ดึงถึงล่าสุดของแต่ละชุดข้อมูล
create table if not exists private.erp_sync_state (
  dataset text primary key,
  since timestamptz,
  after_id uuid,
  last_run_at timestamptz,
  last_count integer,
  last_error text
);
revoke all on private.erp_sync_state from public, anon, authenticated;

alter table public.users add column if not exists erp_emp_code text, add column if not exists erp_synced_at timestamptz;
create unique index if not exists users_erp_emp_code_uidx on public.users (erp_emp_code) where erp_emp_code is not null;
alter table public.products
  add column if not exists erp_item_id uuid,
  add column if not exists erp_legacy_sku text,
  add column if not exists lot_controlled boolean not null default false,
  add column if not exists expiry_controlled boolean not null default false,
  add column if not exists erp_synced_at timestamptz;

-- สำเนาข้อมูล ERP สำหรับตรวจเทียบ (อ่านอย่างเดียวในส่วนขยาย)
create table if not exists public.erp_stock_balance (
  sku text primary key, erp_item_id uuid, qty_by_branch jsonb not null default '{}'::jsonb, as_of timestamptz, pulled_at timestamptz not null default now());
create table if not exists public.erp_open_purchase_orders (
  id uuid primary key, po_number text, branch text, order_date date, expected_date date, status text, vendor text,
  items jsonb not null default '[]'::jsonb, updated_at timestamptz, pulled_at timestamptz not null default now());
create table if not exists public.erp_service_commissions (
  id uuid primary key, service_date date, branch text, customer_hn text, service_name text, doctor_name text, doctor_amount numeric,
  staff_commissions jsonb, total_staff_amount numeric, receipt_id uuid, queue_entry_id uuid, deposit_id uuid,
  updated_at timestamptz, pulled_at timestamptz not null default now());
create index if not exists erp_service_commissions_date_idx on public.erp_service_commissions (service_date, branch);
create table if not exists public.erp_deposits (
  id uuid primary key, receipt_no text, received_date date, branch text, customer_name text, customer_hn text, amount numeric,
  pay_method text, channel_id uuid, status text, created_by uuid, sales_staff jsonb, updated_at timestamptz, pulled_at timestamptz not null default now());
create index if not exists erp_deposits_date_idx on public.erp_deposits (received_date, branch);
alter table public.erp_stock_balance enable row level security;
alter table public.erp_open_purchase_orders enable row level security;
alter table public.erp_service_commissions enable row level security;
alter table public.erp_deposits enable row level security;
revoke all on public.erp_stock_balance, public.erp_open_purchase_orders, public.erp_service_commissions, public.erp_deposits from public, anon, authenticated;

-- เรียกด้วยสิทธิ์ service_role หรือไม่ (รองรับทั้งคีย์รูปแบบเก่า/ใหม่ของ Supabase)
create or replace function private.is_service_call()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role') = 'service_role'
         or session_user = 'postgres'
$$;

-- ชื่อสาขา ERP → ส่วนขยาย (ตัด "สาขา", Back Office/ไม่ระบุ → พิษณุโลก)
create or replace function private.erp_branch_name(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then 'พิษณุโลก'
    when btrim(regexp_replace(p, '^สาขา\s*', '')) ilike 'back office' then 'พิษณุโลก'
    else btrim(regexp_replace(p, '^สาขา\s*', '')) end
$$;

-- กติกาสิทธิ์ตามตำแหน่ง ERP (คุณออม 12/10)
create or replace function private.erp_position_role(p text)
returns table(role text, display_position text, create_account boolean)
language sql immutable as $$
  select
    case
      when p in ('แอดมิน', 'CRM') then 'OnlineSales'
      when p in ('บัญชี', 'การเงินและบัญชี', 'ผู้จัดการเขต') then 'Audit'
      when p in ('หัวหน้าฝ่ายปฏิบัติการ', 'กรรมการบริษัท') then 'Admin'
      else 'Frontdesk' end,
    case
      when p in ('หัวหน้าฝ่ายปฏิบัติการ', 'กรรมการบริษัท') then 'ผู้ดูแลระบบ'
      when p = 'ผู้จัดการเขต' then 'ผู้จัดการ'
      when p in ('บัญชี', 'การเงินและบัญชี') then 'บัญชี'
      when p in ('กราฟิก', 'แม่บ้าน') then 'พนักงานคลัง'
      else 'พนักงาน' end,
    coalesce(p, '') <> 'แพทย์'
$$;

-- ------------------------------------------------------------
-- รับข้อมูลหนึ่งหน้า (Edge Function เรียก, service_role เท่านั้น)
-- p_full_first = true เมื่อเป็นหน้าแรกของรอบนี้ (ชุดที่ ERP ส่งมาทั้งหมดทุกครั้ง คือ stock_balance / open_purchase_orders จะล้างของเก่าก่อน)
-- p_done = true เมื่อเป็นหน้าสุดท้าย → บันทึกจุดที่ดึงถึง
-- ------------------------------------------------------------
create or replace function public.erp_apply_page(p_dataset text, p_rows jsonb, p_full_first boolean, p_done boolean, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  r jsonb; n integer := 0; v_role record; v_branch uuid; v_last jsonb;
begin
  if not private.is_service_call() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_error is not null then
    insert into private.erp_sync_state (dataset, last_run_at, last_error) values (p_dataset, now(), left(p_error, 500))
    on conflict (dataset) do update set last_run_at = now(), last_error = left(p_error, 500);
    return 0;
  end if;

  if p_dataset = 'employees' then
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
      select * into v_role from private.erp_position_role(r->>'position');
      select id into v_branch from public.branches where name = private.erp_branch_name(r->>'branch');
      if exists (select 1 from public.users where erp_emp_code = r->>'emp_code') then
        update public.users
        set name = coalesce(r->>'full_name', name), nickname = coalesce(r->>'nickname', nickname),
            position = r->>'position', role = v_role.role, display_position = v_role.display_position,
            branch_id = coalesce(v_branch, branch_id),
            is_active = coalesce((r->>'active')::boolean, true) and v_role.create_account,
            erp_synced_at = now()
        where erp_emp_code = r->>'emp_code';
      elsif v_role.create_account and coalesce((r->>'active')::boolean, true) then
        insert into public.users (username, password_hash, name, nickname, role, branch_id, position, is_active, display_position, erp_emp_code, erp_synced_at)
        values (r->>'emp_code',
                extensions.crypt((r->>'emp_code') || '-' || coalesce(nullif(r->>'arana_time_code', ''), '000'), extensions.gen_salt('bf')),
                r->>'full_name', r->>'nickname', v_role.role, v_branch, r->>'position', true, v_role.display_position, r->>'emp_code', now())
        on conflict do nothing;
      end if;
      n := n + 1;
    end loop;

  elsif p_dataset = 'stock_items' then
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
      update public.products
      set name = r->>'name', unit = r->>'unit', category = r->>'category', erp_item_id = (r->>'id')::uuid,
          lot_controlled = coalesce((r->>'lot_controlled')::boolean, false), expiry_controlled = coalesce((r->>'expiry_controlled')::boolean, false),
          is_active = true, erp_synced_at = now()
      where code = r->>'sku';
      if not found then
        insert into public.products (code, name, unit, category, type, is_active, erp_item_id, lot_controlled, expiry_controlled, erp_synced_at)
        values (r->>'sku', r->>'name', r->>'unit', r->>'category',
                case when r->>'category' in ('อุปกรณ์', 'วิตามิน Mn (อุปกรณ์)', 'น้ำหอม', 'อื่นๆ') then 2 else 1 end,
                true, (r->>'id')::uuid, coalesce((r->>'lot_controlled')::boolean, false), coalesce((r->>'expiry_controlled')::boolean, false), now());
      end if;
      n := n + 1;
    end loop;

  elsif p_dataset = 'stock_balance' then
    if p_full_first then delete from public.erp_stock_balance; end if;
    insert into public.erp_stock_balance (sku, erp_item_id, qty_by_branch, as_of, pulled_at)
    select x->>'sku', (x->>'id')::uuid, coalesce(x->'qty_by_branch', '{}'::jsonb), (x->>'as_of')::timestamptz, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    on conflict (sku) do update set erp_item_id = excluded.erp_item_id, qty_by_branch = excluded.qty_by_branch, as_of = excluded.as_of, pulled_at = now();
    get diagnostics n = row_count;

  elsif p_dataset = 'open_purchase_orders' then
    if p_full_first then delete from public.erp_open_purchase_orders; end if;
    insert into public.erp_open_purchase_orders (id, po_number, branch, order_date, expected_date, status, vendor, items, updated_at, pulled_at)
    select (x->>'id')::uuid, x->>'po_number', private.erp_branch_name(x->>'branch'), (x->>'order_date')::date, (x->>'expected_date')::date,
           x->>'status', x->>'vendor', coalesce(x->'items', '[]'::jsonb), (x->>'updated_at')::timestamptz, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    on conflict (id) do update set po_number = excluded.po_number, branch = excluded.branch, order_date = excluded.order_date,
      expected_date = excluded.expected_date, status = excluded.status, vendor = excluded.vendor, items = excluded.items,
      updated_at = excluded.updated_at, pulled_at = now();
    get diagnostics n = row_count;

  elsif p_dataset = 'service_commissions' then
    insert into public.erp_service_commissions (id, service_date, branch, customer_hn, service_name, doctor_name, doctor_amount,
      staff_commissions, total_staff_amount, receipt_id, queue_entry_id, deposit_id, updated_at, pulled_at)
    select (x->>'id')::uuid, (x->>'service_date')::date, private.erp_branch_name(x->>'branch'), x->>'customer_hn', x->>'service_name',
           x->>'doctor_name', (x->>'doctor_amount')::numeric, x->'staff_commissions', (x->>'total_staff_amount')::numeric,
           (x->>'receipt_id')::uuid, (x->>'queue_entry_id')::uuid, (x->>'deposit_id')::uuid, (x->>'updated_at')::timestamptz, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    on conflict (id) do update set service_date = excluded.service_date, branch = excluded.branch, customer_hn = excluded.customer_hn,
      service_name = excluded.service_name, doctor_name = excluded.doctor_name, doctor_amount = excluded.doctor_amount,
      staff_commissions = excluded.staff_commissions, total_staff_amount = excluded.total_staff_amount, receipt_id = excluded.receipt_id,
      queue_entry_id = excluded.queue_entry_id, deposit_id = excluded.deposit_id, updated_at = excluded.updated_at, pulled_at = now();
    get diagnostics n = row_count;

  elsif p_dataset = 'deposits' then
    insert into public.erp_deposits (id, receipt_no, received_date, branch, customer_name, customer_hn, amount, pay_method, channel_id,
      status, created_by, sales_staff, updated_at, pulled_at)
    select (x->>'id')::uuid, x->>'receipt_no', (x->>'received_date')::date, private.erp_branch_name(x->>'branch'), x->>'customer_name',
           x->>'customer_hn', (x->>'amount')::numeric, x->>'pay_method', (x->>'channel_id')::uuid, x->>'status', (x->>'created_by')::uuid,
           x->'sales_staff', (x->>'updated_at')::timestamptz, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    on conflict (id) do update set receipt_no = excluded.receipt_no, received_date = excluded.received_date, branch = excluded.branch,
      customer_name = excluded.customer_name, customer_hn = excluded.customer_hn, amount = excluded.amount, pay_method = excluded.pay_method,
      channel_id = excluded.channel_id, status = excluded.status, created_by = excluded.created_by, sales_staff = excluded.sales_staff,
      updated_at = excluded.updated_at, pulled_at = now();
    get diagnostics n = row_count;
  else
    raise exception 'UNKNOWN_DATASET' using errcode = '22023';
  end if;

  -- จุดที่ดึงถึง = แถวสุดท้ายของหน้านี้ (ERP เรียงตาม updated_at, id) เฉพาะชุดที่ดึงแบบเฉพาะที่เปลี่ยน
  v_last := p_rows -> (jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) - 1);
  insert into private.erp_sync_state (dataset, since, after_id, last_run_at, last_count, last_error)
  values (p_dataset,
          case when p_dataset in ('stock_balance', 'open_purchase_orders') then null else (v_last->>'updated_at')::timestamptz end,
          case when p_dataset in ('stock_balance', 'open_purchase_orders') then null else (v_last->>'id')::uuid end,
          now(), n, null)
  on conflict (dataset) do update set
    since = coalesce(excluded.since, private.erp_sync_state.since),
    after_id = case when excluded.since is not null then excluded.after_id else private.erp_sync_state.after_id end,
    last_run_at = now(),
    last_count = case when p_full_first then excluded.last_count else coalesce(private.erp_sync_state.last_count, 0) + excluded.last_count end,
    last_error = null;
  return n;
end;
$$;

create or replace function public.erp_sync_cursor(p_dataset text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v jsonb;
begin
  if not private.is_service_call() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select jsonb_build_object('since', since, 'after_id', after_id) into v from private.erp_sync_state where dataset = p_dataset;
  return coalesce(v, jsonb_build_object('since', null, 'after_id', null));
end;
$$;

revoke all on function public.erp_apply_page(text, jsonb, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.erp_sync_cursor(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- เรียกตัวดึง (Edge Function) — ตั้งเวลา + ปุ่มแอดมิน
-- ------------------------------------------------------------
create or replace function private.erp_pull_call()
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_url text; v_key text;
begin
  select value into v_url from private.app_config where key = 'erp_pull_url';
  select value into v_key from private.app_config where key = 'erp_pull_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
                        body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;

create or replace function public.admin_erp_sync_status(p_session_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record; v jsonb;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin', 'Audit']);
  select jsonb_build_object(
    'configured', exists (select 1 from private.app_config where key = 'erp_pull_url') and exists (select 1 from private.app_config where key = 'erp_pull_key'),
    'datasets', coalesce((select jsonb_agg(jsonb_build_object('dataset', dataset, 'last_run_at', last_run_at, 'last_count', last_count,
                          'since', since, 'last_error', last_error) order by dataset) from private.erp_sync_state), '[]'::jsonb),
    'users_linked', (select count(*) from public.users where erp_emp_code is not null and is_active),
    'products_linked', (select count(*) from public.products where erp_synced_at is not null and is_active)
  ) into v;
  return v;
end $$;

create or replace function public.admin_erp_sync_now(p_session_token text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin']);
  perform private.erp_pull_call();
  return true;
end $$;

grant execute on function public.admin_erp_sync_status(text) to anon, authenticated;
grant execute on function public.admin_erp_sync_now(text) to anon, authenticated;

do $$ begin
  perform cron.unschedule(jobname) from cron.job where jobname = 'erp_pull_daily';
exception when others then null; end $$;
-- 05:00 เวลาไทย = 22:00 UTC ของวันก่อน
select cron.schedule('erp_pull_daily', '0 22 * * *', $cmd$select private.erp_pull_call()$cmd$);

-- รหัสลับระหว่างฐานข้อมูลกับตัวดึง (แทนคีย์ service_role) — สุ่มใหม่เฉพาะครั้งแรก รันซ้ำได้รหัสเดิม
insert into private.app_config (key, value) values ('erp_pull_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do update set value = case when length(private.app_config.value) = 48 then private.app_config.value else excluded.value end;

select (select schedule from cron.job where jobname = 'erp_pull_daily') as "ตั้งเวลา",
       (select value from private.app_config where key = 'erp_pull_key') as "ERP_PULL_TOKEN (ก็อปไปใส่ Secret ของ erp-pull)";
