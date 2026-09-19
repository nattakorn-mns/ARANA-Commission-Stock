/**
 * ARANA CLINIC — Mock Database (localStorage)
 * db.js — Seed data from real APSX exports + employee list
 */

const DB = {

  // ── Helpers ──────────────────────────────────────────────
  _get(key) { try { return JSON.parse(localStorage.getItem('arana_' + key) || 'null'); } catch { return null; } },
  _set(key, val) { localStorage.setItem('arana_' + key, JSON.stringify(val)); },
  _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); },

  _sessionToken() {
    try { return JSON.parse(sessionStorage.getItem('arana_session') || '{}').token || null; }
    catch { return null; }
  },

  async _appRpc(action, payload = {}) {
    const token = this._sessionToken();
    if (!token) throw new Error('SESSION_REQUIRED');
    const { data, error } = await sb.rpc('arana_app_rpc', {
      p_session_token: token,
      p_action: action,
      p_payload: payload
    });
    if (error) {
      if (/SESSION_(INVALID|EXPIRED|REQUIRED)/.test(error.message || '')) {
        sessionStorage.removeItem('arana_session');
      }
      throw error;
    }
    return data;
  },

  // ── Init ─────────────────────────────────────────────────
  init() {
    if (!this._get('initialized')) {
      this._seedAll();
      this._set('initialized', true);
    }
  },

  reset() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('arana_'));
    keys.forEach(k => localStorage.removeItem(k));
    this.init();
  },

  _seedAll() {
    this._set('users', SEED_USERS);
    this._set('products', SEED_PRODUCTS);
    this._set('programs', SEED_PROGRAMS);
    this._set('bills', SEED_BILLS);
    this._set('bill_services', SEED_BILL_SERVICES);
    this._set('bill_sales', SEED_BILL_SALES);
    this._set('bill_supplies', SEED_BILL_SUPPLIES);
    this._set('bill_images', SEED_BILL_IMAGES);
    this._set('stock_logs', SEED_STOCK_LOGS);
    this._set('weekly_counts', []);
    this._set('audit_logs', SEED_AUDIT_LOGS);
    this._set('edit_requests', SEED_EDIT_REQUESTS);
    this._set('apsx_imports', []);
    this._set('hn_counter', 1);
  },

  // ── HN Generator ─────────────────────────────────────────
  nextHN() {
    const n = (this._get('hn_counter') || 1);
    this._set('hn_counter', n + 1);
    return 'HN-' + String(n).padStart(4, '0');
  },

  // ── USERS ─────────────────────────────────────────────────
  getUsers() { return this._get('users') || []; },
  getUserById(id) { return this.getUsers().find(u => u.id === id); },
  getUserByUsername(username) { return this.getUsers().find(u => u.username === username); },
  authenticate(username, password) {
    const user = this.getUserByUsername(username);
    if (user && user.password === password) return user;
    return null;
  },

  // ── LOGIN ผ่านฐานข้อมูลกลาง (Supabase) ─────────────────────
  // ใช้แทน authenticate() แบบเดิม — ตรวจรหัสผ่านฝั่งเซิร์ฟเวอร์ ปลอดภัยกว่า
  async authenticateSupabase(username, password) {
    const { data, error } = await sb.rpc('create_app_session', {
      p_username: username,
      p_password: password
    });
    if (error) {
      console.error('Login error:', error);
      return null;
    }
    if (!data || !data.session_token) return null;
    return {
      id: data.id,
      username: data.username,
      name: data.name,
      nickname: data.nickname,
      role: data.role,
      branch: data.branch_name,
      position: data.position,
      sessionToken: data.session_token
    };
  },

  async logoutSupabase() {
    try { await this._appRpc('logout'); }
    catch (error) { console.warn('Logout session error:', error); }
  },

  // ── จัดการพนักงานผ่านฐานข้อมูลกลาง (Supabase) ───────────────
  async getUsersSupabase() {
    try { var data = await this._appRpc('admin_list_users'); }
    catch (error) { console.error('getUsersSupabase error:', error); return []; }
    return (data || []).map(row => ({
      id: row.id,
      username: row.username,
      name: row.name,
      nickname: row.nickname,
      role: row.role,
      branch: row.branch_name,
      position: row.position,
      isActive: row.is_active
    }));
  },

  async createUserSupabase({ username, password, name, nickname, role, branch, position }) {
    try { return await this._appRpc('admin_create_user', {
      p_username: username,
      p_password: password,
      p_name: name,
      p_nickname: nickname,
      p_role: role,
      p_branch_name: branch,
      p_position: position || null
    }); } catch (error) {
      if (error.message && error.message.includes('USERNAME_EXISTS')) {
        throw new Error('USERNAME_EXISTS');
      }
      throw error;
    }
    return data;
  },

  async setUserActiveSupabase(userId, isActive) {
    await this._appRpc('admin_set_user_active', { p_user_id: userId, p_active: isActive });
  },

  // ── ตำแหน่งและสิทธิ์เมนู (ฟังก์ชันแยก ไม่ผ่าน arana_app_rpc) ──────
  async _positionRpc(fnName, payload = {}) {
    const token = this._sessionToken();
    if (!token) throw new Error('SESSION_REQUIRED');
    const { data, error } = await sb.rpc(fnName, { p_session_token: token, ...payload });
    if (error) {
      if (/SESSION_(INVALID|EXPIRED|REQUIRED)/.test(error.message || '')) {
        sessionStorage.removeItem('arana_session');
      }
      throw error;
    }
    return data;
  },

  async getMenuPermissionsForMeSupabase() {
    try { return await this._positionRpc('get_menu_permissions_for_me'); }
    catch (error) { console.error('getMenuPermissionsForMeSupabase error:', error); return []; }
  },

  async adminListPositionsSupabase() {
    try { return await this._positionRpc('admin_list_positions'); }
    catch (error) { console.error('adminListPositionsSupabase error:', error); return []; }
  },

  async adminCreatePositionSupabase(name, description) {
    return await this._positionRpc('admin_create_position', { p_name: name, p_description: description || null });
  },

  async adminListMenuPermissionsSupabase(positionName) {
    try { return await this._positionRpc('admin_list_menu_permissions', { p_position_name: positionName }); }
    catch (error) { console.error('adminListMenuPermissionsSupabase error:', error); return []; }
  },

  async adminSetMenuPermissionSupabase(positionName, pageKey, canView, canEdit, pageLabel) {
    await this._positionRpc('admin_set_menu_permission', {
      p_position_name: positionName, p_page_key: pageKey,
      p_can_view: canView, p_can_edit: canEdit, p_page_label: pageLabel || null
    });
  },

  async adminSetUserPositionSupabase(userId, positionName) {
    await this._positionRpc('admin_set_user_position', { p_user_id: userId, p_position_name: positionName });
  },

  async listStockLogsErpSyncSupabase(status) {
    try { return await this._positionRpc('list_stock_logs_erp_sync', { p_status: status || null }); }
    catch (error) { console.error('listStockLogsErpSyncSupabase error:', error); return []; }
  },

  async adminListUsersWithPositionSupabase() {
    try { return await this._positionRpc('admin_list_users_with_position'); }
    catch (error) { console.error('adminListUsersWithPositionSupabase error:', error); return []; }
  },

  async changeOwnPasswordSupabase(username, oldPassword, newPassword) {
    const data = await this._appRpc('change_own_password', {
      p_old_password: oldPassword,
      p_new_password: newPassword
    });
    return data === true;
  },

  // ── สต็อก ผ่านฐานข้อมูลกลาง (Supabase) ─────────────────────
  async getProductsSupabase() {
    try { var data = await this._appRpc('get_active_products'); }
    catch (error) { console.error('getProductsSupabase error:', error); return []; }
    return data || [];
  },

  async getBranchStockSupabase(branchName) {
    try { var data = await this._appRpc('get_branch_stock', { p_branch_name: branchName }); }
    catch (error) { console.error('getBranchStockSupabase error:', error); return []; }
    return data || [];
  },

  async saveStockLogSupabase({ branch, toBranch, productCode, direction, type, qty, note, createdBy, source, requestId }) {
    const data = await this._appRpc('save_stock_log', {
      p_branch_name: branch,
      p_to_branch_name: toBranch || null,
      p_product_code: productCode,
      p_direction: direction,
      p_move_type: type,
      p_qty: qty,
      p_note: note,
      p_source: source || null, p_request_id: requestId || null
    });
    return data; // log id
  },

  async saveStockLogImageSupabase(logId, base64Data) {
    try { await this._appRpc('save_stock_log_image', { p_log_id: logId, p_data: base64Data }); }
    catch (error) { console.error('saveStockLogImageSupabase error:', error); }
  },

  // ── OPD ผ่านฐานข้อมูลกลาง (Supabase) ────────────────────────
  async getProgramsSupabase() {
    try { var data = await this._appRpc('get_active_programs'); }
    catch (error) { console.error('getProgramsSupabase error:', error); return []; }
    return data || [];
  },

  async createOpdBillSupabase(payload) {
    const data = await this._appRpc('create_opd_bill', { p_payload: payload });
    return data; // bill id
  },

  async searchOpenOpdBillsSupabase(query, branchName) {
    try { var data = await this._appRpc('search_open_opd_bills', { p_query: query, p_branch_name: branchName }); }
    catch (error) { console.error('searchOpenOpdBillsSupabase error:', error); return []; }
    return (data || []).map(r => ({ id: r.id, hn: r.hn, customerName: r.customer_name, date: r.bill_date, branch: r.branch_name }));
  },

  async appendOpdBillSupabase(billId, payload) {
    const data = await this._appRpc('append_opd_bill', { p_bill_id: billId, p_payload: payload });
    return data;
  },

  // ── มัดจำ/ปิดการขายออนไลน์ ──────────────────────────────
  async createDepositSupabase(payload) {
    const data = await this._appRpc('create_deposit', { p_payload: payload });
    return data;
  },

  async getPendingDepositsSupabase() {
    try { var data = await this._appRpc('get_pending_deposits'); }
    catch (error) { console.error('getPendingDepositsSupabase error:', error); return []; }
    return data || [];
  },

  async getDepositDetailSupabase(depositId) {
    const data = await this._appRpc('get_deposit_detail', { p_deposit_id: depositId });
    return data;
  },

  async auditDepositSupabase(depositId, status, auditBy, note) {
    await this._appRpc('audit_deposit', { p_deposit_id: depositId, p_status: status, p_note: note || null });
  },

  async searchConfirmedDepositsSupabase(query, branchName) {
    try { var data = await this._appRpc('search_confirmed_deposits', { p_query: query, p_branch_name: branchName }); }
    catch (error) { console.error('searchConfirmedDepositsSupabase error:', error); return []; }
    return data || [];
  },

  // ── Audit ผ่านฐานข้อมูลกลาง (Supabase) ──────────────────────
  async getPendingBillsSupabase() {
    try { var data = await this._appRpc('get_pending_bills'); }
    catch (error) { console.error('getPendingBillsSupabase error:', error); return []; }
    return (data || []).map(r => ({
      id: r.id, hn: r.hn, customerName: r.customer_name, date: r.bill_date,
      branch: r.branch_name, createdByName: r.created_by_name, status: r.status
    }));
  },

  async getBillDetailSupabase(billId) {
    try { var data = await this._appRpc('get_bill_detail', { p_bill_id: billId }); }
    catch (error) { console.error('getBillDetailSupabase error:', error); return null; }
    return data;
  },

  async auditBillSupabase(billId, status, auditBy, note) {
    await this._appRpc('audit_bill', { p_bill_id: billId, p_status: status, p_note: note || null });
  },

  async getPendingOpdStockRequestsSupabase() {
    try { var data = await this._appRpc('get_pending_opd_stock_requests'); }
    catch (error) { console.error('getPendingOpdStockRequestsSupabase error:', error); return []; }
    return (data || []).map(r => ({
      billId: r.bill_id, date: r.bill_date, branch: r.branch_name, hn: r.hn,
      customerName: r.customer_name, programSummary: r.program_summary,
      supplyCount: Number(r.supply_count || 0), createdByName: r.created_by_name,
      auditStatus: r.audit_status
    }));
  },

  async auditOpdStockRequestSupabase(billId, status, auditBy, note) {
    await this._appRpc('audit_opd_stock_request', {
      p_bill_id: billId, p_status: status, p_note: note || null
    });
  },

  async getPendingStockLogsSupabase() {
    try { var data = await this._appRpc('get_pending_stock_logs'); }
    catch (error) { console.error('getPendingStockLogsSupabase error:', error); return []; }
    return (data || []).map(r => ({
      id: r.id, requestId: r.request_id || r.id, createdAt: r.created_at, date: r.log_date, branch: r.branch_name, toBranch: r.to_branch_name, type: r.move_type,
      productCode: r.product_code, productName: r.product_name, qty: r.qty, unit: r.unit,
      createdByName: r.created_by_name, auditStatus: r.audit_status, note: r.note, source: r.source
    }));
  },

  async getPendingStockLogImagesSupabase() {
    try { var data = await this._appRpc('get_pending_stock_log_images'); }
    catch (error) { console.error('getPendingStockLogImagesSupabase error:', error); return []; }
    return (data || []).map(r => ({ logId: r.stock_log_id, fileUrl: r.file_url, uploadedAt: r.uploaded_at }));
  },

  async auditStockRequestSupabase(requestId, status, auditBy, note) { await this._appRpc('audit_stock_request', { p_request_id: requestId, p_status: status, p_note: note || null }); },

  async auditStockLogSupabase(logId, status, auditBy, note) {
    await this._appRpc('audit_stock_log', { p_log_id: logId, p_status: status, p_note: note || null });
  },

  // ── Stock Card ผ่านฐานข้อมูลกลาง (Supabase) ─────────────────
  async getStockMovementSupabase(branchName) {
    try { var data = await this._appRpc('get_stock_movement', { p_branch_name: branchName }); }
    catch (error) { console.error('getStockMovementSupabase error:', error); return []; }
    return (data || []).map(r => ({
      date: r.log_date, type: r.move_type, direction: r.direction,
      productCode: r.product_code, productName: r.product_name, unit: r.unit,
      qty: r.qty, auditStatus: r.audit_status, createdByName: r.created_by_name, source: r.source
    }));
  },

  async getAllBranchBalancesSupabase() {
    try { var data = await this._appRpc('get_all_branch_balances'); }
    catch (error) { console.error('getAllBranchBalancesSupabase error:', error); return []; }
    return data || [];
  },

  // ── สรุปยอดของฉัน ผ่านฐานข้อมูลกลาง (Supabase) ──────────────
  async getMyBillsSupabase() {
    const token = this._sessionToken();
    if (!token) throw new Error('SESSION_REQUIRED');
    const { data, error } = await sb.rpc('arana_my_bills', { p_session_token: token });
    if (error) throw error;
    const camel = (k) => k.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
    const norm = (row) => {
      const out = {};
      Object.keys(row || {}).forEach(k => { out[camel(k)] = row[k]; });
      if (out.saleType && !out.type) out.type = String(out.saleType).toLowerCase();
      if (out.type) out.type = String(out.type).toLowerCase();
      if (out.billId == null && out.bill_id != null) out.billId = out.bill_id;
      return out;
    };
    const arr = (v) => Array.isArray(v) ? v.map(norm) : [];
    const res = {
      bills: arr(data && data.bills),
      services: arr(data && data.services),
      sales: arr(data && data.sales)
    };
    console.log('[arana_my_bills] raw:', data, 'normalized:', res);
    return res;
  },

  addUser(user) {
    const users = this.getUsers();
    user.id = this._genId();
    users.push(user);
    this._set('users', users);
    return user;
  },

  // ── PROGRAMS ──────────────────────────────────────────────
  getPrograms() { return this._get('programs') || []; },
  getProgramByCode(code) { return this.getPrograms().find(p => p.code === code); },

  // ── PRODUCTS ──────────────────────────────────────────────
  getProducts() { return this._get('products') || []; },
  getProductByCode(code) { return this.getProducts().find(p => p.code === code); },
  updateProductStock(code, delta) {
    const products = this.getProducts();
    const p = products.find(x => x.code === code);
    if (p) {
      p.stockQty = (p.stockQty || 0) + delta;
      this._set('products', products);
    }
  },

  // ── BILLS ─────────────────────────────────────────────────
  getBills() { return this._get('bills') || []; },
  getBillById(id) { return this.getBills().find(b => b.id === id); },
  saveBill(bill) {
    const bills = this.getBills();
    if (!bill.id) {
      bill.id = this._genId();
      bill.createdAt = new Date().toISOString();
      bill.status = bill.status || 'รอตรวจสอบ';
      bills.push(bill);
    } else {
      const idx = bills.findIndex(b => b.id === bill.id);
      if (idx >= 0) bills[idx] = bill;
    }
    this._set('bills', bills);
    return bill;
  },
  getBillsByUser(userId) {
    return this.getBills().filter(b =>
      b.createdBy === userId || (b.sharedWith || []).includes(userId)
    );
  },
  getBillsPendingAudit() {
    return this.getBills().filter(b => b.status === 'รอตรวจสอบ');
  },

  // ── BILL SERVICES ────────────────────────────────────────
  getBillServices(billId) { return (this._get('bill_services') || []).filter(s => s.billId === billId); },
  saveBillService(svc) {
    const list = this._get('bill_services') || [];
    if (!svc.id) { svc.id = this._genId(); list.push(svc); }
    else { const i = list.findIndex(x => x.id === svc.id); if (i >= 0) list[i] = svc; }
    this._set('bill_services', list);
    return svc;
  },
  deleteBillService(id, userId) {
    let list = this._get('bill_services') || [];
    const svc = list.find(s => s.id === id);
    if (!svc || svc.createdBy !== userId) return false;
    list = list.filter(s => s.id !== id);
    this._set('bill_services', list);
    return true;
  },

  // ── BILL SALES ───────────────────────────────────────────
  getBillSales(billId) { return (this._get('bill_sales') || []).filter(s => s.billId === billId); },
  saveBillSale(sale) {
    const list = this._get('bill_sales') || [];
    if (!sale.id) { sale.id = this._genId(); list.push(sale); }
    else { const i = list.findIndex(x => x.id === sale.id); if (i >= 0) list[i] = sale; }
    this._set('bill_sales', list);
    return sale;
  },
  deleteBillSale(id, userId) {
    let list = this._get('bill_sales') || [];
    const s = list.find(x => x.id === id);
    if (!s || s.createdBy !== userId) return false;
    list = list.filter(x => x.id !== id);
    this._set('bill_sales', list);
    return true;
  },

  // ── BILL SUPPLIES ────────────────────────────────────────
  getBillSupplies(billId) { return (this._get('bill_supplies') || []).filter(s => s.billId === billId); },
  saveBillSupply(sup) {
    const list = this._get('bill_supplies') || [];
    if (!sup.id) { sup.id = this._genId(); list.push(sup); }
    else { const i = list.findIndex(x => x.id === sup.id); if (i >= 0) list[i] = sup; }
    this._set('bill_supplies', list);
    return sup;
  },
  deleteBillSupply(id, userId) {
    let list = this._get('bill_supplies') || [];
    const s = list.find(x => x.id === id);
    if (!s || s.createdBy !== userId) return false;
    list = list.filter(x => x.id !== id);
    this._set('bill_supplies', list);
    return true;
  },

  // ── BILL IMAGES ──────────────────────────────────────────
  getBillImages(billId) { return (this._get('bill_images') || []).filter(i => i.billId === billId); },
  saveBillImage(img) {
    const list = this._get('bill_images') || [];
    img.id = this._genId();
    list.push(img);
    this._set('bill_images', list);
    return img;
  },
  deleteBillImage(id) {
    let list = this._get('bill_images') || [];
    list = list.filter(i => i.id !== id);
    this._set('bill_images', list);
  },

  // ── STOCK IMAGES ─────────────────────────────────────────
  getStockLogImages(logId) { return (this._get('stock_images') || []).filter(i => i.logId === logId); },
  saveStockLogImage(img) {
    const list = this._get('stock_images') || [];
    img.id = this._genId();
    list.push(img);
    this._set('stock_images', list);
    return img;
  },

  // ── STOCK IMAGES ─────────────────────────────────────────
  getStockLogImages(logId) { return (this._get('stock_images') || []).filter(i => i.logId === logId); },
  saveStockLogImage(img) {
    const list = this._get('stock_images') || [];
    img.id = this._genId();
    list.push(img);
    this._set('stock_images', list);
    return img;
  },

  // ── STOCK LOGS ───────────────────────────────────────────
  getStockLogs(filters = {}) {
    let logs = this._get('stock_logs') || [];
    if (filters.branch) logs = logs.filter(l => l.branch === filters.branch);
    if (filters.productCode) logs = logs.filter(l => l.productCode === filters.productCode);
    if (filters.type) logs = logs.filter(l => l.type === filters.type);
    if (filters.auditStatus) logs = logs.filter(l => l.auditStatus === filters.auditStatus);
    if (filters.dateFrom) logs = logs.filter(l => l.date >= filters.dateFrom);
    if (filters.dateTo) logs = logs.filter(l => l.date <= filters.dateTo);
    return logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },
  saveStockLog(log) {
    const list = this._get('stock_logs') || [];
    if (!log.id) {
      log.id = this._genId();
      log.createdAt = new Date().toISOString();
      log.auditStatus = log.auditStatus || 'รอตรวจสอบ';
      list.push(log);
    } else {
      const i = list.findIndex(x => x.id === log.id);
      if (i >= 0) list[i] = log;
    }
    this._set('stock_logs', list);
    return log;
  },
  getStockBalance(branch) {
    const logs = this.getStockLogs(branch ? { branch } : {});
    const balance = {};
    logs.forEach(log => {
      if (!balance[log.productCode]) balance[log.productCode] = 0;
      if (log.direction === 'IN') balance[log.productCode] += (log.qty || 0);
      else if (log.direction === 'OUT') balance[log.productCode] -= (log.qty || 0);
    });
    return balance;
  },

  // ── WEEKLY COUNT ────────────────────────────────────────
  getWeeklyCounts(weekStart, branch) {
    return (this._get('weekly_counts') || []).filter(w =>
      w.weekStart === weekStart && w.branch === branch
    );
  },
  saveWeeklyCount(count) {
    const list = this._get('weekly_counts') || [];
    const existing = list.findIndex(w =>
      w.weekStart === count.weekStart && w.branch === count.branch && w.productCode === count.productCode
    );
    if (existing >= 0) list[existing] = { ...list[existing], ...count };
    else { count.id = this._genId(); list.push(count); }
    this._set('weekly_counts', list);
    return count;
  },

  // ── AUDIT LOGS ───────────────────────────────────────────
  getAuditLogs(filters = {}) {
    let logs = this._get('audit_logs') || [];
    if (filters.dateFrom) logs = logs.filter(l => l.date >= filters.dateFrom);
    if (filters.dateTo) logs = logs.filter(l => l.date <= filters.dateTo);
    if (filters.auditBy) logs = logs.filter(l => l.auditBy === filters.auditBy);
    return logs.sort((a, b) => b.date.localeCompare(a.date));
  },
  saveAuditLog(log) {
    const list = this._get('audit_logs') || [];
    log.id = this._genId();
    log.date = new Date().toISOString();
    list.push(log);
    this._set('audit_logs', list);
    return log;
  },

  // ── EDIT REQUESTS ────────────────────────────────────────
  getEditRequests() { return this._get('edit_requests') || []; },
  getEditRequestsByUser(userId) { return this.getEditRequests().filter(r => r.requestedBy === userId); },
  saveEditRequest(req) {
    const list = this._get('edit_requests') || [];
    if (!req.id) {
      req.id = this._genId();
      req.requestDate = new Date().toISOString();
      req.status = 'รอการอนุมัติ';
      list.push(req);
    } else {
      const i = list.findIndex(x => x.id === req.id);
      if (i >= 0) list[i] = req;
    }
    this._set('edit_requests', list);
    return req;
  },

  // ── AUDIT ACTIONS ────────────────────────────────────────
  auditBill(billId, action, auditUserId, note = '') {
    const bills = this.getBills();
    const bill = bills.find(b => b.id === billId);
    if (!bill) return false;
    const oldStatus = bill.status;
    bill.status = action === 'approve' ? 'อนุมัติแล้ว' : 'ตีกลับ';
    bill.auditBy = auditUserId;
    bill.auditDate = new Date().toISOString();
    bill.auditNote = note;
    this._set('bills', bills);
    this.saveAuditLog({
      action: action === 'approve' ? 'อนุมัติ OPD' : 'ตีกลับ OPD',
      targetType: 'bill', targetId: billId,
      auditBy: auditUserId, oldStatus, newStatus: bill.status, note
    });
    return true;
  },
  auditStockLog(logId, action, auditUserId, note = '') {
    const logs = this._get('stock_logs') || [];
    const log = logs.find(l => l.id === logId);
    if (!log) return false;
    const oldStatus = log.auditStatus;
    log.auditStatus = action === 'approve' ? 'อนุมัติแล้ว' : 'ตีกลับ';
    log.auditBy = auditUserId;
    log.auditDate = new Date().toISOString();
    log.auditNote = note;
    // Auto-transfer logic
    if (action === 'approve' && log.type === 'TRANSFER') {
      this.saveStockLog({
        date: log.date, branch: log.toBranch, type: 'IN', direction: 'IN',
        productCode: log.productCode, productName: log.productName,
        qty: log.qty, unit: log.unit, note: `รับโอนจากสาขา ${log.branch}`,
        createdBy: log.createdBy, auditStatus: 'อนุมัติแล้ว'
      });
    }
    this._set('stock_logs', logs);
    this.saveAuditLog({
      action: action === 'approve' ? 'อนุมัติสต๊อก' : 'ตีกลับสต๊อก',
      targetType: 'stock_log', targetId: logId,
      auditBy: auditUserId, oldStatus, newStatus: log.auditStatus, note
    });
    return true;
  },
  revertAuditStatus(type, targetId, auditUserId) {
    if (type === 'bill') {
      const bills = this.getBills();
      const bill = bills.find(b => b.id === targetId);
      if (!bill) return false;
      const old = bill.status;
      bill.status = 'รอตรวจสอบ';
      this._set('bills', bills);
      this.saveAuditLog({ action: 'คืนสถานะ OPD', targetType: 'bill', targetId, auditBy: auditUserId, oldStatus: old, newStatus: 'รอตรวจสอบ' });
    } else {
      const logs = this._get('stock_logs') || [];
      const log = logs.find(l => l.id === targetId);
      if (!log) return false;
      const old = log.auditStatus;
      log.auditStatus = 'รอตรวจสอบ';
      this._set('stock_logs', logs);
      this.saveAuditLog({ action: 'คืนสถานะสต๊อก', targetType: 'stock_log', targetId, auditBy: auditUserId, oldStatus: old, newStatus: 'รอตรวจสอบ' });
    }
    return true;
  },

  // ── Reports ───────────────────────────────────────────────
  getReports(userId, role, dateFrom, dateTo) {
    let sales = this._get('bill_sales') || [];
    let services = this._get('bill_services') || [];
    const bills = this.getBills();

    if (role === 'Frontdesk') {
      sales = sales.filter(s => s.createdBy === userId && !s.is_superseded);
      services = services.filter(s => s.createdBy === userId && !s.is_superseded);
    } else {
      sales = sales.filter(s => !s.is_superseded);
      services = services.filter(s => !s.is_superseded);
    }

    const billMap = {};
    bills.forEach(b => { billMap[b.id] = b; });

    const rows = [];
    sales.forEach(s => {
      const bill = billMap[s.billId];
      if (!bill) return;
      if (dateFrom && bill.date < dateFrom) return;
      if (dateTo && bill.date > dateTo) return;
      rows.push({
        date: bill.date,
        branch: bill.branch,
        employeeId: s.createdBy,
        customerName: bill.customerName,
        oldProgram: s.oldProgram || '',
        oldPrice: s.oldPrice || 0,
        saleType: s.type,
        newProgram: s.newProgram,
        amountPaid: s.amountPaid || 0,
        commissionBase: s.commissionBase || 0,
        commissionPct: s.commissionPct || 0,
        commissionAmt: s.commissionAmt || 0,
        category: 'commission'
      });
    });
    services.forEach(sv => {
      const bill = billMap[sv.billId];
      if (!bill) return;
      if (dateFrom && bill.date < dateFrom) return;
      if (dateTo && bill.date > dateTo) return;
      rows.push({
        date: bill.date,
        branch: bill.branch,
        employeeId: sv.createdBy,
        customerName: bill.customerName,
        oldProgram: '', oldPrice: 0, saleType: 'service',
        newProgram: sv.programName,
        amountPaid: sv.price || 0,
        commissionBase: sv.price || 0,
        commissionPct: 0,
        commissionAmt: sv.commission || 0,
        category: 'service'
      });
    });
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  },

  // ── Shortcut helpers for modules ─────────────────────────
  updateBillStatus(billId, status, auditUserId, note = '') {
    const bills = this.getBills();
    const bill = bills.find(b => b.id === billId);
    if (!bill) return false;
    const oldStatus = bill.status;
    bill.status = status;
    bill.auditBy = auditUserId;
    bill.auditDate = new Date().toISOString();
    bill.auditNote = note;
    this._set('bills', bills);
    this.saveAuditLog({ action: status === 'อนุมัติแล้ว' ? 'อนุมัติ' : 'ตีกลับ', targetType: 'bill', targetId: billId, auditBy: auditUserId, oldStatus, newStatus: status, note, createdAt: new Date().toISOString() });
    this._logSystem(auditUserId, `${status === 'อนุมัติแล้ว' ? 'อนุมัติ' : 'ตีกลับ'} OPD`, `บิล ${billId}`);
    return true;
  },

  updateStockLogStatus(logId, status, auditUserId, note = '') {
    const logs = this._get('stock_logs') || [];
    const log = logs.find(l => l.id === logId);
    if (!log) return false;
    const oldStatus = log.auditStatus;
    log.auditStatus = status;
    log.auditBy = auditUserId;
    log.auditDate = new Date().toISOString();
    log.auditNote = note || '';
    if (status === 'อนุมัติแล้ว' && log.type === 'TRANSFER') {
      this.saveStockLog({ date: log.date, branch: log.toBranch, type: 'IN', direction: 'IN', productCode: log.productCode, productName: log.productName, qty: log.qty, unit: log.unit, note: `รับโอนจากสาขา ${log.branch}`, createdBy: log.createdBy, auditStatus: 'อนุมัติแล้ว' });
    }
    this._set('stock_logs', logs);
    this.saveAuditLog({ action: status === 'อนุมัติแล้ว' ? 'อนุมัติ' : 'ตีกลับ', targetType: 'stock_log', targetId: logId, auditBy: auditUserId, oldStatus, newStatus: status, note: note || '', createdAt: new Date().toISOString() });
    return true;
  },

  saveUser(user) {
    const users = this.getUsers();
    if (!user.id) { user.id = this._genId(); user.createdAt = new Date().toISOString(); }
    users.push(user);
    this._set('users', users);
    this._logSystem(user.id, 'เพิ่มผู้ใช้', `${user.name} (${user.role})`);
    return user;
  },

  updateEditRequest(reqId, status, approvedBy, note = '') {
    const list = this._get('edit_requests') || [];
    const req = list.find(r => r.id === reqId);
    if (!req) return false;
    req.status = status;
    req.approvedBy = approvedBy;
    req.approvedAt = new Date().toISOString();
    req.auditNote = note;
    this._set('edit_requests', list);
    return true;
  },

  revertAuditLog(logId) {
    const auditLogs = this._get('audit_logs') || [];
    const al = auditLogs.find(l => l.id === logId);
    if (!al) return false;
    if (al.targetType === 'bill') this.updateBillStatus(al.targetId, 'รอตรวจสอบ', al.auditBy);
    else this.updateStockLogStatus(al.targetId, 'รอตรวจสอบ', al.auditBy);
    return true;
  },

  getSystemLogs() { return this._get('system_logs') || []; },

  _logSystem(userId, action, detail = '') {
    const list = this._get('system_logs') || [];
    list.unshift({ id: this._genId(), userId, branch: '', action, detail, createdAt: new Date().toISOString() });
    if (list.length > 500) list.pop();
    this._set('system_logs', list);
  },
};

