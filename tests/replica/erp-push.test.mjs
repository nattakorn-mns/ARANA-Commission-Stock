// Checks SQL 12 (send to ERP, PO-based receiving, other items, dispense compare) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, stock, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;`);
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
const sql12 = stripExtensions(fs.readFileSync(SQL_1012 + '12_นำส่งERP-รับของตามPO-เทียบเบิก.sql', 'utf8'));
await check('12 runs twice', async () => { await db.exec(sql12); await db.exec(sql12); });

await db.exec(`update users set erp_emp_code = 'EMP3027' where username = 'acct';
update users set erp_emp_code = 'EMP3025' where username = 'front';
update products set expiry_controlled = true where code = 'P1';
insert into products(code, name, unit) values ('P9', 'ไม่อยู่ใน PO', 'ชิ้น');
insert into erp_open_purchase_orders(id, po_number, branch, order_date, vendor, items) values
 (gen_random_uuid(), 'PO-NEW', 'พิษณุโลก', '2026-10-15', 'บจก.ใหม่', '[{"sku":"P2","name":"วัสดุ B","unit":"ชิ้น","qty_ordered":5,"qty_received":0}]'),
 (gen_random_uuid(), 'PO-OLD', 'พิษณุโลก', '2026-10-01', 'บจก.ยา', '[{"sku":"P1","name":"ยา A","unit":"ซีซี","qty_ordered":10,"qty_received":4},{"sku":"P2","name":"วัสดุ B","unit":"ชิ้น","qty_ordered":3,"qty_received":3}]'),
 (gen_random_uuid(), 'PO-MS', 'แม่สอด', '2026-10-02', 'x', '[{"sku":"P1","qty_ordered":1,"qty_received":0}]');`);
const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const base = { p_branch_name: 'พิษณุโลก', p_move_type: 'IN', p_log_date: today, p_images: ['img1'] };

await check('open PO list: own branch, oldest first, names only (no quantities), fully received lines hidden', async () => {
  const list = (await q1(`select public.list_open_pos_for_receiving('front', 'พิษณุโลก') r`)).r;
  assert.deepEqual(list.map(p => p.po_no), ['PO-OLD', 'PO-NEW']);
  assert.deepEqual(list[0].items.map(i => i.sku), ['P1']);
  assert.equal(JSON.stringify(list).includes('qty'), false);
  assert.equal(list[0].items[0].expiry_controlled, true);
});

await check('receiving rules: PO required, whole numbers, item must be in PO, expiry for controlled items, 0 = not arrived', async () => {
  const line = { product_code: 'P2', qty: 2 };
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_lines: [line] }), /PO_REQUIRED/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-MS', p_lines: [line] }), /PO_NOT_OPEN/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-NEW', p_lines: [{ product_code: 'P2', qty: 1.5 }] }), /QTY_MUST_BE_WHOLE/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-NEW', p_lines: [{ product_code: 'P9', qty: 1 }] }), /NOT_IN_PO/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-OLD', p_lines: [{ product_code: 'P1', qty: 1 }] }), /EXPIRY_REQUIRED/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-NEW', p_lines: [{ product_code: 'P2', qty: 0 }] }), /INVALID_LINES/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_po_no: 'PO-NEW', p_lines: [{ product_code: 'P2', qty: null }] }), /INVALID_QTY/);
  const id = crypto.randomUUID();
  const r = await rpc('front', 'save_stock_request', { ...base, p_request_id: id, p_po_no: 'PO-OLD',
    p_lines: [{ product_code: 'P1', qty: 7, expire_date: '2028-01-31' }, { product_code: 'P2', qty: 0 }] });
  assert.equal(r.line_count, 1);
  const row = await q1(`select po_no, supplier_name, po_qty_expected::int e, qty::int q from stock_logs where request_id=$1`, [id]);
  assert.deepEqual([row.po_no, row.supplier_name, row.e, row.q], ['PO-OLD', 'บจก.ยา', 6, 7]);
  const pend = (await db.query(`select * from public.get_pending_stock_logs()`)).rows.find(x => x.request_id === id);
  assert.equal(Number(pend.po_qty_expected), 6);
});

