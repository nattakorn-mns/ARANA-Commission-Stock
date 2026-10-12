-- ============================================================
-- บัญชีผู้ใช้ส่วนขยาย = ทะเบียนพนักงาน ERP (ครั้งแรก, ดึงจาก ERP 12/10/2569)  รันซ้ำได้
--
-- กติกา (คุณออม 12/10):
--   1) ชื่อผู้ใช้ = รหัสพนักงาน ERP ทุกคน (คนเดิมเปลี่ยนชื่อผู้ใช้ รหัสผ่านเดิมใช้ต่อได้) · ชื่อ/ชื่อเล่น ตาม ERP
--   2) สิทธิ์ตามตำแหน่ง ERP: Beauty Consult/ทรีทเม้นท์/ผู้ช่วยแพทย์ → พนักงาน · แอดมิน/CRM → แอดมินขายออนไลน์
--      บัญชี/การเงิน/ผู้จัดการเขต → บัญชี · หัวหน้าฝ่ายปฏิบัติการ/กรรมการ → ผู้ดูแลระบบ · แพทย์ → ไม่มีบัญชี
--      กราฟิก/แม่บ้าน → ตำแหน่งใหม่ "พนักงานคลัง" เห็นเฉพาะ เบิกใช้ / รับเข้า / โอน-รับโอน
--   3) สาขาตาม ERP (ตัด "สาขา") · Back Office → พิษณุโลก
--   4) ลาออกที่ ERP → ปิดบัญชี
--   รหัสผ่านเริ่มต้นคนใหม่ = รหัสพนักงาน-รหัสARANA Time (เปลี่ยนเองครั้งแรก) · ไม่รีเซ็ตรหัสผ่านคนเดิม
-- ============================================================
alter table public.users
  add column if not exists erp_emp_code text,
  add column if not exists erp_synced_at timestamptz;
create unique index if not exists users_erp_emp_code_uidx on public.users (erp_emp_code) where erp_emp_code is not null;

-- ------------------------------------------------------------
-- A) ตำแหน่ง "พนักงานคลัง": เห็นเฉพาะเมนูคลัง 3 หน้า (ใช้กับกราฟิก/แม่บ้าน)
-- ------------------------------------------------------------
insert into public.staff_positions (name, description, is_system)
values ('พนักงานคลัง', 'เบิกใช้ / รับของเข้า / โอน-รับโอนข้ามสาขา เท่านั้น (กราฟิก แม่บ้าน)', false)
on conflict (name) do nothing;

insert into public.position_menu_permissions (position_name, page_key, page_label, can_view, can_edit)
select 'พนักงานคลัง', m.page_key, m.page_label,
       m.page_key in ('inventory-out', 'inventory-in', 'inventory-transfer'),
       m.page_key in ('inventory-out', 'inventory-in', 'inventory-transfer')
from (values
  ('opd', 'บันทึก OPD'), ('deposit', 'บันทึกยอดมัดจำ'), ('history', 'สรุปยอดของฉัน'),
  ('inventory-out', 'เบิกใช้วัสดุ/อุปกรณ์'), ('inventory-in', 'รับเข้าสต๊อก'), ('inventory-transfer', 'เบิกโอนข้ามสาขา'),
  ('stockcard', 'สต๊อกการ์ด'), ('weeklycount', 'เช็คสต๊อกประจำสัปดาห์'), ('audit_dashboard', 'แดชบอร์ด สรุปงานทีมออดิท'),
  ('audit', 'Audit Room'), ('balance', 'สต๊อกคงเหลือ'), ('reports', 'รายงานผลงานพนักงาน'), ('expense', 'บันทึกรายจ่าย'),
  ('admin', 'AI Auto-Verification (โซนผู้ดูแลระบบ)'), ('admin_dashboard', 'ระบบ Admin Dashboard (โซนผู้ดูแลระบบ)'), ('systemlogs', 'System Logs (โซนผู้ดูแลระบบ)')
) as m(page_key, page_label)
on conflict (position_name, page_key) do nothing;

