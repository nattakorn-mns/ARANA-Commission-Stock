// Checks SQL 16 (ERP courses/services → branch-specific programs) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;
alter table programs add column if not exists unit text, add column if not exists category text;
insert into branches(name) values ('กำแพงเพชร');`);
await db.exec(fs.readFileSync(SQL_1012 + '06_รับของเข้า-เลขPO-ล็อต-วันหมดอายุ.sql', 'utf8'));
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
const sql16 = fs.readFileSync(SQL_1012 + '16_โปรแกรมบริการจากERP-แยกสาขา.sql', 'utf8');
await check('16 runs twice', async () => { await db.exec(sql16); await db.exec(sql16); });

const list = async (tok, br) => (await q1(`select public.list_programs_for_branch($1, $2) r`, [tok, br])).r;
const id = n => '00000000-0000-0000-0000-0000000f00' + String(n).padStart(2, '0');
await check('before the first pull the old programs stay; after it they are switched off', async () => {
  assert.deepEqual((await list('front', 'พิษณุโลก')).map(p => p.code).sort(), ['PG1', 'PG2']);
  const n = (await q1(`select public.erp_apply_programs('courses', $1::jsonb, true, false) n`, [JSON.stringify([
    { id: id(1), course_code: '00651', name: 'Drip Vitamin C 5 แถม 5', branch: 'สาขาพิษณุโลก', price: 499.9, total_sessions: 10, commission_percent: 5, active: true, updated_at: '2026-10-18T00:00:00Z' },
    { id: id(2), course_code: '00651', name: 'ดริป B 5 แถม 5', branch: 'กำแพงเพชร', price: 499.9, active: true, updated_at: '2026-10-18T00:00:01Z' },
    { id: id(3), course_code: '00999', name: 'ทุกสาขา', branch: null, price: 100, active: true, updated_at: '2026-10-18T00:00:02Z' },
    { id: id(4), course_code: '00777', name: 'ปิดแล้ว', branch: 'พิษณุโลก', price: 1, active: false, updated_at: '2026-10-18T00:00:03Z' },
  ])])).n;
  assert.equal(n, 4);
  assert.equal((await q1(`select count(*)::int c from programs where erp_id is null and is_active`)).c, 0);
  assert.equal((await q1(`select public.erp_sync_cursor('courses') c`)).c.after_id, id(4));
});

await check('each branch sees only its own programs (+ all-branch ones); same ERP code kept apart', async () => {
  const pl = await list('front', 'พิษณุโลก');
  assert.deepEqual(pl.map(p => [p.code, p.name, p.erp_code]).sort(), [['ALL-C-00999', 'ทุกสาขา', '00999'], ['PL-C-00651', 'Drip Vitamin C 5 แถม 5', '00651']]);
  const kp = await list('front', 'กำแพงเพชร');
  assert.deepEqual(kp.map(p => p.code).sort(), ['ALL-C-00999', 'KP-C-00651']);
  assert.deepEqual(await list('front', 'แม่สอด').then(r => r.map(p => p.code)), ['ALL-C-00999']);
  await q1(`select public.erp_apply_programs('services', $1::jsonb, true, true)`, [JSON.stringify([
    { id: id(5), service_code: '00651', name: 'บริการ 00651', branch: 'พิษณุโลก', price: 300, active: true, updated_at: '2026-10-18T00:00:04Z' }])]);
  assert.ok((await list('front', 'พิษณุโลก')).some(p => p.code === 'PL-S-00651' && p.kind === 'S'));
});

await check('ERP updates (rename / close) flow through; OPD saves with the branch program code', async () => {
  await q1(`select public.erp_apply_programs('courses', $1::jsonb, false, true)`, [JSON.stringify([
    { id: id(1), course_code: '00651', name: 'ชื่อใหม่', branch: 'สาขาพิษณุโลก', price: 550, active: true, updated_at: '2026-10-19T00:00:00Z' },
    { id: id(3), course_code: '00999', name: 'ทุกสาขา', branch: null, price: 100, active: false, updated_at: '2026-10-19T00:00:01Z' }])]);
  const pl = await list('front', 'พิษณุโลก');
  assert.equal(pl.find(p => p.code === 'PL-C-00651').name, 'ชื่อใหม่');
  assert.ok(!pl.some(p => p.code === 'ALL-C-00999'));
  const bill = await rpc('front', 'create_opd_bill', { p_payload: { branch_name: 'พิษณุโลก', hn: 'HN0001', customer_name: 'x', date: '2026-10-18',
    services: [{ program_code: 'PL-C-00651', price: 550, commission: 50 }] } });
  assert.equal((await q1(`select p.name from bill_services bs join programs p on p.id = bs.program_id where bs.bill_id = $1`, [bill])).name, 'ชื่อใหม่');
});
report();
