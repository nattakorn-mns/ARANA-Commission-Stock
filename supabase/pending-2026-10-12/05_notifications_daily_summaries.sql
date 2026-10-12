-- ============================================================
-- แจ้งเตือน Telegram / LINE + สรุปรายวันอัตโนมัติ + ป้าย "ส่งช้า"
-- สร้างเมื่อ 12/10/2569  (ต้องรันไฟล์ 02 และ 04 ของรอบ 26/09 ก่อน)
--
-- สิ่งที่ไฟล์นี้ทำ
--   1) ตารางตั้งค่าห้องแจ้งเตือน (notify_channels) — ตั้งจากหน้าแอดมิน ไม่มีคีย์ลับในตารางนี้
--   2) คิวข้อความ (notify_queue) — ทุกข้อความมีสถานะ รอส่ง/ส่งแล้ว/ส่งไม่สำเร็จ ดูย้อนหลังได้
--   3) ส่งทันที: ค่าคอมทีละรายการ (Telegram), มัดจำ+รูป (LINE), ตีกลับ/ถอยการอนุมัติ (Telegram)
--   4) สรุปอัตโนมัติ: สต็อก 23:00 (LINE 2 ห้อง), ค่ามือ/ค่าคอมรายคน 23:59 (Telegram),
--      ฉบับเพิ่มเติม 06:00 เฉพาะรายการส่งช้า/แก้ไขหลังสรุป
--   5) ป้าย "ส่งช้า" = บันทึกหลังเที่ยงคืนของวันที่ให้บริการ (ยึดวันที่ให้บริการ ไม่ใช่เวลากดส่ง)
--
-- ตัวส่งจริง = Edge Function "notify-dispatch" (คีย์ Telegram/LINE เก็บเป็น secret ฝั่งเซิร์ฟเวอร์)
-- pg_cron เรียก Edge Function ตามเวลา (เวลาไทย) — ต้องตั้งค่า 2 อย่างหลังรัน (ดูท้ายไฟล์)
-- รันซ้ำได้
-- ============================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- 1) ห้องแจ้งเตือน
-- ------------------------------------------------------------
create table if not exists public.notify_channels (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                 -- รหัสห้องที่โค้ดอ้างถึง เช่น tg_upsell_items
  label text not null,                      -- ชื่อที่แสดงในหน้าตั้งค่า
  provider text not null check (provider in ('telegram', 'line')),
  secret_name text not null,                -- ชื่อ secret ใน Edge Function ที่เก็บ token ของห้องนี้
  target_id text,                           -- Telegram chat id / LINE group id (ไม่ใช่คีย์ลับ)
  branch_name text,                         -- ห้องเฉพาะสาขา (null = ทุกสาขา)
  is_active boolean not null default true,
  monthly_quota integer,                    -- LINE ฟรี 200/เดือน; null = ไม่จำกัด (Telegram)
  updated_at timestamptz not null default now()
);
alter table public.notify_channels enable row level security;
revoke all on public.notify_channels from public, anon, authenticated;

insert into public.notify_channels (key, label, provider, secret_name, branch_name, monthly_quota) values
  ('tg_upsell_items',   'Telegram: อัพเซล/ขายเพิ่ม รายลูกค้า',        'telegram', 'TG_BOT_TOKEN', null, null),
  ('tg_daily_summary',  'Telegram: สรุปรายงานอัพเซลและค่ามือ',        'telegram', 'TG_BOT_TOKEN', null, null),
  ('line_stock_out',    'LINE: เบิก / โอนออก (รวมทุกสาขา)',            'line', 'LINE_TOKEN_STOCK_OUT', null, 200),
  ('line_stock_in',     'LINE: รับเข้า / รับโอน (รวมทุกสาขา)',         'line', 'LINE_TOKEN_STOCK_IN',  null, 200),
  ('line_deposit_pl',   'LINE: มัดจำ พิษณุโลก',                        'line', 'LINE_TOKEN_DEP_PL', 'พิษณุโลก', 200),
  ('line_deposit_kp',   'LINE: มัดจำ กำแพงเพชร',                       'line', 'LINE_TOKEN_DEP_KP', 'กำแพงเพชร', 200),
  ('line_deposit_ms',   'LINE: มัดจำ แม่สอด',                          'line', 'LINE_TOKEN_DEP_MS', 'แม่สอด', 200),
  ('line_deposit_ns',   'LINE: มัดจำ นครสวรรค์',                       'line', 'LINE_TOKEN_DEP_NS', 'นครสวรรค์', 200)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2) คิวข้อความ
