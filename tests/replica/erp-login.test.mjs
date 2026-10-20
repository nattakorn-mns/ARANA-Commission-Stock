// Checks SQL 17 (session for an ERP-verified employee) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, applyBase, stripExtensions, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { rpc, q1, check, report } = helpers(db);
await applyBase(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text;`);
await db.exec(stripExtensions(fs.readFileSync(SQL_1012 + '09_ดึงข้อมูลจากERPอัตโนมัติ.sql', 'utf8')));
const sql17 = fs.readFileSync(SQL_1012 + '17_เข้าสู่ระบบด้วยบัญชีERP.sql', 'utf8');
await check('17 runs twice', async () => { await db.exec(sql17); await db.exec(sql17); });
await db.exec(`update users set erp_emp_code='EMP3025' where username='front'; update users set erp_emp_code='EMP9', is_active=false where username='other';`);
await check('active linked employee gets a working session; unknown / inactive get none', async () => {
  const s = (await q1(`select public.erp_issue_app_session('EMP3025') r`)).r;
  assert.equal(s.username, 'front'); assert.equal(s.branch_name, 'พิษณุโลก'); assert.equal(s.session_token.length, 64);
  assert.equal(await rpc(s.session_token, 'ping'), 'legacy');
  assert.equal((await q1(`select public.erp_issue_app_session('EMP9') r`)).r, null);
  assert.equal((await q1(`select public.erp_issue_app_session('NOPE') r`)).r, null);
});
report();
