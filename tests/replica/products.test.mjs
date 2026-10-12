// Checks SQL 07 (product list synced from ERP) on the local replica: update / add / deactivate, idempotent.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
const sql07 = fs.readFileSync(SQL_1012 + '07_อัปเดตรายชื่อสินค้าจากERP.sql', 'utf8');
const erpCount = (sql07.match(/^\(/gm) || []).length;
await check('07 runs twice; P1/P2/P3 (not in ERP) deactivated, ERP rows active', async () => {
  await db.exec(sql07); await db.exec(sql07);
  const r = await q1(`select count(*) filter (where is_active)::int a, count(*) filter (where not is_active)::int d, count(*) filter (where erp_synced_at is not null)::int s from products`);
  assert.equal(r.a, erpCount); assert.equal(r.d, 3); assert.equal(r.s, erpCount);
  assert.equal((await q1(`select is_active from products where code='P1'`)).is_active, false);
});
await check('existing code gets ERP name/unit; type set by category', async () => {
  await db.exec(`update products set name='old', unit='x' where code=(select code from products where erp_synced_at is not null limit 1)`);
  await db.exec(sql07);
  assert.equal((await q1(`select count(*)::int n from products where name='old'`)).n, 0);
  const t = await q1(`select type from products where category='อุปกรณ์' and erp_synced_at is not null limit 1`); assert.equal(t.type, 2);
  const t2 = await q1(`select type from products where category='filler' limit 1`); assert.equal(t2.type, 1);
  assert.equal((await q1(`select count(*)::int n from products where lot_controlled`)).n > 0, true);
});
report();