-- ------------------------------------------------------------
create table if not exists public.notify_queue (
  id uuid primary key default gen_random_uuid(),
  channel_key text not null references public.notify_channels(key),
  kind text not null,                       -- upsell_item / deposit / rejected / stock_daily / staff_daily / staff_addendum
  dedupe_key text unique,                   -- กันส่งซ้ำ เช่น 'staff_daily:พิษณุโลก:2026-10-12'
  text_body text not null,
  image_url text,                           -- มัดจำ: รูปสลิป (LINE ส่งเป็นข้อความเดียวพร้อมรูป)
  status text not null default 'รอส่ง' check (status in ('รอส่ง', 'ส่งแล้ว', 'ส่งไม่สำเร็จ', 'ข้าม')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notify_queue_pending_idx on public.notify_queue (status, created_at) where status = 'รอส่ง';
create index if not exists notify_queue_channel_month_idx on public.notify_queue (channel_key, sent_at);
alter table public.notify_queue enable row level security;
revoke all on public.notify_queue from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) ป้าย "ส่งช้า" + เวลาที่สรุปครั้งล่าสุดครอบคลุม
-- ------------------------------------------------------------
alter table public.bills add column if not exists submitted_late boolean not null default false;
alter table public.deposits add column if not exists submitted_late boolean not null default false;
-- ใช้ตัดสินว่ารายการไหน "มาหลังสรุป 23:59" → เข้าฉบับเพิ่มเติม 06:00
create table if not exists public.notify_summary_marks (
  kind text not null,
  branch_name text not null,
  for_date date not null,
  covered_until timestamptz not null,
  primary key (kind, branch_name, for_date)
);
alter table public.notify_summary_marks enable row level security;
revoke all on public.notify_summary_marks from public, anon, authenticated;

create or replace function private.bkk_now() returns timestamptz
language sql stable as $$ select now() $$;
create or replace function private.bkk_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- บันทึกหลังเที่ยงคืนของวันที่ให้บริการ = ส่งช้า
create or replace function private.flag_late_bill() returns trigger
language plpgsql set search_path = pg_catalog, public, private as $$
begin
  if new.bill_date < private.bkk_today() then new.submitted_late := true; end if;
  return new;
end $$;
drop trigger if exists bills_flag_late on public.bills;
create trigger bills_flag_late before insert on public.bills for each row execute function private.flag_late_bill();

create or replace function private.flag_late_deposit() returns trigger
language plpgsql set search_path = pg_catalog, public, private as $$
begin
  if new.deposit_date < private.bkk_today() then new.submitted_late := true; end if;
  return new;
end $$;
drop trigger if exists deposits_flag_late on public.deposits;
create trigger deposits_flag_late before insert on public.deposits for each row execute function private.flag_late_deposit();

-- ------------------------------------------------------------
-- 4) ตัวช่วยจัดรูปแบบ
-- ------------------------------------------------------------
create or replace function private.fmt_baht(n numeric) returns text
language sql immutable as $$
  select case when n is null then '0'
              when n = trunc(n) then to_char(n, 'FM999,999,999,990')
              else to_char(n, 'FM999,999,999,990.00') end
$$;
create or replace function private.fmt_dmy(d date) returns text
language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;

create or replace function private.notify_enqueue(p_channel text, p_kind text, p_dedupe text, p_text text, p_image text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.notify_channels where key = p_channel and is_active) then return null; end if;
  insert into public.notify_queue (channel_key, kind, dedupe_key, text_body, image_url)
  values (p_channel, p_kind, p_dedupe, p_text, p_image)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------
