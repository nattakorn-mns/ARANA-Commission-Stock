-- Shared OPD contributions and deposit payment verification.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'users_role_check' and conrelid = 'public.users'::regclass
  ) then
    alter table public.users drop constraint users_role_check;
  end if;
  alter table public.users add constraint users_role_check
    check (role = any (array['Admin','Audit','Frontdesk','CommissionAudit','StockAudit','OnlineSales']::text[]));
end $$;

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  deposit_no text not null unique,
  deposit_date date not null default current_date,
  branch_id uuid not null references public.branches(id),
  customer_name text not null,
  customer_phone text,
  hn text,
  channel text not null,
  program_id uuid references public.programs(id),
  program_name text not null,
  package_price numeric(12,2) not null default 0 check (package_price >= 0),
  deposit_amount numeric(12,2) not null check (deposit_amount > 0),
  payment_method text not null,
  payment_reference text,
  commission_pct numeric(7,4) not null default 0 check (commission_pct >= 0),
  commission_amt numeric(12,2) not null default 0 check (commission_amt >= 0),
  appointment_date date,
  note text,
  payment_status text not null default 'รอตรวจสอบ'
    check (payment_status in ('รอตรวจสอบ','ยืนยันแล้ว','ตีกลับ','เชื่อม OPD แล้ว','คืนบางส่วน','คืนเต็มจำนวน')),
  commission_status text not null default 'รอตรวจสอบ'
    check (commission_status in ('รอตรวจสอบ','ได้สิทธิ์แล้ว','ยกเลิก','ปรับลด')),
  created_by uuid not null references public.users(id),
  audited_by uuid references public.users(id),
  audited_at timestamptz,
  audit_note text,
  linked_bill_id uuid references public.bills(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deposit_images (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.deposits(id) on delete cascade,
  file_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);

create unique index if not exists deposits_branch_payment_reference_uidx
  on public.deposits (branch_id, payment_reference)
  where payment_reference is not null and payment_reference <> '';
create index if not exists deposits_pending_date_idx on public.deposits (payment_status, deposit_date, branch_id);
create index if not exists deposits_created_by_idx on public.deposits (created_by, created_at desc);
create index if not exists deposits_branch_id_idx on public.deposits (branch_id);
create index if not exists deposits_program_id_idx on public.deposits (program_id) where program_id is not null;
create index if not exists deposits_audited_by_idx on public.deposits (audited_by) where audited_by is not null;
create index if not exists deposits_linked_bill_idx on public.deposits (linked_bill_id) where linked_bill_id is not null;
create index if not exists deposit_images_deposit_id_idx on public.deposit_images (deposit_id);

alter table public.deposits enable row level security;
alter table public.deposit_images enable row level security;
revoke all on public.deposits, public.deposit_images from public, anon, authenticated;

create or replace function public.search_open_opd_bills(p_query text, p_branch_name text)
returns table(id uuid, hn text, customer_name text, bill_date date, branch_name text)
language sql
security definer
set search_path = public, extensions
as $$
  select b.id, b.hn, b.customer_name, b.bill_date, br.name
  from public.bills b
  join public.branches br on br.id = b.branch_id
  where br.name = p_branch_name
    and b.bill_date >= current_date - 7
    and (
      b.commission_status = 'รอตรวจสอบ'
      or exists (select 1 from public.stock_logs sl where sl.opd_bill_id = b.id and sl.audit_status = 'รอตรวจสอบ')
    )
    and (b.hn ilike '%' || trim(p_query) || '%' or b.customer_name ilike '%' || trim(p_query) || '%')
  order by b.bill_date desc, b.created_at desc
  limit 10;
$$;

create or replace function public.append_opd_bill(p_bill_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bill public.bills%rowtype;
  v_item jsonb;
  v_program_id uuid;
  v_product_id uuid;
  v_created_by uuid := (p_payload->>'created_by')::uuid;
  v_has_commission boolean := false;
begin
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then raise exception 'ไม่พบ OPD ที่เลือก'; end if;
  if not exists (select 1 from public.users where id = v_created_by and is_active = true) then
    raise exception 'ผู้บันทึกไม่มีสิทธิ์หรือถูกระงับการใช้งาน';
  end if;
  if v_bill.bill_date < current_date - 7 then raise exception 'พ่วงได้เฉพาะ OPD ภายใน 7 วัน'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'services', '[]'::jsonb)) loop
    select id into v_program_id from public.programs where code = v_item->>'program_code' and is_active = true;
    if v_program_id is null then raise exception 'ไม่พบโปรแกรม %', v_item->>'program_code'; end if;
    insert into public.bill_services (bill_id, program_id, price, commission, created_by)
    values (p_bill_id, v_program_id, coalesce((v_item->>'price')::numeric,0), coalesce((v_item->>'commission')::numeric,0), v_created_by);
    v_has_commission := v_has_commission or coalesce((v_item->>'commission')::numeric,0) > 0;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'sales', '[]'::jsonb)) loop
    insert into public.bill_sales (bill_id, sale_type, old_program_name, old_price, new_program_name, amount_paid, commission_base, commission_pct, commission_amt, created_by)
    values (p_bill_id, v_item->>'type', v_item->>'old_program', coalesce((v_item->>'old_price')::numeric,0), v_item->>'new_program',
      coalesce((v_item->>'amount_paid')::numeric,0), coalesce((v_item->>'commission_base')::numeric,0),
      coalesce((v_item->>'commission_pct')::numeric,0), coalesce((v_item->>'commission_amt')::numeric,0), v_created_by);
    v_has_commission := v_has_commission or coalesce((v_item->>'commission_amt')::numeric,0) > 0;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'supplies', '[]'::jsonb)) loop
    select id into v_product_id from public.products where code = v_item->>'product_code' and is_active = true;
    if v_product_id is null then raise exception 'ไม่พบสินค้า %', v_item->>'product_code'; end if;
    insert into public.bill_supplies (bill_id, product_id, qty, created_by)
    values (p_bill_id, v_product_id, (v_item->>'qty')::numeric, v_created_by);
    insert into public.stock_logs (opd_bill_id, branch_id, product_id, direction, move_type, qty, note, created_by, audit_status, source)
    values (p_bill_id, v_bill.branch_id, v_product_id, 'OUT', 'OUT', (v_item->>'qty')::numeric,
      'เบิกจาก OPD พ่วง (HN: ' || v_bill.hn || ')', v_created_by, 'รอตรวจสอบ', 'ห้องตรวจ');
    insert into public.branch_stock (branch_id, product_id, qty_on_hand)
    values (v_bill.branch_id, v_product_id, -1 * (v_item->>'qty')::numeric)
    on conflict (branch_id, product_id) do update
      set qty_on_hand = public.branch_stock.qty_on_hand - (v_item->>'qty')::numeric, updated_at = now();
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb)) loop
    insert into public.bill_images (bill_id, file_url, file_name) values (p_bill_id, v_item->>'data', v_item->>'name');
  end loop;

  if v_has_commission then
    update public.bills set status = 'รอตรวจสอบ', commission_status = 'รอตรวจสอบ', commission_audit_by = null,
      commission_audit_date = null, commission_audit_note = null where id = p_bill_id;
  end if;
  return p_bill_id;
