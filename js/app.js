/**
 * ARANA CLINIC — Main App Controller
 * app.js — Router, Auth, Toast, Navigation
 */

// ── Current Session ───────────────────────────────────────────
let currentUser = null;
let currentBranch = null;
let currentRoute = null;
let sidebarOpen = true;
let menuPermissions = {}; // page_key -> { can_view, can_edit } ตามตำแหน่งที่แสดงของผู้ใช้

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  DB.init();
  startClock();

  if (handleErpLoginReturn()) return;
  const session = AppSession.get();
  if (session) {
    try {
      currentUser = session.user;
      if (currentUser && session.token) {
        currentBranch = session.branch || currentUser.branch;
        showApp(); // async ไม่ต้องรอ ระหว่างโหลดสิทธิ์เมนู จะเห็นเมนูตามสิทธิ์เดิมไปก่อน
        return;
      }
    } catch(e) {}
  }
  showLogin();
});

// ── AUTH ──────────────────────────────────────────────────────
async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!username || !password) {
    showLoginError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    return;
  }

  btn.classList.add('loading');
  btn.disabled = true;

  let user = null;
  let loginErrorShown = false;
  try {
    user = await Promise.race([
      DB.authenticateSupabase(username, password),
      new Promise((_, reject) => setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), 15000))
    ]);
  } catch (e) {
    console.error('Login request failed:', e);
    showLoginError(e.message === 'LOGIN_TIMEOUT'
      ? 'เชื่อมต่อระบบนานเกินไป กรุณาลองใหม่อีกครั้ง'
      : 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่');
    loginErrorShown = true;
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }

  if (user) {
    errorEl.classList.add('hidden');
    await finishLogin(user);
  } else if (!loginErrorShown) {
    showLoginError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    document.getElementById('login-password').value = '';
  }
}

async function finishLogin(user) {
  const token = user.sessionToken;
  delete user.sessionToken;
  currentUser = user;
  currentBranch = user.branch;
  AppSession.remove();
  AppSession.set({ user, branch: user.branch, token });
  await showApp();
}