-- 5) ส่งทันที: ค่าคอมทีละรายการ / มัดจำ / ตีกลับ-ถอยการอนุมัติ
-- ------------------------------------------------------------
create or replace function private.notify_upsell_item() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare b record; v_kind text; v_who text;
begin
  select bl.hn, bl.customer_name, bl.bill_date, bl.submitted_late, br.name as branch into b
  from public.bills bl left join public.branches br on br.id = bl.branch_id where bl.id = new.bill_id;
  select coalesce(nickname, name) into v_who from public.users where id = new.created_by;
  v_kind := case new.sale_type when 'upsell' then 'อัพเซล' when 'crosssell' then 'ขายเพิ่ม' else 'ขายสินค้า' end;
  perform private.notify_enqueue('tg_upsell_items', 'upsell_item', 'upsell_item:' || new.id,
    format(E'🛍 %s — %s (%s)\nลูกค้า: %s %s\nโปรแกรม: %s\nยอดเต็ม %s บาท = ค่าคอม %s บาท\nวันที่ให้บริการ %s%s',
      v_kind, coalesce(v_who, '-'), coalesce(b.branch, '-'), coalesce(b.hn, ''), coalesce(b.customer_name, '-'),
      coalesce(new.new_program_name, '-'), private.fmt_baht(new.amount_paid), private.fmt_baht(new.commission_amt),
      private.fmt_dmy(b.bill_date), case when b.submitted_late then E'\n⏰ ส่งช้า (หลังเที่ยงคืน)' else '' end));
  return new;
end $$;
drop trigger if exists bill_sales_notify on public.bill_sales;
create trigger bill_sales_notify after insert on public.bill_sales for each row execute function private.notify_upsell_item();

create or replace function private.notify_deposit() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_branch text; v_who text; v_channel text; v_img text;
begin
  select name into v_branch from public.branches where id = new.branch_id;
  select coalesce(nickname, name) into v_who from public.users where id = new.created_by;
  select key into v_channel from public.notify_channels where provider = 'line' and key like 'line_deposit_%' and branch_name = v_branch and is_active limit 1;
  if v_channel is null then return new; end if;
  -- รูปแรกที่แนบ (ต้องเป็นลิงก์ https; ถ้าเป็นข้อมูลรูปฝังมาจะส่งเฉพาะข้อความ)
  select file_url into v_img from public.deposit_images where deposit_id = new.id and file_url like 'https://%' order by uploaded_at limit 1;
  perform private.notify_enqueue(v_channel, 'deposit', 'deposit:' || new.id,
    format(E'💰 มัดจำ %s — %s\nลูกค้า: %s%s\nโปรแกรม: %s\nยอดมัดจำ %s บาท (ราคาเต็ม %s)\nช่องทาง: %s · รับเข้า: %s\nวันรับเงิน %s · นัด %s\nโดย %s%s',
      new.deposit_no, coalesce(v_branch, '-'), new.customer_name, case when new.customer_phone <> '' then ' ' || new.customer_phone else '' end,
      coalesce(new.program_name, '-'), private.fmt_baht(new.deposit_amount), private.fmt_baht(new.package_price),
      coalesce(new.channel, '-'), coalesce(new.payment_method, '-'), private.fmt_dmy(new.deposit_date),
      coalesce(private.fmt_dmy(new.appointment_date), '-'), coalesce(v_who, '-'),
      case when new.submitted_late then E'\n⏰ ส่งช้า' else '' end), v_img);
  return new;
end $$;
drop trigger if exists deposits_notify on public.deposits;
create trigger deposits_notify after insert on public.deposits for each row execute function private.notify_deposit();

