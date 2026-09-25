-- ============================================================
-- ตรวจโครงสร้างฐานข้อมูลส่วนขยาย (อ่านอย่างเดียว ไม่แก้อะไรเลย)
-- สร้างเมื่อ 26/09/2026
--
-- ใช้เพื่อให้ Claude เห็นฟังก์ชันเดิมของ OPD / สต็อก ก่อนปรับ "ตัดสต็อกตอนอนุมัติ" ให้ครบทุกหน้า
-- วิธีใช้: copy ทั้งหมด วางใน SQL Editor ของ Supabase (โปรเจกต์ส่วนขยาย) แล้วกด Run
--          จากนั้นกด Export -> CSV แล้วส่งไฟล์ให้ Claude
-- ============================================================

select 'function' as kind, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('audit_stock_log', 'audit_stock_request', 'audit_opd_stock_request', 'create_opd_bill',
                    'append_opd_bill', 'get_branch_stock', 'get_stock_movement', 'get_all_branch_balances',
                    'arana_my_bills', 'save_stock_log_image', 'get_bill_detail', 'audit_bill',
                    'get_pending_opd_stock_requests', 'get_active_products')

union all

select 'columns', c.table_name, '', string_agg(
         c.column_name || ' ' || c.data_type || case when c.is_nullable = 'NO' then ' not null' else '' end
         || coalesce(' default ' || c.column_default, ''), E'\n' order by c.ordinal_position)
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('stock_logs', 'branch_stock', 'audit_logs', 'stock_log_images', 'products',
                       'bills', 'bill_services', 'bill_sales', 'bill_supplies', 'branches')
group by c.table_name

union all

select 'constraints', con.conrelid::regclass::text, '', string_agg(con.conname || ': ' || pg_get_constraintdef(con.oid), E'\n')
from pg_constraint con
where con.conrelid in ('public.stock_logs'::regclass, 'public.branch_stock'::regclass, 'public.products'::regclass)
group by con.conrelid

union all

select 'count', 'stock_logs', audit_status || ' / ' || coalesce(move_type, '-') || ' / ' || case when opd_bill_id is null then 'ใบเบิก' else 'OPD' end,
       count(*)::text
from public.stock_logs
group by audit_status, move_type, opd_bill_id is null

order by 1, 2, 3;
