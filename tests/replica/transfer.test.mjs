// Checks SQL 19 (two-step branch transfer: dispatch → blind receive → accounting decides) on the local replica.
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
await db.exec(`update users set erp_emp_code = 'EMP1' where username = 'acct'; update users set erp_emp_code = 'EMP2' where username = 'front';`);
const sql19 = fs.readFileSync(SQL_1012 + '19_โอนข้ามสาขา2ขั้น-รับโอน.sql', 'utf8');

await check('19 runs twice; checks report 3 / 6 / 1', async () => {
  await db.exec(sql19);
  const r = (await db.exec(sql19)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [3, 6, 1]);
});

const today = (await q1(`select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') d`)).d;
const send = async (lines) => {
  const id = crypto.randomUUID();
  await rpc('front', 'save_stock_request', { p_request_id: id, p_branch_name: 'พิษณุโลก', p_to_branch_name: 'แม่สอด', p_move_type: 'TRANSFER',
    p_log_date: today, p_images: ['img'], p_lines: lines });
  await rpc('acct', 'audit_stock_request', { p_request_id: id, p_status: 'อนุมัติแล้ว' });
  return id;
};
const receive = (tok, id, lines) => q1(`select public.receive_transfer($1, $2, $3::jsonb, '["photo"]'::jsonb, 'ok') r`, [tok, id, JSON.stringify(lines)]);
const decide = (id, d, note) => q1(`select public.decide_transfer_receipt('acct', $1, $2, $3) r`, [id, d, note || null]);
const prep = async id => (await q1(`select public.erp_push_prepare('acct', $1, 'send') r`, [id])).r;

await check('approve dispatch: origin cut, destination waits; list hides quantities; only destination branch can receive', async () => {
  const s0 = await stock('พิษณุโลก', 'P1'), d0 = await stock('แม่สอด', 'P1');
  const id = await send([{ product_code: 'P1', qty: 5 }, { product_code: 'P2', qty: 2 }]);
  assert.equal(await stock('พิษณุโลก', 'P1'), s0 - 5);
  assert.equal(await stock('แม่สอด', 'P1'), d0, 'destination not added before receiving');
  const list = (await q1(`select public.list_incoming_transfers('other', 'แม่สอด') r`)).r;
  assert.equal(list.length, 1); assert.equal(list[0].items.length, 2);
  assert.equal(JSON.stringify(list).includes('"qty'), false, 'blind count: no quantities');
  await assert.rejects(q1(`select public.list_incoming_transfers('front', 'แม่สอด')`), /FORBIDDEN|BRANCH/i);
  await assert.rejects(receive('front', id, [{ product_code: 'P1', qty: 5 }, { product_code: 'P2', qty: 2 }]), /FORBIDDEN|BRANCH/i);
  await assert.rejects(receive('other', id, [{ product_code: 'P1', qty: 5 }]), /COUNT_REQUIRED/);
  await assert.rejects(q1(`select public.receive_transfer('other', $1, '[{"product_code":"P1","qty":5},{"product_code":"P2","qty":2}]'::jsonb, '[]'::jsonb)`, [id]), /EVIDENCE_REQUIRED/);
  // ERP: dispatch only until the receipt is approved
  assert.deepEqual((await prep(id)).docs.map(d => d.kind), ['transfer_dispatch']);
});

await check('match → approve adds destination stock; ERP gets dispatch + receive with received lines', async () => {
  const id = await send([{ product_code: 'P2', qty: 3 }]);
  const d0 = await stock('แม่สอด', 'P2');
  await receive('other', id, [{ product_code: 'P2', qty: 3 }]);
  assert.equal((await q1(`select public.list_incoming_transfers('other', 'แม่สอด') r`)).r.some(x => x.request_id === id), false);
  const rc = (await q1(`select public.list_transfer_receipts('acct') r`)).r.find(x => x.request_id === id);
  assert.deepEqual([Number(rc.lines[0].sent), Number(rc.lines[0].received)], [3, 3]);
  assert.equal((await decide(id, 'approve')).r.affected, 1);
  assert.equal(await stock('แม่สอด', 'P2'), d0 + 3);
  const docs = (await prep(id)).docs;
  assert.deepEqual(docs.map(d => d.kind), ['transfer_dispatch', 'transfer_receive']);
  assert.deepEqual(docs[1].payload.lines, [{ sku: 'P2', qty: 3 }]); assert.equal(docs[1].payload.close_short, false);
  await assert.rejects(rpc('acct', 'revert_stock_request', { p_request_id: id, p_note: 'x' }), /TRANSFER_ALREADY_RECEIVED/);
});

