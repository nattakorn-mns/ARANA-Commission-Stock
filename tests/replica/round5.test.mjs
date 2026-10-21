// Checks SQL 21 (Telegram in Aom's original layout, edit-request messages, chat-close commission rules, appointment matching).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012, REPO } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;
alter table deposits add column if not exists audited_by uuid, add column if not exists audited_at timestamptz, add column if not exists program_id uuid;
update users set password_hash = public.crypt('pw', public.gen_salt('bf'));
create or replace function extensions.crypt(text, text) returns text language sql as $$ select public.crypt($1, $2) $$;
create or replace function extensions.gen_salt(text) returns text language sql as $$ select public.gen_salt($1) $$;`);
const sess = fs.readFileSync(REPO + '/supabase/migrations/20260912103000_secure_app_sessions.sql', 'utf8').replace(/\r\n/g, '\n');
const cs = sess.indexOf('create or replace function public.create_app_session');
await db.exec(sess.slice(cs, sess.indexOf('$$;', sess.indexOf('as $$', cs) + 5) + 3));
const mig = fs.readFileSync(REPO + '/supabase/migrations/20260912090000_shared_opd_and_deposits.sql', 'utf8').replace(/\r\n/g, '\n');
const cd = mig.indexOf('create or replace function public.create_deposit');
await db.exec(mig.slice(cd, mig.indexOf('$$;', mig.indexOf('as $$', cd) + 5) + 3));
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
for (const f of ['09_ดึงข้อมูลจากERPอัตโนมัติ.sql', '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', '05_แจ้งเตือนTelegram-LINE-สรุปรายวัน.sql'])
  await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + f, 'utf8')));
for (const f of ['13_HNตรงกับERP-รายชื่อลูกค้า.sql', '15_เชื่อมมัดจำ-รอยืนยัน-ข้ามสาขา.sql', '17_เข้าสู่ระบบด้วยบัญชีERP.sql', '18_รอบ2-ตั้งค่า-ขอแก้ไข-ประวัติ.sql'])
  await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
await db.exec(`update users set role = 'Admin' where username = 'acct';
insert into users(username, name, nickname, role, branch_id) select 'online', 'ฟ้าใส ใจดี', 'ฟ้า', 'OnlineSales', id from branches where name = 'พิษณุโลก';
insert into private.app_sessions(token_hash, user_id, expires_at) select digest('online', 'sha256'), id, now() + interval '1 day' from users where username = 'online';
update notify_channels set target_id = 'x';`);
const sql21 = fs.readFileSync(SQL_1012 + '21_รอบ5-แจ้งเตือนรูปแบบเดิม-ค่าคอมปิดแชท.sql', 'utf8');
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const thai = today.slice(8, 10) + '/' + today.slice(5, 7) + '/' + (Number(today.slice(0, 4)) + 543);
const msgs = async kind => (await db.query(`select text_body from notify_queue where kind = $1 order by created_at`, [kind])).rows.map(r => r.text_body);

await check('21 runs twice; checks 2 / 2 / 5 / 2', async () => {
  await db.exec(sql21);
  const r = (await db.exec(sql21)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [2, 2, 5, 2]);
  await q1(`select public.admin_save_app_setting('acct', 'notify_admin_tag', '"@aom"'::jsonb)`);
});

const bill = async (extra = {}) => rpc('front', 'create_opd_bill', { p_payload: { branch_name: 'พิษณุโลก', hn: 'HN0001', customer_name: 'ปาธิชา พูลเพิ่ม', date: today,
  customer_source: 'ปิดจากแชท (แอดมิน) · LINE', services: [{ program_code: 'PG1', price: 5000, commission: 30 }],
  sales: [{ type: 'crosssell', old_program: 'ปรึกษาโปรแกรมรักษาสิว', new_program: 'เลเซอร์บราซิลเลี่ยน คอร์ส 10 ครั้ง', new_price: 8999, pay_type: 'มัดจำ',
            amount_paid: 1000, commission_pct: 1.5, commission_amt: 15 }], ...extra } });

await check('per-sale message: original field order, Thai date, ชื่อ (ชื่อเล่น), 🛒 for ขายเพิ่ม, empty lines dropped, หมายเหตุ "-"', async () => {
  await bill();
  const t = (await msgs('upsell_item')).at(-1);
  assert.equal(t, [`วันที่: ${thai}`, 'ร้าน/สาขา: ARANA พิษณุโลก', 'ชื่อพนักงาน: พนักงาน (เอ)', 'ช่องทาง: ปิดจากแชท (แอดมิน) · LINE',
    'ชื่อลูกค้า: ปาธิชา พูลเพิ่ม', '📍จองมาโปร: ปรึกษาโปรแกรมรักษาสิว', '🛒ขายเพิ่ม: เลเซอร์บราซิลเลี่ยน คอร์ส 10 ครั้ง', '🛒ขายเพิ่มราคา: 8,999',
    '⏩แบ่งจ่าย/มัดจำ: มัดจำ', '⏩ ยอดแบ่งจ่าย/มัดจำ: 1,000', '✅ยอดรวมที่ได้: 1,000', '⛔หมายเหตุ: -', '🔼เปอร์เซ็นต์ค่าคอม: 1.5'].join('\n'));
});

await check('edit: request message tags admin, no per-sale message while editing; approve posts the corrected sale; reject says restored', async () => {
  const id = await bill();
  const before = (await msgs('upsell_item')).length;
  const p = { edit_commission: true, hn: 'HN0001', customer_name: 'ปาธิชา พูลเพิ่ม', date: today, services: [{ program_code: 'PG1', price: 5000, commission: 30 }],
    sales: [{ type: 'crosssell', new_program: 'เลเซอร์บราซิลเลี่ยน คอร์ส 10 ครั้ง', new_price: 8999, amount_paid: 2000, commission_pct: 10, commission_amt: 200 }] };
  const req = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'ใส่ยอดผิด') r`, [id, JSON.stringify(p)])).r.request_id;
  assert.equal((await msgs('upsell_item')).length, before, 'no new per-sale message during edit');
  const er = (await msgs('edit_request')).at(-1);
  assert.match(er, /^\[ขอแก้ไขรายการ\] @aom\n/); assert.match(er, /เหตุผล: ใส่ยอดผิด\nสถานะ: รออนุมัติ$/); assert.doesNotMatch(er, /2,000/);
  await q1(`select public.decide_bill_edit('acct', $1, true)`, [req]);
  const ok = (await msgs('edit_approved')).at(-1);
  assert.match(ok, /^\[แก้ไขรายการ — อนุมัติแล้ว\]\n/); assert.match(ok, /✅ยอดรวมที่ได้: 2,000/); assert.match(ok, /🔼เปอร์เซ็นต์ค่าคอม: 10$/);
  const req2 = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'อีกครั้ง') r`, [id, JSON.stringify(p)])).r.request_id;
  await q1(`select public.decide_bill_edit('acct', $1, false, 'ไม่มีหลักฐาน')`, [req2]);
  assert.match((await msgs('edit_rejected')).at(-1), /เหตุผล: ไม่มีหลักฐาน\nสถานะ: ไม่อนุมัติ — คืนข้อมูลเดิมแล้ว$/);
  assert.equal((await msgs('upsell_item')).length, before, 'restoring old data sends no per-sale message');
});

await check('23:00 summary: one message per person in the original layout', async () => {
  await q1(`select public.notify_build_staff_daily()`);
  const t = (await msgs('staff_daily')).at(-1);
  assert.match(t, new RegExp(`^⛔วันที่: ${thai.replace(/\//g, '\\/')}\\n📍ชื่อพนักงาน: พนักงาน \\(เอ\\)\\n📍สาขา: พิษณุโลก\\n◾ค่ามือ: \\d`));
  assert.match(t, /◾ขายเพิ่ม: [\d,]+\n◾ขายของ: 0$/);
});

