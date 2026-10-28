// Checks SQL 27 (staff confirm daily summary, 23:30 day-end summary, no per-item ตีกลับ, edit note).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012, REPO } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, stock, check, report } = helpers(db);
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
for (const f of ['13_HNตรงกับERP-รายชื่อลูกค้า.sql', '15_เชื่อมมัดจำ-รอยืนยัน-ข้ามสาขา.sql', '17_เข้าสู่ระบบด้วยบัญชีERP.sql', '18_รอบ2-ตั้งค่า-ขอแก้ไข-ประวัติ.sql',
                 '19_โอนข้ามสาขา2ขั้น-รับโอน.sql', '21_รอบ5-แจ้งเตือนรูปแบบเดิม-ค่าคอมปิดแชท.sql', '23_ห้องแจ้งเตือน-รูปแบบข้อความตั้งค่าเอง.sql'])
  await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
await db.exec(`update users set role = 'Admin', erp_emp_code = 'EMP1' where username = 'acct';
insert into notify_rooms (name, provider, target_id, secret_name) values ('เทส', 'telegram', '-1', 'TG_BOT_TOKEN');
insert into notify_channel_rooms select key, (select id from notify_rooms limit 1) from notify_channels;`);
const sql26 = fs.readFileSync(SQL_1012 + '26_ใบของฉัน-แก้ไขยกเลิก-ติดตามการแชร์.sql', 'utf8');
await db.exec(fs.readFileSync(SQL_1012 + '26_ใบของฉัน-แก้ไขยกเลิก-ติดตามการแชร์.sql', 'utf8'));
await q1(`select public.admin_save_app_setting('acct', 'notify_admin_tag', '"@aom"'::jsonb)`);
const sql27 = fs.readFileSync(SQL_1012 + '27_ยืนยันยอดสรุปรายวัน-สรุปสิ้นวัน-ตีกลับ.sql', 'utf8');
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const msgs = async kind => (await db.query(`select text_body from notify_queue where kind = $1 order by created_at`, [kind])).rows.map(r => r.text_body);
const bill = (tok, extra = {}) => rpc(tok, 'create_opd_bill', { p_payload: { branch_name: tok === 'other' ? 'แม่สอด' : 'พิษณุโลก', hn: 'HN0001', customer_name: 'ลูกค้า', date: today,
  services: [{ program_code: 'PG1', price: 5000, commission: 100 }], sales: [], ...extra } });
const confirm = async tok => (await q1(`select public.confirm_daily_summary($1) r`, [tok])).r.map(x => x.result);

await check('27 runs twice; checks 6 / 0 / 2', async () => {
  await db.exec(sql27);
  const r = (await db.exec(sql27)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [6, 0, 2]);
});
await check('28 + 29 (diff in ฉบับแก้ไข) run after 27', async () => {
  for (const f of ['28_สรุปสิ้นวันเฉพาะคนที่ยังไม่ยืนยันยอด.sql', '29_สรุปฉบับแก้ไขบอกส่วนต่าง.sql', '29_สรุปฉบับแก้ไขบอกส่วนต่าง.sql'])
    await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
});

let billId;
await check('confirm: first press sends the summary; again with no change sends nothing; new item → ฉบับแก้ไข with numbers', async () => {
  await assert.rejects(q1(`select public.confirm_daily_summary('front')`), /NOTHING_TO_CONFIRM/);
  billId = await bill('front');
  assert.deepEqual(await confirm('front'), ['sent']);
  assert.match((await msgs('staff_daily')).at(-1), /^⛔วันที่: .*\n📍ชื่อพนักงาน: พนักงาน \(เอ\)\n📍สาขา: พิษณุโลก\n◾ค่ามือ: 100\n/);
  assert.deepEqual(await confirm('front'), ['unchanged']);
  await bill('front', { hn: 'HN0002', services: [{ program_code: 'PG1', price: 1, commission: 50 }] });
  assert.deepEqual(await confirm('front'), ['resent']);
  assert.match((await msgs('staff_addendum')).at(-1), /^\[สรุปรายวัน — ฉบับแก้ไข\]\n[\s\S]*◾ค่ามือ: 150 \(\+50\)\n◾อัพเซลล์: 0\n/);
  assert.equal((await q1(`select public.my_daily_confirm('front') r`)).r[0].status, 'ส่งแล้ว');
});

