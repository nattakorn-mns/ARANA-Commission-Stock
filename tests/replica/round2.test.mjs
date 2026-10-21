// Checks SQL 18 (settings, program codes, customer source, any-branch deposits, 24h sessions, activity log,
// edit-with-approval + period close) on the local replica.
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
for (const f of ['06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql']) await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
for (const f of ['09_ดึงข้อมูลจากERPอัตโนมัติ.sql', '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql']) await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + f, 'utf8')));
for (const f of ['13_HNตรงกับERP-รายชื่อลูกค้า.sql', '15_เชื่อมมัดจำ-รอยืนยัน-ข้ามสาขา.sql', '17_เข้าสู่ระบบด้วยบัญชีERP.sql']) await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
const sql18 = fs.readFileSync(SQL_1012 + '18_รอบ2-ตั้งค่า-ขอแก้ไข-ประวัติ.sql', 'utf8');
await db.exec(`update users set role = 'Admin' where username = 'acct';
insert into users(username, name, nickname, role, branch_id) select 'online', 'แอดมิน', 'ฟ้า', 'OnlineSales', id from branches where name = 'พิษณุโลก';
insert into private.app_sessions(token_hash, user_id, expires_at) select digest('online', 'sha256'), id, now() + interval '1 day' from users where username = 'online';`);

await check('18 runs twice; every patch lands', async () => {
  await db.exec(sql18);
  const r = (await db.exec(sql18)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [2, 1, 1, 2, 6]);
});

await check('settings: anyone reads, admin/accounting saves (with history), staff cannot', async () => {
  const s = (await q1(`select public.get_app_settings('front') r`)).r;
  assert.equal(s.commission_pcts.product_pct, 5); assert.ok(s.channels.includes('Live สด'));
  await q1(`select public.admin_save_app_setting('acct', 'channels', '["หน้าร้าน","LINE"]'::jsonb)`);
  assert.deepEqual((await q1(`select public.get_app_settings('front') r`)).r.channels, ['หน้าร้าน', 'LINE']);
  await assert.rejects(q1(`select public.admin_save_app_setting('front', 'channels', '["x"]'::jsonb)`), /FORBIDDEN|ROLE|permission/i);
  await assert.rejects(q1(`select public.admin_save_app_setting('acct', 'channels', '[]'::jsonb)`), /INVALID_SETTING/);
  assert.match((await q1(`select note from audit_logs where action = 'แก้ตั้งค่า' order by created_at desc limit 1`)).note, /^channels: .*→/);
});

const bill = async (extra = {}) => rpc('front', 'create_opd_bill', { p_payload: { branch_name: 'พิษณุโลก', hn: 'HN0001', customer_name: 'ลูกค้า', date: '2026-10-20',
  customer_source: 'Walk-in หน้าร้าน', services: [{ program_code: 'PG1', price: 5000, commission: 100 }],
  sales: [{ type: 'crosssell', new_program: 'ฟิลเลอร์', new_program_code: 'PG2', new_price: 9999, amount_paid: 1000, commission_pct: 1.5, commission_amt: 15 }], ...extra } });

await check('sales keep name + hidden code; bill keeps customer source', async () => {
  const id = await bill();
  const s = await q1(`select new_program_name, new_program_code from bill_sales where bill_id = $1`, [id]);
  assert.deepEqual([s.new_program_name, s.new_program_code], ['ฟิลเลอร์', 'PG2']);
  assert.equal((await q1(`select customer_source from bills where id = $1`, [id])).customer_source, 'Walk-in หน้าร้าน');
});

await check('deposit: online admin records for another branch; deposit list shows channel + recorder role', async () => {
  const id = (await q1(`select public.create_deposit_any_branch('online', $1::jsonb) r`, [JSON.stringify({ branch_name: 'แม่สอด', customer_name: 'ก', hn: 'HN0009',
    channel: 'LINE', program_code: 'PG1', deposit_amount: 1000, payment_method: 'โอน', deposit_date: '2026-10-20', images: [{ data: 'x', name: 'slip' }] })])).r;
  assert.equal((await q1(`select b.name from deposits d join branches b on b.id = d.branch_id where d.id = $1`, [id])).name, 'แม่สอด');
  const d = (await q1(`select public.list_customer_deposits('front', null, 'HN0009', null) r`)).r[0];
  assert.deepEqual([d.channel, d.created_by_role, d.branch_name], ['LINE', 'OnlineSales', 'แม่สอด']);
  await assert.rejects(q1(`select public.create_deposit_any_branch('online', '{"customer_name":"x"}'::jsonb)`), /BRANCH_REQUIRED/);
});