const deposit = (tok, extra) => q1(`select public.create_deposit_any_branch($1, $2::jsonb) r`, [tok, JSON.stringify({ branch_name: 'พิษณุโลก', customer_name: 'ลูกค้าแชท',
  hn: 'HN0777', channel: 'LINE', program_code: 'PG1', package_price: 800, deposit_amount: 1000, payment_method: 'โอน', deposit_date: today,
  images: [{ data: 'x', name: 'slip' }], ...extra })]);
const dep = async id => q1(`select closer_role, rule_base::numeric b, commission_pct::numeric p, commission_amt::numeric a from deposits where id = $1`, [id]);

await check('deposit rule: admin 3% of min(paid, tier) · Live 1% · surgery tier 1999 · store 1% of deposit', async () => {
  let d = await dep((await deposit('online', {})).r);
  assert.deepEqual([d.closer_role, Number(d.b), Number(d.p), Number(d.a)], ['แอดมิน', 499, 3, 14.97]);
  d = await dep((await deposit('online', { channel: 'Live สด', package_price: 5000 })).r);
  assert.deepEqual([Number(d.b), Number(d.p), Number(d.a)], [1000, 1, 10]);
  d = await dep((await deposit('online', { package_price: 300, deposit_amount: 150 })).r);
  assert.equal(Number(d.b), 150, 'paid less than tier → paid amount');
  d = await dep((await deposit('online', { package_price: 50000, deposit_amount: 3000, is_surgery: true })).r);
  assert.equal(Number(d.b), 1999);
  d = await dep((await deposit('front', {})).r);
  assert.deepEqual([d.closer_role, Number(d.b), Number(d.p), Number(d.a)], ['หน้าร้าน', 1000, 1, 10]);
});

