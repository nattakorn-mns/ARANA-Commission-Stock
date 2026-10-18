// Checks SQL 13 (HN normalisation + ERP customer lookup) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;`);
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', 'utf8')));
const sql13 = fs.readFileSync(SQL_1012 + '13_HNตรงกับERP-รายชื่อลูกค้า.sql', 'utf8');
await check('13 runs twice; HN normalisation', async () => {
  await db.exec(sql13); await db.exec(sql13);
  for (const [a, b] of [[' hn-0001 ', 'HN0001'], ['HN 0001', 'HN0001'], ['c0990', 'C0990'], ['026500244', '026500244'], ['', null], [null, null]])
    assert.equal((await q1(`select private.hn_norm($1) h`, [a])).h, b);
});

await check('customer lookup: not loaded yet → no warning signal; then finds by any spelling, own branch first', async () => {
  let r = (await q1(`select public.lookup_erp_customer('front', 'HN0001') r`)).r;
  assert.deepEqual(r, { loaded: false, matches: [] });
  const id = n => `00000000-0000-0000-0000-00000000c00${n}`;
  await q1(`select public.erp_apply_page_ext('customers', $1::jsonb, true, true)`, [JSON.stringify([
    { id: id(1), hn: 'HN0001', full_name: 'ลูกค้า แม่สอด', branch: 'สาขาแม่สอด', status: 'ปกติ', updated_at: '2026-10-18T00:00:00Z' },
    { id: id(2), hn: 'HN0001', full_name: 'ลูกค้า พิษณุโลก', branch: 'สาขาพิษณุโลก', status: 'ปกติ', updated_at: '2026-10-18T00:00:01Z' },
    { id: id(4), hn: 'HN0001', full_name: 'ลบแล้ว', branch: 'สาขาพิษณุโลก', status: 'ลบแล้ว', updated_at: '2026-10-18T00:00:01Z' },
    { id: id(5), hn: 'HN0002', full_name: 'ระงับ', branch: 'สาขาพิษณุโลก', status: 'ระงับ', updated_at: '2026-10-18T00:00:01Z' },
    { id: id(3), hn: '026500244', full_name: 'สุภาวดี', branch: 'สาขากำแพงเพชร', status: 'ปกติ', updated_at: '2026-10-18T00:00:02Z' },
  ])]);
  r = (await q1(`select public.lookup_erp_customer('front', 'hn-0001') r`)).r;
  assert.equal(r.loaded, true);
  assert.deepEqual(r.matches.map(m => m.full_name), ['ลูกค้า พิษณุโลก', 'ลูกค้า แม่สอด']);
  assert.equal((await q1(`select public.lookup_erp_customer('front', 'HN9999') r`)).r.matches.length, 0);
  const sus = (await q1(`select public.lookup_erp_customer('front', 'HN0002') r`)).r.matches[0];
  assert.equal(sus.active, false); assert.equal(sus.status, 'ระงับ');
  await assert.rejects(q1(`select public.lookup_erp_customer('nobody', 'HN0001')`), /SESSION/);
  assert.equal((await q1(`select public.erp_sync_cursor('customers') c`)).c.after_id, id(3));
});

await check('compare matches HN-0001 typed in OPD with HN0001 in ERP', async () => {
  await q1(`select public.erp_apply_page_ext('dispense_items', $1::jsonb, true, true)`, [JSON.stringify([
    { id: '00000000-0000-0000-0000-00000000d001', doc_no: 'D1', service_date: '2026-10-20', branch: 'สาขาพิษณุโลก', hn: 'HN0001', sku: 'P1', qty: 2, updated_at: '2026-10-20T01:00:00Z' }])]);
  const b = (await q1(`insert into bills(hn, customer_name, bill_date, branch_id) select 'hn-0001', 'x', '2026-10-20', id from branches where name='พิษณุโลก' returning id`)).id;
  await q1(`insert into stock_logs(opd_bill_id, branch_id, product_id, direction, move_type, qty, audit_status) select $1, b.id, p.id, 'OUT', 'OUT', 2, 'อนุมัติแล้ว' from branches b, products p where b.name='พิษณุโลก' and p.code='P1'`, [b]);
  const rows = (await q1(`select public.dispense_compare('acct', '2026-10-20', '2026-10-20', null) r`)).r;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ตรง'); assert.equal(rows[0].hn, 'HN0001');
});

await check('14: short HN search — number finds HN/C/plain forms, own branch first; letters narrow it', async () => {
  await db.exec(fs.readFileSync(SQL_1012 + '14_ค้นHNแบบย่อ.sql', 'utf8'));
  const id = n => '00000000-0000-0000-0000-0000000e00' + String(n).padStart(2, '0');
  await q1(`select public.erp_apply_page_ext('customers', $1::jsonb, false, true)`, [JSON.stringify([
    { id: id(1), hn: 'HN0755', full_name: 'ใหม่ พล', branch: 'สาขาพิษณุโลก', status: 'ปกติ', updated_at: '2026-10-18T01:00:00Z' },
    { id: id(2), hn: 'HN0755', full_name: 'ใหม่ กพ', branch: 'สาขากำแพงเพชร', status: 'ปกติ', updated_at: '2026-10-18T01:00:01Z' },
    { id: id(3), hn: '755', full_name: 'เก่า กพ', branch: 'สาขากำแพงเพชร', status: 'ปกติ', updated_at: '2026-10-18T01:00:02Z' },
    { id: id(4), hn: 'C0755', full_name: 'เก่า พล', branch: 'สาขาพิษณุโลก', status: 'ปกติ', updated_at: '2026-10-18T01:00:03Z' },
    { id: id(5), hn: '7550', full_name: 'ไม่ใช่', branch: 'สาขาพิษณุโลก', status: 'ปกติ', updated_at: '2026-10-18T01:00:04Z' }])]);
  const names = async q => (await q1(`select public.lookup_erp_customer('front', $1) r`, [q])).r.matches.map(m => m.full_name);
  for (const q of ['755', '0755', '00755']) assert.deepEqual(await names(q), ['เก่า พล', 'ใหม่ พล', 'เก่า กพ', 'ใหม่ กพ']);
  assert.deepEqual(await names('hn755'), ['ใหม่ พล', 'ใหม่ กพ']);
  assert.deepEqual(await names('C755'), ['เก่า พล']);
  assert.deepEqual(await names('7550'), ['ไม่ใช่']);
  assert.deepEqual(await names('สมชาย'), []);
});
report();
