// Builds SQL that syncs the extension's products table to the ERP stock_items list (read-only export from ERP).
// usage: node gen-products-sql.cjs <erp-items.json> <out.sql>
const fs = require('fs');
const [, , src, out] = process.argv;
const raw = fs.readFileSync(src, 'utf8');
// The MCP tool result wraps the JSON and escapes quotes (\" ) — unescape before parsing.
let body = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
if (body.includes('\\"')) body = body.replace(/\\"/g, '"');
const rows = JSON.parse(body);
const q = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const seen = new Set(); const dups = [];
for (const r of rows) { if (seen.has(r.sku)) dups.push(r.sku); seen.add(r.sku); }
if (dups.length) throw new Error('duplicate sku in ERP: ' + dups.join(','));
const placeholder = rows.filter(r => !r.name || r.name.trim() === '.' || r.name.trim() === '');
const vals = rows.map(r => `(${q(r.sku)},${q(r.name)},${q(r.unit)},${q(r.category)},${q(r.legacy_sku)},${r.lot_controlled ? 'true' : 'false'},${r.expiry_controlled ? 'true' : 'false'})`).join(',\n');
const equip = ['อุปกรณ์', 'วิตามิน Mn (อุปกรณ์)', 'น้ำหอม', 'อื่นๆ'];
const sql = `-- ============================================================
-- อัปเดตรายชื่อสินค้าในส่วนขยายให้ตรงกับ ERP (Stock Master ณ ${new Date().toISOString().slice(0, 10)})
-- ที่มา: อ่านจากตาราง stock_items ของ ERP โดยตรง (อ่านอย่างเดียว) ${rows.length} รายการ
--
-- กติกา: รหัส (code) = SKU ของ ERP · รหัสที่ ERP ไม่มีแล้วจะถูก "ปิดใช้" (ไม่ลบ ประวัติเก่ายังอ้างได้)
--        ชื่อ/หน่วย/หมวด ยึดตาม ERP · รันซ้ำได้
-- ============================================================
begin;

alter table public.products
  add column if not exists erp_legacy_sku text,
  add column if not exists lot_controlled boolean not null default false,
  add column if not exists expiry_controlled boolean not null default false,
  add column if not exists erp_synced_at timestamptz;

create temp table erp_items(code text primary key, name text, unit text, category text, legacy_sku text, lot_controlled boolean, expiry_controlled boolean) on commit drop;
insert into erp_items values
${vals};

-- 1) อัปเดตรายการที่มีอยู่แล้ว (จับคู่ด้วยรหัส)
update public.products p
set name = e.name, unit = e.unit, category = e.category, erp_legacy_sku = e.legacy_sku,
    lot_controlled = e.lot_controlled, expiry_controlled = e.expiry_controlled, is_active = true, erp_synced_at = now()
from erp_items e where e.code = p.code;

-- 2) เพิ่มรายการใหม่ (type: 2 = อุปกรณ์/ของใช้, 1 = ยา/เวชภัณฑ์ — ตามหมวดของ ERP)
insert into public.products (code, name, unit, category, type, is_active, erp_legacy_sku, lot_controlled, expiry_controlled, erp_synced_at)
select e.code, e.name, e.unit, e.category,
       case when e.category in (${equip.map(q).join(', ')}) then 2 else 1 end,
       true, e.legacy_sku, e.lot_controlled, e.expiry_controlled, now()
from erp_items e
where not exists (select 1 from public.products p where p.code = e.code);

-- 3) ปิดใช้รหัสที่ ERP ไม่มี (ยังเลือกไม่ได้ในฟอร์ม แต่ประวัติยังแสดงชื่อได้)
update public.products p set is_active = false
where p.is_active and not exists (select 1 from erp_items e where e.code = p.code);

commit;

-- ตรวจผล
select (select count(*) from public.products where is_active) as "เปิดใช้",
       (select count(*) from public.products where not is_active) as "ปิดใช้ (ไม่มีใน ERP)",
       (select count(*) from public.products where erp_synced_at is not null) as "ตรงกับ ERP";
`;
fs.writeFileSync(out, sql);
console.log('rows', rows.length, 'placeholder-names', placeholder.map(p => p.sku).join(','));
