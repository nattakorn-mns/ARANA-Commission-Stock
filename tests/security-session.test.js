const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/db.js', 'utf8') + '\n;globalThis.__DB = DB;';
const values = new Map([['arana_session', JSON.stringify({ token: 'test-token' })]]);
const calls = [];
const context = {
  console,
  localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    key: () => null,
    get length() { return values.size; }
  },
  sessionStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  },
  sb: {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'create_app_session') {
        return { data: {
          id: 'user-id', username: 'tester', name: 'Test User', nickname: 'Test',
          role: 'Frontdesk', branch_name: 'พิษณุโลก', position: 'Tester',
          session_token: 'issued-token'
        }, error: null };
      }
      return { data: name === 'arana_app_rpc' ? true : null, error: null };
    }
  }
};
vm.createContext(context);
vm.runInContext(source, context);
const DB = context.__DB;

(async () => {
  const user = await DB.authenticateSupabase('tester', 'secret');
  assert.equal(user.sessionToken, 'issued-token');

  await DB.saveStockLogSupabase({
    branch: 'พิษณุโลก', productCode: 'P1', direction: 'OUT', type: 'OUT',
    qty: 1, note: 'test', createdBy: 'spoofed-user'
  });
  await DB.auditBillSupabase('bill-id', 'อนุมัติแล้ว', 'spoofed-auditor', 'ok');

  const gatewayCalls = calls.filter(call => call.name === 'arana_app_rpc');
  assert.equal(gatewayCalls.length, 2);
  assert.equal(gatewayCalls[0].args.p_session_token, 'test-token');
  assert.equal(gatewayCalls[0].args.p_payload.p_created_by, undefined);
  assert.equal(gatewayCalls[1].args.p_payload.p_audit_by, undefined);

  // Every function the browser may call directly. All except create_app_session take
  // p_session_token and check it with private.require_app_session on the server.
  const directRpcNames = [...source.matchAll(/sb\.rpc\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(directRpcNames)].sort(), ['arana_app_rpc', 'arana_my_bills', 'create_app_session']);
  const tokenCheckedRpc = new Set([
    'get_menu_permissions_for_me', 'admin_list_positions', 'admin_create_position', 'admin_list_menu_permissions',
    'admin_set_menu_permission', 'admin_set_user_position', 'admin_list_users_with_position',
    'list_stock_logs_erp_sync', 'set_stock_log_erp_sync_result', 'get_my_deposits',
    'admin_erp_sync_status', 'admin_erp_sync_now', 'admin_notify_channels', 'admin_notify_set_channel', 'admin_notify_queue', 'admin_notify_test', 'admin_notify_build',
    'admin_notify_rooms', 'admin_notify_save_room', 'admin_notify_delete_room', 'admin_notify_set_topic', 'admin_notify_test_room', 'admin_notify_template_defaults',
    'admin_stock_resync_preview', 'admin_stock_resync_apply',
    'list_deposit_accounts', 'admin_save_deposit_account',
    'list_open_pos_for_receiving', 'lookup_erp_customer', 'list_customer_deposits', 'list_programs_for_branch', 'list_receive_other_items', 'decide_receive_other_item', 'dispense_compare',
    'get_app_settings', 'admin_save_app_setting', 'create_deposit_any_branch', 'submit_bill_edit', 'list_bill_edits', 'decide_bill_edit',
    'commission_period_status', 'close_commission_period', 'admin_activity_log',
    'list_photos', 'create_chat_appointment', 'list_chat_visits', 'decide_chat_visit', 'list_my_chat_commissions',
    'list_incoming_transfers', 'receive_transfer', 'list_transfer_receipts', 'decide_transfer_receipt', 'list_transfers_to_fix', 'fix_transfer_dispatch'
  ]);
  const positionRpcNames = [...source.matchAll(/_positionRpc\('([^']+)'/g)].map(match => match[1]);
  assert.ok(positionRpcNames.length > 0);
  positionRpcNames.forEach(name => assert.ok(tokenCheckedRpc.has(name), 'Unreviewed direct RPC: ' + name));
  // _positionRpc is the only place allowed to call sb.rpc with a variable name.
  assert.equal([...source.matchAll(/sb\.rpc\((?!')/g)].length, 1);
  console.log('security-session.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});