await check('other items: saved with request, photos kept when no PO lines, accounting decides; OUT cannot carry them', async () => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_request_id: id, p_po_no: 'PO-NEW', p_lines: [{ product_code: 'P2', qty: 5 }],
    p_others: [{ name: 'กระดาษทิชชู่', qty: 2, unit: 'แพ็ค' }] });
  const only = crypto.randomUUID();
  const r = await rpc('front', 'save_stock_request', { ...base, p_request_id: only, p_others: [{ name: 'ปากกา', qty: 10 }] });
  assert.equal(r.other_count, 1);
  assert.deepEqual((await q1(`select images from receive_other_items where request_id=$1`, [only])).images, ['img1']);
  const again = await rpc('front', 'save_stock_request', { ...base, p_request_id: only, p_others: [{ name: 'ปากกา', qty: 10 }] });
  assert.equal(again.duplicate, true);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_move_type: 'OUT', p_source: 'ทั่วไป', p_request_id: crypto.randomUUID(),
    p_lines: [{ product_code: 'P2', qty: 1 }], p_others: [{ name: 'x', qty: 1 }] }), /INVALID_LINES/);
  await assert.rejects(rpc('front', 'save_stock_request', { ...base, p_request_id: crypto.randomUUID(), p_others: [{ name: '', qty: 1 }] }), /INVALID_OTHER_ITEM/);
  const list = (await q1(`select public.list_receive_other_items('acct', true) r`)).r;
  assert.equal(list.length, 2);
  assert.equal(list.find(x => x.item_name === 'กระดาษทิชชู่').po_no, 'PO-NEW');
  await assert.rejects(q1(`select public.list_receive_other_items('front', true)`), /FORBIDDEN|ROLE|permission/i);
  const pid = list.find(x => x.item_name === 'ปากกา').id;
  assert.equal((await q1(`select public.decide_receive_other_item('acct', $1, 'ไม่เข้าคลัง', 'ของสำนักงาน') r`, [pid])).r.affected, 1);
  assert.equal((await q1(`select public.list_receive_other_items('acct', true) r`)).r.length, 1);
  assert.equal(await stock('พิษณุโลก', 'P9'), 0, 'other items never touch stock');
});

await check('send: requisition / goods receive / transfer payloads, approver emp code, finish marks synced', async () => {
  const out = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_move_type: 'OUT', p_source: 'ห้องตรวจ', p_request_id: out,
    p_lines: [{ product_code: 'P2', qty: 1 }, { product_code: 'P2', qty: 2 }] });
  await assert.rejects(q1(`select public.erp_push_prepare('acct', $1, 'send')`, [out]), /อนุมัติไม่ครบ/);
  await rpc('acct', 'audit_stock_request', { p_request_id: out, p_status: 'อนุมัติแล้ว' });
  await assert.rejects(q1(`select public.erp_push_prepare('front', $1, 'send')`, [out]), /FORBIDDEN|ROLE|permission/i);
  const prep = (await q1(`select public.erp_push_prepare('acct', $1, 'send') r`, [out])).r;
  assert.equal(prep.docs.length, 1);
  const d = prep.docs[0];
  assert.equal(d.kind, 'requisition'); assert.equal(d.ext_ref, out);
  assert.equal(d.payload.approved_by_emp_code, 'EMP3027'); assert.equal(d.payload.created_by_emp_code, 'EMP3025');
  assert.equal(d.payload.branch, 'พิษณุโลก'); assert.deepEqual(d.payload.lines, [{ sku: 'P2', qty: 3, expire_date: null }]);
  await q1(`select public.erp_push_finish($1, 'send', false, null, 'ของไม่พอ')`, [out]);
  assert.equal((await q1(`select erp_sync_status s, erp_sync_error e from stock_logs where request_id=$1 limit 1`, [out])).e, 'ของไม่พอ');
  await q1(`select public.erp_push_finish($1, 'send', true, 'RQ-1', null)`, [out]);
  const rows = (await db.query(`select erp_sync_status s, erp_ref r from stock_logs where request_id=$1`, [out])).rows;
  assert.deepEqual([...new Set(rows.map(x => x.s + '|' + x.r))], ['ส่งสำเร็จ|RQ-1']);
  await assert.rejects(q1(`select public.erp_push_prepare('acct', $1, 'send')`, [out]), /ส่งเข้า ERP แล้ว/);

  const gr = (await q1(`select request_id from stock_logs where po_no='PO-OLD' limit 1`)).request_id;
  await rpc('acct', 'audit_stock_request', { p_request_id: gr, p_status: 'อนุมัติแล้ว' });
  const g = (await q1(`select public.erp_push_prepare('acct', $1, 'send') r`, [gr])).r.docs[0];
  assert.equal(g.kind, 'goods_receive'); assert.equal(g.payload.po_no, 'PO-OLD');
  assert.deepEqual(g.payload.lines, [{ sku: 'P1', qty: 7, expire_date: '2028-01-31' }]);

  const tf = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { ...base, p_move_type: 'TRANSFER', p_to_branch_name: 'แม่สอด', p_request_id: tf, p_lines: [{ product_code: 'P2', qty: 4 }] });
  await rpc('acct', 'audit_stock_request', { p_request_id: tf, p_status: 'อนุมัติแล้ว' });
  const t = (await q1(`select public.erp_push_prepare('acct', $1, 'send') r`, [tf])).r.docs;
  assert.deepEqual(t.map(x => x.kind), ['transfer_dispatch', 'transfer_receive']);
  assert.equal(t[0].payload.to_branch, 'แม่สอด'); assert.equal(t[1].payload.dispatch_ext_ref, tf);
  assert.notEqual(t[1].ext_ref, tf);
  assert.equal((await q1(`select public.erp_push_prepare('acct', $1, 'send') r`, [tf])).r.docs[1].ext_ref, t[1].ext_ref, 'receive ref is stable for retries');
});

