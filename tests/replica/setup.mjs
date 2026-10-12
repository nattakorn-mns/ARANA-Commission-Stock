// Local Postgres replica (PGlite) of the extension database for testing SQL files before Aom runs them.
// Nothing here touches Supabase. Run: node tests/replica/<test>.mjs  (needs: npm i -D @electric-sql/pglite)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const SQL_0926 = path.resolve(REPO, '..', 'SQL-รอบแก้-2026-09-26') + path.sep;
export const SQL_1012 = path.resolve(REPO, '..', 'SQL-รอบแก้-2026-10-12') + path.sep;

export function stripExtensions(sql) {
  // pg_cron / pg_net are Supabase-only; the replica stubs them.
  return sql.replace(/create extension if not exists pg_(cron|net);/g, '');
}

export async function makeDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
create extension if not exists pgcrypto schema public;
create schema if not exists extensions;
create or replace function extensions.digest(text, text) returns bytea language sql as $$ select public.digest($1,$2) $$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;
do $$ begin create role service_role; exception when others then null; end $$;
create schema private;
create table branches(id uuid primary key default gen_random_uuid(), name text unique not null, is_active boolean default true);
create table users(id uuid primary key default gen_random_uuid(), username text unique, name text, nickname text, role text, branch_id uuid references branches(id), is_active boolean default true, display_position text);
create table products(id uuid primary key default gen_random_uuid(), code text unique, name text, unit text, category text, type smallint, is_active boolean default true);
create table programs(id uuid primary key default gen_random_uuid(), code text unique, name text, price numeric, is_active boolean default true);
create table bills(id uuid primary key default gen_random_uuid(), hn text not null default '-', customer_name text not null default '-', bill_date date not null default current_date,
  branch_id uuid references branches(id), status text default 'รอตรวจสอบ', created_by uuid, audit_by uuid, audit_date timestamptz, audit_note text,
  created_at timestamptz default now(), commission_status text not null default 'รอตรวจสอบ', commission_audit_by uuid, commission_audit_date timestamptz, commission_audit_note text);
create table bill_services(id uuid primary key default gen_random_uuid(), bill_id uuid references bills(id), program_id uuid, price numeric, commission numeric, created_by uuid, created_at timestamptz default clock_timestamp());
create table bill_sales(id uuid primary key default gen_random_uuid(), bill_id uuid references bills(id), sale_type text, old_program_name text, old_price numeric, new_program_name text, amount_paid numeric, commission_base numeric, commission_pct numeric, commission_amt numeric, created_by uuid, created_at timestamptz default clock_timestamp());
create table bill_supplies(id uuid primary key default gen_random_uuid(), bill_id uuid references bills(id), product_id uuid, qty numeric not null, created_by uuid, created_at timestamptz default clock_timestamp());
create table bill_images(id uuid primary key default gen_random_uuid(), bill_id uuid references bills(id), file_url text, file_name text, uploaded_at timestamptz default now());
create table stock_logs(id uuid primary key default gen_random_uuid(), opd_bill_id uuid references bills(id), branch_id uuid references branches(id),
  to_branch_id uuid references branches(id), product_id uuid references products(id), direction text check (direction in ('IN','OUT')),
  move_type text, qty numeric not null, note text, created_by uuid references users(id), audit_status text default 'รอตรวจสอบ',
  source text, request_id uuid, log_date date default current_date, created_at timestamptz default clock_timestamp(),
  erp_sync_status text not null default 'รอส่ง' check (erp_sync_status in ('รอส่ง','ส่งสำเร็จ','ส่งไม่สำเร็จ','ไม่ต้องส่ง')),
  erp_ref text, erp_synced_at timestamptz, erp_sync_error text);
create table branch_stock(branch_id uuid references branches(id), product_id uuid references products(id), qty_on_hand numeric not null default 0,
  updated_at timestamptz default now(), primary key(branch_id, product_id));
create table stock_log_images(id uuid primary key default gen_random_uuid(), stock_log_id uuid references stock_logs(id), file_url text, uploaded_at timestamptz default now());
create table audit_logs(id uuid primary key default gen_random_uuid(), action text, target_type text, target_id text, audit_by uuid, old_status text, new_status text, note text, created_at timestamptz default now());
create table deposits(id uuid primary key default gen_random_uuid(), deposit_no text, deposit_date date, branch_id uuid references branches(id), customer_name text, customer_phone text default '', hn text,
  channel text, program_name text, package_price numeric default 0, deposit_amount numeric, payment_method text, payment_reference text, commission_pct numeric, commission_amt numeric,
  appointment_date date, note text, payment_status text default 'รอตรวจสอบ', commission_status text default 'รอตรวจสอบ', audit_note text,
  created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz, linked_bill_id uuid);
