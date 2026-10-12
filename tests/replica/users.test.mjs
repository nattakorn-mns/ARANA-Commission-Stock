// Checks SQL 08 (users = ERP employee registry) on the local replica.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDb, helpers, SQL_1012 } from './setup.mjs';

const db = await makeDb();
const { q1, check, report } = helpers(db);
await db.exec(`alter table users add column if not exists password_hash text, add column if not exists position text, add column if not exists created_at timestamptz default now();
create or replace function extensions.crypt(text, text) returns text language sql as $$ select public.crypt($1, $2) $$;
create or replace function extensions.gen_salt(text) returns text language sql as $$ select public.gen_salt($1) $$;
create table staff_positions(id uuid primary key default gen_random_uuid(), name text unique not null, description text, is_system boolean default false);
create table position_menu_permissions(id uuid primary key default gen_random_uuid(), position_name text references staff_positions(name), page_key text, page_label text, can_view boolean, can_edit boolean, unique(position_name, page_key));
insert into branches(name) values ('กำแพงเพชร'), ('นครสวรรค์');
insert into users(username, name, nickname, role, branch_id, password_hash, display_position) select 'frontdesk1', 'ปาวีณา จันตาเรียน', 'มายด์', 'Frontdesk', id, 'keep', 'พนักงาน' from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id, password_hash, display_position) select 'audit3', 'น้ำฝน กันยาประสิทธิ์', 'ฝน', 'Audit', id, 'keep', 'บัญชี' from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id, password_hash, display_position) select 'audit1', 'กุลวรินทร์ กุลทวีพรพัฒน์', 'กุญแจ', 'Audit', id, 'keep', 'บัญชี' from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id, password_hash, display_position) select 'fd_beam', 'ปัณณพร สุทธิศักดิ์', 'บีม', 'Frontdesk', id, 'keep', 'พนักงาน' from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id, password_hash, is_active) select 'fd_may', 'กันยารัตน์', 'เมย์', 'Frontdesk', id, 'keep', false from branches where name = 'พิษณุโลก';`);
const sql08 = fs.readFileSync(SQL_1012 + '08_บัญชีผู้ใช้จากทะเบียนพนักงานERP.sql', 'utf8');
await check('08 first run: 4 existing renamed to emp codes (password kept), 31 created, roles by position', async () => {
  await db.exec(sql08);
  assert.equal((await q1(`select count(*)::int n from users where username = erp_emp_code`)).n, 35);
  const a = await q1(`select username, nickname, password_hash from users where erp_emp_code='EMP3028'`);
  assert.equal(a.username, 'EMP3028'); assert.equal(a.nickname, 'น้ำฝน'); assert.equal(a.password_hash, 'keep');
  assert.equal((await q1(`select role from users where username='MVP1'`)).role, 'Admin');
  const beam = await q1(`select role, display_position from users where username='EMP3033'`);
  assert.equal(beam.role, 'Frontdesk'); assert.equal(beam.display_position, 'พนักงานคลัง');
  const nun = await q1(`select role, display_position from users where username='EMP3017'`);
  assert.equal(nun.role, 'Audit'); assert.equal(nun.display_position, 'ผู้จัดการ');
  assert.equal((await q1(`select password_hash = extensions.crypt('EMP3037-054', password_hash) ok from users where username='EMP3037'`)).ok, true);
  assert.equal((await q1(`select is_active from users where username='fd_may'`)).is_active, false);
  const perm = await q1(`select count(*) filter (where can_view)::int v, count(*)::int t from position_menu_permissions where position_name='พนักงานคลัง'`);
  assert.equal(perm.v, 3); assert.equal(perm.t, 16);
});
await check('08 second run: nothing duplicated, nothing deactivated', async () => {
  await db.exec(sql08);
  assert.equal((await q1(`select count(*)::int n from users where erp_emp_code is not null`)).n, 35);
  assert.equal((await q1(`select count(*)::int n from users where is_active and erp_emp_code is not null`)).n, 35);
});
await check('employee removed from ERP list gets deactivated', async () => {
  await db.exec(sql08.replace("('EMP3022', 'อารียา สีเอื้อย',         'หยก',     'ทรีทเม้นท์',             'แม่สอด',    '053', null),\n", ''));
  assert.equal((await q1(`select is_active from users where username='EMP3022'`)).is_active, false);
});
report();
