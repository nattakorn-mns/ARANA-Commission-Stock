// Checks SQL 25 (staff drafts: own only, today only, accounting sees who has open drafts).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '05_แจ้งเตือนTelegram-LINE-สรุปรายวัน.sql', 'utf8')));
const sql25 = fs.readFileSync(SQL_1012 + '25_บันทึกร่าง.sql', 'utf8');
const save = (tok, id, kind, title, payload) => q1(`select public.save_staff_draft($1, $2, $3, null, $4, $5::jsonb) r`, [tok, id, kind, title, JSON.stringify(payload)]);
const mine = async tok => (await q1(`select public.list_my_drafts($1) r`, [tok])).r;

await check('25 runs twice; checks 1 / 6 / 1', async () => {
  await db.exec(sql25);
  const r = (await db.exec(sql25)).at(-1).rows[0];
  assert.deepEqual(Object.values(r).map(Number), [1, 6, 1]);
});

let id;
await check('save → list (no payload) → save again updates the same draft → get returns the payload', async () => {
  id = (await save('front', null, 'stock_out', 'ยา A', { rows: [{ productCode: 'P1', qty: 2 }], photos: [{ data: 'data:image/jpeg;base64,xx' }] })).r.id;
  assert.equal((await save('front', id, 'stock_out', 'ยา A +1 รายการ', { rows: [1, 2], photos: [] })).r.id, id);
  const list = await mine('front');
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].title, list[0].photo_count, list[0].branch, 'payload' in list[0]], ['ยา A +1 รายการ', 0, 'พิษณุโลก', false]);
  assert.deepEqual((await q1(`select public.get_staff_draft('front', $1) r`, [id])).r.payload.rows, [1, 2]);
});

await check('others cannot open/overwrite/delete it; accounting sees who has drafts but not the photos', async () => {
  await assert.rejects(q1(`select public.get_staff_draft('other', $1)`, [id]), /DRAFT_NOT_FOUND/);
  const r = (await save('other', id, 'stock_out', 'แอบแก้', {})).r;
  assert.notEqual(r.id, id, 'saving with someone else\'s id makes a new draft instead');
  await q1(`select public.delete_staff_draft('other', $1)`, [id]);
  assert.equal((await mine('front')).length, 1);
  await assert.rejects(q1(`select public.list_open_drafts('front')`), /FORBIDDEN|ROLE|permission/i);
  const open = (await q1(`select public.list_open_drafts('acct') r`)).r;
  assert.equal(open.length, 2);
  assert.ok(open.every(d => !('payload' in d) && d.staff));
});

await check('drafts do not survive past midnight', async () => {
  await db.exec(`update staff_drafts set draft_date = draft_date - 1`);
  await assert.rejects(q1(`select public.get_staff_draft('front', $1)`, [id]), /DRAFT_NOT_FOUND/);
  assert.equal((await save('front', id, 'stock_out', 'x', {})).r.id !== id, true, 'yesterday\'s draft cannot be updated');
  assert.equal((await mine('front')).length, 1, 'only today\'s new one is listed');
  assert.equal((await q1(`select count(*)::int c from staff_drafts where draft_date < (now() at time zone 'Asia/Bangkok')::date`)).c, 0, 'old ones purged');
});

await check('guards: bad kind, too large, delete own', async () => {
  await assert.rejects(save('front', null, 'other', 'x', {}), /DRAFT_KIND_INVALID/);
  await assert.rejects(save('front', null, 'opd', 'x', { photos: ['a'.repeat(8000001)] }), /DRAFT_TOO_LARGE/);
  const d = (await mine('front'))[0];
  await q1(`select public.delete_staff_draft('front', $1)`, [d.id]);
  assert.equal((await mine('front')).length, 0);
});
report();