-- ตีกลับ / ถอยการอนุมัติ (บิล, มัดจำ, ใบเบิก) → Telegram ห้องสรุป
create or replace function private.notify_rejected() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_who text; v_label text; v_note text; v_branch text;
begin
  if tg_table_name = 'bills' then
    if not (new.commission_status = 'ตีกลับ' and old.commission_status is distinct from 'ตีกลับ') then return new; end if;
    select coalesce(nickname, name) into v_who from public.users where id = new.created_by;
    select name into v_branch from public.branches where id = new.branch_id;
    v_label := format('บิล OPD %s %s (%s)', coalesce(new.hn, ''), new.customer_name, private.fmt_dmy(new.bill_date));
    v_note := coalesce(new.commission_audit_note, new.audit_note, '-');
  elsif tg_table_name = 'deposits' then
    if not (new.payment_status = 'ตีกลับ' and old.payment_status is distinct from 'ตีกลับ') then return new; end if;
    select coalesce(nickname, name) into v_who from public.users where id = new.created_by;
    select name into v_branch from public.branches where id = new.branch_id;
    v_label := format('มัดจำ %s %s', new.deposit_no, new.customer_name);
    v_note := coalesce(new.audit_note, '-');
  else
    if not (new.audit_status = 'ตีกลับ' and old.audit_status is distinct from 'ตีกลับ') then return new; end if;
    if new.opd_bill_id is not null then return new; end if;  -- เบิกจาก OPD แจ้งผ่านบิลอยู่แล้ว
    select coalesce(nickname, name) into v_who from public.users where id = new.created_by;
    select name into v_branch from public.branches where id = new.branch_id;
    v_label := format('ใบเบิก/โอน %s', coalesce(new.request_id::text, new.id::text));
    v_note := coalesce(new.audit_note, '-');
    -- ใบเดียวหลายบรรทัด แจ้งครั้งเดียว
    if exists (select 1 from public.notify_queue where dedupe_key = 'rejected:req:' || coalesce(new.request_id::text, new.id::text)) then return new; end if;
    perform private.notify_enqueue('tg_daily_summary', 'rejected', 'rejected:req:' || coalesce(new.request_id::text, new.id::text),
      format(E'↩️ ตีกลับ — %s\n%s\nผู้บันทึก: %s\nเหตุผล: %s\nกรุณาแก้ไขแล้วส่งใหม่ในระบบส่วนขยาย', coalesce(v_branch, '-'), v_label, coalesce(v_who, '-'), v_note));
    return new;
  end if;
  perform private.notify_enqueue('tg_daily_summary', 'rejected', 'rejected:' || tg_table_name || ':' || new.id || ':' || extract(epoch from now())::bigint,
    format(E'↩️ ตีกลับ — %s\n%s\nผู้บันทึก: %s\nเหตุผล: %s\nกรุณาแก้ไขแล้วส่งใหม่ในระบบส่วนขยาย', coalesce(v_branch, '-'), v_label, coalesce(v_who, '-'), v_note));
  return new;
end $$;
drop trigger if exists bills_notify_rejected on public.bills;
create trigger bills_notify_rejected after update on public.bills for each row execute function private.notify_rejected();
drop trigger if exists deposits_notify_rejected on public.deposits;
create trigger deposits_notify_rejected after update on public.deposits for each row execute function private.notify_rejected();
drop trigger if exists stock_logs_notify_rejected on public.stock_logs;
create trigger stock_logs_notify_rejected after update on public.stock_logs for each row execute function private.notify_rejected();

-- ------------------------------------------------------------
-- 6) สรุปค่ามือ/ค่าคอม รายคน 23:59 (ต่อสาขา 1 ข้อความ) + ฉบับเพิ่มเติม 06:00
-- ------------------------------------------------------------
-- ยอดของแต่ละคนในวันที่ให้บริการ; p_since ไม่ null = เฉพาะรายการที่เกิด/แก้หลังเวลานั้น (ฉบับเพิ่มเติม)
create or replace function private.staff_daily_rows(p_date date, p_branch text, p_since timestamptz default null)
returns table(staff text, fee numeric, upsell_full numeric, upsell_amt numeric, cross_full numeric, cross_amt numeric,
              product_full numeric, product_amt numeric, late_count bigint, item_count bigint)
