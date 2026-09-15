/**
 * ARANA CLINIC — Main App Controller
 * app.js — Router, Auth, Toast, Navigation
 */

// ── Current Session ───────────────────────────────────────────
let currentUser = null;
let currentBranch = null;
let currentRoute = null;
let sidebarOpen = true;

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  DB.init();
  startClock();

  const saved = sessionStorage.getItem('arana_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      currentUser = session.user;
      if (currentUser && session.token) {
        currentBranch = session.branch || currentUser.branch;
        showApp();
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

  const user = await DB.authenticateSupabase(username, password);
  btn.classList.remove('loading');
  btn.disabled = false;

  if (user) {
    const token = user.sessionToken;
    delete user.sessionToken;
    currentUser = user;
    currentBranch = user.branch;
    sessionStorage.setItem('arana_session', JSON.stringify({ user, branch: user.branch, token }));
    errorEl.classList.add('hidden');
    showApp();
  } else {
    showLoginError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    document.getElementById('login-password').value = '';
  }
}

async function logout() {
  if (!confirm('ต้องการออกจากระบบ?')) return;
  await DB.logoutSupabase();
  sessionStorage.removeItem('arana_session');
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

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Set user info
  document.getElementById('user-name').textContent = `${currentUser.nickname} (${currentUser.name.split(' ')[0]})`;
  document.getElementById('user-role-badge').textContent = currentUser.role;
  document.getElementById('user-role-badge').className = 'user-role role-' + currentUser.role.toLowerCase();
  document.getElementById('user-avatar').textContent = (currentUser.nickname || currentUser.name)[0];

  // Set branch
  const branchSel = document.getElementById('branch-select');
  branchSel.value = currentBranch;
  document.getElementById('topbar-branch-name').textContent = currentBranch;

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
  history: { label: 'ประวัติบิลของฉัน', icon: 'history', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderHistory(getPage()) },
  'inventory-out': { label: 'เบิกใช้วัสดุ/อุปกรณ์', icon: 'package-minus', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'orange', render: () => renderInventory(getPage(), 'out') },
  'inventory-in': { label: 'รับเข้าสต๊อก', icon: 'package-plus', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'blue', render: () => renderInventory(getPage(), 'in') },
  'inventory-transfer': { label: 'เบิกโอนข้ามสาขา', icon: 'truck', roles: ['Frontdesk', 'Audit', 'Admin'], color: 'purple', render: () => renderInventory(getPage(), 'transfer') },
  stockcard: { label: 'สต๊อกการ์ด', icon: 'book-open', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderStockCard(getPage()) },
  weeklycount: { label: 'เช็คสต๊อกประจำสัปดาห์', icon: 'calendar-check', roles: ['Frontdesk', 'Audit', 'Admin'], render: () => renderWeeklyCount(getPage()) },
  audit: { label: 'Audit Room', icon: 'shield-check', roles: ['Audit', 'CommissionAudit', 'StockAudit', 'Admin'], render: () => renderAudit(getPage()) },
  balance: { label: 'สต๊อกคงเหลือ', icon: 'layers', roles: ['Audit', 'Admin'], render: () => renderBalance(getPage()) },
  reports: { label: 'รายงานผลงานพนักงาน', icon: 'bar-chart-3', roles: ['Frontdesk', 'Admin'], render: () => renderReports(getPage()) },
  admin: { label: 'AI Auto-Verification', icon: 'cpu', roles: ['Admin'], render: () => renderAdmin(getPage()) },
  admin_dashboard: { label: 'ระบบ Admin Dashboard', icon: 'layout-dashboard', roles: ['Admin'], render: () => renderAdminDashboard(getPage()) },
  systemlogs: { label: 'System Logs', icon: 'activity', roles: ['Admin'], render: () => renderSystemLogs(getPage()) },
};

function canAccess(route) {
  if (!currentUser) return false;
  const r = ROUTES[route];
  return r && r.roles.includes(currentUser.role);
}

function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  const sections = [
    { label: null, routes: ['opd', 'deposit', 'history'] },
    { label: 'คลังสินค้า', routes: ['inventory-out', 'inventory-in', 'inventory-transfer', 'stockcard', 'weeklycount'] },
    { label: 'Audit Zone', routes: ['audit', 'balance', 'reports'] },
    { label: 'Admin', routes: ['admin', 'admin_dashboard', 'systemlogs'] },
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

  nav.innerHTML = html;
  lucide.createIcons();
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
    else if (route === 'audit') parentCategory = 'ห้องตรวจสอบ';
    else if (route === 'admin' || route === 'systemlogs') parentCategory = 'ผู้ดูแลระบบ';

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
  const sess = JSON.parse(sessionStorage.getItem('arana_session') || '{}');
  sess.branch = branch;
  sessionStorage.setItem('arana_session', JSON.stringify(sess));
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
        <button class="btn btn-primary" id="cp-submit-btn" onclick="submitChangePassword()">บันทึกรหัสผ่านใหม่</button>
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
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

