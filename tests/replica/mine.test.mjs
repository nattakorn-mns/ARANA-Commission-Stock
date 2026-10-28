// Checks SQL 26 (my requests: cancel own pending, deposit cancel, share tracking + report).
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
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const save = async (tok, branch, type, lines, to) => {
  const id = crypto.randomUUID();
  await rpc(tok, 'save_stock_request', { p_request_id: id, p_branch_name: branch, p_to_branch_name: to || null, p_move_type: type, p_source: 'ทั่วไป',
    p_log_date: today, p_images: ['storage:out/x/2026-10/a.jpg'], p_lines: lines });
  return id;
};
const mine = async (tok, kind) => (await q1(`select public.list_my_stock_requests($1, $2) r`, [tok, kind])).r;

await check('26 runs twice; checks 1 / 6 / 1', async () => {
  await db.exec(sql26);
  const r = (await db.exec(sql26)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [1, 6, 1]);
});

let a, b;
await check('my requests list: lines, photos, editable while waiting; not other people\'s', async () => {
  a = await save('front', 'พิษณุโลก', 'OUT', [{ product_code: 'P1', qty: 2 }, { product_code: 'P2', qty: 1 }]);
  b = await save('front', 'พิษณุโลก', 'OUT', [{ product_code: 'P1', qty: 5 }]);
  const list = await mine('front', 'out');
  const x = list.find(r => r.request_id === a);
  assert.deepEqual([x.lines.length, x.images[0], x.editable, x.status, x.shared], [2, 'storage:out/x/2026-10/a.jpg', true, 'รอตรวจสอบ', null]);
  assert.equal((await mine('other', 'out')).length, 0);
});

await check('cancel own waiting request: no stock change, no Telegram "ตีกลับ", logged; cannot cancel approved or others\'', async () => {
  const s0 = await stock('พิษณุโลก', 'P1');
  const before = (await q1(`select count(*)::int c from notify_queue where kind = 'rejected'`)).c;
  await assert.rejects(q1(`select public.cancel_my_stock_request('other', $1, 'x')`, [a]), /CANNOT_CANCEL/);
  await assert.rejects(q1(`select public.cancel_my_stock_request('front', $1, '')`, [a]), /NOTE_REQUIRED/);
  assert.equal((await q1(`select public.cancel_my_stock_request('front', $1, 'บันทึกซ้ำ') r`, [a])).r, 2);
  assert.equal((await q1(`select count(*)::int c from notify_queue where kind = 'rejected'`)).c, before, 'no ตีกลับ message');
  const x = (await mine('front', 'out')).find(r => r.request_id === a);
  assert.deepEqual([x.status, x.cancelled, x.editable], ['ยกเลิกแล้ว', true, false]);
  assert.equal(await stock('พิษณุโลก', 'P1'), s0);
  await rpc('acct', 'audit_stock_request', { p_request_id: b, p_status: 'อนุมัติแล้ว' });
  await assert.rejects(q1(`select public.cancel_my_stock_request('front', $1, 'x')`, [b]), /CANNOT_CANCEL/);
  assert.equal((await q1(`select count(*)::int c from audit_logs where action = 'ยกเลิกใบโดยผู้บันทึก'`)).c, 1);
  // accounting's own ตีกลับ still notifies
  const c = await save('front', 'พิษณุโลก', 'OUT', [{ product_code: 'P2', qty: 1 }]);
  await rpc('acct', 'audit_stock_request', { p_request_id: c, p_status: 'ตีกลับ', p_note: 'รูปไม่ชัด' });
  assert.equal((await q1(`select count(*)::int c from notify_queue where kind = 'rejected'`)).c, before + 1);
});

await check('share tracking: press share twice → counted; report shows shared / not shared, hides cancelled', async () => {
  await q1(`select public.mark_stock_shared('front', $1, 'out', 'line')`, [b]);
  await q1(`select public.mark_stock_shared('front', $1, 'out', 'copy')`, [b]);
  assert.equal((await mine('front', 'out')).find(r => r.request_id === b).shared.times, 2);
  const rep = (await q1(`select public.list_share_report('acct', $1::date, $1::date) r`, [today])).r;
  assert.equal(rep.some(r => r.request_id === a), false, 'cancelled request hidden');
  const rb = rep.find(r => r.request_id === b);
  assert.deepEqual([rb.kind, rb.staff, Number(rb.times)], ['out', 'เอ', 2]);
  assert.ok(rep.some(r => r.times == null), 'unshared ones listed');
  await assert.rejects(q1(`select public.list_share_report('front', $1::date, $1::date)`, [today]), /FORBIDDEN|ROLE|permission/i);
});

await check('transfer received by me shows on my receive list; share counted for kind receive', async () => {
  const t = await save('front', 'พิษณุโลก', 'TRANSFER', [{ product_code: 'P1', qty: 1 }], 'แม่สอด');
  await rpc('acct', 'audit_stock_request', { p_request_id: t, p_status: 'อนุมัติแล้ว' });
  await q1(`select public.receive_transfer('other', $1, '[{"product_code":"P1","qty":1}]'::jsonb, '["photo"]'::jsonb, 'ok')`, [t]);
  const r = (await mine('other', 'receive')).find(x => x.request_id === t);
  assert.deepEqual([r.from_branch, r.lines[0].qty == 1, r.editable], ['พิษณุโลก', true, false]);
  await q1(`select public.mark_stock_shared('other', $1, 'receive', 'line')`, [t]);
  assert.equal((await mine('other', 'receive')).find(x => x.request_id === t).shared.times, 1);
});

await check('deposit: open my waiting deposit with photos; cancel → ยกเลิก (no commission); confirmed one cannot be cancelled', async () => {
  const d1 = (await q1(`insert into deposits(deposit_no, deposit_date, branch_id, customer_name, deposit_amount, commission_pct, commission_amt, created_by)
    select 'D1', current_date, b.id, 'ลูกค้า', 1000, 1, 10, u.id from branches b, users u where b.name = 'พิษณุโลก' and u.username = 'front' returning id`)).id;
  await db.query(`insert into deposit_images(deposit_id, file_url, file_name) values ($1, 'storage:deposit/x/a.jpg', 'slip')`, [d1]);
  const g = (await q1(`select public.get_my_deposit('front', $1) r`, [d1])).r;
  assert.deepEqual([g.customer_name, g.branch_name, g.images[0].data, 'commission_amt' in g], ['ลูกค้า', 'พิษณุโลก', 'storage:deposit/x/a.jpg', false]);
  await assert.rejects(q1(`select public.get_my_deposit('other', $1)`, [d1]), /NOT_FOUND/);
  await q1(`select public.cancel_my_deposit('front', $1, 'ใส่ยอดผิด')`, [d1]);
  const d = await q1(`select payment_status, commission_status, audit_note from deposits where id = $1`, [d1]);
  assert.deepEqual([d.payment_status, d.commission_status, d.audit_note], ['ตีกลับ', 'ยกเลิก', 'ยกเลิกโดยผู้บันทึก: ใส่ยอดผิด']);
  await db.query(`update deposits set payment_status = 'ยืนยันแล้ว', commission_status = 'รอตรวจสอบ' where id = $1`, [d1]);
  await assert.rejects(q1(`select public.cancel_my_deposit('front', $1, 'x')`, [d1]), /CANNOT_CANCEL/);
});
report();