await check('reverse: revert after send → ต้องยกเลิกที่ ERP → ERP reverse → done; transfers refuse', async () => {
  const out = (await q1(`select request_id from stock_logs where erp_ref='RQ-1' limit 1`)).request_id;
  await rpc('acct', 'revert_stock_request', { p_request_id: out, p_note: 'อนุมัติผิด' });
  assert.equal((await q1(`select erp_sync_status s from stock_logs where request_id=$1 limit 1`, [out])).s, 'ต้องยกเลิกที่ ERP');
  const r = (await q1(`select public.erp_push_prepare('acct', $1, 'reverse') r`, [out])).r;
  assert.equal(r.ext_ref, out); assert.equal(r.by_emp_code, 'EMP3027'); assert.equal(r.reason, 'อนุมัติผิด');
  await q1(`select public.erp_push_finish($1, 'reverse', true, null, null)`, [out]);
  const row = await q1(`select erp_sync_status s, erp_sync_error e from stock_logs where request_id=$1 limit 1`, [out]);
  assert.equal(row.s, 'ไม่ต้องส่ง'); assert.match(row.e, /ยกเลิกใน ERP แล้ว \(RQ-1\)/);
  const tf = (await q1(`select request_id from stock_logs where move_type='TRANSFER' limit 1`)).request_id;
  await q1(`select public.erp_push_finish($1, 'send', true, 'TF-1', null)`, [tf]);
  await rpc('acct', 'revert_stock_request', { p_request_id: tf, p_note: 'ผิด' });
  await assert.rejects(q1(`select public.erp_push_prepare('acct', $1, 'reverse')`, [tf]), /โอนกลับ/);
});