// ── เข้าสู่ระบบด้วยบัญชี ERP (คุณออม 18/10) ─────────────────────
// ไปเข้าสู่ระบบที่หน้า ERP เอง (รหัสผ่าน ERP ไม่ผ่านเว็บนี้) แล้ว ERP ส่งรหัสใช้ครั้งเดียวกลับมา
const ERP_LOGIN_URL = 'https://arana-aesthetic-erp.netlify.app/ext-login';
function erpLoginReturnUrl() {
  return location.hostname === 'localhost' ? 'http://localhost:8095/' : 'https://nattakorn-mns.github.io/ARANA-Commission-Stock/';
}
function loginWithErp() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('erp_login_state', state);
  location.href = `${ERP_LOGIN_URL}?return_url=${encodeURIComponent(erpLoginReturnUrl())}&state=${encodeURIComponent(state)}`;
}
// กลับมาจากหน้า ERP พร้อม ?erp_login_code=...&state=... → true ถ้ากำลังจัดการ (ไม่ต้องโชว์หน้า login ซ้ำ)
function handleErpLoginReturn() {
  const params = new URLSearchParams(location.search);
  const code = params.get('erp_login_code'), state = params.get('state');
  if (!code) return false;
  history.replaceState(null, '', location.pathname);
  const expected = sessionStorage.getItem('erp_login_state');
  sessionStorage.removeItem('erp_login_state');
  showLogin();
  if (!state || !expected || state !== expected) {
    showLoginError('ลิงก์เข้าสู่ระบบหมดอายุหรือไม่ได้เริ่มจากเครื่องนี้ กรุณากด "เข้าสู่ระบบด้วยบัญชี ERP" อีกครั้ง');
    return true;
  }
  const btn = document.getElementById('login-erp-btn');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  (async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/erp-pull`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: 'erp_login', code, state })
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok || !j.user) { showLoginError(j.error || 'เข้าสู่ระบบด้วยบัญชี ERP ไม่สำเร็จ'); return; }
      const d = j.user;
      await finishLogin({ id: d.id, username: d.username, name: d.name, nickname: d.nickname, role: d.role,
        branch: d.branch_name, position: d.position, sessionToken: d.session_token });
    } catch (e) {
      showLoginError('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
  })();
  return true;
}

// ยืนยันด้วยกล่องในหน้าเว็บ (กล่อง confirm ของเบราว์เซอร์ถูกปิดในบางเครื่อง/แอป ทำให้กดออกจากระบบไม่ได้)
function logout() {
  openModal(`<div class="modal" style="max-width:380px;"><div class="modal-header"><h3 class="modal-title">ออกจากระบบ</h3></div>
    <div class="modal-body"><p style="margin:0;">ต้องการออกจากระบบใช่ไหม?</p></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="closeModalDirect();doLogout()">ออกจากระบบ</button></div></div>`);
}
async function doLogout() {
  await DB.logoutSupabase();
  AppSession.remove();
  currentUser = null;
  currentBranch = null;
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  Toast.show('ออกจากระบบเรียบร้อย', 'info');
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-msg').textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
  lucide.createIcons();
}

function togglePassword() {
  const input = document.getElementById('login-password');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

// ── SHOW/HIDE ─────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  lucide.createIcons();
}

async function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Set user info
  document.getElementById('user-name').textContent = `${currentUser.nickname} (${currentUser.name.split(' ')[0]})`;
  document.getElementById('user-role-badge').textContent = roleLabel(currentUser.role);
  document.getElementById('user-role-badge').className = 'user-role role-' + currentUser.role.toLowerCase();
  document.getElementById('user-avatar').textContent = (currentUser.nickname || currentUser.name)[0];

  // Set branch
  const branchSel = document.getElementById('branch-select');
  branchSel.value = currentBranch;
  document.getElementById('topbar-branch-name').textContent = currentBranch;

  // โหลดสิทธิ์เมนูตามตำแหน่งที่แสดง แล้วค่อยสร้างเมนู (ถ้าโหลดไม่สำเร็จ จะ fallback ไปใช้สิทธิ์เดิมล้วน ๆ)
  try {
    const rows = await DB.getMenuPermissionsForMeSupabase();
    menuPermissions = {};
    (rows || []).forEach(r => { menuPermissions[r.page_key] = { can_view: r.can_view, can_edit: r.can_edit }; });
  } catch (e) {
    console.warn('โหลดสิทธิ์เมนูไม่สำเร็จ ใช้สิทธิ์ตำแหน่งเดิมแทน:', e);
    menuPermissions = {};
  }

  // ตั้งค่า % ค่าคอม / ช่องทาง (ข้อ 11, 30) — ถ้ายังไม่ติดตั้ง SQL 18 ใช้ค่าเริ่มต้น
  await loadAppSettings();

  // Build nav
  buildNav();

  // Default route
  navigate('opd');

  lucide.createIcons();
}

// ── NAVIGATION ────────────────────────────────────────────────
const ROUTES = {
  opd: { label: 'บันทึก OPD', icon: 'clipboard-plus', roles: ['Frontdesk', 'Audit', 'OnlineSales', 'Admin'], render: () => renderOPD(getPage()) },
  deposit: { label: 'บันทึกยอดมัดจำ', icon: 'wallet-cards', roles: ['Frontdesk', 'OnlineSales', 'Admin'], render: () => renderDeposits(getPage()) },
  history: { label: 'สรุปยอดของฉัน', icon: 'history', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderHistory(getPage()) },
  'inventory-out': { label: 'เบิกใช้วัสดุ/อุปกรณ์', icon: 'package-minus', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'orange', render: () => renderInventory(getPage(), 'out') },
  'inventory-in': { label: 'รับเข้าสต๊อก', icon: 'package-plus', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'blue', render: () => renderInventory(getPage(), 'in') },
  'inventory-transfer': { label: 'เบิกโอนข้ามสาขา', icon: 'truck', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'purple', render: () => renderInventory(getPage(), 'transfer') },
  stockcard: { label: 'สต๊อกการ์ด', icon: 'book-open', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderStockCard(getPage()) },
  weeklycount: { label: 'เช็คสต๊อกประจำสัปดาห์', icon: 'calendar-check', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderWeeklyCount(getPage()) },
  audit_dashboard: { label: 'แดชบอร์ด สรุปงานทีมออดิท', icon: 'gauge', roles: ['Audit', 'CommissionAudit', 'StockAudit', 'Admin'], render: () => renderAuditDashboard(getPage()) },
  audit: { label: 'Audit Room', icon: 'shield-check', roles: ['Audit', 'CommissionAudit', 'StockAudit', 'Admin'], render: () => renderAudit(getPage()) },
  balance: { label: 'สต๊อกคงเหลือ', icon: 'layers', roles: ['Audit', 'Admin'], render: () => renderBalance(getPage()) },
  reports: { label: 'รายงานผลงานพนักงาน', icon: 'bar-chart-3', roles: ['Frontdesk', 'Admin'], render: () => renderReports(getPage()) },
  settings: { label: 'ตั้งค่า', icon: 'settings', roles: ['Admin', 'Audit', 'CommissionAudit'], render: () => renderSettings(getPage()) },
  admin: { label: 'ผู้ดูแลระบบ', icon: 'user-cog', roles: ['Admin'], render: () => renderAdmin(getPage()) },
  admin_dashboard: { label: 'ระบบ Admin Dashboard', icon: 'layout-dashboard', roles: ['Admin'], render: () => renderAdminDashboard(getPage()) },
};

// Names shown on screen, matched to the main ERP. The stored role value stays the same.
const ROLE_LABELS = { Admin: 'ผู้ดูแลระบบ' };
function roleLabel(role) { return ROLE_LABELS[role] || role || '-'; }

function canAccess(route) {
  if (!currentUser) return false;
  const r = ROUTES[route];
  if (!r || !r.roles.includes(currentUser.role)) return false; // สิทธิ์เดิม (คุมว่ากดบันทึกจริงได้ไหม) ต้องผ่านก่อนเสมอ
  const perm = menuPermissions[route];
  if (!perm) return true; // ยังไม่เคยตั้งค่าสิทธิ์เมนูนี้ในระบบใหม่ -> ใช้สิทธิ์เดิมไปก่อน
  return !!perm.can_view; // ตั้งค่าไว้แล้ว -> ให้ระบบตำแหน่งใหม่เป็นตัวตัดสินการมองเห็น
}

function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  const sections = [
    { label: null, routes: ['opd', 'deposit', 'history'] },
    { label: 'คลังสินค้า', routes: ['inventory-out', 'inventory-in', 'inventory-transfer', 'stockcard', 'weeklycount'] },
    { label: 'Audit Zone', routes: ['audit_dashboard', 'audit', 'balance', 'reports'] },
    { label: 'ผู้ดูแลระบบ', routes: ['settings', 'admin'] }, // คลังรูปภาพแทน Admin Dashboard (ข้อ 25) / System Logs เอาออก (ข้อ 27)
  ];

  let html = '';
  sections.forEach(sec => {
    const accessible = sec.routes.filter(r => canAccess(r));
    if (!accessible.length) return;

    if (sec.label) html += `<div class="nav-section-label">${sec.label}</div>`;

    accessible.forEach(r => {
      const route = ROUTES[r];
      const colorClass = route.color ? `nav-item-${route.color}` : '';
      html += `
        <button class="nav-item ${colorClass}" id="nav-${r}" onclick="navigate('${r}')">
          <i data-lucide="${route.icon}" class="nav-icon"></i>
          <span class="nav-label">${route.label}</span>
        </button>`;
    });
  });

  // เมนูบันทึกรายจ่าย: ผูกกับระบบสิทธิ์ตำแหน่งใหม่โดยตรง (ไม่มีสิทธิ์เดิมมาเกี่ยวข้อง)
  // ค่าเริ่มต้น = ไม่แสดง ถ้ายังไม่มีใครตั้งสิทธิ์ให้ตำแหน่งนี้เห็นเมนูนี้ (ปลอดภัยไว้ก่อน)
  const expensePerm = menuPermissions['expense'];
  if (expensePerm && expensePerm.can_view) {
    html += `
      <div class="nav-section-label">รายจ่าย</div>
      <a class="nav-item" href="expense/index.html" target="_blank" rel="noopener">
        <i data-lucide="receipt-text" class="nav-icon"></i>
        <span class="nav-label">บันทึกรายจ่าย</span>
      </a>`;
  }

  nav.innerHTML = html;
  lucide.createIcons();
}

// "ดูอย่างเดียว" = position has can_view but not can_edit for this menu.
// The page opens normally; buttons that save / approve / reject / delete are hidden (see .readonly-mode in style.css).
function canEditRoute(route) {
  const perm = menuPermissions[route];
  return !perm || perm.can_edit !== false;
}

function navigate(route) {
  if (!canAccess(route)) {
    Toast.show('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้', 'error');
    return;
  }

  // Update active state
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.getElementById('nav-' + route);
  if (activeNav) activeNav.classList.add('active');

  // Update title
  const routeConf = ROUTES[route];
  document.getElementById('page-title').textContent = routeConf.label;

  // Render APSX-style Page Header Card
  const headerCard = document.getElementById('apsx-page-header');
  if (headerCard) {
    let parentCategory = 'ระบบหลัก';
    if (route === 'opd' || route === 'deposit' || route === 'history') parentCategory = 'OPD & การขาย';
    else if (route.startsWith('inventory-') || route === 'stockcard' || route === 'weeklycount' || route === 'balance') parentCategory = 'คลังสินค้า';
    else if (route === 'reports') parentCategory = 'รายงาน';
    else if (route === 'audit' || route === 'audit_dashboard') parentCategory = 'ห้องตรวจสอบ';
    else if (route === 'admin' || route === 'settings') parentCategory = 'ผู้ดูแลระบบ';

    headerCard.innerHTML = `
      <div class="apsx-page-header">
        <div class="apsx-header-info">
          <div class="apsx-header-icon-circle burgundy">
            <i data-lucide="${routeConf.icon}" style="width:20px;height:20px;"></i>
          </div>
          <div class="apsx-header-text">
            <div class="apsx-header-breadcrumb">${parentCategory} &gt; ${routeConf.label}</div>
            <h2 class="apsx-header-title">${routeConf.label}</h2>
          </div>
        </div>
        <div class="apsx-header-actions" id="apsx-header-actions">
        </div>
      </div>`;
  }

  currentRoute = route;
  const readOnly = !canEditRoute(route);
  document.body.classList.toggle('readonly-mode', readOnly);
  const headerActions = document.getElementById('apsx-header-actions');
  if (headerActions && readOnly) headerActions.innerHTML = '<span class="readonly-pill"><i data-lucide="eye" style="width:14px;height:14px;"></i> ดูอย่างเดียว</span>';

  // Render
  try {
    routeConf.render();
  } catch(e) {
    console.error('Render error:', e);
    getPage().innerHTML = `<div class="page-error"><i data-lucide="alert-triangle"></i><p>เกิดข้อผิดพลาดในการโหลดหน้า: ${e.message}</p></div>`;
    lucide.createIcons();
  }

  lucide.createIcons();

  // On mobile: close sidebar after navigation
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.body.classList.remove('sidebar-active');
  }
}

function getPage() {
  const pc = document.getElementById('page-content');
  pc.innerHTML = '';
  return pc;
}

// ── BRANCH ────────────────────────────────────────────────────
function changeBranch(branch) {
  currentBranch = branch;
  document.getElementById('topbar-branch-name').textContent = branch;
  const sess = AppSession.get();
  if (sess) AppSession.set({ ...sess, branch });
  if (currentRoute) navigate(currentRoute);
  Toast.show(`เปลี่ยนสาขาเป็น ${branch}`, 'info');
}

// ── SIDEBAR ───────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    document.body.classList.toggle('sidebar-active');
  } else {
    sidebarOpen = !sidebarOpen;
    document.getElementById('app-shell').classList.toggle('sidebar-collapsed', !sidebarOpen);
  }
}

// ── CLOCK ─────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('topbar-datetime');
  if (!el) return;
  function tick() {
    const now = new Date();
    const d = now.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const t = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `${d} ${t}`;
  }
  tick();
  setInterval(tick, 60000);
}

// ── TOAST ─────────────────────────────────────────────────────
const Toast = {
  show(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const id = 'toast-' + Date.now();
    const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
    const t = document.createElement('div');
    t.id = id;
    t.className = `toast toast-${type} toast-enter`;
    t.innerHTML = `
      <i data-lucide="${icons[type] || 'info'}" class="toast-icon"></i>
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" onclick="Toast.remove('${id}')"><i data-lucide="x"></i></button>
    `;
    container.appendChild(t);
    lucide.createIcons();
    requestAnimationFrame(() => { t.classList.remove('toast-enter'); t.classList.add('toast-show'); });
    setTimeout(() => Toast.remove(id), duration);
  },
  remove(id) {
    const t = document.getElementById(id);
    if (!t) return;
    t.classList.add('toast-exit');
    setTimeout(() => t.remove(), 300);
  }
};

// ── MODAL ─────────────────────────────────────────────────────
function openModal(html, opts = {}) {
  const overlay = document.getElementById('modal-overlay');
  const wrap = document.getElementById('modal-wrap');
  wrap.innerHTML = html;
  
  if (opts.width) wrap.style.maxWidth = opts.width;
  else wrap.style.maxWidth = '600px';

  overlay.classList.remove('hidden');
  overlay.classList.add('modal-in');
  lucide.createIcons();
  
  setTimeout(() => {
    const header = wrap.querySelector('.modal-header');
    const modal = wrap.querySelector('.modal');
    if(header && modal) {
      header.style.cursor = 'move';
      let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
      
      header.onmousedown = (e) => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        isDragging = true;
        modal.style.animation = 'none';
        modal.style.transition = 'none';
        window.addEventListener('mousemove', drag);
        window.addEventListener('mouseup', dragEnd);
      };
      
      function dragEnd() {
        isDragging = false;
        window.removeEventListener('mousemove', drag); window.removeEventListener('mouseup', dragEnd);
      }
      function drag(e) {
        if (isDragging) {
          e.preventDefault();
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
          xOffset = currentX; yOffset = currentY;
          modal.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
      }
    }
  }, 50);

  if (opts.onOpen) opts.onOpen();
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('modal-overlay') && !event.target.classList.contains('modal-close')) return;
  closeModalDirect();
}

function openChangePasswordModal() {
  openModal(`
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <h3 class="modal-title"><i data-lucide="key-round"></i> เปลี่ยนรหัสผ่าน</h3>
        <button class="modal-close btn btn-ghost btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">รหัสผ่านเดิม</label>
          <input id="cp-old" type="password" class="form-input" placeholder="รหัสผ่านปัจจุบัน" />
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">รหัสผ่านใหม่</label>
          <input id="cp-new" type="password" class="form-input" placeholder="อย่างน้อย 4 ตัวอักษร" />
        </div>
        <div class="form-group" style="margin-bottom:4px;">
          <label class="form-label">ยืนยันรหัสผ่านใหม่</label>
          <input id="cp-confirm" type="password" class="form-input" placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง" />
        </div>
        <div id="cp-error" class="hidden" style="color:var(--red-600,#dc2626);font-size:0.8rem;margin-top:8px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModalDirect()">ยกเลิก</button>
        <button class="btn btn-primary" data-view-ok id="cp-submit-btn" onclick="submitChangePassword()">บันทึกรหัสผ่านใหม่</button>
      </div>
    </div>
  `);
}

async function submitChangePassword() {
  const oldPass = document.getElementById('cp-old').value;
  const newPass = document.getElementById('cp-new').value;
  const confirmPass = document.getElementById('cp-confirm').value;
  const errorEl = document.getElementById('cp-error');
  const btn = document.getElementById('cp-submit-btn');

  errorEl.classList.add('hidden');

  if (!oldPass || !newPass || !confirmPass) {
    errorEl.textContent = 'กรุณากรอกข้อมูลให้ครบทุกช่อง';
    errorEl.classList.remove('hidden');
    return;
  }
  if (newPass.length < 8) {
    errorEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร';
    errorEl.classList.remove('hidden');
    return;
  }
  if (newPass !== confirmPass) {
    errorEl.textContent = 'รหัสผ่านใหม่ที่กรอก 2 ช่องไม่ตรงกัน';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  try {
    const ok = await DB.changeOwnPasswordSupabase(currentUser.username, oldPass, newPass);
    if (ok) {
      Toast.show('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');
      closeModalDirect();
    } else {
      errorEl.textContent = 'รหัสผ่านเดิมไม่ถูกต้อง';
      errorEl.classList.remove('hidden');
    }
  } catch (e) {
    console.error(e);
    errorEl.textContent = 'เกิดข้อผิดพลาด: ' + e.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

function closeModalDirect() {
  const overlay = document.getElementById('modal-overlay');
  const wrap = document.getElementById('modal-wrap');
  overlay.classList.remove('modal-in');
  overlay.classList.add('modal-out');
  setTimeout(() => {
    overlay.classList.remove('modal-in', 'modal-out');
    overlay.classList.add('hidden');
    wrap.innerHTML = '';
    wrap.style.maxWidth = '600px';
  }, 200);
}

// ── HELPER FUNCTIONS ──────────────────────────────────────────
function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    return new Date(isoStr).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return isoStr; }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  try {
    return new Date(isoStr).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function formatCurrency(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function statusBadge(status) {
  const map = {
    'รอตรวจสอบ': 'badge-pending',
    'อนุมัติแล้ว': 'badge-approved',
    'ตีกลับ': 'badge-rejected',
    'รอแก้ไข': 'badge-waiting',
    'รอการอนุมัติ': 'badge-pending',
    'อนุมัติ': 'badge-approved',
    'ฉบับร่าง': 'badge-pending',
  };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

function typeBadge(type) {
  const map = {
    'upsell': 'badge-upsell',
    'crosssell': 'badge-crosssell',
    'product': 'badge-product',
    'service': 'badge-service',
    'IN': 'badge-in',
    'OUT': 'badge-out',
    'TRANSFER': 'badge-transfer',
  };
  const labels = {
    'upsell': 'อัพเซลส์',
    'crosssell': 'ขายเพิ่ม',
    'product': 'ขายสินค้า',
    'service': 'บริการ',
    'IN': 'รับเข้า',
    'OUT': 'เบิกออก',
    'TRANSFER': 'โอนสาขา',
  };
  return `<span class="badge ${map[type] || ''}">${labels[type] || type}</span>`;
}

function getUserName(userId) {
  const user = DB.getUserById(userId);
  return user ? `${user.nickname} (${user.name.split(' ')[0]})` : 'ไม่ทราบ';
}

// Business dates are Thai calendar days. toISOString() is UTC and shows yesterday before 07:00.
function bangkokISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function todayISO() {
  return bangkokISO();
}

function getWeekStart(date = new Date()) {
  const d = new Date(bangkokISO(new Date(date)) + 'T00:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.match(/image.*/)) {
      reject(new Error("Not an image"));
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Convert to highly compressed JPEG to save localStorage space
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function confirmDialog(msg, onConfirm) {
  const html = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title"><i data-lucide="help-circle"></i> ยืนยัน</h3>
        <button class="modal-close btn btn-ghost btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <p>${msg}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
        <button class="btn btn-danger" onclick="(${onConfirm.toString()})(); closeModalDirect();">ยืนยัน</button>
      </div>
    </div>`;
  openModal(html);
}

// ── Module render functions are defined in js/modules/*.js ────
// DO NOT redefine them here — they are loaded before app.js


// ── ตาราง: จัดคอลัมน์ข้อความยาวชิดซ้าย (คุณออม 18/10 ข้อ 20) ───────────
// หัวคอลัมน์ที่เป็นชื่อ/รายการ/หมายเหตุ → ทั้งคอลัมน์ชิดซ้าย ที่เหลือกึ่งกลาง (CSS ใน staff-ui.css)
const TABLE_TEXT_HEADERS = /ชื่อ|รายการ|สินค้า|ลูกค้า|โปรแกรม|หมายเหตุ|ข้อผิดพลาด|รายละเอียด|ผู้ขาย|แหล่งที่มา|ชุดข้อมูล|ของ$/;
function alignTableColumns(root) {
  (root || document).querySelectorAll('table').forEach(table => {
    const heads = table.querySelectorAll('thead th');
    if (!heads.length) return;
    const textCols = [];
    heads.forEach((th, i) => { if (TABLE_TEXT_HEADERS.test(th.textContent.trim())) { th.classList.add('col-text'); textCols.push(i); } });
    if (!textCols.length) return;
    table.querySelectorAll('tbody tr').forEach(tr => {
      if (tr.children.length !== heads.length) return; // แถวรวมช่อง (colspan) ไม่ต้องจัด
      textCols.forEach(i => tr.children[i]?.classList.add('col-text'));
    });
  });
}
let _alignTimer = null;
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
  new MutationObserver(() => { clearTimeout(_alignTimer); _alignTimer = setTimeout(() => alignTableColumns(), 60); })
    .observe(document.documentElement, { childList: true, subtree: true });
}