await check('appointment without deposit + visit matching: HN = sure (auto), name only = maybe (accounting confirms/rejects)', async () => {
  const a1 = (await q1(`select public.create_chat_appointment('online', $1::jsonb) r`, [JSON.stringify({ branch_name: 'พิษณุโลก', customer_name: 'นัดไม่มัดจำ',
    hn: 'HN0900', channel: 'Facebook', program_name: 'ฟิลเลอร์', appointment_date: today })])).r;
  const a2 = (await q1(`select public.create_chat_appointment('front', $1::jsonb) r`, [JSON.stringify({ branch_name: 'พิษณุโลก', customer_name: 'ชื่อเหมือน',
    channel: 'LINE', appointment_date: today })])).r;
  await assert.rejects(q1(`select public.create_chat_appointment('front', '{"branch_name":"พิษณุโลก","customer_name":"x"}'::jsonb)`), /APPOINTMENT_DATE_REQUIRED/);
  await bill({ hn: 'HN0900', customer_name: 'คนละชื่อ' });
  await bill({ hn: 'HN0999', customer_name: 'ชื่อเหมือน' });
  const list = (await q1(`select public.list_chat_visits('acct', null, true) r`)).r;
  const v1 = list.find(x => x.id === a1), v2 = list.find(x => x.id === a2);
  assert.deepEqual([v1.visit_status, v1.visit_match, Number(v1.visit_paid), Number(v1.visit_commission_pct), Number(v1.visit_commission)], ['ยืนยันแล้ว', 'HN ตรง', 1000, 1, 10]);
  assert.deepEqual([v2.visit_status, v2.visit_match, Number(v2.visit_commission_pct)], ['รอยืนยัน', 'ชื่อตรง', 0.5]);
  assert.ok((await msgs('chat_visit')).some(t => /^\[ลูกค้าจากแชทมาใช้บริการ\] @ฟ้า/.test(t)));
  await q1(`select public.decide_chat_visit('acct', 'appt', $1, 'reject')`, [a2]);
  assert.equal((await q1(`select public.list_chat_visits('acct', null, true) r`)).r.find(x => x.id === a2).visit_status, 'รอลูกค้ามา', 'rejected bill is not matched again');
  await bill({ hn: 'HN0998', customer_name: 'ชื่อเหมือน' });
  await q1(`select public.list_chat_visits('acct', null, true)`);
  await q1(`select public.decide_chat_visit('acct', 'appt', $1, 'confirm', 4000)`, [a2]);
  const c = (await q1(`select public.list_chat_visits('acct', 'ยืนยันแล้ว') r`)).r.find(x => x.id === a2);
  assert.deepEqual([Number(c.visit_paid), Number(c.visit_commission)], [4000, 20]);
  const mine = (await q1(`select public.list_my_chat_commissions('online') r`)).r;
  assert.ok(mine.some(x => x.kind === 'appt' && Number(x.visit_commission) === 10));
  await assert.rejects(q1(`select public.list_chat_visits('front')`), /FORBIDDEN|ROLE|permission/i);
});

await check('deposit linked from OPD = sure match; store closer earns 1% of what was paid at the visit', async () => {
  const id = (await deposit('front', { hn: 'HN0555', customer_name: 'มัดจำหน้าร้าน' })).r;
  await q1(`update deposits set payment_status = 'ยืนยันแล้ว' where id = $1`, [id]);
  await bill({ hn: 'HN0555', customer_name: 'มัดจำหน้าร้าน', linked_deposit_id: id });
  const v = (await q1(`select public.list_chat_visits('acct', null, true) r`)).r.find(x => x.id === id);
  assert.equal(v.visit_status, 'ยืนยันแล้ว'); assert.equal(Number(v.visit_commission), 10);
});
report();