await check('dispense pull + compare: match, mismatch, missing, waiting for audit, daily totals without HN', async () => {
  const id = n => `00000000-0000-0000-0000-00000000d00${n}`;
  const ap = (rows) => q1(`select public.erp_apply_page_ext('dispense_items', $1::jsonb, true, true) n`, [JSON.stringify(rows)]);
  assert.equal((await ap([
    { id: id(1), doc_no: 'D1', service_date: '2026-10-15', branch: 'สาขาพิษณุโลก', hn: 'hn1', sku: 'P1', item_name: 'ยา A', qty: 2, updated_at: '2026-10-15T01:00:00Z' },
    { id: id(2), doc_no: 'D1', service_date: '2026-10-15', branch: 'สาขาพิษณุโลก', hn: 'HN1', sku: 'P2', item_name: 'วัสดุ B', qty: 3, updated_at: '2026-10-15T01:00:01Z' },
    { id: id(3), doc_no: 'D2', service_date: '2026-10-15', branch: 'สาขาพิษณุโลก', hn: 'HN2', sku: 'P1', item_name: 'ยา A', qty: 1, updated_at: '2026-10-15T01:00:02Z' },
    { id: id(4), doc_no: 'BLU-20261005-แม่สอด', service_date: '2026-10-15', branch: 'แม่สอด', hn: null, sku: 'P1', item_name: 'ยา A', qty: 9, updated_at: '2026-10-15T01:00:03Z' },
    { id: id(5), doc_no: 'D5', service_date: '2026-10-15', branch: 'สาขาพิษณุโลก', hn: 'HN5', sku: 'P2', qty: 1, updated_at: '2026-10-15T01:00:04Z' },
    { id: id(6), doc_no: 'D5', service_date: '2026-10-15', branch: 'สาขาพิษณุโลก', hn: 'HN5', sku: 'P2', qty: -1, is_return: true, updated_at: '2026-10-15T01:00:05Z' },
  ])).n, 6);
  assert.equal((await q1(`select public.erp_sync_cursor('dispense_items') c`)).c.after_id, id(6));
  const bill = async (hn, rows, status) => {
    const b = (await q1(`insert into bills(hn, customer_name, bill_date, branch_id) select $1, 'ลูกค้า '||$1, '2026-10-15', id from branches where name='พิษณุโลก' returning id`, [hn])).id;
    for (const [code, qty] of rows) await q1(`insert into stock_logs(opd_bill_id, branch_id, product_id, direction, move_type, qty, audit_status) select $1, b.id, p.id, 'OUT', 'OUT', $2, $4 from branches b, products p where b.name='พิษณุโลก' and p.code=$3`, [b, qty, code, status]);
  };
  await bill('HN1', [['P1', 2], ['P2', 1]], 'อนุมัติแล้ว');
  await bill('HN3', [['P2', 1]], 'อนุมัติแล้ว');
  await bill('HN2', [['P1', 1]], 'รอตรวจสอบ');
  const rows = (await q1(`select public.dispense_compare('acct', '2026-10-15', '2026-10-15', null) r`)).r;
  const st = (hn, sku) => rows.find(r => r.hn === hn && r.sku === sku)?.status;
  assert.equal(st('HN1', 'P1'), 'ตรง');
  assert.equal(st('HN1', 'P2'), 'จำนวนไม่ตรง');
  assert.equal(st('HN2', 'P1'), 'รอบัญชีตรวจ');
  assert.equal(st('HN3', 'P2'), 'บันทึกแต่ไม่มีใน ERP');
  assert.equal(rows.find(r => r.branch === 'แม่สอด').status, 'ยอดรวมรายวัน (ไม่มี HN)');
  assert.equal(st('HN5', 'P2'), undefined, 'returned in full = nothing to compare');
  await assert.rejects(q1(`select public.dispense_compare('front', '2026-10-15', '2026-10-15', null)`), /FORBIDDEN|ROLE|permission/i);
  await assert.rejects(q1(`select public.dispense_compare('acct', '2026-01-01', '2026-10-15', null)`), /INVALID_RANGE/);
  await q1(`select public.erp_apply_page_ext('ext_write_status', $1::jsonb, true, true)`, [JSON.stringify([{ id: id(7), kind: 'requisition', status: 'posted', erp_doc_no: 'RQ-1', branch: 'สาขาพิษณุโลก', updated_at: '2026-10-15T02:00:00Z' }])]);
  assert.equal((await q1(`select branch from erp_write_status`)).branch, 'พิษณุโลก');
});

await check('PO-only pulls scheduled at 11:00/17:00 and send only that dataset', async () => {
  const jobs = (await db.query(`select jobname, schedule, command from cron.job order by jobname`)).rows;
  assert.deepEqual(jobs.map(j => j.jobname + ' ' + j.schedule), ['erp_pull_daily 0 22 * * *', 'erp_pull_po_11 0 4 * * *', 'erp_pull_po_17 0 10 * * *']);
  await db.exec(`insert into private.app_config values ('erp_pull_url', 'https://x/functions/v1/erp-pull') on conflict (key) do nothing;`);
  await db.exec(`delete from net.calls; select private.erp_pull_call(array['open_purchase_orders']); select private.erp_pull_call();`);
  const calls = (await db.query(`select body from net.calls order by at`)).rows;
  assert.deepEqual(calls.map(c => c.body), [{ datasets: ['open_purchase_orders'] }, {}]);
});
report();
