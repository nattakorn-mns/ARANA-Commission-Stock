-- ============================================================
-- บัญชีผู้ใช้ส่วนขยาย = ทะเบียนพนักงาน ERP (ครั้งแรก, ดึงจาก ERP 12/10/2569)
--
-- - คนที่มีบัญชีอยู่แล้ว (16): คงชื่อผู้ใช้/รหัสผ่าน/สิทธิ์เดิม ผูกรหัสพนักงาน ERP + อัปเดตชื่อ/ชื่อเล่นตาม ERP
-- - คนใหม่ (10): ชื่อผู้ใช้ = รหัสพนักงาน · รหัสผ่านเริ่มต้น = รหัสพนักงาน-รหัสARANA Time (เปลี่ยนเองครั้งแรก)
-- - ไม่สร้างบัญชีให้ แพทย์ / กราฟิก / แม่บ้าน / กรรมการ
-- รันซ้ำได้ (คนที่มีแล้วจะไม่ถูกสร้างซ้ำ รหัสผ่านไม่ถูกรีเซ็ต)
-- ============================================================
alter table public.users
  add column if not exists erp_emp_code text,
  add column if not exists erp_synced_at timestamptz;
create unique index if not exists users_erp_emp_code_uidx on public.users (erp_emp_code) where erp_emp_code is not null;

-- 1) ผูกบัญชีเดิมกับทะเบียน ERP (จับคู่ด้วยชื่อผู้ใช้ที่มีอยู่)
with m(username, emp_code, full_name, nickname) as (values
  ('frontdesk6',   'EMP3023', 'กนกพร จันทร์โพธิ์',        'ปอล์หวาย'),
  ('fd_prae',      'EMP3019', 'แพรวัลย์ ปิ่นสากล',        'แพร'),
  ('fd_kamphaeng', 'EMP3015', 'ศิริวิมล มณีเขียว',        'ใบเงิน'),
  ('frontdesk5',   'EMP3018', 'อริศรา หงษ์ดำเนิน',        'ซาย'),
  ('audit1',       'MVP1',    'กุลวรินทร์ กุลทวีพรพัฒน์', 'กุญแจ'),
  ('admin',        'EMP3030', 'ณัฎฐากร หิรัญวัฒนะ',       'ออม'),
  ('fd_yoyo',      'EMP3029', 'ณิชกานต์ รักษา',           'โยเกิร์ต'),
  ('frontdesk2',   'EMP3035', 'ทิพาศรี สุขประเสริฐ',      'โบว์'),
  ('audit2',       'EMP3027', 'นันติยา จันทร์อยู่',       'วิว'),
  ('audit3',       'EMP3028', 'น้ำฝน กันยาประสิทธิ์',     'น้ำฝน'),
  ('frontdesk4',   'EMP3034', 'ปทิตตา ปริฐากุลตรา',       'นอม'),
  ('fd_beam',      'EMP3033', 'ปัณณพร สุทธิศักดิ์',       'บีม'),
  ('frontdesk1',   'EMP3025', 'ปาวีณา จันตาเรียน',        'มายด์'),
  ('fd_nim',       'EMP3008', 'สุภาภรณ์ จันทร์พันธ์',     'นิ่ม'),
  ('fd_boon',      'EMP3011', 'อุ้มบุญ แก้วเขียว',        'กุ๊กไก่'),
  ('fd_maesod',    'EMP3003', 'จันบาล วงค์ปางมูล',        'น้อย'),
  ('frontdesk7',   'EMP3001', 'ปุญญิสา บุญศรีกุล',        'หญิง'),
  ('frontdesk8',   'EMP3002', 'ภูริชญา รุ่งสุริญา',       'ฮาเดียร์')
)
update public.users u
set erp_emp_code = m.emp_code, name = m.full_name, nickname = m.nickname, erp_synced_at = now()
from m where u.username = m.username;

-- 2) สร้างบัญชีใหม่ให้พนักงานใน ERP ที่ยังไม่มี (ข้ามถ้ามีชื่อผู้ใช้/รหัสพนักงานนี้แล้ว)
with n(emp_code, full_name, nickname, role, display_position, branch, position, temp_pw) as (values
  ('EMP3037', 'สุกัญญา อุดมสุข',       'แม็ก',   'Frontdesk',   'พนักงาน',  'กำแพงเพชร', 'Beauty Consult',       'EMP3037-054'),
  ('EMP3024', 'นิศาชล บุญรอด',          'โบว์',   'Frontdesk',   'พนักงาน',  'พิษณุโลก',  'ทรีทเม้นท์',           'EMP3024-011'),
  ('EMP3005', 'พันธิภา ประสงค์เจริญ',   'พั้นช์', 'Frontdesk',   'พนักงาน',  'แม่สอด',    'Beauty Consult',       'EMP3005-042'),
  ('EMP3022', 'อารียา สีเอื้อย',        'หยก',    'Frontdesk',   'พนักงาน',  'แม่สอด',    'ทรีทเม้นท์',           'EMP3022-053'),
  ('EMP3009', 'วนิดา จารัตน์',          'เอิร์น', 'OnlineSales', 'พนักงาน',  'พิษณุโลก',  'แอดมิน',               'EMP3009-043'),
  ('EMP3013', 'ชุตินันท์ หล่ำเสน',      'เบลล์',  'OnlineSales', 'พนักงาน',  'พิษณุโลก',  'แอดมิน',               'EMP3013-050'),
  ('EMP3026', 'ยอดขวัญ บุญศรี',         'ชมพู',   'OnlineSales', 'พนักงาน',  'พิษณุโลก',  'CRM',                  'EMP3026-018'),
  ('EMP3032', 'จิรัชญา ถนัดค้า',        'ดรีม',   'OnlineSales', 'พนักงาน',  'พิษณุโลก',  'CRM',                  'EMP3032-023'),
  ('EMP3036', 'ภาคภูมิ เจนประดับ',      'เจน',    'Audit',       'บัญชี',    'พิษณุโลก',  'การเงินและบัญชี',      'EMP3036-004'),
  ('EMP3017', 'มาริสา อ่อนพล',          'นุ่น',   'Audit',       'ผู้จัดการ', 'พิษณุโลก',  'ผู้จัดการเขต',         'EMP3017-001')
)
insert into public.users (username, password_hash, name, nickname, role, branch_id, position, is_active, display_position, erp_emp_code, erp_synced_at)
select n.emp_code, extensions.crypt(n.temp_pw, extensions.gen_salt('bf')), n.full_name, n.nickname, n.role,
       (select id from public.branches b where b.name = n.branch), n.position, true, n.display_position, n.emp_code, now()
from n
where not exists (select 1 from public.users u where u.username = n.emp_code or u.erp_emp_code = n.emp_code);

-- ตรวจผล
select count(*) filter (where erp_emp_code is not null) as "ผูกกับ ERP แล้ว",
       count(*) filter (where erp_synced_at > now() - interval '1 minute' and username = erp_emp_code) as "สร้างใหม่รอบนี้",
       count(*) filter (where is_active and erp_emp_code is null) as "เปิดใช้แต่ไม่มีใน ERP"
from public.users;
