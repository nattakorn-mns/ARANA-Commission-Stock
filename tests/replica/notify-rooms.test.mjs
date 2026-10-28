// Checks SQL 23 (room book, several rooms per topic, editable message templates) on top of SQL 21.
import fs from 'node:fs';
import vm from 'node:vm';
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
for (const f of ['13_HNตรงกับERP-รายชื่อลูกค้า.sql', '15_เชื่อมมัดจำ-รอยืนยัน-ข้ามสาขา.sql', '17_เข้าสู่ระบบด้วยบัญชีERP.sql', '18_รอบ2-ตั้งค่า-ขอแก้ไข-ประวัติ.sql',
                 '21_รอบ5-แจ้งเตือนรูปแบบเดิม-ค่าคอมปิดแชท.sql'])
  await db.exec(fs.readFileSync(SQL_1012 + f, 'utf8'));
await db.exec(`update users set role = 'Admin' where username = 'acct';
update notify_channels set target_id = '-100111' where provider = 'telegram';
update notify_channels set target_id = 'C' || key where provider = 'line';`);
await q1(`select public.admin_save_app_setting('acct', 'notify_admin_tag', '"@aom"'::jsonb)`);
const sql23 = fs.readFileSync(SQL_1012 + '23_ห้องแจ้งเตือน-รูปแบบข้อความตั้งค่าเอง.sql', 'utf8');
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const thai = today.slice(8, 10) + '/' + today.slice(5, 7) + '/' + (Number(today.slice(0, 4)) + 543);
const msgs = async kind => (await db.query(`select q.text_body, q.room_id, r.name from notify_queue q left join notify_rooms r on r.id = q.room_id where kind = $1 order by q.created_at`, [kind])).rows;
const bill = (extra = {}) => rpc('front', 'create_opd_bill', { p_payload: { branch_name: 'พิษณุโลก', hn: 'HN0001', customer_name: 'ปาธิชา พูลเพิ่ม', date: today,
  customer_source: 'หน้าร้าน', services: [{ program_code: 'PG1', price: 5000, commission: 30 }],
  sales: [{ type: 'crosssell', old_program: 'ปรึกษาโปรแกรมรักษาสิว', new_program: 'เลเซอร์ คอร์ส 10 ครั้ง', new_price: 8999, pay_type: 'มัดจำ',
            amount_paid: 1000, commission_pct: 1.5, commission_amt: 15 }], ...extra } });
const OLD_SALE = [`วันที่: ${thai}`, 'ร้าน/สาขา: ARANA พิษณุโลก', 'ชื่อพนักงาน: พนักงาน (เอ)', 'ช่องทาง: หน้าร้าน', 'ชื่อลูกค้า: ปาธิชา พูลเพิ่ม',
  '📍จองมาโปร: ปรึกษาโปรแกรมรักษาสิว', '🛒ขายเพิ่ม: เลเซอร์ คอร์ส 10 ครั้ง', '🛒ขายเพิ่มราคา: 8,999', '⏩แบ่งจ่าย/มัดจำ: มัดจำ', '⏩ ยอดแบ่งจ่าย/มัดจำ: 1,000',
  '✅ยอดรวมที่ได้: 1,000', '⛔หมายเหตุ: -', '🔼เปอร์เซ็นต์ค่าคอม: 1.5'].join('\n');

await check('23 runs twice; old room ids move into the room book (same id + bot = one room)', async () => {
  await db.exec(sql23);
  const r = (await db.exec(sql23)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [2, 7, 8]);
  const links = (await q1(`select count(*)::int c from notify_channel_rooms`)).c;
  assert.equal(links, 8);
  const tg = await q1(`select count(distinct room_id)::int c from notify_channel_rooms where channel_key like 'tg_%'`);
  assert.equal(tg.c, 1, 'both Telegram topics share one room');
});

