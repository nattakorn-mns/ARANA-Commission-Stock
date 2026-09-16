-- Secure the browser-facing API behind short-lived, opaque application sessions.
-- The legacy business functions remain internal implementation details and have
-- all direct browser execution privileges revoked at the end of this migration.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx
  on private.app_sessions(user_id);
create index if not exists app_sessions_expiry_idx
  on private.app_sessions(expires_at)
  where revoked_at is null;

create or replace function private.require_app_session(p_token text)
returns table(user_id uuid, username text, role text, branch_id uuid, branch_name text)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
begin
  if nullif(trim(p_token), '') is null then
    raise exception 'SESSION_REQUIRED' using errcode = '28000';
  end if;

  return query
  select u.id, u.username, u.role, u.branch_id, b.name
  from private.app_sessions s
  join public.users u on u.id = s.user_id
  left join public.branches b on b.id = u.branch_id
  where s.token_hash = extensions.digest(p_token, 'sha256')
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true;

  if not found then
    raise exception 'SESSION_INVALID_OR_EXPIRED' using errcode = '28000';
  end if;

  update private.app_sessions
  set last_used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256')
    and last_used_at < now() - interval '5 minutes';
end;
$$;

create or replace function private.require_role(p_role text, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if not (p_role = any(p_allowed)) then
    raise exception 'FORBIDDEN_ROLE' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_branch(
  p_role text,
  p_user_branch text,
  p_requested_branch text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_role in ('Frontdesk', 'OnlineSales')
     and p_requested_branch is distinct from p_user_branch then
    raise exception 'FORBIDDEN_BRANCH' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_app_session(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_user record;
  v_token text;
begin
  select u.id, u.username, u.name, u.nickname, u.role, u.branch_id,
         b.name as branch_name, u.position
  into v_user
  from public.users u
  left join public.branches b on b.id = u.branch_id
  where lower(u.username) = lower(trim(p_username))
    and u.is_active = true
    and u.password_hash = extensions.crypt(p_password, u.password_hash);

  if not found then return null; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.app_sessions(token_hash, user_id, expires_at)
  values (extensions.digest(v_token, 'sha256'), v_user.id, now() + interval '12 hours');

  delete from private.app_sessions
  where expires_at < now() - interval '7 days'
     or revoked_at < now() - interval '7 days';

  return jsonb_build_object(
    'id', v_user.id,
    'username', v_user.username,
    'name', v_user.name,
    'nickname', v_user.nickname,
    'role', v_user.role,
    'branch_name', v_user.branch_name,
    'position', v_user.position,
    'session_token', v_token,
    'expires_in_seconds', 43200
  );
end;
$$;

create or replace function public.arana_app_rpc(
  p_session_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor record;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_result jsonb;
  v_id uuid;
  v_allowed boolean;
begin
  select * into v_actor from private.require_app_session(p_session_token);

  if p_action = 'logout' then
    update private.app_sessions set revoked_at = now()
    where token_hash = extensions.digest(p_session_token, 'sha256') and revoked_at is null;
    return 'true'::jsonb;

  elsif p_action = 'get_active_products' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_active_products() x;

  elsif p_action = 'get_active_programs' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_active_programs() x;

  elsif p_action = 'admin_list_users' then
    perform private.require_role(v_actor.role, array['Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.admin_list_users() x;

  elsif p_action = 'admin_create_user' then
    perform private.require_role(v_actor.role, array['Admin']);
    v_id := public.admin_create_user(
      v_payload->>'p_username', v_payload->>'p_password', v_payload->>'p_name',
      v_payload->>'p_nickname', v_payload->>'p_role', v_payload->>'p_branch_name',
      v_payload->>'p_position');
    v_result := to_jsonb(v_id);

  elsif p_action = 'admin_set_user_active' then
    perform private.require_role(v_actor.role, array['Admin']);
    if (v_payload->>'p_user_id')::uuid = v_actor.user_id
       and not (v_payload->>'p_active')::boolean then
      raise exception 'CANNOT_DISABLE_SELF' using errcode = '22023';
    end if;
    perform public.admin_set_user_active(
      (v_payload->>'p_user_id')::uuid, (v_payload->>'p_active')::boolean);
    v_result := 'true'::jsonb;

  elsif p_action = 'change_own_password' then
    if length(coalesce(v_payload->>'p_new_password', '')) < 8 then
      raise exception 'PASSWORD_TOO_SHORT' using errcode = '22023';
    end if;
    v_allowed := public.change_own_password(
      v_actor.username, v_payload->>'p_old_password', v_payload->>'p_new_password');
    if v_allowed then
      update private.app_sessions set revoked_at = now()
      where user_id = v_actor.user_id
        and token_hash <> extensions.digest(p_session_token, 'sha256')
        and revoked_at is null;
    end if;
    v_result := to_jsonb(v_allowed);

  elsif p_action = 'get_branch_stock' then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','StockAudit','Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_branch_stock(v_payload->>'p_branch_name') x;

  elsif p_action = 'save_stock_log' then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    v_id := public.save_stock_log(
      v_payload->>'p_branch_name', nullif(v_payload->>'p_to_branch_name',''),
      v_payload->>'p_product_code', v_payload->>'p_direction', v_payload->>'p_move_type',
      (v_payload->>'p_qty')::numeric, v_payload->>'p_note', v_actor.user_id,
      nullif(v_payload->>'p_source',''), nullif(v_payload->>'p_request_id','')::uuid);
    v_result := to_jsonb(v_id);

  elsif p_action = 'save_stock_log_image' then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','Admin']);
    select exists(
      select 1 from public.stock_logs sl
      where sl.id = (v_payload->>'p_log_id')::uuid
        and (sl.created_by = v_actor.user_id or v_actor.role in ('Audit','Admin'))
    ) into v_allowed;
    if not v_allowed then raise exception 'FORBIDDEN_RECORD' using errcode = '42501'; end if;
    perform public.save_stock_log_image((v_payload->>'p_log_id')::uuid, v_payload->>'p_data');
    v_result := 'true'::jsonb;

  elsif p_action in ('create_opd_bill','append_opd_bill') then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','OnlineSales','Admin']);
    v_payload := jsonb_set(v_payload, '{p_payload,created_by}', to_jsonb(v_actor.user_id::text), true);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload#>>'{p_payload,branch_name}');
    if p_action = 'create_opd_bill' then
      v_id := public.create_opd_bill(v_payload->'p_payload');
    else
      select exists(
        select 1 from public.bills b left join public.branches br on br.id=b.branch_id
        where b.id=(v_payload->>'p_bill_id')::uuid
          and (v_actor.role in ('Audit','Admin') or br.name=v_actor.branch_name)
      ) into v_allowed;
      if not v_allowed then raise exception 'FORBIDDEN_RECORD' using errcode = '42501'; end if;
      v_id := public.append_opd_bill((v_payload->>'p_bill_id')::uuid, v_payload->'p_payload');
    end if;
    v_result := to_jsonb(v_id);

  elsif p_action = 'search_open_opd_bills' then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','OnlineSales','Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.search_open_opd_bills(v_payload->>'p_query', v_payload->>'p_branch_name') x;

  elsif p_action = 'create_deposit' then
    perform private.require_role(v_actor.role, array['Frontdesk','OnlineSales','Admin']);
    v_payload := jsonb_set(v_payload, '{p_payload,created_by}', to_jsonb(v_actor.user_id::text), true);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload#>>'{p_payload,branch_name}');
    v_id := public.create_deposit(v_payload->'p_payload');
    v_result := to_jsonb(v_id);

  elsif p_action = 'get_pending_deposits' then
    perform private.require_role(v_actor.role, array['Audit','CommissionAudit','Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_pending_deposits() x;

  elsif p_action = 'get_deposit_detail' then
    perform private.require_role(v_actor.role, array['Audit','CommissionAudit','Admin']);
    v_result := public.get_deposit_detail((v_payload->>'p_deposit_id')::uuid);

  elsif p_action = 'audit_deposit' then
    perform private.require_role(v_actor.role, array['Audit','CommissionAudit','Admin']);
    perform public.audit_deposit((v_payload->>'p_deposit_id')::uuid,
      v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note',''));
    v_result := 'true'::jsonb;

  elsif p_action = 'search_confirmed_deposits' then
    perform private.require_role(v_actor.role, array['Frontdesk','OnlineSales','Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.search_confirmed_deposits(v_payload->>'p_query', v_payload->>'p_branch_name') x;

  elsif p_action = 'get_pending_bills' then
    perform private.require_role(v_actor.role, array['Audit','CommissionAudit','Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_pending_bills() x;

  elsif p_action = 'get_bill_detail' then
    perform private.require_role(v_actor.role, array['Frontdesk','OnlineSales','Audit','CommissionAudit','StockAudit','Admin']);
    select exists(
      select 1 from public.bills b left join public.branches br on br.id=b.branch_id
      where b.id=(v_payload->>'p_bill_id')::uuid
        and (v_actor.role in ('Audit','CommissionAudit','StockAudit','Admin') or br.name=v_actor.branch_name)
    ) into v_allowed;
    if not v_allowed then raise exception 'FORBIDDEN_RECORD' using errcode = '42501'; end if;
    v_result := public.get_bill_detail((v_payload->>'p_bill_id')::uuid);

  elsif p_action = 'audit_bill' then
    perform private.require_role(v_actor.role, array['Audit','CommissionAudit','Admin']);
    perform public.audit_bill((v_payload->>'p_bill_id')::uuid,
      v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note',''));
    v_result := 'true'::jsonb;

  elsif p_action = 'get_pending_opd_stock_requests' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_pending_opd_stock_requests() x;

  elsif p_action = 'audit_opd_stock_request' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    perform public.audit_opd_stock_request((v_payload->>'p_bill_id')::uuid,
      v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note',''));
    v_result := 'true'::jsonb;

  elsif p_action = 'get_pending_stock_logs' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_pending_stock_logs() x;

  elsif p_action = 'audit_stock_log' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    perform public.audit_stock_log((v_payload->>'p_log_id')::uuid,
      v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note',''));
    v_result := 'true'::jsonb;

  elsif p_action = 'audit_stock_request' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    perform public.audit_stock_request((v_payload->>'p_request_id')::uuid,
      v_payload->>'p_status', v_actor.user_id, nullif(v_payload->>'p_note',''));
    v_result := 'true'::jsonb;

  elsif p_action = 'get_stock_movement' then
    perform private.require_role(v_actor.role, array['Frontdesk','Audit','StockAudit','Admin']);
    perform private.require_branch(v_actor.role, v_actor.branch_name, v_payload->>'p_branch_name');
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_stock_movement(v_payload->>'p_branch_name') x;

  elsif p_action = 'get_all_branch_balances' then
    perform private.require_role(v_actor.role, array['Audit','StockAudit','Admin']);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result
    from public.get_all_branch_balances() x;

  else
    raise exception 'UNKNOWN_ACTION' using errcode = '22023';
  end if;

  return v_result;
end;
$$;

-- Deny direct calls to every legacy function. The browser can only log in or
-- enter through the token-checked dispatcher above.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_app_session(text, text) to anon, authenticated;
grant execute on function public.arana_app_rpc(text, text, jsonb) to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;