end;
$$;

create or replace function public.create_deposit(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_branch_id uuid;
  v_program_id uuid;
  v_created_by uuid := (p_payload->>'created_by')::uuid;
  v_ref text := nullif(trim(p_payload->>'payment_reference'), '');
  v_item jsonb;
begin
  select id into v_branch_id from public.branches where name = p_payload->>'branch_name' and is_active = true;
  if v_branch_id is null then raise exception 'ไม่พบสาขา'; end if;
  if not exists (select 1 from public.users where id = v_created_by and is_active = true) then raise exception 'ผู้บันทึกไม่มีสิทธิ์'; end if;
  select id into v_program_id from public.programs where code = p_payload->>'program_code' and is_active = true;
  if v_program_id is null then raise exception 'ไม่พบโปรแกรม'; end if;
  if coalesce((p_payload->>'deposit_amount')::numeric,0) <= 0 then raise exception 'ยอดมัดจำต้องมากกว่า 0'; end if;
  if v_ref is not null and exists (select 1 from public.deposits where branch_id = v_branch_id and payment_reference = v_ref) then
    raise exception 'เลขใบเสร็จหรือเลขอ้างอิงนี้ถูกบันทึกแล้ว';
  end if;

  insert into public.deposits (id, deposit_no, deposit_date, branch_id, customer_name, customer_phone, hn, channel,
    program_id, program_name, package_price, deposit_amount, payment_method, payment_reference,
    commission_pct, commission_amt, appointment_date, note, created_by)
  values (v_id, 'DEP-' || to_char(coalesce((p_payload->>'deposit_date')::date,current_date),'YYMMDD') || '-' || upper(right(replace(v_id::text,'-',''),6)),
    coalesce((p_payload->>'deposit_date')::date,current_date), v_branch_id, trim(p_payload->>'customer_name'), nullif(trim(p_payload->>'customer_phone'),''),
    nullif(trim(p_payload->>'hn'),''), p_payload->>'channel', v_program_id, coalesce(nullif(p_payload->>'program_name',''),(select name from public.programs where id=v_program_id)),
    coalesce((p_payload->>'package_price')::numeric,0), (p_payload->>'deposit_amount')::numeric, p_payload->>'payment_method', v_ref,
    coalesce((p_payload->>'commission_pct')::numeric,0), round((p_payload->>'deposit_amount')::numeric * coalesce((p_payload->>'commission_pct')::numeric,0) / 100,2),
    nullif(p_payload->>'appointment_date','')::date, nullif(trim(p_payload->>'note'),''), v_created_by);

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images','[]'::jsonb)) loop
    insert into public.deposit_images (deposit_id,file_url,file_name) values (v_id,v_item->>'data',v_item->>'name');
  end loop;
  if not exists (select 1 from public.deposit_images where deposit_id=v_id) then raise exception 'กรุณาแนบหลักฐานอย่างน้อย 1 รูป'; end if;
  return v_id;
end;
$$;

create or replace function public.get_pending_deposits()
returns table(id uuid, deposit_no text, deposit_date date, branch_name text, customer_name text, customer_phone text,
  program_name text, deposit_amount numeric, commission_pct numeric, commission_amt numeric, created_by_name text)
language sql security definer set search_path = public, extensions
as $$
  select d.id,d.deposit_no,d.deposit_date,b.name,d.customer_name,d.customer_phone,d.program_name,d.deposit_amount,
    d.commission_pct,d.commission_amt,u.name
  from public.deposits d join public.branches b on b.id=d.branch_id left join public.users u on u.id=d.created_by
  where d.payment_status='รอตรวจสอบ' order by d.created_at;
$$;

create or replace function public.get_deposit_detail(p_deposit_id uuid)
returns jsonb language sql security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'deposit',(select row_to_json(x) from (select d.*,b.name branch_name,u.name created_by_name from public.deposits d join public.branches b on b.id=d.branch_id left join public.users u on u.id=d.created_by where d.id=p_deposit_id) x),
    'images',(select coalesce(jsonb_agg(row_to_json(i) order by i.uploaded_at),'[]'::jsonb) from public.deposit_images i where i.deposit_id=p_deposit_id)
  );