// ── SEED DATA ─────────────────────────────────────────────────

const SEED_USERS = [
  { id:'u001', username:'admin', password:'admin', name:'ณัฎฐากร หิรัญวัฒนะ', nickname:'ออม', role:'Admin', branch:'พิษณุโลก', position:'หัวหน้าฝ่ายปฏิบัติการ' },
  { id:'u002', username:'audit1', password:'1234', name:'กุลวรินทร์ กุลทวีพรพัฒน์', nickname:'กุญแจ', role:'Audit', branch:'พิษณุโลก', position:'ผู้อำนวยการ' },
  { id:'u003', username:'audit2', password:'1234', name:'นันติยา จันทร์อยู่', nickname:'วิว', role:'Audit', branch:'พิษณุโลก', position:'บัญชี' },
  { id:'u004', username:'audit3', password:'1234', name:'น้ำฝน กันยาประสิทธิ์', nickname:'ฝน', role:'Audit', branch:'พิษณุโลก', position:'บัญชี' },
  { id:'u005', username:'frontdesk1', password:'1234', name:'ปาวีณา จันตาเรียน', nickname:'มายด์', role:'Frontdesk', branch:'พิษณุโลก', position:'Beauty Consult' },
  { id:'u006', username:'frontdesk2', password:'1234', name:'ทิพาศรี สุขประเสริฐ', nickname:'โบว์', role:'Frontdesk', branch:'พิษณุโลก', position:'ผู้ช่วยแพทย์' },
  { id:'u007', username:'frontdesk3', password:'1234', name:'ชนัญชิดา ศิริมงคล', nickname:'ทราย', role:'Frontdesk', branch:'พิษณุโลก', position:'พนักงานทรีทเม้นท์' },
  { id:'u008', username:'frontdesk4', password:'1234', name:'ปทิตตา ปริฐากุลตรา', nickname:'นอม', role:'Frontdesk', branch:'พิษณุโลก', position:'Beauty Consult' },
  { id:'u009', username:'frontdesk5', password:'1234', name:'อริศรา หงษ์ดำเนิน', nickname:'ซาย', role:'Frontdesk', branch:'กำแพงเพชร', position:'Beauty Consult' },
  { id:'u010', username:'frontdesk6', password:'1234', name:'กนกพร จันทร์โพธิ์', nickname:'ปอล์หวาย', role:'Frontdesk', branch:'กำแพงเพชร', position:'ผู้ช่วยแพทย์' },
  { id:'u011', username:'frontdesk7', password:'1234', name:'ปุญญิสา บุญศรีกุล', nickname:'หญิง', role:'Frontdesk', branch:'แม่สอด', position:'Beauty Consult' },
  { id:'u012', username:'frontdesk8', password:'1234', name:'ภูริชญา รุ่งสุริญา', nickname:'ฮาเดียร์', role:'Frontdesk', branch:'แม่สอด', position:'ผู้ช่วยแพทย์' },
  { id:'u013', username:'fd_maesod', password:'1234', name:'จันบาล วงค์ปางมูล', nickname:'น้อย', role:'Frontdesk', branch:'แม่สอด', position:'พนักงานทรีทเม้นท์' },
  { id:'u014', username:'fd_kamphaeng', password:'1234', name:'ศิริวิมล มณีเขียว', nickname:'ใบเงิน', role:'Frontdesk', branch:'กำแพงเพชร', position:'พนักงานทรีทเม้นท์' },
  { id:'u015', username:'fd_boon', password:'1234', name:'อุ้มบุญ แก้วเขียว', nickname:'กุ๊กไก่', role:'Frontdesk', branch:'พิษณุโลก', position:'พนักงานทรีทเม้นท์' },
  { id:'u016', username:'fd_yoyo', password:'1234', name:'ณิชกานต์ รักษา', nickname:'โยเกิร์ต', role:'Frontdesk', branch:'พิษณุโลก', position:'เลขา' },
  { id:'u017', username:'fd_nim', password:'1234', name:'สุภาภรณ์ จันทร์พันธ์', nickname:'นิ่ม', role:'Frontdesk', branch:'พิษณุโลก', position:'แอดมิน' },
  { id:'u018', username:'fd_beam', password:'1234', name:'ปัณณพร สุทธิศักดิ์', nickname:'บีม', role:'Frontdesk', branch:'พิษณุโลก', position:'กราฟิก' },
  { id:'u019', username:'fd_prae', password:'1234', name:'แพรวัลย์ ปิ่นสากล', nickname:'แพร', role:'Frontdesk', branch:'กำแพงเพชร', position:'พนักงานทรีทเม้นท์' },
  { id:'u020', username:'fd_may', password:'1234', name:'กันยารัตน์ มหาพนารักษ์', nickname:'เมย์', role:'Frontdesk', branch:'พิษณุโลก', position:'พี่เลี้ยง' },
];