await check('default templates give exactly the old messages (sale / edit request / 23:00 summary)', async () => {
  await bill();
  assert.equal((await msgs('upsell_item')).at(-1).text_body, OLD_SALE);
  await q1(`select public.notify_build_staff_daily()`);
  assert.match((await msgs('staff_daily')).at(-1).text_body,
    new RegExp(`^⛔วันที่: ${thai.replace(/\//g, '\\/')}\\n📍ชื่อพนักงาน: พนักงาน \\(เอ\\)\\n📍สาขา: พิษณุโลก\\n◾ค่ามือ: \\d[\\d,]*\\n◾อัพเซลล์: 0\\n◾ขายเพิ่ม: [\\d,]+\\n◾ขายของ: 0$`));
  const id = await bill();
  const p = { edit_commission: true, hn: 'HN0001', customer_name: 'ปาธิชา พูลเพิ่ม', date: today, services: [{ program_code: 'PG1', price: 5000, commission: 30 }],
    sales: [{ type: 'crosssell', new_program: 'เลเซอร์ คอร์ส 10 ครั้ง', new_price: 8999, amount_paid: 2000, commission_pct: 10, commission_amt: 200 }] };
  const req = (await q1(`select public.submit_bill_edit('front', $1, $2::jsonb, 'ใส่ยอดผิด') r`, [id, JSON.stringify(p)])).r.request_id;
  const er = (await msgs('edit_request')).at(-1).text_body;
  assert.equal(er, ['[ขอแก้ไขรายการ] @aom', `วันที่: ${thai}`, 'ร้าน/สาขา: ARANA พิษณุโลก', 'ชื่อพนักงาน: พนักงาน (เอ)', 'ชื่อลูกค้า: ปาธิชา พูลเพิ่ม',
    'รายการ: ค่ามือ/ค่าคอม', 'เหตุผล: ใส่ยอดผิด', 'สถานะ: รออนุมัติ'].join('\n'));
  await q1(`select public.decide_bill_edit('acct', $1, true)`, [req]);
  assert.match((await msgs('edit_approved')).at(-1).text_body, /^\[แก้ไขรายการ — อนุมัติแล้ว\]\nวันที่: .*\n[\s\S]*✅ยอดรวมที่ได้: 2,000\n⛔หมายเหตุ: -\n🔼เปอร์เซ็นต์ค่าคอม: 10$/);
});

let testRoom;
await check('add a room + send one topic to two rooms; each room gets its own copy, no duplicates', async () => {
  testRoom = (await q1(`select public.admin_notify_save_room('acct', '{"name":"กลุ่มเทส","provider":"telegram","target_id":"-100999","secret_name":"tg_bot_token"}'::jsonb) r`)).r;
  const main = (await q1(`select room_id from notify_channel_rooms where channel_key = 'tg_upsell_items'`)).room_id;
  await q1(`select public.admin_notify_set_topic('acct', 'tg_upsell_items', $1::uuid[], true)`, [[main, testRoom]]);
  const before = (await msgs('upsell_item')).length;
  await bill({ hn: 'HN0002' });
  const rows = (await msgs('upsell_item')).slice(before);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.name).sort(), ['กลุ่มเทส', 'กลุ่ม Telegram -100111'].sort());
  // ส่งซ้ำด้วย dedupe เดิม → ไม่เพิ่ม
  const sale = (await q1(`select id from bill_sales order by created_at desc limit 1`)).id;
  assert.equal((await q1(`select private.notify_enqueue('tg_upsell_items', 'upsell_item', 'upsell_item:' || $1, 'x') r`, [sale])).r, null);
  // ตัวส่งได้เลขห้อง + บอทของห้องนั้น
  const claimed = (await q1(`select public.notify_claim_pending(50) r`)).r.filter(i => i.kind === 'upsell_item' && i.room_name === 'กลุ่มเทส');
  assert.ok(claimed.length >= 1);
  assert.deepEqual([claimed[0].target_id, claimed[0].secret_name, claimed[0].provider], ['-100999', 'TG_BOT_TOKEN', 'telegram']);
});

await check('switch topic to the test room only; room test button; room validation', async () => {
  await q1(`select public.admin_notify_set_topic('acct', 'tg_upsell_items', $1::uuid[], true)`, [[testRoom]]);
  const before = (await msgs('upsell_item')).length;
  await bill({ hn: 'HN0003' });
  assert.deepEqual((await msgs('upsell_item')).slice(before).map(r => r.name), ['กลุ่มเทส']);
  await q1(`select public.admin_notify_test_room('acct', $1)`, [testRoom]);
  assert.match((await msgs('test')).at(-1).text_body, /^✅ ทดสอบการแจ้งเตือนจากระบบส่วนขยาย\nห้อง: กลุ่มเทส\nเวลา: /);
  await assert.rejects(q1(`select public.admin_notify_save_room('acct', '{"name":"x","provider":"telegram","target_id":"abc","secret_name":"TG_BOT_TOKEN"}'::jsonb)`), /ROOM_TARGET_INVALID/);
  await assert.rejects(q1(`select public.admin_notify_save_room('acct', '{"name":"x","provider":"line","target_id":"C1","secret_name":"bad name"}'::jsonb)`), /ROOM_SECRET_INVALID/);
  await assert.rejects(q1(`select public.admin_notify_rooms('front')`), /FORBIDDEN|ROLE|permission/i);
  // ปิดเรื่อง = ไม่ส่ง
  await q1(`select public.admin_notify_set_topic('acct', 'tg_upsell_items', $1::uuid[], false)`, [[testRoom]]);
  const n = (await msgs('upsell_item')).length;
  await bill({ hn: 'HN0004' });
  assert.equal((await msgs('upsell_item')).length, n);
  await q1(`select public.admin_notify_set_topic('acct', 'tg_upsell_items', $1::uuid[], true)`, [[testRoom]]);
});