language sql stable security definer set search_path = pg_catalog, public, private as $$
  with sv as (
    select s.created_by, s.commission, b.submitted_late, greatest(s.created_at, coalesce(s.superseded_at, s.created_at)) as ts
    from public.bill_services s join public.bills b on b.id = s.bill_id join public.branches br on br.id = b.branch_id
    where b.bill_date = p_date and br.name = p_branch and not s.is_superseded
  ), sl as (
    select s.created_by, s.sale_type, s.amount_paid, s.commission_amt, b.submitted_late, s.created_at as ts
    from public.bill_sales s join public.bills b on b.id = s.bill_id join public.branches br on br.id = b.branch_id
    where b.bill_date = p_date and br.name = p_branch and not s.is_superseded
  ), allrows as (
    select created_by, 'fee' as k, commission as amt, 0::numeric as full_amt, submitted_late, ts from sv
    union all
    select created_by, sale_type, commission_amt, amount_paid, submitted_late, ts from sl
  )
  select coalesce(u.nickname, u.name, '-') as staff,
         sum(case when k = 'fee' then amt else 0 end),
         sum(case when k = 'upsell' then full_amt else 0 end), sum(case when k = 'upsell' then amt else 0 end),
         sum(case when k = 'crosssell' then full_amt else 0 end), sum(case when k = 'crosssell' then amt else 0 end),
         sum(case when k = 'product' then full_amt else 0 end), sum(case when k = 'product' then amt else 0 end),
         count(*) filter (where submitted_late), count(*)
  from allrows a left join public.users u on u.id = a.created_by
  where p_since is null or a.ts > p_since
  group by 1 order by 1;
$$;