const SEED_PROGRAMS = [
  {code:'00002',name:'Drip Glow Aura Booster 1 ครั้ง',price:699,unit:'ครั้ง',category:'Drip'},
  {code:'00003',name:'Drip Glow Aura Booster 5 ครั้ง',price:599.8,unit:'ครั้ง',category:'Drip'},
  {code:'00005',name:'Drip Vitamin C Bright Boost 1 ครั้ง',price:999,unit:'ครั้ง',category:'Drip'},
  {code:'00007',name:'Drip Put 1 ครั้ง',price:399,unit:'ครั้ง',category:'Drip'},
  {code:'00011',name:'Drip Celebrity Aura Glow Skin 1 ครั้ง',price:1599,unit:'ครั้ง',category:'Drip'},
  {code:'00015',name:'Drip Miracle Glass Skin 1 ครั้ง',price:1999,unit:'ครั้ง',category:'Drip'},
  {code:'00018',name:'Drip Premium Glass Skin 1 ครั้ง',price:2999,unit:'ครั้ง',category:'Drip'},
  {code:'00055',name:'P-cell 1 ครั้ง',price:1899,unit:'ครั้ง',category:'Treatment'},
  {code:'00071',name:'Filler Restylane Vital light 2 cc',price:24999,unit:'ครั้ง',category:'Filler'},
  {code:'00076',name:'Filler Restylane defyne 1 cc',price:12999,unit:'ครั้ง',category:'Filler'},
  {code:'00131',name:'Botox Xeomin 50 U',price:9999,unit:'ครั้ง',category:'Botox'},
  {code:'00164',name:'Botox Nabota 50 u',price:3999,unit:'ครั้ง',category:'Botox'},
  {code:'00189',name:'เมโสคริสตัลไวส์ 1 ครั้ง',price:899,unit:'ครั้ง',category:'Meso'},
  {code:'00190',name:'Glassskin Meso Boost คอร์ส 10 ครั้ง',price:599.9,unit:'ครั้ง',category:'Meso'},
  {code:'00200',name:'เลเซอร์รักแร้ขน+ขาว 1 ครั้ง',price:999,unit:'ครั้ง',category:'Laser'},
  {code:'00203',name:'เลเซอร์บราซิลเลี่ยน+ขาว 1 ครั้ง',price:1599,unit:'ครั้ง',category:'Laser'},
  {code:'00240',name:'รักษาสิวที่หลัง 1 ครั้ง',price:1599,unit:'ครั้ง',category:'Treatment'},
  {code:'00243',name:'Lifting ขนตา+คิ้ว',price:999,unit:'ครั้ง',category:'Treatment'},
  {code:'00254',name:'กดสิวฉายแสง Acne Light',price:299,unit:'ครั้ง',category:'Treatment'},
  {code:'00263',name:'Reju Glow skin 1 ครั้ง',price:999,unit:'ครั้ง',category:'Treatment'},
  {code:'00271',name:'V Ultra Shape Lift 1 ครั้ง',price:999,unit:'ครั้ง',category:'Lift'},
  {code:'00281',name:'Botox Aestox เหมาริ้วรอย',price:3999,unit:'ครั้ง',category:'Botox'},
  {code:'00299',name:'ศัลยกรรมตาสองชั้นกรีดยาว+ตัดไขมันหนังตา',price:15999,unit:'ครั้ง',category:'Surgery'},
  {code:'00301',name:'ศัลยกรรมตา 2 ชั้น+ตัดไขมัน',price:9999,unit:'ครั้ง',category:'Surgery'},
  {code:'00346',name:'ศัลยกรรมจมูก Semi Open Full option',price:19999,unit:'ครั้ง',category:'Surgery'},
  {code:'00418',name:'ฉีดฝ้า Derma glow 2 cc',price:2999,unit:'ครั้ง',category:'Injection'},
  {code:'00419',name:'ฉีดฝ้า 1 ขวด',price:3999,unit:'ครั้ง',category:'Injection'},
  {code:'00431',name:'Botox หน้าเรียวขั้นสุด',price:5999,unit:'ครั้ง',category:'Botox'},
  {code:'00432',name:'Sculptra 1 ขวด',price:29999,unit:'ครั้ง',category:'Filler'},
  {code:'00436',name:'Botox Neuronox 50 u',price:4999,unit:'ครั้ง',category:'Botox'},
  {code:'00467',name:'Fat lipo 100 cc',price:9999,unit:'ครั้ง',category:'Fat'},
  {code:'00479',name:'Signature Milk Bath',price:1999,unit:'ครั้ง',category:'Spa'},
  {code:'00482',name:'เลเซอร์ขาว',price:699,unit:'ครั้ง',category:'Laser'},
  {code:'00495',name:'Botox Hugel 50 unit',price:2999,unit:'ครั้ง',category:'Botox'},
  {code:'00500',name:'ลักยิ้ม',price:5999,unit:'ครั้ง',category:'Surgery'},
  {code:'00567',name:'Arana Signature นวดผ่อนคลาย',price:1599,unit:'ครั้ง',category:'Spa'},
  {code:'00637',name:'ร้อยไหมไม่จำกัดเส้น',price:9999,unit:'ครั้ง',category:'Thread'},
  {code:'00669',name:'Ulthera SPT 400 line',price:39999,unit:'ครั้ง',category:'Lift'},
  {code:'00692',name:'Rejuran 4 cc',price:18999,unit:'ครั้ง',category:'Injection'},
  {code:'00712',name:'ร้อยไหมมิ้น 8 เส้น',price:16999,unit:'ครั้ง',category:'Thread'},
  {code:'00727',name:'Pico หลุมสิว+รูขุมขน 10 ครั้ง',price:2299.9,unit:'ครั้ง',category:'Laser'},
  {code:'00731',name:'Ulthera 400 line',price:39999,unit:'ครั้ง',category:'Lift'},
  {code:'00737',name:'Alyn Signature 5 ครั้ง',price:1399.8,unit:'ครั้ง',category:'Treatment'},
  {code:'00739',name:'Ulthera 600 line',price:59999,unit:'ครั้ง',category:'Lift'},
  {code:'00744',name:'Ulthera 800 line',price:79999,unit:'ครั้ง',category:'Lift'},
];