await check('custom template: used for the next message; empty "หัวข้อ: {x}" lines dropped; typo placeholder kept', async () => {
  const tpl = { upsell_item: '🔥 {ขายเพิ่ม} ({ขายเพิ่มราคา})\nโดย {พนักงาน} · {สาขา}\nอัพเพิ่ม: {อัพเพิ่ม}\nพิมพ์ผิด {ไม่มีช่องนี้}' };
  await q1(`select public.admin_save_app_setting('acct', 'notify_templates', $1::jsonb)`, [JSON.stringify(tpl)]);
  await bill({ hn: 'HN0005' });
  assert.equal((await msgs('upsell_item')).at(-1).text_body, '🔥 เลเซอร์ คอร์ส 10 ครั้ง (8,999)\nโดย พนักงาน (เอ) · พิษณุโลก\nพิมพ์ผิด {ไม่มีช่องนี้}');
  await assert.rejects(q1(`select public.admin_save_app_setting('acct', 'notify_templates', $1::jsonb)`, [JSON.stringify({ x: 'a'.repeat(2001) })]), /INVALID_SETTING/);
  await q1(`select public.admin_save_app_setting('acct', 'notify_templates', '{}'::jsonb)`);
  await bill({ hn: 'HN0006' });
  assert.equal((await msgs('upsell_item')).at(-1).text_body, OLD_SALE.replace('ปาธิชา พูลเพิ่ม', 'ปาธิชา พูลเพิ่ม'));
});

await check('delete room: its waiting messages are cancelled, topic link removed', async () => {
  const pending = (await q1(`select count(*)::int c from notify_queue where room_id = $1 and status = 'รอส่ง'`, [testRoom])).c;
  assert.ok(pending > 0);
  await q1(`select public.admin_notify_delete_room('acct', $1)`, [testRoom]);
  assert.equal((await q1(`select count(*)::int c from notify_queue where status = 'ข้าม' and last_error = 'ลบห้องแล้ว'`)).c, pending);
  assert.equal((await q1(`select count(*)::int c from notify_channel_rooms where channel_key = 'tg_upsell_items'`)).c, 0);
  assert.equal((await q1(`select public.admin_notify_test('acct', 'tg_upsell_items') r`)).r, null, 'no room = nothing queued');
});

await check('browser renderer (notifyFill) = database renderer (tpl_fill); share defaults render as specified', async () => {
  const ctx = { appSettings: { notify_templates: {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(REPO + '/js/notify-templates.js', 'utf8') + '\n;this.NOTIFY_TPL_META = NOTIFY_TPL_META; this.notifyFill = notifyFill; this.notifyTemplate = notifyTemplate;', ctx);
  await db.exec(fs.readFileSync(SQL_1012 + '27_ยืนยันยอดสรุปรายวัน-สรุปสิ้นวัน-ตีกลับ.sql', 'utf8'));
  const defaults = (await q1(`select public.admin_notify_template_defaults('acct') r`)).r;
  for (const m of ctx.NOTIFY_TPL_META) {
    const tpl = m.group === 'bot' ? defaults[m.kind] : ctx.notifyTemplate(m.kind);
    assert.ok(tpl, 'default for ' + m.kind);
    const sql = (await q1(`select private.tpl_fill($1, $2::jsonb) t`, [tpl, JSON.stringify(m.sample)])).t;
    assert.equal(ctx.notifyFill(tpl, m.sample), sql, m.kind);
  }
  const odd = ['  หัวข้อ: {a}  ', '{a}', 'x {a} {b}', 'ว่าง: {a} {b}', '{ไม่รู้จัก}: {a}', '', 'จบ'].join('\n');
  for (const vars of [{ a: '', b: '' }, { a: ' 1 ', b: '' }, { a: '\nสอง\nบรรทัด\n', b: 'b' }])
    assert.equal(ctx.notifyFill(odd, vars), (await q1(`select private.tpl_fill($1, $2::jsonb) t`, [odd, JSON.stringify(vars)])).t, JSON.stringify(vars));
  assert.equal(ctx.notifyFill(ctx.notifyTemplate('share_out'), { วันที่: '24/10/2569', สาขา: 'พิษณุโลก', ชื่อ: 'ณัฏฐากร (ออม)', จำนวน: '2', ลิงก์รูป: 'ดูรูป: https://x' }),
    'วันที่ 24/10/2569 สาขาพิษณุโลก\nณัฏฐากร (ออม) - ส่งเบิก 2 รายการ\nดูรูป: https://x');
  assert.equal(ctx.notifyFill(ctx.notifyTemplate('share_in'), { วันที่: '1', สาขา: 'A', ชื่อ: 'B', จำนวน: '3', เลขPO: '', ลิงก์รูป: '' }), 'วันที่ 1 สาขาA\nB - รับเข้า 3 รายการ');
});
report();