$$;

create or replace function public.audit_deposit(p_deposit_id uuid, p_status text, p_audit_by uuid, p_note text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_old text;
begin
  if p_status not in ('ยืนยันแล้ว','ตีกลับ') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  if not exists (select 1 from public.users where id=p_audit_by and is_active=true and role in ('Admin','Audit','CommissionAudit')) then
    raise exception 'ผู้ใช้นี้ไม่มีสิทธิ์ตรวจยอดมัดจำ';
  end if;
  select payment_status into v_old from public.deposits where id=p_deposit_id for update;
  if v_old is null then raise exception 'ไม่พบยอดมัดจำ'; end if;
  if v_old <> 'รอตรวจสอบ' then raise exception 'ยอดมัดจำนี้ถูกตรวจไปแล้ว'; end if;
  update public.deposits set payment_status=p_status,
    commission_status=case when p_status='ยืนยันแล้ว' then 'ได้สิทธิ์แล้ว' else 'ยกเลิก' end,
    audited_by=p_audit_by,audited_at=now(),audit_note=nullif(trim(p_note),''),updated_at=now()
  where id=p_deposit_id;
  insert into public.audit_logs(action,target_type,target_id,audit_by,old_status,new_status,note)
  values(case when p_status='ยืนยันแล้ว' then 'ยืนยันเงินมัดจำ' else 'ตีกลับยอดมัดจำ' end,'deposit',p_deposit_id,p_audit_by,v_old,p_status,p_note);
end;
$$;

create or replace function public.search_confirmed_deposits(p_query text, p_branch_name text)
returns table(id uuid, deposit_no text, deposit_date date, customer_name text, customer_phone text, hn text,
  program_name text, deposit_amount numeric, commission_amt numeric)
language sql security definer set search_path = public, extensions
as $$
  select d.id,d.deposit_no,d.deposit_date,d.customer_name,d.customer_phone,d.hn,d.program_name,d.deposit_amount,d.commission_amt
  from public.deposits d join public.branches b on b.id=d.branch_id
  where b.name=p_branch_name and d.payment_status='ยืนยันแล้ว' and d.linked_bill_id is null
    and (d.deposit_no ilike '%'||trim(p_query)||'%' or d.customer_name ilike '%'||trim(p_query)||'%'
      or coalesce(d.customer_phone,'') ilike '%'||trim(p_query)||'%' or coalesce(d.hn,'') ilike '%'||trim(p_query)||'%')
  order by d.deposit_date desc,d.created_at desc limit 10;
$$;

-- Preserve the existing OPD behavior and atomically link a confirmed deposit when selected.
create or replace function public.create_opd_bill(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_bill_id uuid; v_branch_id uuid; v_item jsonb; v_program_id uuid; v_product_id uuid; v_deposit_id uuid;
begin
  select id into v_branch_id from public.branches where name=(p_payload->>'branch_name');
  if v_branch_id is null then raise exception 'ไม่พบสาขา'; end if;
  insert into public.bills(hn,customer_name,bill_date,branch_id,status,commission_status,created_by)
  values(p_payload->>'hn',p_payload->>'customer_name',(p_payload->>'date')::date,v_branch_id,'รอตรวจสอบ','รอตรวจสอบ',(p_payload->>'created_by')::uuid)
  returning id into v_bill_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'services','[]'::jsonb)) loop
    select id into v_program_id from public.programs where code=v_item->>'program_code';
    insert into public.bill_services(bill_id,program_id,price,commission,created_by) values(v_bill_id,v_program_id,(v_item->>'price')::numeric,(v_item->>'commission')::numeric,(p_payload->>'created_by')::uuid);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'sales','[]'::jsonb)) loop
    insert into public.bill_sales(bill_id,sale_type,old_program_name,old_price,new_program_name,amount_paid,commission_base,commission_pct,commission_amt,created_by)
    values(v_bill_id,v_item->>'type',v_item->>'old_program',(v_item->>'old_price')::numeric,v_item->>'new_program',(v_item->>'amount_paid')::numeric,(v_item->>'commission_base')::numeric,(v_item->>'commission_pct')::numeric,(v_item->>'commission_amt')::numeric,(p_payload->>'created_by')::uuid);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'supplies','[]'::jsonb)) loop
    select id into v_product_id from public.products where code=v_item->>'product_code';
    insert into public.bill_supplies(bill_id,product_id,qty,created_by) values(v_bill_id,v_product_id,(v_item->>'qty')::numeric,(p_payload->>'created_by')::uuid);
    insert into public.stock_logs(opd_bill_id,branch_id,product_id,direction,move_type,qty,note,created_by,audit_status,source)
    values(v_bill_id,v_branch_id,v_product_id,'OUT','OUT',(v_item->>'qty')::numeric,'เบิกจาก OPD (HN: '||(p_payload->>'hn')||')',(p_payload->>'created_by')::uuid,'รอตรวจสอบ','ห้องตรวจ');
    insert into public.branch_stock(branch_id,product_id,qty_on_hand) values(v_branch_id,v_product_id,-1*(v_item->>'qty')::numeric)
    on conflict(branch_id,product_id) do update set qty_on_hand=public.branch_stock.qty_on_hand-(v_item->>'qty')::numeric,updated_at=now();
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'images','[]'::jsonb)) loop
    insert into public.bill_images(bill_id,file_url,file_name) values(v_bill_id,v_item->>'data',v_item->>'name');
  end loop;
  v_deposit_id := nullif(p_payload->>'linked_deposit_id','')::uuid;
  if v_deposit_id is not null then
    update public.deposits set linked_bill_id=v_bill_id,payment_status='เชื่อม OPD แล้ว',updated_at=now()
    where id=v_deposit_id and branch_id=v_branch_id and payment_status='ยืนยันแล้ว' and linked_bill_id is null;
    if not found then raise exception 'ยอดมัดจำนี้ไม่พร้อมเชื่อม หรือถูกเชื่อมไปแล้ว'; end if;
  end if;
  return v_bill_id;