create table deposit_images(id uuid primary key default gen_random_uuid(), deposit_id uuid references deposits(id), file_url text, file_name text, uploaded_at timestamptz default now());
create table private.app_sessions(id uuid primary key default gen_random_uuid(), token_hash bytea unique, user_id uuid references users(id), expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz default now());
-- Supabase-only pieces stubbed
create schema cron; create table cron.job(jobid serial, jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $f$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $f$;
create function cron.unschedule(n text) returns boolean language sql as $f$ delete from cron.job where jobname = n returning true $f$;
create schema net; create table net.calls(url text, body jsonb, at timestamptz default now());
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns int language sql as $f$ insert into net.calls(url, body) values (url, body) returning 1 $f$;
-- legacy stand-ins for what the live gateway did before the 26/09 files
create function public.save_stock_log_image(p_log_id uuid, p_data text) returns void language sql as $$ insert into stock_log_images(stock_log_id, file_url) values (p_log_id, p_data) $$;
create function public.create_opd_bill(p jsonb) returns uuid language sql as $$ select null::uuid $$;
create function public.append_opd_bill(b uuid, p jsonb) returns uuid language sql as $$ select null::uuid $$;
create function public.arana_app_rpc(p_session_token text, p_action text, p_payload jsonb default '{}') returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare v_actor record;
begin
  select * into v_actor from private.require_app_session(p_session_token);
  if p_action = 'ping' then return '"legacy"'::jsonb; end if;
  raise exception 'UNKNOWN_ACTION';
end $$;`);
  // Real session helpers from the repo migration.
  const sess = fs.readFileSync(path.join(REPO, 'supabase/migrations/20260912103000_secure_app_sessions.sql'), 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['private.require_app_session', 'private.require_role', 'private.require_branch']) {
    const start = sess.indexOf('create or replace function ' + name);
    const end = sess.indexOf('$$;', sess.indexOf('as $$', start) + 5) + 3;
    await db.exec(sess.slice(start, end));
  }
  await db.exec(`
insert into programs(code,name,price) values ('PG1','โบท็อกซ์',5000),('PG2','ฟิลเลอร์',9999);
insert into branches(name) values ('พิษณุโลก'), ('แม่สอด');
insert into products(code, name, unit) values ('P1','ยา A','ซีซี'), ('P2','วัสดุ B','ชิ้น'), ('P3','ของไม่ใช้แล้ว','ชิ้น');
update products set is_active = false where code = 'P3';
insert into users(username, name, nickname, role, branch_id) select 'front', 'พนักงาน หนึ่ง', 'เอ', 'Frontdesk', id from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id) select 'acct', 'บัญชี', 'บี', 'Audit', id from branches where name = 'พิษณุโลก';
insert into users(username, name, nickname, role, branch_id) select 'other', 'สาขาอื่น', 'ซี', 'Frontdesk', id from branches where name = 'แม่สอด';
insert into private.app_sessions(token_hash, user_id, expires_at) select digest(username, 'sha256'), id, now() + interval '1 day' from users;
insert into branch_stock select b.id, p.id, 100 from branches b, products p;`);
  return db;
}

export function helpers(db) {
  const rpc = async (tok, action, payload = {}) => (await db.query('select public.arana_app_rpc($1,$2,$3::jsonb) r', [tok, action, JSON.stringify(payload)])).rows[0].r;
  const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const stock = async (branch, code) => Number((await q1(`select coalesce((select qty_on_hand from branch_stock bs join branches b on b.id=bs.branch_id join products p on p.id=bs.product_id where b.name=$1 and p.code=$2),0) q`, [branch, code])).q);
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
  const report = () => {
    for (const [s, n, d] of results) console.log(s, n, d ? '\n   ' + d : '');
    const f = results.filter(r => r[0] === 'FAIL').length;
    console.log(`\n${results.length - f} PASS / ${f} FAIL`);
    process.exitCode = f ? 1 : 0;
  };
  return { rpc, q1, stock, check, report };
}

export async function applyBase(db) {
  // The 26/09 chain that the live database already has (02 then 04).
  await db.exec(fs.readFileSync(SQL_0926 + '02_ตัดสต็อกตอนอนุมัติ-ถอยสถานะ-เช็คสต๊อก.sql', 'utf8'));
  await db.exec(fs.readFileSync(SQL_0926 + '04_แก้ไขบิลOPD-คำขอแก้ไข-OPDตัดสต็อกตอนอนุมัติ.sql', 'utf8'));
}