-- ------------------------------------------------------------
-- B) ทะเบียนพนักงาน ERP (เฉพาะคนที่ใช้ระบบ; แพทย์ไม่สร้าง) + ชื่อผู้ใช้เดิมที่จะผูก
--    role / display_position คิดจากตำแหน่ง ERP ตามกติกาข้อ 2
-- ------------------------------------------------------------
with erp(emp_code, full_name, nickname, position, branch, time_code, old_username) as (values
  -- พิษณุโลก
  ('EMP3011', 'อุ้มบุญ แก้วเขียว',        'กุ๊กไก่', 'ทรีทเม้นท์',             'พิษณุโลก',  '013', 'fd_boon'),
  ('EMP3017', 'มาริสา อ่อนพล',           'นุ่น',    'ผู้จัดการเขต',           'พิษณุโลก',  '001', null),
  ('EMP3024', 'นิศาชล บุญรอด',           'โบว์',    'ทรีทเม้นท์',             'พิษณุโลก',  '011', null),
  ('EMP3025', 'ปาวีณา จันตาเรียน',       'มายด์',   'Beauty Consult',         'พิษณุโลก',  '006', 'frontdesk1'),
  ('EMP3034', 'ปทิตตา ปริฐากุลตรา',      'นอม',     'Beauty Consult',         'พิษณุโลก',  '010', 'frontdesk4'),
  ('EMP3035', 'ทิพาศรี สุขประเสริฐ',     'โบว์',    'ผู้ช่วยแพทย์',           'พิษณุโลก',  '012', 'frontdesk2'),
  -- กำแพงเพชร
  ('EMP3014', 'ศรัญญา ทวีทรัพย์',        'ปลา',     'แม่บ้าน',                'กำแพงเพชร', '019', null),
  ('EMP3015', 'ศิริวิมล มณีเขียว',       'ใบเงิน',  'ทรีทเม้นท์',             'กำแพงเพชร', '027', 'fd_kamphaeng'),
  ('EMP3018', 'อริศรา หงษ์ดำเนิน',       'ซาย',     'Beauty Consult',         'กำแพงเพชร', '007', 'frontdesk5'),
  ('EMP3019', 'แพรวัลย์ ปิ่นสากล',       'แพร',     'ทรีทเม้นท์',             'กำแพงเพชร', '031', 'fd_prae'),
  ('EMP3023', 'กนกพร จันทร์โพธิ์',       'ปอล์หวาย', 'ผู้ช่วยแพทย์',          'กำแพงเพชร', '005', 'frontdesk6'),
  ('EMP3037', 'สุกัญญา อุดมสุข',         'แม็ก',    'Beauty Consult',         'กำแพงเพชร', '054', null),
  -- แม่สอด
  ('EMP3001', 'ปุญญิสา บุญศรีกุล',       'หญิง',    'Beauty Consult',         'แม่สอด',    '037', 'frontdesk7'),
  ('EMP3002', 'ภูริชญา รุ่งสุริญา',      'ฮาเดียร์', 'ผู้ช่วยแพทย์',          'แม่สอด',    '038', 'frontdesk8'),
  ('EMP3003', 'จันบาล วงค์ปางมูล',       'น้อย',    'ทรีทเม้นท์',             'แม่สอด',    '039', 'fd_maesod'),
  ('EMP3004', 'นภารัตน์ กำแพงติ๊บ',      'ยุ',      'แม่บ้าน',                'แม่สอด',    '040', null),
  ('EMP3005', 'พันธิภา ประสงค์เจริญ',    'พั้นช์',  'Beauty Consult',         'แม่สอด',    '042', null),
  ('EMP3022', 'อารียา สีเอื้อย',         'หยก',     'ทรีทเม้นท์',             'แม่สอด',    '053', null),
  -- Back Office → พิษณุโลก
  ('EMP3008', 'สุภาภรณ์ จันทร์พันธ์',    'นิ่ม',    'แอดมิน',                 'พิษณุโลก',  '029', 'fd_nim'),
  ('EMP3009', 'วนิดา จารัตน์',           'เอิร์น',  'แอดมิน',                 'พิษณุโลก',  '043', null),
  ('EMP3013', 'ชุตินันท์ หล่ำเสน',       'เบลล์',   'แอดมิน',                 'พิษณุโลก',  '050', null),
  ('EMP3016', 'พัชรพรรณ ทองรัตน์',       'มิ้น',    'กราฟิก',                 'พิษณุโลก',  '034', null),
  ('EMP3020', 'เสาวภาค สุขประสาน',       'เสาว์',   'แม่บ้าน',                'พิษณุโลก',  '002', null),
  ('EMP3021', 'ณัฐปาริญภัค เบญจรัศมีรัชต์', 'ตะวัน', 'กราฟิก',                'พิษณุโลก',  '033', null),
  ('EMP3026', 'ยอดขวัญ บุญศรี',          'ชมพู',    'CRM',                    'พิษณุโลก',  '018', null),
  ('EMP3027', 'นันติยา จันทร์อยู่',      'วิว',     'บัญชี',                  'พิษณุโลก',  '016', 'audit2'),
  ('EMP3028', 'น้ำฝน กันยาประสิทธิ์',    'น้ำฝน',   'บัญชี',                  'พิษณุโลก',  '020', 'audit3'),
  ('EMP3029', 'ณิชกานต์ รักษา',          'โยเกิร์ต', 'หัวหน้าการตลาด/เลขา',   'พิษณุโลก',  '028', 'fd_yoyo'),
  ('EMP3030', 'ณัฎฐากร หิรัญวัฒนะ',      'ออม',     'หัวหน้าฝ่ายปฏิบัติการ',  'พิษณุโลก',  '003', 'admin'),
  ('EMP3031', 'สุธิดา นิยมธรรมมนิตย์',   'มะปราง',  'กราฟิก',                 'พิษณุโลก',  '022', null),
  ('EMP3032', 'จิรัชญา ถนัดค้า',         'ดรีม',    'CRM',                    'พิษณุโลก',  '023', null),
  ('EMP3033', 'ปัณณพร สุทธิศักดิ์',      'บีม',     'กราฟิก',                 'พิษณุโลก',  '030', 'fd_beam'),
  ('EMP3036', 'ภาคภูมิ เจนประดับ',       'เจน',     'การเงินและบัญชี',        'พิษณุโลก',  '004', null),
  -- กรรมการ
  ('MVP1',    'กุลวรินทร์ กุลทวีพรพัฒน์', 'กุญแจ',  'กรรมการบริษัท',          'พิษณุโลก',  '000', 'audit1'),
  ('MVP2',    'ฐณรินทร์ กุลทวีพรพัฒน์',   null,      'กรรมการบริษัท',          'พิษณุโลก',  '999', null)
),
mapped as (
  select e.*,
    case
      when e.position in ('Beauty Consult', 'ทรีทเม้นท์', 'ผู้ช่วยแพทย์') then 'Frontdesk'
      when e.position in ('แอดมิน', 'CRM') then 'OnlineSales'
      when e.position in ('บัญชี', 'การเงินและบัญชี', 'ผู้จัดการเขต') then 'Audit'
      when e.position in ('หัวหน้าฝ่ายปฏิบัติการ', 'กรรมการบริษัท') then 'Admin'
      when e.position in ('กราฟิก', 'แม่บ้าน') then 'Frontdesk'
      else 'Frontdesk' end as role,
    case
      when e.position in ('หัวหน้าฝ่ายปฏิบัติการ', 'กรรมการบริษัท') then 'ผู้ดูแลระบบ'
      when e.position = 'ผู้จัดการเขต' then 'ผู้จัดการ'
      when e.position in ('บัญชี', 'การเงินและบัญชี') then 'บัญชี'
      when e.position in ('กราฟิก', 'แม่บ้าน') then 'พนักงานคลัง'
      else 'พนักงาน' end as display_position
  from erp e
),
-- B1) คนเดิม: ผูกรหัส + เปลี่ยนชื่อผู้ใช้เป็นรหัสพนักงาน + ชื่อ/ชื่อเล่น/สิทธิ์/สาขาตาม ERP (รหัสผ่านคงเดิม)
upd as (
  update public.users u
  set username = m.emp_code, erp_emp_code = m.emp_code, name = m.full_name, nickname = coalesce(m.nickname, u.nickname),
      role = m.role, display_position = m.display_position, position = m.position,
      branch_id = (select id from public.branches b where b.name = m.branch), is_active = true, erp_synced_at = now()
  from mapped m
  where (u.erp_emp_code = m.emp_code or (u.erp_emp_code is null and u.username in (m.old_username, m.emp_code)))
  returning u.id
),
-- B2) คนใหม่: สร้างบัญชี (ข้ามถ้ามีแล้ว)
ins as (
  insert into public.users (username, password_hash, name, nickname, role, branch_id, position, is_active, display_position, erp_emp_code, erp_synced_at)
  select m.emp_code, extensions.crypt(m.emp_code || '-' || m.time_code, extensions.gen_salt('bf')), m.full_name, m.nickname, m.role,
         (select id from public.branches b where b.name = m.branch), m.position, true, m.display_position, m.emp_code, now()
  from mapped m
  where not exists (select 1 from public.users u where u.username = m.emp_code or u.erp_emp_code = m.emp_code
                                                    or (m.old_username is not null and u.username = m.old_username))
  returning id
),
-- B3) ลาออก/ไม่มีใน ERP: ปิดบัญชี (เฉพาะที่เคยผูก ERP ไว้)
deact as (
  update public.users u set is_active = false
  where u.is_active and u.erp_emp_code is not null and not exists (select 1 from mapped m where m.emp_code = u.erp_emp_code)
  returning id
)
select (select count(*) from upd) as "คนเดิมที่ผูกแล้ว", (select count(*) from ins) as "สร้างใหม่", (select count(*) from deact) as "ปิดบัญชี";
