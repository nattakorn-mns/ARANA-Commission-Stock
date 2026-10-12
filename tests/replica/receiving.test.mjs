// Checks SQL 06 (receiving: PO no / supplier / lot / expiry) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, stock, check, report } = helpers(db);
await applyBase(db);
const sql06 = fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8');
await check('06 runs twice', async () => { await db.exec(sql06); await db.exec(sql06); });
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const base = { p_branch_name: 'พิษณุโลก', p_move_type: 'IN', p_log_date: today, p_images: ['x'] };
await check('receiving stores PO/supplier per request and lot/expiry per line', async () => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_request_id: id, p_po_no: ' PO-20261012-01 ', p_supplier_name: 'บจก.ยา',
    p_lines: [{ product_code: 'P1', qty: 10, lot_no: 'L1', expire_date: '2027-12-31' }, { product_code: 'P2', qty: 3 }] });
  const rows = (await db.query(`select po_no, supplier_name, lot_no, expire_date::text e from stock_logs where request_id=$1 order by created_at`, [id])).rows;
  assert.deepEqual(rows.map(r => [r.po_no, r.supplier_name, r.lot_no, r.e]), [['PO-20261012-01', 'บจก.ยา', 'L1', '2027-12-31'], ['PO-20261012-01', 'บจก.ยา', null, null]]);
  const pend = (await db.query(`select * from public.get_pending_stock_logs()`)).rows.filter(r => r.request_id === id);
  assert.equal(pend[0].po_no, 'PO-20261012-01'); assert.equal(pend[0].lot_no, 'L1');
  assert.equal(await stock('พิษณุโลก', 'P1'), 100, 'not added until approval');
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'อนุมัติแล้ว' });
  assert.equal(await stock('พิษณุโลก', 'P1'), 110);
  const erp = (await db.query(`select public.list_stock_logs_erp_sync('acct', null) r`)).rows[0].r.find(x => x.request_id === id && x.product_code === 'P1');
  assert.equal(erp.lot_no, 'L1'); assert.equal(erp.supplier_name, 'บจก.ยา');
});
await check('expiry before receive date is refused; OUT ignores PO fields', async () => {
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_lines: [{ product_code: 'P1', qty: 1, expire_date: '2020-01-01' }] }), /EXPIRED_ON_RECEIPT/);
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_request_id: id, p_move_type: 'OUT', p_source: 'ทั่วไป', p_po_no: 'X', p_lines: [{ product_code: 'P1', qty: 1 }] });
  assert.equal((await q1(`select po_no from stock_logs where request_id=$1`, [id])).po_no, null);
});
await check('IN rows now queue for ERP; OPD rows still do not', async () => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_request_id: id, p_lines: [{ product_code: 'P2', qty: 1 }] });
  assert.equal((await q1(`select erp_sync_status s from stock_logs where request_id=$1`, [id])).s, 'รอส่ง');
  const bill = (await q1(`insert into bills(hn, customer_name, branch_id) select 'H','c', id from branches where name='พิษณุโลก' returning id`)).id;
  const s = (await q1(`insert into stock_logs(opd_bill_id, branch_id, product_id, direction, move_type, qty) select $1, b.id, p.id, 'OUT','OUT',1 from branches b, products p where b.name='พิษณุโลก' and p.code='P2' returning erp_sync_status s`, [bill])).s;
  assert.equal(s, 'ไม่ต้องส่ง');
});
report();