create or replace function private.staff_daily_text(p_date date, p_branch text, p_since timestamptz, p_title text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare r record; v text := ''; v_total numeric := 0; v_n int := 0;
begin
  for r in select * from private.staff_daily_rows(p_date, p_branch, p_since) loop
    v_n := v_n + 1;
    v_total := v_total + r.fee + r.upsell_amt + r.cross_amt + r.product_amt;
    v := v || format(E'\n%s (%s)%s\nค่ามือ: %s\nอัพเซล: ยอดเต็ม %s = %s\nขายเพิ่ม: ยอดเต็ม %s = %s\nขายสินค้า: ยอดเต็ม %s = %s\nรวมได้: %s\n',
      r.staff, p_branch, case when r.late_count > 0 then ' ⏰ ส่งช้า ' || r.late_count || ' รายการ' else '' end,
      private.fmt_baht(r.fee), private.fmt_baht(r.upsell_full), private.fmt_baht(r.upsell_amt),
      private.fmt_baht(r.cross_full), private.fmt_baht(r.cross_amt), private.fmt_baht(r.product_full), private.fmt_baht(r.product_amt),
      private.fmt_baht(r.fee + r.upsell_amt + r.cross_amt + r.product_amt));
  end loop;
  if v_n = 0 then return null; end if;
  return format(E'📊 %s — %s · %s\n%s\nรวมทั้งสาขา %s บาท (%s คน) · ตรวจรายละเอียดได้ที่ระบบส่วนขยาย',
    p_title, p_branch, private.fmt_dmy(p_date), v, private.fmt_baht(v_total), v_n);
end $$;

-- 23:59 สรุปของ "วันนี้" ทุกสาขาที่มีรายการ
create or replace function public.notify_build_staff_daily(p_date date default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare d date := coalesce(p_date, private.bkk_today()); br record; t text; n int := 0;
begin
  for br in select name from public.branches where is_active order by name loop
    t := private.staff_daily_text(d, br.name, null, 'สรุปค่ามือ/ค่าคอมรายวัน');
    if t is not null then
      if private.notify_enqueue('tg_daily_summary', 'staff_daily', 'staff_daily:' || br.name || ':' || d, t) is not null then n := n + 1; end if;
    end if;
    insert into public.notify_summary_marks (kind, branch_name, for_date, covered_until) values ('staff_daily', br.name, d, now())
    on conflict (kind, branch_name, for_date) do update set covered_until = excluded.covered_until;
  end loop;
  return n;
end $$;

-- 06:00 ฉบับเพิ่มเติมของ "เมื่อวาน": เฉพาะรายการที่มาหลังสรุป 23:59 (ส่งช้า/แก้ไข)
create or replace function public.notify_build_staff_addendum(p_date date default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare d date := coalesce(p_date, private.bkk_today() - 1); br record; t text; n int := 0; v_since timestamptz;
begin
  for br in select name from public.branches where is_active order by name loop
    select covered_until into v_since from public.notify_summary_marks where kind = 'staff_daily' and branch_name = br.name and for_date = d;
    if v_since is null then continue; end if;
    t := private.staff_daily_text(d, br.name, v_since, 'ฉบับเพิ่มเติม (ส่งช้า/แก้ไขหลังสรุป)');
    if t is not null then
      if private.notify_enqueue('tg_daily_summary', 'staff_addendum', 'staff_addendum:' || br.name || ':' || d || ':' || to_char(now(), 'HH24'), t) is not null then n := n + 1; end if;
      update public.notify_summary_marks set covered_until = now() where kind = 'staff_daily' and branch_name = br.name and for_date = d;
    end if;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------
-- 7) สรุปสต็อก 23:00 → LINE 2 ห้อง (เบิก/โอนออก และ รับเข้า/รับโอน) ข้อความละ 1 ห้อง แยกบรรทัดตามสาขา
-- ------------------------------------------------------------
create or replace function private.stock_daily_text(p_date date, p_out boolean)
returns text language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare r record; v text := ''; v_lines int := 0; v_cur text := '';
begin
  for r in
    select br.name as branch, tb.name as to_branch, sl.move_type, p.name as product, p.unit, sl.qty, sl.audit_status, sl.source,
           coalesce(u.nickname, u.name) as who
    from public.stock_logs sl
    join public.branches br on br.id = sl.branch_id
    left join public.branches tb on tb.id = sl.to_branch_id
    left join public.products p on p.id = sl.product_id
    left join public.users u on u.id = sl.created_by
    where sl.log_date = p_date and sl.opd_bill_id is null and sl.superseded_at is null
      and ((p_out and sl.move_type in ('OUT', 'TRANSFER')) or (not p_out and sl.move_type = 'IN'))
    order by br.name, sl.move_type, sl.created_at
  loop
    v_lines := v_lines + 1;
    if r.branch <> v_cur then v := v || E'\n▪ ' || r.branch || E'\n'; v_cur := r.branch; end if;
    v := v || format(E'  %s %s %s %s%s · %s · %s\n',
      case r.move_type when 'OUT' then 'เบิก' when 'TRANSFER' then 'โอนไป ' || coalesce(r.to_branch, '?') else 'รับเข้า' end,
      coalesce(r.product, '-'), private.fmt_baht(r.qty), coalesce(r.unit, ''),
      case when r.move_type = 'OUT' and r.source is not null then ' (' || r.source || ')' else '' end,
      coalesce(r.who, '-'), r.audit_status);
  end loop;
  if v_lines = 0 then return null; end if;
  return format(E'📦 %s — %s (%s รายการ)\n%s\nสถานะ "รอตรวจสอบ" = ยังไม่ตัด/เพิ่มสต็อก จนกว่าบัญชีอนุมัติ',
    case when p_out then 'สรุปเบิก/โอนออก ประจำวัน' else 'สรุปรับเข้า/รับโอน ประจำวัน' end, private.fmt_dmy(p_date), v_lines, v);
end $$;

create or replace function public.notify_build_stock_daily(p_date date default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare d date := coalesce(p_date, private.bkk_today()); t text; n int := 0;
begin
  t := private.stock_daily_text(d, true);
  if t is not null and private.notify_enqueue('line_stock_out', 'stock_daily', 'stock_out:' || d, t) is not null then n := n + 1; end if;
  t := private.stock_daily_text(d, false);
  if t is not null and private.notify_enqueue('line_stock_in', 'stock_daily', 'stock_in:' || d, t) is not null then n := n + 1; end if;
  return n;
end $$;

-- ------------------------------------------------------------
-- 8) ฟังก์ชันที่ Edge Function ใช้ (service_role เท่านั้น)
-- ------------------------------------------------------------
-- ดึงข้อความรอส่ง (ล็อกไว้ 2 นาที) พร้อมข้อมูลห้องและโควตาที่ใช้ไปเดือนนี้
create or replace function public.notify_claim_pending(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v jsonb;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  with picked as (
    select q.id from public.notify_queue q
    where q.status = 'รอส่ง' and q.attempts < 5 and (q.sent_at is null or q.sent_at < now() - interval '2 minutes')
    order by q.created_at limit p_limit for update skip locked
  ), upd as (
    update public.notify_queue q set attempts = q.attempts + 1, sent_at = now()
    from picked where q.id = picked.id returning q.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'kind', u.kind, 'text', u.text_body, 'image_url', u.image_url,
    'provider', c.provider, 'secret_name', c.secret_name, 'target_id', c.target_id, 'channel_key', c.key,
    'monthly_quota', c.monthly_quota,
    'used_this_month', (select count(*) from public.notify_queue x where x.channel_key = c.key and x.status = 'ส่งแล้ว'
                        and x.sent_at >= date_trunc('month', private.bkk_today())::timestamptz))), '[]'::jsonb)
  into v from upd u join public.notify_channels c on c.key = u.channel_key;
  return v;
end $$;

create or replace function public.notify_mark(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.notify_queue
  set status = case when p_ok then 'ส่งแล้ว' when attempts >= 5 then 'ส่งไม่สำเร็จ' else 'รอส่ง' end,
      sent_at = case when p_ok then now() else sent_at end,
      last_error = case when p_ok then null else left(p_error, 500) end
  where id = p_id;
end $$;

revoke all on function public.notify_claim_pending(integer) from public, anon, authenticated;
revoke all on function public.notify_mark(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.notify_build_staff_daily(date) from public, anon, authenticated;
revoke all on function public.notify_build_staff_addendum(date) from public, anon, authenticated;
revoke all on function public.notify_build_stock_daily(date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 9) หน้าแอดมิน: ดูห้อง/ตั้ง target id/เปิด-ปิด + ดูคิวข้อความ + ลองส่ง
-- ------------------------------------------------------------
create or replace function public.admin_notify_channels(p_session_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record; v jsonb;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin']);
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'provider', c.provider, 'secret_name', c.secret_name,
    'target_id', c.target_id, 'branch_name', c.branch_name, 'is_active', c.is_active, 'monthly_quota', c.monthly_quota,
    'used_this_month', (select count(*) from public.notify_queue x where x.channel_key = c.key and x.status = 'ส่งแล้ว'
                        and x.sent_at >= date_trunc('month', private.bkk_today())::timestamptz),
    'pending', (select count(*) from public.notify_queue x where x.channel_key = c.key and x.status = 'รอส่ง'),
    'failed', (select count(*) from public.notify_queue x where x.channel_key = c.key and x.status = 'ส่งไม่สำเร็จ')
  ) order by c.provider, c.key), '[]'::jsonb) into v from public.notify_channels c;
  return v;
end $$;

create or replace function public.admin_notify_set_channel(p_session_token text, p_key text, p_target_id text, p_is_active boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin']);
  update public.notify_channels set target_id = nullif(trim(coalesce(p_target_id, '')), ''), is_active = coalesce(p_is_active, true), updated_at = now()
  where key = p_key;
end $$;

create or replace function public.admin_notify_queue(p_session_token text, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record; v jsonb;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin', 'Audit']);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select q.id, q.channel_key, q.kind, q.status, q.attempts, q.last_error, q.created_at, q.sent_at, left(q.text_body, 160) as preview
    from public.notify_queue q order by q.created_at desc limit least(coalesce(p_limit, 100), 300)) x;
  return v;
end $$;

-- ปุ่ม "ทดสอบส่ง" และ "สร้างสรุปตอนนี้" ของแอดมิน
create or replace function public.admin_notify_test(p_session_token text, p_key text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin']);
  return private.notify_enqueue(p_key, 'test', null, format(E'✅ ทดสอบการแจ้งเตือนจากระบบส่วนขยาย\nห้อง: %s\nเวลา: %s', p_key, to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')));
end $$;

create or replace function public.admin_notify_build(p_session_token text, p_kind text, p_date date default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin']);
  return case p_kind
    when 'staff_daily' then public.notify_build_staff_daily(p_date)
    when 'staff_addendum' then public.notify_build_staff_addendum(p_date)
    when 'stock_daily' then public.notify_build_stock_daily(p_date)
    else 0 end;
end $$;

grant execute on function public.admin_notify_channels(text) to anon, authenticated;
grant execute on function public.admin_notify_set_channel(text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_notify_queue(text, integer) to anon, authenticated;
grant execute on function public.admin_notify_test(text, text) to anon, authenticated;
grant execute on function public.admin_notify_build(text, text, date) to anon, authenticated;

-- ------------------------------------------------------------
-- 10) ตั้งเวลา (pg_cron ใช้เวลา UTC: ไทย 23:00 = 16:00 UTC, 23:59 = 16:59 UTC, 06:00 = 23:00 UTC วันก่อน)
--     ตัวส่ง (Edge Function) ถูกเรียกทุก 2 นาที เฉพาะเมื่อมีข้อความรอส่ง
--     ค่า URL/คีย์ของ Edge Function ตั้งครั้งเดียวด้วยคำสั่งท้ายไฟล์ (ข้อ ก)
-- ------------------------------------------------------------
create or replace function private.notify_dispatch_call()
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from public.notify_queue where status = 'รอส่ง' and attempts < 5) then return; end if;
  select value into v_url from private.app_config where key = 'notify_dispatch_url';
  select value into v_key from private.app_config where key = 'notify_dispatch_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
                        body := '{}'::jsonb, timeout_milliseconds := 20000);
end $$;

create table if not exists private.app_config (key text primary key, value text not null);
revoke all on private.app_config from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('notify_dispatch', 'notify_staff_daily', 'notify_staff_addendum', 'notify_stock_daily');
exception when others then null; end $$;
select cron.schedule('notify_dispatch',       '*/2 * * * *', $$select private.notify_dispatch_call()$$);
select cron.schedule('notify_stock_daily',    '0 16 * * *',  $$select public.notify_build_stock_daily()$$);
select cron.schedule('notify_staff_daily',    '59 16 * * *', $$select public.notify_build_staff_daily()$$);
select cron.schedule('notify_staff_addendum', '0 23 * * *',  $$select public.notify_build_staff_addendum()$$);

commit;

-- ============================================================
-- หลังรัน ต้องทำ 2 อย่าง (ครั้งเดียว) — คุณออมทำเอง Claude ไม่เห็นคีย์
-- ก) ใส่ URL และคีย์ของ Edge Function (ได้จากหน้า Edge Functions ของ Supabase หลัง deploy "notify-dispatch")
--    insert into private.app_config (key, value) values
--      ('notify_dispatch_url', 'https://<project-ref>.supabase.co/functions/v1/notify-dispatch'),
--      ('notify_dispatch_key', '<service_role key>')
--    on conflict (key) do update set value = excluded.value;
-- ข) ใส่ token ของบอทเป็น Secret ของ Edge Function (Settings → Edge Functions → Secrets):
--    TG_BOT_TOKEN, LINE_TOKEN_STOCK_OUT, LINE_TOKEN_STOCK_IN, LINE_TOKEN_DEP_PL, LINE_TOKEN_DEP_KP, LINE_TOKEN_DEP_MS, LINE_TOKEN_DEP_NS
-- แล้วใส่ "ไอดีห้อง" (Telegram chat id / LINE group id) ในหน้าแอดมิน → แท็บ แจ้งเตือน
-- ============================================================
select jobname, schedule from cron.job where jobname like 'notify_%' order by jobname;
