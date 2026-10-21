// Checks SQL 20 (photo library list + session check for the photos Edge Function) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;`);
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', 'utf8')));
await db.exec(fs.readFileSync(SQL_1012 + '19_โอนข้ามสาขา2ขั้น-รับโอน.sql', 'utf8'));
const sql20 = fs.readFileSync(SQL_1012 + '20_คลังรูป-Storage.sql', 'utf8');
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const month = today.slice(0, 7);

await check('20 runs twice', async () => { await db.exec(sql20); const r = (await db.exec(sql20)).at(-1).rows[0]; assert.equal(Number(Object.values(r)[0]), 2); });

await check('list photos by kind / branch / month; staff only own branch; accounting any branch', async () => {
  const out = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { p_request_id: out, p_branch_name: 'พิษณุโลก', p_move_type: 'OUT', p_source: 'ห้องตรวจ', p_log_date: today,
    p_images: ['storage:out/PL/x.jpg'], p_lines: [{ product_code: 'P1', qty: 1 }] });
  const b = (await q1(`insert into bills(hn, customer_name, bill_date, branch_id, created_by) select 'HN1','ลูกค้า', $1::date, b.id, u.id from branches b, users u where b.name='พิษณุโลก' and u.username='front' returning id`, [today])).id;
  await db.query(`insert into bill_images(bill_id, file_url) values ($1, 'storage:opd/PL/a.jpg'), ($1, 'data:image/jpeg;base64,xx')`, [b]);
  const opd = (await q1(`select public.list_photos('front', 'opd', 'พิษณุโลก', $1) r`, [month])).r;
  assert.equal(opd.length, 2); assert.match(opd[0].title, /HN1/);
  const outs = (await q1(`select public.list_photos('front', 'out', 'พิษณุโลก', $1) r`, [month])).r;
  assert.deepEqual(outs.map(x => x.url), ['storage:out/PL/x.jpg']);
  assert.equal((await q1(`select public.list_photos('acct', 'opd', 'แม่สอด', $1) r`, [month])).r.length, 0);
  await assert.rejects(q1(`select public.list_photos('front', 'opd', 'แม่สอด', $1)`, [month]), /FORBIDDEN|BRANCH/i);
  await assert.rejects(q1(`select public.list_photos('front', 'zzz', 'พิษณุโลก', $1)`, [month]), /INVALID_KIND/);
});

await check('received-transfer photos appear under โอน at the destination', async () => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { p_request_id: id, p_branch_name: 'พิษณุโลก', p_to_branch_name: 'แม่สอด', p_move_type: 'TRANSFER', p_log_date: today,
    p_images: ['storage:transfer/PL/t.jpg'], p_lines: [{ product_code: 'P2', qty: 1 }] });
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'อนุมัติแล้ว' });
  await q1(`select public.receive_transfer('other', $1, '[{"product_code":"P2","qty":1}]'::jsonb, '["storage:transfer-receive/MS/r.jpg"]'::jsonb)`, [id]);
  const ms = (await q1(`select public.list_photos('other', 'transfer', 'แม่สอด', $1) r`, [month])).r;
  assert.deepEqual(ms.map(x => x.url), ['storage:transfer-receive/MS/r.jpg']);
});

await check('session check is for the Edge Function only', async () => {
  await db.exec(`set role anon`);
  await assert.rejects(q1(`select public.photo_session_check('front')`), /permission denied/);
  await db.exec(`reset role`);
  const r = (await q1(`select public.photo_session_check('front') r`)).r; // replica runs as postgres = service
  assert.equal(r.role, 'Frontdesk');
});
report();
