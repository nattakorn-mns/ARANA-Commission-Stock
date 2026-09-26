-- ============================================================
-- บัญชีรับเงินมัดจำ: เพิ่ม / แก้ไข / ปิดใช้ ได้จากหน้า "บันทึกยอดมัดจำ" โดยตรง
-- สร้างเมื่อ 26/09/2569
--
-- - พนักงานเห็นเฉพาะบัญชีที่เปิดใช้อยู่ ในช่อง "บัญชีที่รับโอน"
-- - แอดมิน / บัญชี กดปุ่ม "จัดการบัญชี" ข้างช่องนั้นเพื่อเพิ่ม/แก้ไข/ปิดใช้
-- - ไม่ลบบัญชีทิ้ง (ปิดใช้แทน) เพราะยอดมัดจำเก่ายังอ้างชื่อบัญชีอยู่
-- ไม่แก้ของเดิม รันซ้ำได้
-- วิธีใช้: copy ทั้งหมด วางใน SQL Editor ของ Supabase (โปรเจกต์ส่วนขยาย) แล้วกด Run
-- ============================================================

begin;

create table if not exists public.deposit_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_no text not null,
  account_name text not null,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (bank_name, account_no)
);
alter table public.deposit_accounts enable row level security;
revoke all on public.deposit_accounts from public, anon, authenticated;

-- Everyone logged in sees active accounts; managers also see closed ones.
create or replace function public.list_deposit_accounts(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor record;
  v_manage boolean;
  v_result jsonb;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  v_manage := v_actor.role in ('Admin', 'Audit', 'CommissionAudit');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'bank_name', a.bank_name, 'account_no', a.account_no, 'account_name', a.account_name,
    'note', a.note, 'is_active', a.is_active, 'sort_order', a.sort_order
  ) order by a.is_active desc, a.sort_order, a.bank_name, a.account_no), '[]'::jsonb) into v_result
  from public.deposit_accounts a
  where a.is_active or v_manage;

  return jsonb_build_object('can_manage', v_manage, 'accounts', v_result);
end;
$$;

-- p_id null = add new account.
create or replace function public.admin_save_deposit_account(
  p_session_token text, p_id uuid, p_bank_name text, p_account_no text, p_account_name text,
  p_note text default null, p_is_active boolean default true, p_sort_order integer default 0)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor record;
  v_id uuid;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  perform private.require_role(v_actor.role, array['Admin', 'Audit', 'CommissionAudit']);
  if nullif(trim(coalesce(p_bank_name, '')), '') is null
     or nullif(trim(coalesce(p_account_no, '')), '') is null
     or nullif(trim(coalesce(p_account_name, '')), '') is null then
    raise exception 'ACCOUNT_FIELDS_REQUIRED' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.deposit_accounts (bank_name, account_no, account_name, note, is_active, sort_order, updated_by)
    values (trim(p_bank_name), trim(p_account_no), trim(p_account_name), nullif(trim(coalesce(p_note, '')), ''),
            coalesce(p_is_active, true), coalesce(p_sort_order, 0), v_actor.user_id)
    returning id into v_id;
  else
    update public.deposit_accounts
    set bank_name = trim(p_bank_name), account_no = trim(p_account_no), account_name = trim(p_account_name),
        note = nullif(trim(coalesce(p_note, '')), ''), is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 0), updated_by = v_actor.user_id, updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'ACCOUNT_NOT_FOUND' using errcode = '22023'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'ACCOUNT_DUPLICATE' using errcode = '22023', hint = 'มีบัญชีเลขนี้ของธนาคารนี้อยู่แล้ว';
end;
$$;

revoke all on function public.list_deposit_accounts(text) from public;
revoke all on function public.admin_save_deposit_account(text, uuid, text, text, text, text, boolean, integer) from public;
grant execute on function public.list_deposit_accounts(text) to anon, authenticated;
grant execute on function public.admin_save_deposit_account(text, uuid, text, text, text, text, boolean, integer) to anon, authenticated;

commit;

-- ตรวจผล: ต้องเห็นชื่อฟังก์ชัน 2 แถว
select proname as "ฟังก์ชันที่เพิ่ม" from pg_proc where proname in ('list_deposit_accounts', 'admin_save_deposit_account');