end;
$$;

create or replace function public.get_bill_detail(p_bill_id uuid)
returns jsonb language sql security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'bill',(select row_to_json(x) from (select b.id,b.hn,b.customer_name,b.bill_date,br.name branch_name,u.name created_by_name,
      b.commission_status,b.audit_note,b.commission_audit_note
      from public.bills b left join public.branches br on br.id=b.branch_id left join public.users u on u.id=b.created_by where b.id=p_bill_id) x),
    'services',(select coalesce(jsonb_agg(row_to_json(x) order by x.created_at),'[]'::jsonb) from
      (select bs.price,bs.commission,p.name program_name,p.code program_code,u.name created_by_name,bs.created_at
       from public.bill_services bs left join public.programs p on p.id=bs.program_id left join public.users u on u.id=bs.created_by where bs.bill_id=p_bill_id) x),
    'sales',(select coalesce(jsonb_agg(row_to_json(x) order by x.created_at),'[]'::jsonb) from
      (select bs.sale_type,bs.old_program_name,bs.old_price,bs.new_program_name,bs.amount_paid,bs.commission_base,bs.commission_pct,bs.commission_amt,
       u.name created_by_name,bs.created_at from public.bill_sales bs left join public.users u on u.id=bs.created_by where bs.bill_id=p_bill_id) x),
    'supplies',(select coalesce(jsonb_agg(row_to_json(x) order by x.created_at),'[]'::jsonb) from
      (select p.code product_code,p.name product_name,p.category,bs.qty,p.unit,u.name created_by_name,bs.created_at
       from public.bill_supplies bs left join public.products p on p.id=bs.product_id left join public.users u on u.id=bs.created_by where bs.bill_id=p_bill_id) x),
    'images',(select coalesce(jsonb_agg(row_to_json(i) order by i.uploaded_at),'[]'::jsonb) from public.bill_images i where i.bill_id=p_bill_id),
    'deposit',(select row_to_json(x) from (select d.id,d.deposit_no,d.deposit_amount,d.commission_amt,d.commission_status,u.name created_by_name
      from public.deposits d left join public.users u on u.id=d.created_by where d.linked_bill_id=p_bill_id order by d.created_at limit 1) x)
  );
$$;

revoke all on function public.search_open_opd_bills(text,text) from public;
revoke all on function public.append_opd_bill(uuid,jsonb) from public;
revoke all on function public.create_deposit(jsonb) from public;
revoke all on function public.get_pending_deposits() from public;
revoke all on function public.get_deposit_detail(uuid) from public;
revoke all on function public.audit_deposit(uuid,text,uuid,text) from public;
revoke all on function public.search_confirmed_deposits(text,text) from public;
grant execute on function public.search_open_opd_bills(text,text) to anon;
grant execute on function public.append_opd_bill(uuid,jsonb) to anon;
grant execute on function public.create_deposit(jsonb) to anon;
grant execute on function public.get_pending_deposits() to anon;
grant execute on function public.get_deposit_detail(uuid) to anon;
grant execute on function public.audit_deposit(uuid,text,uuid,text) to anon;
grant execute on function public.search_confirmed_deposits(text,text) to anon;