await check('mismatch: approve blocked; loss approves what arrived, records the loss, ERP closes short', async () => {
  const id = await send([{ product_code: 'P1', qty: 4 }]);
  const d0 = await stock('แม่สอด', 'P1');
  await receive('other', id, [{ product_code: 'P1', qty: 3 }]);
  await assert.rejects(decide(id, 'approve'), /COUNT_MISMATCH/);
  await assert.rejects(decide(id, 'loss', ''), /NOTE_REQUIRED/);
  await decide(id, 'loss', 'แตกระหว่างทาง');
  assert.equal(await stock('แม่สอด', 'P1'), d0 + 3);
  const rc = (await q1(`select public.list_transfer_receipts('acct', 'รับไม่ครบ-ของหาย') r`)).r.find(x => x.request_id === id);
  assert.equal(Number(rc.loss_lines[0].lost), 1);
  const rcv = (await prep(id)).docs[1];
  assert.deepEqual(rcv.payload.lines, [{ sku: 'P1', qty: 3 }]); assert.equal(rcv.payload.close_short, true);
});

await check('received more than sent: loss blocked; recount sends it back to the destination with a note', async () => {
  const id = await send([{ product_code: 'P2', qty: 1 }]);
  await receive('other', id, [{ product_code: 'P2', qty: 2 }]);
  await assert.rejects(decide(id, 'loss', 'x'), /RECEIVED_MORE_THAN_SENT/);
  await decide(id, 'recount', 'นับใหม่อีกครั้ง');
  const again = (await q1(`select public.list_incoming_transfers('other', 'แม่สอด') r`)).r.find(x => x.request_id === id);
  assert.equal(again.recount, true); assert.equal(again.recount_note, 'นับใหม่อีกครั้ง');
  await receive('other', id, [{ product_code: 'P2', qty: 1 }]);
  await decide(id, 'approve');
});

await check('origin fix (เบิกผิด): old cancelled + stock back, new transfer at corrected qty waits for accounting; ERP reverses old, sends new', async () => {
  const id = await send([{ product_code: 'P1', qty: 6 }]);
  await db.exec(`update stock_logs set erp_sync_status = 'ส่งสำเร็จ' where request_id = '${id}'`); // dispatch already in ERP
  const s0 = await stock('พิษณุโลก', 'P1');
  await receive('other', id, [{ product_code: 'P1', qty: 5 }]);
  await decide(id, 'origin_fix', 'ต้นทางนับผิด?');
  const fix = (await q1(`select public.list_transfers_to_fix('front', 'พิษณุโลก') r`)).r.find(x => x.request_id === id);
  assert.deepEqual([Number(fix.lines[0].sent), Number(fix.lines[0].received)], [6, 5]);
  await assert.rejects(q1(`select public.fix_transfer_dispatch('other', $1, '[{"product_code":"P1","qty":5}]'::jsonb, 'x')`, [id]), /FORBIDDEN|BRANCH/i);
  await assert.rejects(q1(`select public.fix_transfer_dispatch('front', $1, '[{"product_code":"P1","qty":5}]'::jsonb, '')`, [id]), /NOTE_REQUIRED/);
  const nw = (await q1(`select public.fix_transfer_dispatch('front', $1, '[{"product_code":"P1","qty":5}]'::jsonb, 'เบิกผิด นับเกิน 1') r`, [id])).r.request_id;
  assert.equal(await stock('พิษณุโลก', 'P1'), s0 + 1, 'origin gets the 1 back');
  assert.equal((await q1(`select erp_sync_status s from stock_logs where request_id = $1`, [id])).s, 'ต้องยกเลิกที่ ERP');
  assert.equal((await q1(`select public.erp_push_prepare('acct', $1, 'reverse') r`, [id])).r.op, 'reverse');
  const rc = (await q1(`select public.list_transfer_receipts('acct') r`)).r.find(x => x.request_id === nw);
  assert.deepEqual([Number(rc.lines[0].sent), Number(rc.lines[0].received)], [5, 5]);
  const d0 = await stock('แม่สอด', 'P1');
  await decide(nw, 'approve');
  assert.equal(await stock('แม่สอด', 'P1'), d0 + 5);
  const docs = (await prep(nw)).docs;
  assert.equal(docs[0].ext_ref, nw); assert.deepEqual(docs[0].payload.lines.map(l => l.qty), [5]);
});

await check('revert dispatch before receipt approval: origin restored, transfer leaves the waiting list', async () => {
  const id = await send([{ product_code: 'P2', qty: 2 }]);
  const s0 = await stock('พิษณุโลก', 'P2');
  await rpc('acct', 'revert_stock_request', { p_request_id: id, p_note: 'ผิดสาขา' });
  assert.equal(await stock('พิษณุโลก', 'P2'), s0 + 2);
  assert.equal((await q1(`select public.list_incoming_transfers('other', 'แม่สอด') r`)).r.some(x => x.request_id === id), false);
});

await check('stock card at destination shows the received quantity', async () => {
  const id = await send([{ product_code: 'P2', qty: 4 }]);
  await receive('other', id, [{ product_code: 'P2', qty: 3 }]);
  await decide(id, 'loss', 'หาย 1');
  const rows = await rpc('other', 'get_stock_movement_v2', { p_branch_name: 'แม่สอด', p_date_from: today, p_date_to: today });
  const row = rows.find(r => r.request_id === id && r.is_incoming);
  assert.equal(Number(row.qty), 3); assert.equal(row.applies_to_balance, true);
});
report();