await check('login lasts 24h and is logged; activity log is admin-only', async () => {
  const s = (await q1(`select public.create_app_session('front', 'pw') r`)).r;
  assert.equal(s.expires_in_seconds, 86400);
  const exp = (await q1(`select extract(epoch from expires_at - now())::int e from private.app_sessions order by expires_at desc limit 1`)).e;
  assert.ok(exp > 23 * 3600);
  const log = (await q1(`select public.admin_activity_log('acct') r`)).r;
  assert.ok(log.some(l => l.action === 'เข้าสู่ระบบ' && l.username === 'front' && l.note === 'รหัสพนักงาน'));
  await assert.rejects(q1(`select public.admin_activity_log('front')`), /FORBIDDEN|ROLE|permission/i);
});

await check('edit: applies at once, waits for approval; one pending at a time; reject restores the old data', async () => {
  const id = await bill();
  const payload = { edit_commission: true, hn: 'HN0001', customer_name: 'ลูกค้า', date: '2026-10-20', services: [{ program_code: 'PG1', price: 5000, commission: 300 }],
    sales: [{ type: 'crosssell', new_program: 'ฟิลเลอร์', new_program_code: 'PG2', new_price: 12000, amount_paid: 1000, commission_pct: 1.5, commission_amt: 15 }] };
  await assert.rejects(q1(`select public.submit_bill_edit('front', $1, $2::jsonb, '')`, [id, JSON.stringify(payload)]), /NOTE_REQUIRED/);
  const res = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'ใส่ราคาผิด') r`, [id, JSON.stringify(payload)])).r;
  const live = async () => q1(`select (select commission from bill_services where bill_id = $1 and not is_superseded) c, (select new_price from bill_sales where bill_id = $1 and not is_superseded) p`, [id]);
  assert.deepEqual(Object.values(await live()).map(Number), [300, 12000], 'daily figures use the edited values right away');
  await assert.rejects(q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'อีกรอบ')`, [id, JSON.stringify(payload)]), /REQUEST_ALREADY_OPEN/);
  const list = (await q1(`select public.list_bill_edits('acct') r`)).r;
  const req = list.find(x => x.id === res.request_id);
  assert.equal(req.old_payload.services[0].commission, 100); assert.equal(req.new_payload.services[0].commission, 300);
  await assert.rejects(q1(`select public.decide_bill_edit('front', $1, true)`, [res.request_id]), /FORBIDDEN|ROLE|permission/i);
  await assert.rejects(q1(`select public.decide_bill_edit('acct', $1, false, '')`, [res.request_id]), /NOTE_REQUIRED/);
  await q1(`select public.decide_bill_edit('acct', $1, false, 'ไม่มีหลักฐาน')`, [res.request_id]);
  assert.deepEqual(Object.values(await live()).map(Number), [100, 9999], 'rejected → old data back');
  assert.equal((await q1(`select status from bill_edit_requests where id = $1`, [res.request_id])).status, 'ไม่อนุมัติ');
  const res2 = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'แก้อีกครั้ง') r`, [id, JSON.stringify(payload)])).r;
  await q1(`select public.decide_bill_edit('acct', $1, true)`, [res2.request_id]);
  assert.deepEqual(Object.values(await live()).map(Number), [300, 12000]);
});

await check('period close: only admin, only after day 25, blocks pending edits, then locks edits', async () => {
  const st = (await q1(`select public.commission_period_status('acct') r`)).r;
  assert.equal(st.closed_through, null); assert.match(st.next_period_end, /-25$/);
  await assert.rejects(q1(`select public.close_commission_period('front', '2026-09-25')`), /FORBIDDEN|ROLE|permission/i);
  await assert.rejects(q1(`select public.close_commission_period('acct', '2026-09-24')`), /INVALID_PERIOD/);
  const old = await bill({ date: '2026-09-20' });
  const p = { edit_commission: true, date: '2026-09-20', services: [{ program_code: 'PG1', price: 1, commission: 1 }] };
  await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'x')`, [old, JSON.stringify(p)]);
  await assert.rejects(q1(`select public.close_commission_period('acct', '2026-09-25')`), /PENDING_EDITS/);
  const rq = (await q1(`select id from bill_edit_requests where bill_id = $1 and status = 'รออนุมัติ'`, [old])).id;
  await q1(`select public.decide_bill_edit('acct', $1, true)`, [rq]);
  await q1(`select public.close_commission_period('acct', '2026-09-25')`);
  await assert.rejects(q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'y')`, [old, JSON.stringify(p)]), /PERIOD_CLOSED/);
  assert.equal((await q1(`select public.commission_period_status('acct') r`)).r.next_period_end, '2026-10-25');
});
await check('weekly count: re-saving a counted item keeps old → new history', async () => {
  const save = qty => rpc('front', 'save_weekly_count', { p_branch_name: 'พิษณุโลก', p_week_start: '2026-10-19', p_items: [{ product_code: 'P1', counted_qty: qty }] });
  await save(10); await save(12); await save(12);
  const h = (await db.query(`select old_qty::int o, new_qty::int n from stock_count_history order by changed_at`)).rows;
  assert.deepEqual(h, [{ o: 10, n: 12 }]);
  assert.match((await q1(`select note from audit_logs where action = 'แก้ผลนับสต๊อก'`)).note, /10\.?0* → 12/);
});
report();
