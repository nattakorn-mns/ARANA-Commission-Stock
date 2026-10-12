// Checks SQL 05 (Telegram/LINE notifications + daily summaries) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
const sql05 = stripExtensions(fs.readFileSync(SQL_1012 + '05_แจ้งเตือนTelegram-LINE-สรุปรายวัน.sql', 'utf8'));

await check('05 runs twice', async () => { await db.exec(sql05); await db.exec(sql05); });
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const yday = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date - 1,'YYYY-MM-DD') d`)).d;
const bill = { hn: 'HN1', customer_name: 'ลูกค้า', date: today, branch_name: 'พิษณุโลก',
  services: [{ program_code: 'PG1', price: 5000, commission: 1200 }],
  sales: [{ type: 'upsell', new_program: 'B', new_price: 9999, amount_paid: 9999, commission_base: 6000, commission_pct: 2, commission_amt: 200 },
          { type: 'product', new_program: 'ครีม', new_price: 590, amount_paid: 590, commission_base: 590, commission_pct: 5, commission_amt: 29.5 }],
  supplies: [], images: [{ data: 'data:x', name: 'a.jpg' }] };

await check('upsell item -> telegram queue, no % in text', async () => {
  await rpc('front', 'create_opd_bill', { p_payload: bill });
  const rows = (await db.query(`select text_body, channel_key from notify_queue where kind='upsell_item' order by created_at`)).rows;
  assert.equal(rows.length, 2); assert.equal(rows[0].channel_key, 'tg_upsell_items');
  assert.ok(rows[0].text_body.includes('ยอดเต็ม 9,999 บาท = ค่าคอม 200 บาท')); assert.ok(!rows[0].text_body.includes('%'));
});
await check('late flag: bill dated yesterday submitted today', async () => {
  await rpc('front', 'create_opd_bill', { p_payload: { ...bill, date: yday, sales: [] } });
  assert.equal((await q1(`select submitted_late l from bills where bill_date=$1`, [yday])).l, true);
  assert.equal((await q1(`select submitted_late l from bills where bill_date=$1 limit 1`, [today])).l, false);
});
await check('staff daily 23:59 text format + dedupe', async () => {
  assert.equal((await q1(`select public.notify_build_staff_daily($1::date) n`, [today])).n, 1);
  const t = (await q1(`select text_body t from notify_queue where kind='staff_daily'`)).t;
  for (const s of ['ค่ามือ: 1,200', 'อัพเซล: ยอดเต็ม 9,999 = 200', 'ขายสินค้า: ยอดเต็ม 590 = 29.50', 'รวมได้: 1,429.50']) assert.ok(t.includes(s), 'missing ' + s);
  assert.ok(!t.includes('%'));
  await db.query(`select public.notify_build_staff_daily($1::date)`, [today]);
  assert.equal((await q1(`select count(*)::int c from notify_queue where kind='staff_daily'`)).c, 1);
});
await check('addendum 06:00: only rows that came after the 23:59 summary', async () => {
  assert.equal((await q1(`select public.notify_build_staff_addendum($1::date) n`, [today])).n, 0);
  await new Promise(r => setTimeout(r, 50));
  await rpc('front', 'create_opd_bill', { p_payload: { ...bill, hn: 'HN2', sales: [], services: [{ program_code: 'PG1', price: 1, commission: 300 }] } });
  assert.equal((await q1(`select public.notify_build_staff_addendum($1::date) n`, [today])).n, 1);
  const t = (await q1(`select text_body t from notify_queue where kind='staff_addendum'`)).t;
  assert.ok(t.includes('ฉบับเพิ่มเติม') && t.includes('ค่ามือ: 300') && !t.includes('1,200'));
});
await check('stock daily 23:00 -> two LINE rooms; reject notice', async () => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { p_request_id: id, p_branch_name: 'พิษณุโลก', p_move_type: 'OUT', p_source: 'ทั่วไป', p_log_date: today, p_lines: [{ product_code: 'P1', qty: 2 }], p_images: ['x'] });
  await rpc('front', 'save_stock_request', { p_request_id: crypto.randomUUID(), p_branch_name: 'พิษณุโลก', p_move_type: 'IN', p_log_date: today, p_lines: [{ product_code: 'P2', qty: 5 }], p_images: ['x'] });
  assert.equal((await q1(`select public.notify_build_stock_daily($1::date) n`, [today])).n, 2);
  const out = (await q1(`select text_body t from notify_queue where channel_key='line_stock_out'`)).t;
  const inn = (await q1(`select text_body t from notify_queue where channel_key='line_stock_in'`)).t;
  assert.ok(out.includes('เบิก ยา A 2 ซีซี (ทั่วไป)') && out.includes('รอตรวจสอบ')); assert.ok(inn.includes('รับเข้า วัสดุ B 5'));
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'ตีกลับ', p_note: 'รูปไม่ชัด' });
  const rej = (await q1(`select text_body t from notify_queue where kind='rejected'`)).t;
  assert.ok(rej.includes('ตีกลับ') && rej.includes('รูปไม่ชัด'));
});
await check('deposit -> LINE room of its branch; reject notice', async () => {
  const did = (await q1(`insert into deposits(deposit_no, deposit_date, branch_id, customer_name, program_name, deposit_amount, package_price, commission_pct, commission_amt, created_by, channel, payment_method)
    select 'DEP-1', $1, b.id, 'คุณ ก', 'HIFU', 2999, 15000, 1.5, 44.99, u.id, 'LINE', 'กสิกร 123' from branches b, users u where b.name='พิษณุโลก' and u.username='front' returning id`, [today])).id;
  const r = await q1(`select channel_key, text_body, image_url from notify_queue where kind='deposit'`);
  assert.equal(r.channel_key, 'line_deposit_pl'); assert.ok(r.text_body.includes('ยอดมัดจำ 2,999 บาท (ราคาเต็ม 15,000)')); assert.equal(r.image_url, null);
  await db.query(`update deposits set payment_status='ตีกลับ', audit_note='สลิปไม่ตรง' where id=$1`, [did]);
  assert.equal((await q1(`select count(*)::int c from notify_queue where kind='rejected'`)).c, 2);
});
await check('claim/mark: attempts, 2-minute lock, quota counters', async () => {
  const items = (await q1(`select public.notify_claim_pending(50) v`)).v;
  assert.ok(items.length >= 7); assert.ok(items.every(i => i.secret_name && i.provider));
  const line = items.find(i => i.provider === 'line'); assert.equal(line.monthly_quota, 200); assert.equal(line.used_this_month, 0);
  await db.query(`select public.notify_mark($1, true)`, [items[0].id]);
  await db.query(`select public.notify_mark($1, false, 'boom')`, [items[1].id]);
  assert.equal((await q1(`select status from notify_queue where id=$1`, [items[0].id])).status, 'ส่งแล้ว');
  const b = await q1(`select status, last_error from notify_queue where id=$1`, [items[1].id]); assert.equal(b.status, 'รอส่ง'); assert.equal(b.last_error, 'boom');
  const again = (await q1(`select public.notify_claim_pending(50) v`)).v; assert.ok(!again.some(i => i.id === items[1].id));
});
await check('dispatch call only when something is pending and config exists', async () => {
  await db.query(`select private.notify_dispatch_call()`);
  assert.equal((await q1(`select count(*)::int c from net.calls`)).c, 0, 'no config -> no call');
  await db.query(`insert into private.app_config values ('notify_dispatch_url','https://x/functions/v1/notify-dispatch'),('notify_dispatch_key','k')`);
  await db.query(`select private.notify_dispatch_call()`);
  assert.equal((await q1(`select count(*)::int c from net.calls`)).c, 1);
});
await check('admin functions: channels, set target, test message, build, cron jobs', async () => {
  await assert.rejects(db.query(`select public.admin_notify_channels('front')`), /FORBIDDEN_ROLE/);
  await db.query(`update users set role='Admin' where username='acct'`);
  await db.query(`select public.admin_notify_set_channel('acct', 'tg_upsell_items', '-100123', true)`);
  const ch = (await q1(`select public.admin_notify_channels('acct') v`)).v;
  assert.equal(ch.find(c => c.key === 'tg_upsell_items').target_id, '-100123'); assert.equal(ch.length, 8);
  assert.ok((await q1(`select public.admin_notify_test('acct', 'tg_daily_summary') v`)).v);
  assert.equal((await q1(`select public.admin_notify_build('acct', 'stock_daily', $1::date) v`, [today])).v, 0, 'dedupe: already built');
  assert.equal((await q1(`select count(*)::int c from cron.job where jobname like 'notify_%'`)).c, 4);
});
report();
