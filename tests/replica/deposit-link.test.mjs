// Checks SQL 15 (find a customer's deposits from OPD; link pending / other-branch deposits) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012, REPO } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;
alter table deposits add column if not exists audited_by uuid, add column if not exists audited_at timestamptz;`);
// audit_deposit as the live database has it (from the 12/09 migration)
const mig = fs.readFileSync(REPO + '/supabase/migrations/20260912090000_shared_opd_and_deposits.sql', 'utf8').replace(/\r\n/g, '\n');
const a = mig.indexOf('create or replace function public.audit_deposit');
await db.exec(mig.slice(a, mig.indexOf('$$;', mig.indexOf('as $$', a) + 5) + 3));
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', 'utf8')));
await db.exec(fs.readFileSync(SQL_1012 + '13_HNตรงกับERP-รายชื่อลูกค้า.sql', 'utf8'));
const sql15 = fs.readFileSync(SQL_1012 + '15_เชื่อมมัดจำ-รอยืนยัน-ข้ามสาขา.sql', 'utf8');

await check('15 runs twice and patches the OPD save + deposit audit', async () => {
  await db.exec(sql15);
  const r = (await db.exec(sql15)).at(-1).rows[0];
  assert.ok(Number(Object.values(r)[0]) >= 1); assert.equal(Number(Object.values(r)[1]), 1); assert.equal(Number(Object.values(r)[2]), 1);
});

const dep = async (no, hn, name, branch, status) => (await q1(`insert into deposits(deposit_no, deposit_date, branch_id, customer_name, hn, deposit_amount, payment_status, program_name)
  select $1, '2026-10-18', id, $3, $2, 1000, $5, 'โบท็อกซ์' from branches where name = $4 returning id`, [no, hn, name, branch, status])).id;
const d1 = await dep('D1', 'HN0755', 'ปัณฑ์ณัฐ สุดคิด', 'พิษณุโลก', 'ยืนยันแล้ว');
const d2 = await dep('D2', 'hn-0755', 'ปัณฑ์ณัฐ สุดคิด', 'แม่สอด', 'รอตรวจสอบ');
await dep('D3', 'HN0755', 'ปัณฑ์ณัฐ สุดคิด', 'พิษณุโลก', 'ตีกลับ');
const d4 = await dep('D4', null, 'ลูกค้าใหม่ ไม่มีHN', 'แม่สอด', 'รอตรวจสอบ');

await check('find by HN (any spelling) or exact name, all branches, own branch first; rejected ones hidden', async () => {
  const list = (await q1(`select public.list_customer_deposits('front', null, 'HN0755', null) r`)).r;
  assert.deepEqual(list.map(x => [x.deposit_no, x.branch_name, x.payment_status]), [['D1', 'พิษณุโลก', 'ยืนยันแล้ว'], ['D2', 'แม่สอด', 'รอตรวจสอบ']]);
  const byName = (await q1(`select public.list_customer_deposits('front', null, 'HN9999', 'ลูกค้าใหม่ ไม่มีHN') r`)).r;
  assert.deepEqual(byName.map(x => x.deposit_no), ['D4']);
  assert.deepEqual((await q1(`select public.list_customer_deposits('front', 'D4') r`)).r.map(x => x.deposit_no), ['D4']);
  assert.deepEqual((await q1(`select public.list_customer_deposits('front') r`)).r, []);
});

const opd = (dep) => rpc('front', 'create_opd_bill', { p_payload: { branch_name: 'พิษณุโลก', hn: 'HN0755', customer_name: 'ปัณฑ์ณัฐ สุดคิด', date: '2026-10-18',
  services: [{ program_code: 'PG1', price: 5000, commission: 100 }], linked_deposit_id: dep } });

await check('link a pending deposit from another branch: stays รอตรวจสอบ until accounting confirms, then เชื่อม OPD แล้ว', async () => {
  await opd(d2);
  let r = await q1(`select payment_status s, linked_bill_id is not null l from deposits where id=$1`, [d2]);
  assert.deepEqual([r.s, r.l], ['รอตรวจสอบ', true]);
  assert.equal((await q1(`select public.list_customer_deposits('front', null, 'HN0755', null) r`)).r.length, 1, 'linked deposits drop out of the list');
  const acct = (await q1(`select id from users where username='acct'`)).id;
  await q1(`select public.audit_deposit($1, 'ยืนยันแล้ว', $2, null)`, [d2, acct]);
  assert.equal((await q1(`select payment_status s from deposits where id=$1`, [d2])).s, 'เชื่อม OPD แล้ว');
});

await check('confirmed deposit still links as before; a deposit cannot be linked twice', async () => {
  await opd(d1);
  assert.equal((await q1(`select payment_status s from deposits where id=$1`, [d1])).s, 'เชื่อม OPD แล้ว');
  await assert.rejects(opd(d1), /ไม่พร้อมเชื่อม/);
});
report();
