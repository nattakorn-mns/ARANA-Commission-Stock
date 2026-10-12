// Checks SQL 08 (users linked/created from the ERP employee registry) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text, add column if not exists created_at timestamptz default now();
create or replace function extensions.crypt(text, text) returns text language sql as $$ select public.crypt($1, $2) $$;
create or replace function extensions.gen_salt(text) returns text language sql as $$ select public.gen_salt($1) $$;
insert into branches(name) values ('กำแพงเพชร'), ('นครสวรรค์');
insert into users(username, name, nickname, role, branch_id, password_hash) select 'frontdesk1', 'ปาวีณา จันตาเรียน', 'มายด์', 'Frontdesk', id, 'keep' from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id, password_hash) select 'audit3', 'น้ำฝน กันยาประสิทธิ์', 'ฝน', 'Audit', id, 'keep' from branches where name = 'พิษณุโลก';`);
const sql08 = fs.readFileSync(SQL_1012 + '08_บัญชีผู้ใช้จากทะเบียนพนักงานERP.sql', 'utf8');
await check('08 runs twice: existing linked (password kept, nickname from ERP), 10 new created once', async () => {
  await db.exec(sql08); await db.exec(sql08);
  const a = await q1(`select erp_emp_code, nickname, password_hash from users where username='audit3'`);
  assert.equal(a.erp_emp_code, 'EMP3028'); assert.equal(a.nickname, 'น้ำฝน'); assert.equal(a.password_hash, 'keep');
  assert.equal((await q1(`select count(*)::int n from users where username = erp_emp_code`)).n, 10);
  const nun = await q1(`select role, display_position, (select name from branches where id = branch_id) b from users where username='EMP3017'`);
  assert.equal(nun.role, 'Audit'); assert.equal(nun.display_position, 'ผู้จัดการ'); assert.equal(nun.b, 'พิษณุโลก');
  const mak = await q1(`select branch_id = (select id from branches where name='กำแพงเพชร') ok, password_hash = extensions.crypt('EMP3037-054', password_hash) pw from users where username='EMP3037'`);
  assert.equal(mak.ok, true); assert.equal(mak.pw, true);
});
report();
