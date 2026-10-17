// Checks SQL 09 (apply ERP pages into the extension) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;
create or replace function extensions.crypt(text, text) returns text language sql as $$ select public.crypt($1, $2) $$;
create or replace function extensions.gen_salt(text) returns text language sql as $$ select public.gen_salt($1) $$;
insert into branches(name) values ('กำแพงเพชร');`.replace('erp_emp_code)', 'erp_emp_code)'));
const sql09 = stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8'));
const apply = async (ds, rows, first = true, done = true) => (await q1(`select public.erp_apply_page($1, $2::jsonb, $3, $4) n`, [ds, JSON.stringify(rows), first, done])).n;

await check('09 runs twice', async () => { await db.exec(sql09); await db.exec(sql09); });
await db.exec("insert into users(username, name, nickname, role, branch_id, password_hash, erp_emp_code) select 'EMP3025', 'ปาวีณา', 'มายด์', 'Frontdesk', id, 'keep', 'EMP3025' from branches where name='พิษณุโลก';");
await check('employees: update existing (password kept), create new, skip doctors, deactivate leavers, branch mapping', async () => {
  const n = await apply('employees', [
    { id: '00000000-0000-0000-0000-000000000001', emp_code: 'EMP3025', full_name: 'ปาวีณา จันตาเรียน', nickname: 'มายด์', position: 'Beauty Consult', branch: 'สาขาพิษณุโลก', active: true, arana_time_code: '006', updated_at: '2026-10-12T01:00:00Z' },
    { id: '00000000-0000-0000-0000-000000000002', emp_code: 'EMP4001', full_name: 'คนใหม่', nickname: 'ใหม่', position: 'แม่บ้าน', branch: 'สาขากำแพงเพชร', active: true, arana_time_code: '099', updated_at: '2026-10-12T02:00:00Z' },
    { id: '00000000-0000-0000-0000-000000000003', emp_code: 'DR099', full_name: 'หมอ', nickname: null, position: 'แพทย์', branch: null, active: true, arana_time_code: null, updated_at: '2026-10-12T03:00:00Z' },
    { id: '00000000-0000-0000-0000-000000000004', emp_code: 'EMP4002', full_name: 'แอดมินใหม่', nickname: 'แอด', position: 'แอดมิน', branch: 'สาขา Back Office', active: true, arana_time_code: '100', updated_at: '2026-10-12T04:00:00Z' },
  ]);
  assert.equal(n, 4);
  assert.equal((await q1(`select name, password_hash from users where username='EMP3025'`)).password_hash, 'keep');
  const nw = await q1(`select role, display_position, (select name from branches where id=branch_id) b, password_hash = extensions.crypt('EMP4001-099', password_hash) pw from users where username='EMP4001'`);
  assert.equal(nw.display_position, 'พนักงานคลัง'); assert.equal(nw.b, 'กำแพงเพชร'); assert.equal(nw.pw, true);
  assert.equal((await q1(`select count(*)::int n from users where username='DR099'`)).n, 0);
  const ad = await q1(`select role, (select name from branches where id=branch_id) b from users where username='EMP4002'`);
  assert.equal(ad.role, 'OnlineSales'); assert.equal(ad.b, 'พิษณุโลก');
  await apply('employees', [{ id: '00000000-0000-0000-0000-000000000002', emp_code: 'EMP4001', full_name: 'คนใหม่', position: 'แม่บ้าน', branch: 'สาขากำแพงเพชร', active: false, updated_at: '2026-10-13T00:00:00Z' }]);
  assert.equal((await q1(`select is_active from users where username='EMP4001'`)).is_active, false);
  const cur = (await q1(`select public.erp_sync_cursor('employees') c`)).c;
  assert.equal(cur.after_id, '00000000-0000-0000-0000-000000000002');
});
await check('stock_items upsert keeps code, sets ERP item id; balance and open POs replaced each run', async () => {
  await apply('stock_items', [{ id: '00000000-0000-0000-0000-0000000000a1', sku: 'P1', name: 'ยา A ใหม่', unit: 'ซีซี', category: 'ยา', lot_controlled: true, expiry_controlled: true, updated_at: '2026-10-12T00:00:00Z' },
                              { id: '00000000-0000-0000-0000-0000000000a2', sku: 'NEW1', name: 'ของใหม่', unit: 'ชิ้น', category: 'อุปกรณ์', lot_controlled: false, expiry_controlled: false, updated_at: '2026-10-12T00:00:01Z' }]);
  const p = await q1(`select name, erp_item_id from products where code='P1'`); assert.equal(p.name, 'ยา A ใหม่'); assert.ok(p.erp_item_id);
  assert.equal((await q1(`select type from products where code='NEW1'`)).type, 2);
  await apply('stock_balance', [{ id: '00000000-0000-0000-0000-0000000000a1', sku: 'P1', qty_by_branch: { 'พิษณุโลก': 5 }, as_of: '2026-10-12T00:00:00Z' }, { sku: 'P2', qty_by_branch: {} }]);
  await apply('stock_balance', [{ id: '00000000-0000-0000-0000-0000000000a1', sku: 'P1', qty_by_branch: { 'พิษณุโลก': 4 } }]);
  assert.equal((await q1(`select count(*)::int n from erp_stock_balance`)).n, 1);
  assert.equal((await q1(`select qty_by_branch->>'พิษณุโลก' q from erp_stock_balance where sku='P1'`)).q, '4');
  await apply('open_purchase_orders', [{ id: '00000000-0000-0000-0000-0000000000b1', po_number: 'PO-1', branch: 'สาขาแม่สอด', items: [{ sku: 'P1', qty_ordered: 10, qty_received: 0 }] }]);
  assert.equal((await q1(`select branch from erp_open_purchase_orders`)).branch, 'แม่สอด');
});
await check('commissions/deposits stored for cross-check; multi-page counts add up; errors recorded', async () => {
  const sc = i => ({ id: `00000000-0000-0000-0000-00000000c00${i}`, service_date: '2026-10-12', branch: 'สาขาพิษณุโลก', customer_hn: 'HN1', service_name: 'x', doctor_name: 'd', doctor_amount: 100, staff_commissions: [{ name: 'มายด์', amount: 50 }], total_staff_amount: 50, updated_at: `2026-10-12T00:00:0${i}Z` });
  await apply('service_commissions', [sc(1), sc(2)], true, false);
  await apply('service_commissions', [sc(3)], false, true);
  assert.equal((await q1(`select count(*)::int n from erp_service_commissions`)).n, 3);
  assert.equal((await q1(`select last_count from private.erp_sync_state where dataset='service_commissions'`)).last_count, 3);
  await apply('deposits', [{ id: '00000000-0000-0000-0000-0000000000d1', receipt_no: 'DP-1', received_date: '2026-10-12', branch: 'สาขาพิษณุโลก', amount: 2999, status: 'paid', sales_staff: [], updated_at: '2026-10-12T00:00:00Z' }]);
  assert.equal((await q1(`select amount from erp_deposits`)).amount, '2999');
  await db.query(`select public.erp_apply_page('deposits', '[]'::jsonb, false, true, 'ERP 401: invalid key')`);
  assert.equal((await q1(`select last_error from private.erp_sync_state where dataset='deposits'`)).last_error, 'ERP 401: invalid key');
});
await check('admin status + sync-now; cron job scheduled', async () => {
  await db.query(`update users set role='Admin' where username='acct'`);
  const st = (await q1(`select public.admin_erp_sync_status('acct') v`)).v;
  assert.equal(st.configured, false); assert.ok(st.datasets.length >= 5);
  await assert.rejects(db.query(`select public.admin_erp_sync_now('front')`), /FORBIDDEN_ROLE/);
  await db.query(`insert into private.app_config values ('erp_pull_url','https://x/functions/v1/erp-pull') on conflict do nothing`);
  assert.equal((await q1(`select length(value) l from private.app_config where key='erp_pull_key'`)).l, 48);
  await db.query(`select public.admin_erp_sync_now('acct')`);
  assert.equal((await q1(`select count(*)::int n from net.calls where url like '%erp-pull'`)).n, 1);
  assert.equal((await q1(`select count(*)::int n from cron.job where jobname='erp_pull_daily'`)).n, 1);
});
report();