const SEED_PRODUCTS = [
  // Medical/Clinical (type: 1)
  {code:'ST000001',name:'Botox Hugel 50 unit',unit:'ยูนิต',category:'ยา',type:1,stockQty:500},
  {code:'ST000002',name:'Botox Hugel 200 unit',unit:'ยูนิต',category:'ยา',type:1,stockQty:200},
  {code:'ST000007',name:'Botox Allergen 50 unit',unit:'ยูนิต',category:'ยา',type:1,stockQty:150},
  {code:'ST000009',name:'Filler Neuramis Volume (RP)',unit:'ซีซี',category:'ยา',type:1,stockQty:30},
  {code:'ST000011',name:'Filler Neuramis Deep (ดำยาชา) RP',unit:'ซีซี',category:'ยา',type:1,stockQty:25},
  {code:'ST000016',name:'Filler Eptq S100 (เขียว)',unit:'ซีซี',category:'ยา',type:1,stockQty:20},
  {code:'ST000018',name:'Filler Eptq S300 (สีส้ม)',unit:'ซีซี',category:'ยา',type:1,stockQty:15},
  {code:'ST000020',name:'Filler Eptq S500 (สีน้ำเงิน)',unit:'ซีซี',category:'ยา',type:1,stockQty:10},
  {code:'ST000022',name:'Filler Restylane Kysse (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:20},
  {code:'ST000024',name:'Filler Restylane Vital light (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:18},
  {code:'ST000026',name:'Filler Restylane Lyft (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:12},
  {code:'ST000029',name:'Filler Restylane Classic (A)',unit:'ซีซี',category:'ยา',type:1,stockQty:15},
  {code:'ST000031',name:'Filler Restylane Defyne (A)',unit:'ซีซี',category:'ยา',type:1,stockQty:14},
  {code:'ST000034',name:'Filler Juvederm xcplus (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:20},
  {code:'ST000036',name:'Filler Juvederm Voluma (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:18},
  {code:'ST000038',name:'Filler Juvederm Volbella (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:10},
  {code:'ST000040',name:'Filler Juvederm Volift (H)',unit:'ซีซี',category:'ยา',type:1,stockQty:8},
  {code:'ST000045',name:'Fat เกาหลี (V LINE SOL)',unit:'ขวด',category:'ยา',type:1,stockQty:50},
  {code:'ST000046',name:'Fat Sisi (ขาวชมพู)',unit:'ซีซี',category:'ยา',type:1,stockQty:40},
  {code:'ST000048',name:'Fat Dimond',unit:'ขวด',category:'ยา',type:1,stockQty:80},
  {code:'ST000050',name:'Atomix',unit:'ขวด',category:'ยา',type:1,stockQty:20},
  {code:'ST000055',name:'ยาชา Lidocaine 2%',unit:'ขวด',category:'ยา',type:1,stockQty:100},
  {code:'ST000057',name:'Alpha Arbutin อัลฟ่าอาร์บูติน',unit:'ขวด',category:'ยา',type:1,stockQty:30},
  {code:'ST000058',name:'ไหม 100mm (หน้า)',unit:'เส้น',category:'ยา',type:1,stockQty:500},
  {code:'ST000059',name:'ไหม 60mm (จมูก)',unit:'เส้น',category:'ยา',type:1,stockQty:300},
  {code:'ST000067',name:'วิตามิน สูตร A',unit:'เซ็ท',category:'ยา',type:1,stockQty:80},
  {code:'ST000068',name:'วิตามิน สูตร B',unit:'เซ็ท',category:'ยา',type:1,stockQty:80},
  {code:'ST000069',name:'วิตามิน สูตร Celeb',unit:'เซ็ท',category:'ยา',type:1,stockQty:60},
  {code:'ST000070',name:'วิตามิน สูตร Miracle',unit:'เซ็ท',category:'ยา',type:1,stockQty:60},
  {code:'ST000082',name:'Botox Aestox 100 u',unit:'ยูนิต',category:'ยา',type:1,stockQty:300},
  {code:'ST000085',name:'Rejuran',unit:'หลอด',category:'ยา',type:1,stockQty:25},
  {code:'ST000099',name:'Syring 5 ml.',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:200},
  {code:'ST000101',name:'Syring 20 ml.',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:100},
  {code:'ST000104',name:'เข็ม 18 (1 นิ้ว)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:50},
  {code:'ST000105',name:'เข็ม 21 (1 นิ้ว)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000106',name:'เข็ม 25 (1 นิ้ว)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000107',name:'เข็ม 27 (ครึ่งนิ้ว)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000108',name:'เข็ม 27 (1 นิ้ว)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000112',name:'เบตาดีน',unit:'ขวด',category:'วัสดุ',type:1,stockQty:60},
  {code:'ST000113',name:'แอลกอฮอล์',unit:'ขวด',category:'วัสดุ',type:1,stockQty:100},
  {code:'ST000115',name:'ยาฉีดสิวอักเสบ V nolone',unit:'ขวด',category:'ยา',type:1,stockQty:20},
  {code:'ST000116',name:'ยาชาแบบทา',unit:'กระปุก',category:'ยา',type:1,stockQty:40},
  {code:'ST000117',name:'เข็มปีกผีเสื้อ (Scalp Vein)',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:30},
  {code:'ST000118',name:'NSS 100 ml.',unit:'ขวด',category:'วัสดุ',type:1,stockQty:200},
  {code:'ST000119',name:'เซ็ทต่อน้ำเกลือ (Set IV)',unit:'อัน',category:'วัสดุ',type:1,stockQty:100},
  {code:'ST000122',name:'เข็มทู่ 23',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:30},
  {code:'ST000123',name:'เข็มทู่ 25',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:30},
  {code:'ST000125',name:'เข็มทู่ 27',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:30},
  {code:'ST000128',name:'เทปแต่งแผล ไมโครปอร์ 1/2นิ้ว',unit:'ม้วน',category:'วัสดุ',type:1,stockQty:100},
  {code:'ST000129',name:'เทปแต่งแผล ไมโครปอร์ 1นิ้ว',unit:'ม้วน',category:'วัสดุ',type:1,stockQty:100},
  {code:'ST000130',name:'ผ้าก็อต 3*3',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000131',name:'ผ้าก็อต 4*4',unit:'กล่อง',category:'วัสดุ',type:1,stockQty:80},
  {code:'ST000136',name:'Botox Xeomin 100 unit',unit:'ยูนิต',category:'ยา',type:1,stockQty:200},
  {code:'ST000140',name:'ยาสิว Roacta',unit:'กล่อง',category:'ยา',type:1,stockQty:20},
  {code:'ST000160',name:'เซ็ทยา+ทำแผล 500',unit:'เซ็ท',category:'ยา',type:1,stockQty:50},
  {code:'ST000161',name:'ยา Terramycin',unit:'หลอด',category:'ยา',type:1,stockQty:40},
  {code:'ST000164',name:'ยา Bellatrix (ยาลดบวม)',unit:'กล่อง',category:'ยา',type:1,stockQty:30},
  {code:'ST000168',name:'Ceftriaxone Drip (ฆ่าเชื้อ)',unit:'ขวด',category:'ยา',type:1,stockQty:20},
  {code:'ST000173',name:'ยาชา Dronil-A 2%(ศัลยกรรม)',unit:'ขวด',category:'ยา',type:1,stockQty:30},
  {code:'ST000176',name:'Vit c',unit:'แอมป์',category:'ยา',type:1,stockQty:200},
  {code:'STA00088',name:'Sculptra',unit:'กล่อง',category:'ยา',type:1,stockQty:15},
  {code:'STA00093',name:'Radiesse',unit:'กล่อง',category:'ยา',type:1,stockQty:10},
  {code:'STA00102',name:'Filler Volifil Classic',unit:'ซีซี',category:'ยา',type:1,stockQty:20},
  {code:'STA00181',name:'Tensonez',unit:'ซีซี',category:'ยา',type:1,stockQty:30},
  // General/Office (type: 2)
  {code:'00030',name:'ถุงมือสเตอร์ไลซ์ M',unit:'กล่อง',category:'อุปกรณ์',type:2,stockQty:50},
  {code:'00035',name:'แอลกอฮอล์ล้างมือ',unit:'ขวด',category:'อุปกรณ์',type:2,stockQty:40},
  {code:'00036',name:'สบู่เหลวล้างมือ',unit:'ขวด',category:'อุปกรณ์',type:2,stockQty:30},
  {code:'MN00001',name:'Acne (หลอดเล็ก)',unit:'หลอด',category:'วัสดุ',type:2,stockQty:60},
  {code:'MN00005',name:'แผ่นสื่อ RF',unit:'แผ่น',category:'อุปกรณ์',type:2,stockQty:200},
  {code:'MN00007',name:'เทปแปะขนตา',unit:'ม้วน',category:'วัสดุ',type:2,stockQty:30},
  {code:'MN00008',name:'มาร์คแผ่น',unit:'แผ่น',category:'วัสดุ',type:2,stockQty:100},
  {code:'MN00009',name:'มาร์คคาบอน',unit:'หลอด',category:'วัสดุ',type:2,stockQty:20},
  {code:'MN00011',name:'Detox OXY',unit:'ขวด',category:'วัสดุ',type:2,stockQty:15},
  {code:'MN00012',name:'AHA',unit:'ขวด',category:'วัสดุ',type:2,stockQty:20},
  {code:'MN00013',name:'RF Cream',unit:'ขวด',category:'อุปกรณ์',type:2,stockQty:15},
  {code:'MN00019',name:'สครับสตอเบอร์รี่',unit:'กระปุก',category:'วัสดุ',type:2,stockQty:25},
  {code:'MN00025',name:'กางเกงในสปา',unit:'แพ็ค',category:'วัสดุ',type:2,stockQty:50},
  {code:'MN00026',name:'เสื้อในสปา',unit:'แพ็ค',category:'วัสดุ',type:2,stockQty:50},
  {code:'MN00027',name:'เจล IPL',unit:'กระปุก',category:'อุปกรณ์',type:2,stockQty:20},
  {code:'MN00030',name:'แผ่นรองเลเซอร์',unit:'ม้วน',category:'อุปกรณ์',type:2,stockQty:30},
  {code:'SM000008',name:'คัตตอนบัต',unit:'ห่อ',category:'สำนักงาน',type:2,stockQty:80},
  {code:'SM000012',name:'ถุงขยะม้วนมีกลิ่น 24*28',unit:'แพ็ค',category:'สำนักงาน',type:2,stockQty:40},
  {code:'SM000014',name:'ถุงขยะดำ 30*40',unit:'แพ็ค',category:'สำนักงาน',type:2,stockQty:40},
  {code:'SM000015',name:'ทิชชู่กล่อง',unit:'กล่อง',category:'สำนักงาน',type:2,stockQty:60},
  {code:'SM000017',name:'ทิชชู่ม้วน',unit:'ห่อ',category:'สำนักงาน',type:2,stockQty:60},
  {code:'SM000033',name:'สำลีแผ่น',unit:'ห่อ',category:'วัสดุ',type:2,stockQty:100},
  {code:'SM000035',name:'กระดาษ A4',unit:'รีม',category:'สำนักงาน',type:2,stockQty:20},
  {code:'SM000036',name:'ปากกาน้ำเงิน',unit:'ด้าม',category:'สำนักงาน',type:2,stockQty:50},
];

const SEED_STOCK_LOGS = [
  {id:'sl001',date:'2026-07-10',branch:'พิษณุโลก',type:'IN',direction:'IN',productCode:'ST000001',productName:'Botox Hugel 50 unit',qty:200,unit:'ยูนิต',note:'รับสินค้าจาก Supplier',createdBy:'u001',auditStatus:'อนุมัติแล้ว'},
  {id:'sl002',date:'2026-07-10',branch:'พิษณุโลก',type:'IN',direction:'IN',productCode:'ST000048',productName:'Fat Dimond',qty:50,unit:'ขวด',note:'รับสินค้าจาก Supplier',createdBy:'u001',auditStatus:'อนุมัติแล้ว'},
  {id:'sl003',date:'2026-07-11',branch:'พิษณุโลก',type:'OUT',direction:'OUT',productCode:'ST000001',productName:'Botox Hugel 50 unit',qty:10,unit:'ยูนิต',note:'เบิกใช้ประจำวัน',createdBy:'u005',auditStatus:'อนุมัติแล้ว'},
  {id:'sl004',date:'2026-07-12',branch:'พิษณุโลก',type:'OUT',direction:'OUT',productCode:'ST000048',productName:'Fat Dimond',qty:5,unit:'ขวด',note:'เบิกใช้ประจำวัน',createdBy:'u006',auditStatus:'รอตรวจสอบ'},
  {id:'sl005',date:'2026-07-13',branch:'กำแพงเพชร',type:'IN',direction:'IN',productCode:'ST000055',productName:'ยาชา Lidocaine 2%',qty:30,unit:'ขวด',note:'รับสินค้าจาก Supplier',createdBy:'u009',auditStatus:'อนุมัติแล้ว'},
  {id:'sl006',date:'2026-07-14',branch:'พิษณุโลก',type:'TRANSFER',direction:'OUT',productCode:'ST000082',productName:'Botox Aestox 100 u',qty:50,unit:'ยูนิต',toBranch:'กำแพงเพชร',note:'โอนให้สาขากำแพงเพชร',createdBy:'u005',auditStatus:'รอตรวจสอบ'},
  {id:'sl007',date:'2026-07-15',branch:'พิษณุโลก',type:'OUT',direction:'OUT',productCode:'ST000113',productName:'แอลกอฮอล์',qty:3,unit:'ขวด',note:'เบิกใช้',createdBy:'u007',auditStatus:'อนุมัติแล้ว'},
  {id:'sl008',date:'2026-07-15',branch:'แม่สอด',type:'IN',direction:'IN',productCode:'ST000118',productName:'NSS 100 ml.',qty:100,unit:'ขวด',note:'รับสินค้า',createdBy:'u012',auditStatus:'รอตรวจสอบ'},
];

const SEED_BILLS = [
  { id: 'b001', hn: 'HN-0001', customerName: 'คุณสมชาย ใจดี', date: '2026-07-18', branch: 'พิษณุโลก', createdBy: 'u005', status: 'รอตรวจสอบ' },
  { id: 'b002', hn: 'HN-0002', customerName: 'คุณสมหญิง รักสวย', date: '2026-07-17', branch: 'พิษณุโลก', createdBy: 'u006', status: 'อนุมัติแล้ว', auditBy: 'u002', auditDate: '2026-07-17T18:00:00Z' },
  { id: 'b003', hn: 'HN-0003', customerName: 'คุณวิภาวี ดีพร้อม', date: '2026-07-18', branch: 'พิษณุโลก', createdBy: 'u007', status: 'ตีกลับ', auditBy: 'u002', auditNote: 'รูปไม่ชัดเจน กรุณาถ่ายใหม่' },
  { id: 'b004', hn: 'HN-0004', customerName: 'คุณกิตติชัย พัฒนา', date: '2026-07-18', branch: 'กำแพงเพชร', createdBy: 'u009', status: 'รอแก้ไข', auditBy: 'u002' },
];

const SEED_BILL_SERVICES = [
  { id: 's001', billId: 'b001', programCode: '00131', programName: 'Botox Xeomin 50 U', price: 9999, commission: 200, createdBy: 'u005' },
  { id: 's002', billId: 'b002', programCode: '00200', programName: 'เลเซอร์รักแร้ขน+ขาว 1 ครั้ง', price: 999, commission: 50, createdBy: 'u006' },
  { id: 's003', billId: 'b003', programCode: '00005', programName: 'Drip Vitamin C Bright Boost 1 ครั้ง', price: 999, commission: 100, createdBy: 'u007' },
  { id: 's004', billId: 'b004', programCode: '00637', programName: 'ร้อยไหมไม่จำกัดเส้น', price: 9999, commission: 300, createdBy: 'u009' },
];

const SEED_BILL_SALES = [
  { id: 'sl001', billId: 'b001', type: 'Upsell', oldProgram: 'Botox Nabota 50 u', oldPrice: 3999, newProgram: 'Botox Xeomin 50 U', amountPaid: 9999, commissionBase: 6000, commissionPct: 2, commissionAmt: 120, createdBy: 'u005' },
  { id: 'sl002', billId: 'b003', type: 'Product', newProgram: 'ครีมกันแดด Arana', amountPaid: 590, commissionBase: 590, commissionPct: 5, commissionAmt: 29.5, createdBy: 'u007' },
];

const SEED_BILL_SUPPLIES = [
  { id: 'sp001', billId: 'b001', productCode: 'ST000136', productName: 'Botox Xeomin 100 unit', qty: 0.5, unit: 'ยูนิต', createdBy: 'u005' },
  { id: 'sp002', billId: 'b001', productCode: 'ST000099', productName: 'Syring 5 ml.', qty: 1, unit: 'กล่อง', createdBy: 'u005' },
  { id: 'sp003', billId: 'b004', productCode: 'ST000058', productName: 'ไหม 100mm (หน้า)', qty: 8, unit: 'เส้น', createdBy: 'u009' },
];

const SEED_BILL_IMAGES = [
  { id: 'img001', billId: 'b001', data: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', name: 'opd_1.jpg' },
  { id: 'img002', billId: 'b001', data: 'https://images.unsplash.com/photo-1628771065518-0d82f1938462?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', name: 'opd_2.jpg' },
  { id: 'img003', billId: 'b003', data: 'https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', name: 'opd_c.jpg' },
  { id: 'img004', billId: 'b004', data: 'https://images.unsplash.com/photo-1606811841689-23dfddce3e95?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', name: 'opd_d.jpg' },
];

const SEED_AUDIT_LOGS = [
  { id: 'al001', action: 'อนุมัติ', targetType: 'bill', targetId: 'b002', auditBy: 'u002', oldStatus: 'รอตรวจสอบ', newStatus: 'อนุมัติแล้ว', note: '', createdAt: '2026-07-17T18:00:00Z', date: '2026-07-17T18:00:00Z' },
  { id: 'al002', action: 'ตีกลับ', targetType: 'stock_log', targetId: 'sl004', auditBy: 'u003', oldStatus: 'รอตรวจสอบ', newStatus: 'ตีกลับ', note: 'ภาพใบเบิกไม่ชัด ขอถ่ายใหม่', createdAt: '2026-07-13T10:00:00Z', date: '2026-07-13T10:00:00Z' },
  { id: 'al003', action: 'ตีกลับ', targetType: 'bill', targetId: 'b003', auditBy: 'u002', oldStatus: 'รอตรวจสอบ', newStatus: 'ตีกลับ', note: 'รูปไม่ชัดเจน กรุณาถ่ายใหม่', createdAt: '2026-07-18T10:00:00Z', date: '2026-07-18T10:00:00Z' }
];

const SEED_EDIT_REQUESTS = [
  { id: 'req001', billId: 'b004', requestedBy: 'u009', requestDate: '2026-07-18T10:30:00Z', reason: 'ลงยอดเงินผิด ขอแก้ไขค่ะ', status: 'อนุมัติแล้ว', approvedBy: 'u002' },
  { id: 'req002', billId: 'b002', requestedBy: 'u006', requestDate: '2026-07-18T11:00:00Z', reason: 'ลืมลงรายการยา', status: 'รอการอนุมัติ' }
];

