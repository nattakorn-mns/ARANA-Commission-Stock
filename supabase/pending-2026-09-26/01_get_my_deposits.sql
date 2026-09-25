-- ============================================================
-- หน้า "สรุปยอดของฉัน" แสดงค่าคอมมัดจำทางแชทของตัวเอง
-- สร้างเมื่อ 26/09/2026 (รอบแก้ตามรายงาน Codex)
--
-- เพิ่มฟังก์ชันใหม่ 1 ตัว อ่านอย่างเดียว เห็นเฉพาะยอดมัดจำที่ตัวเองเป็นคนส่ง
-- ไม่แก้ของเดิม รันซ้ำได้
-- วิธีใช้: copy ทั้งหมด วางใน SQL Editor ของ Supabase (โปรเจกต์ส่วนขยาย) แล้วกด Run
-- ============================================================

begin;

create or replace function public.get_my_deposits(p_session_token text)
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

  select coalesce(jsonb_agg(to_jsonb(x) order by x.deposit_date desc, x.created_at desc), '[]'::jsonb) into v_result
  from (
    select d.id, d.deposit_no, d.deposit_date, br.name as branch_name, d.customer_name, d.program_name,
           d.deposit_amount, d.commission_pct, d.commission_amt, d.payment_status, d.commission_status, d.created_at
    from public.deposits d
    left join public.branches br on br.id = d.branch_id
    where d.created_by = v_actor.user_id
    order by d.deposit_date desc, d.created_at desc
    limit 500
  ) x;

  return v_result;
end;
$$;

revoke all on function public.get_my_deposits(text) from public;
grant execute on function public.get_my_deposits(text) to anon, authenticated;

commit;

-- ตรวจผล: ต้องเห็นชื่อฟังก์ชัน 1 แถว
select proname as "ฟังก์ชันที่เพิ่ม" from pg_proc where proname = 'get_my_deposits';