await check('edit after confirming: edited lines waiting → "[ขอแก้ไขสรุปรายวัน]" without numbers; approve → corrected summary sent automatically', async () => {
  await db.exec(`update bills set commission_status = 'อนุมัติแล้ว' where id = '${billId}'`);
  const p = { edit_commission: true, hn: 'HN0001', customer_name: 'ลูกค้า', date: today, services: [{ program_code: 'PG1', price: 5000, commission: 300 }],
    sales: [{ type: 'crosssell', new_program: 'X', new_price: 1000, amount_paid: 1000, commission_pct: 1, commission_amt: 10, commission_note: 'ลูกค้าเพิ่ม' }] };
  const req = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'ใส่ยอดผิด') r`, [billId, JSON.stringify(p)])).r.request_id;
  const before = (await msgs('staff_addendum')).length;
  assert.deepEqual(await confirm('front'), ['requested']);
  const rq = (await msgs('staff_daily_request')).at(-1);
  assert.match(rq, /^\[ขอแก้ไขสรุปรายวัน\] @aom\n/); assert.doesNotMatch(rq, /ค่ามือ|350/);
  assert.deepEqual(await confirm('front'), ['waiting']);
  assert.equal((await msgs('staff_addendum')).length, before);
  await q1(`select public.decide_bill_edit('acct', $1, true)`, [req]);
  const fixed = (await msgs('staff_addendum')).at(-1);
  assert.equal((await msgs('staff_addendum')).length, before + 1);
  assert.match(fixed, /◾ค่ามือ: 350 \(\+200\)\n◾อัพเซลล์: 0\n◾ขายเพิ่ม: 1,000 \(\+1,000\)/);
  assert.match((await msgs('edit_approved')).at(-1), /⛔หมายเหตุ: ลูกค้าเพิ่ม \(ขอแก้: ใส่ยอดผิด\)/);
});

await check('no per-item ตีกลับ message; 23:30 day-end lists returns per person and who has not confirmed', async () => {
  const before = (await msgs('rejected')).length;
  const b2 = await bill('other');
  await db.exec(`update bills set commission_status = 'ตีกลับ', commission_audit_date = now(), commission_audit_note = 'รูปไม่ชัด' where id = '${b2}'`);
  assert.equal((await msgs('rejected')).length, before);
  assert.match((await q1(`select private.day_end_returns(current_date, 'comm') t`)).t, /▪ แม่สอด: สาขาอื่น \(ซี\) 1 รายการ/);
  // SQL 28: Telegram ส่งแค่รายชื่อคนที่ยังไม่กดยืนยันยอด
  const s28 = fs.readFileSync(SQL_1012 + '28_สรุปสิ้นวันเฉพาะคนที่ยังไม่ยืนยันยอด.sql', 'utf8');
  await db.exec(s28);
  assert.equal(Number(Object.values((await db.exec(s28)).at(-1).rows[0])[0]), 1);
  assert.equal((await q1(`select public.admin_notify_build('acct', 'day_end', null) n`)).n, 1);
  const t = (await msgs('day_end')).at(-1);
  assert.match(t, /^📋 สรุปสิ้นวัน .*\n⏳ ยังไม่กดยืนยันยอด ส่งสรุปรายวัน\n▪ แม่สอด: สาขาอื่น \(ซี\)$/);
  assert.doesNotMatch(t, /ตีกลับ|พนักงาน \(เอ\)/, 'no returns; confirmed person not listed');
});

await check('stock daily (LINE) carries its own returns; self-cancelled ones are not counted', async () => {
  const id = crypto.randomUUID(), id2 = crypto.randomUUID();
  for (const r of [id, id2]) await rpc('front', 'save_stock_request', { p_request_id: r, p_branch_name: 'พิษณุโลก', p_move_type: 'OUT', p_source: 'ทั่วไป', p_log_date: today, p_lines: [{ product_code: 'P1', qty: 1 }], p_images: ['x'] });
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'ตีกลับ', p_note: 'ผิดตัว' });
  await q1(`select public.cancel_my_stock_request('front', $1, 'ซ้ำ')`, [id2]);
  await db.exec(`update stock_logs set audited_at = coalesce(audited_at, now())`);
  const t = (await q1(`select private.stock_daily_text($1::date, true) t`, [today])).t;
  assert.match(t, /↩️ ตีกลับ ยังค้างแก้ไข\n▪ พิษณุโลก: พนักงาน \(เอ\) 1 รายการ/);
  assert.doesNotMatch(t, /\n\n\n/);
});
report();
