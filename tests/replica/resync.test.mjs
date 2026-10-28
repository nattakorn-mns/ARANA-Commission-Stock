// Checks SQL 24 (re-set a branch's stock from the latest ERP balance, keeping web records that ERP does not have yet).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, stock, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;`);
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', 'utf8')));
await db.exec(fs.readFileSync(SQL_1012 + '19_โอนข้ามสาขา2ขั้น-รับโอน.sql', 'utf8'));
await db.exec(`update users set role = 'Admin', erp_emp_code = 'EMP1' where username = 'acct'; update users set erp_emp_code = 'EMP2' where username = 'front';
insert into branches(name) values ('นครสวรรค์');
insert into erp_stock_balance (sku, qty_by_branch, as_of) values
  ('P1', '{"สาขาแม่สอด": 40, "สาขาพิษณุโลก": 90}', now() - interval '1 hour'),
  ('P2', '{"สาขาแม่สอด": 7}', now() - interval '1 hour');
insert into erp_open_purchase_orders(id, po_number, branch, order_date, vendor, items) values
  (gen_random_uuid(), 'PO-MS', 'แม่สอด', '2026-10-15', 'บจก.ใหม่', '[{"sku":"P2","name":"วัสดุ B","unit":"ชิ้น","qty_ordered":5,"qty_received":0}]');`);
const sql24 = fs.readFileSync(SQL_1012 + '24_ตั้งยอดสต๊อกตามERPใหม่-รายสาขา.sql', 'utf8');
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const preview = async b => (await q1(`select public.admin_stock_resync_preview('acct', $1) r`, [b])).r;
const apply = async (b, snap) => (await q1(`select public.admin_stock_resync_apply('acct', $1, $2) r`, [b, snap])).r;
const save = async (tok, branch, type, lines, to) => {
  const id = crypto.randomUUID();
  await rpc(tok, 'save_stock_request', { p_request_id: id, p_branch_name: branch, p_to_branch_name: to || null, p_move_type: type, p_source: type === 'OUT' ? 'ทั่วไป' : null, p_po_no: type === 'IN' ? 'PO-MS' : null,
    p_log_date: today, p_images: ['img'], p_lines: lines });
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'อนุมัติแล้ว' });
  return id;
};

await check('24 runs twice; checks 1 / 4', async () => {
  await db.exec(sql24);
  const r = (await db.exec(sql24)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [1, 4]);
});

await check('first set (new branch case): preview lists only changes; nothing changes until confirmed; then = ERP', async () => {
  const p = await preview('แม่สอด');
  assert.deepEqual(p.rows.map(r => [r.code, Number(r.cur), Number(r.new)]).sort(), [['P1', 100, 40], ['P2', 100, 7], ['P3', 100, 0]]);
  assert.equal(await stock('แม่สอด', 'P1'), 100, 'preview does not change stock');
  assert.equal(await apply('แม่สอด', p.snapshot), 3);
  assert.deepEqual([await stock('แม่สอด', 'P1'), await stock('แม่สอด', 'P2'), await stock('พิษณุโลก', 'P1')], [40, 7, 100], 'other branches untouched');
  assert.equal((await preview('แม่สอด')).rows.length, 0);
  assert.equal((await preview('แม่สอด')).last.changed, 3);
});

let outId;
await check('web records after the set (เบิก / รับเข้า / รับโอน) are kept on a re-set — not lost, not counted twice', async () => {
  outId = await save('other', 'แม่สอด', 'OUT', [{ product_code: 'P1', qty: 3 }]);
  await save('other', 'แม่สอด', 'IN', [{ product_code: 'P2', qty: 5 }]);
  const tr = await save('front', 'พิษณุโลก', 'TRANSFER', [{ product_code: 'P1', qty: 2 }], 'แม่สอด');
  await q1(`select public.receive_transfer('other', $1, '[{"product_code":"P1","qty":2}]'::jsonb, '["photo"]'::jsonb, 'ok')`, [tr]);
  await q1(`select public.decide_transfer_receipt('acct', $1, 'approve', null)`, [tr]);
  assert.deepEqual([await stock('แม่สอด', 'P1'), await stock('แม่สอด', 'P2')], [39, 12]);
  const p = await preview('แม่สอด');
  assert.equal(p.rows.length, 0, 'ERP + web-only records = current balance');
});

await check('after the เบิก doc reaches ERP and ERP makes a new balance, it is not added again', async () => {
  await db.query(`update stock_logs set erp_sync_status = 'ส่งสำเร็จ', erp_synced_at = now(), erp_ref = 'RQ-1' where coalesce(request_id, id) = $1`, [outId]);
  // ส่งเข้า ERP หลังเวลาที่ ERP ทำยอดชุดเดิม → ยังนับเป็น "ยังไม่อยู่ใน ERP"
  assert.equal((await preview('แม่สอด')).rows.length, 0);
  await db.exec(`update erp_stock_balance set qty_by_branch = '{"สาขาแม่สอด": 37, "สาขาพิษณุโลก": 90}', as_of = now() + interval '1 minute' where sku = 'P1';
                 update erp_stock_balance set as_of = now() + interval '1 minute' where sku = 'P2';`);
  assert.equal((await preview('แม่สอด')).rows.length, 0, 'ERP 37 already includes the -3; +2 transfer still web-only');
});

await check('accounting fixes a back-dated เบิก in ERP → re-set picks it up; stale preview is refused', async () => {
  const old = await preview('แม่สอด');
  await db.exec(`update erp_stock_balance set qty_by_branch = '{"สาขาแม่สอด": 35, "สาขาพิษณุโลก": 90}', as_of = now() + interval '2 minute' where sku = 'P1';`);
  await assert.rejects(apply('แม่สอด', old.snapshot), /ERP_BALANCE_CHANGED/);
  const p = await preview('แม่สอด');
  assert.deepEqual(p.rows.map(r => [r.code, Number(r.cur), Number(r.erp), Number(r.ext_not_in_erp), Number(r.new)]), [['P1', 39, 35, 2, 37]]);
  assert.equal(await apply('แม่สอด', p.snapshot), 1);
  assert.equal(await stock('แม่สอด', 'P1'), 37);
  assert.equal((await q1(`select count(*)::int c from stock_resync_log`)).c, 2);
  assert.ok((await q1(`select count(*)::int c from audit_logs where action = 'ตั้งยอดสต๊อกตาม ERP'`)).c >= 2);
});

await check('guards: branch with no ERP balance; non-admin', async () => {
  await assert.rejects(preview('นครสวรรค์'), /ERP_NO_BRANCH/);
  await assert.rejects(q1(`select public.admin_stock_resync_preview('other', 'แม่สอด')`), /FORBIDDEN|ROLE|permission/i);
  await db.exec(`update users set role = 'Audit' where username = 'acct'`);
  assert.ok((await preview('แม่สอด')).rows, 'accounting can use it');
});
report();
