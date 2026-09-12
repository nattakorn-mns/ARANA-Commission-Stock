/**
 * ARANA CLINIC — Admin Module
 * js/modules/admin.js
 */

let adminTab = 'ai';

function renderAdmin(container) {
  adminTab = 'ai';
  container.innerHTML = `
  <div>
    <div class="tab-bar">
      <button class="tab-btn active" id="adm-tab-ai" onclick="admSwitch('ai')">
        <i data-lucide="cpu"></i>AI Auto-Verification
      </button>
      <button class="tab-btn" id="adm-tab-users" onclick="admSwitch('users')">
        <i data-lucide="users"></i>จัดการผู้ใช้
      </button>
      <button class="tab-btn" id="adm-tab-logs" onclick="admSwitch('logs')">
        <i data-lucide="activity"></i>System Logs
      </button>
      <button class="tab-btn" id="adm-tab-import" onclick="admSwitch('import')">
        <i data-lucide="file-up"></i>นำเข้าข้อมูล (Import)
      </button>
    </div>
    <div id="adm-body"></div>
  </div>`;
  admRender();
  lucide.createIcons();
}

function renderSystemLogs(container) {
  adminTab = 'logs';
  renderAdmin(container);
}

function admSwitch(tab) {
  adminTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`adm-tab-${tab}`);
  if (el) el.classList.add('active');
  admRender();
}

function admRender() {
  const body = document.getElementById('adm-body');
  if (!body) return;
  if (adminTab === 'ai') admRenderAI(body);
  else if (adminTab === 'users') admRenderUsers(body);
  else if (adminTab === 'import') admRenderImport(body);
  else admRenderLogs(body);
}

// ── AI Auto-Verification ──────────────────────────────────
function admRenderAI(body) {
  const pendingBills = DB.getBills().filter(b => b.status === 'รอตรวจสอบ');
  const pendingStock = DB.getStockLogs({ auditStatus: 'รอตรวจสอบ' });

  body.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px;">
    <div class="stat-card">
      <div class="stat-icon burgundy"><i data-lucide="file-clock"></i></div>
      <div class="stat-body">
        <div class="stat-label">บิล OPD รอตรวจ</div>
        <div class="stat-value">${pendingBills.length}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><i data-lucide="package"></i></div>
      <div class="stat-body">
        <div class="stat-label">สต๊อกรอตรวจ</div>
        <div class="stat-value">${pendingStock.length}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i data-lucide="check-circle"></i></div>
      <div class="stat-body">
        <div class="stat-label">ผ่านการตรวจล่าสุด</div>
        <div class="stat-value">${DB.getBills().filter(b=>b.status==='อนุมัติแล้ว').length}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue"><i data-lucide="cpu"></i></div>
      <div class="stat-body">
        <div class="stat-label">AI Model</div>
        <div class="stat-value" style="font-size:0.9rem;">ARANA-v1</div>
        <div class="stat-sub">Rule-based Engine</div>
      </div>
    </div>
  </div>

  <div class="glass-card" style="text-align:center;padding:32px;">
    <div style="font-size:2rem;margin-bottom:8px;">🤖</div>
    <h3 style="font-size:1.1rem;font-weight:700;color:var(--burgundy-800);margin-bottom:8px;">AI Auto-Verification Engine</h3>
    <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:20px;max-width:440px;margin-left:auto;margin-right:auto;">ตรวจสอบอัตโนมัติ: ภาพ OPD ครบ, รายการเบิกตรงกับบิล, ค่าคอมอยู่ในเกณฑ์ปกติ</p>
    <button class="btn btn-primary" id="ai-run-btn" onclick="admRunAI()">
      <i data-lucide="play"></i> เริ่มการตรวจสอบ
    </button>
  </div>
  <div id="ai-results" style="margin-top:16px;"></div>`;
  lucide.createIcons();
}

function admRunAI() {
  const btn = document.getElementById('ai-run-btn');
  const results = document.getElementById('ai-results');
  btn.classList.add('loading'); btn.disabled = true;
  results.innerHTML = `<div class="loading-placeholder" style="height:150px;"><div class="spinner"></div><p style="margin-top:8px;">AI กำลังประมวลผล...</p></div>`;
  lucide.createIcons();

  setTimeout(() => {
    btn.classList.remove('loading'); btn.disabled = false;
    const bills = DB.getBills().filter(b => b.status === 'รอตรวจสอบ');

    const analyzed = bills.map(b => {
      const services = DB.getBillServices(b.id);
      const supplies = DB.getBillSupplies(b.id);
      const images = DB.getBillImages ? DB.getBillImages(b.id) : [];
      const flags = [];
      if (!images.length) flags.push({ text: 'ไม่มีภาพ OPD', sev: 'high' });
      const hasCommission = services.some(s => s.commission > 0);
      if (hasCommission && !supplies.length) flags.push({ text: 'มีค่ามือแต่ไม่มีรายการเบิก', sev: 'high' });
      if (services.some(s => s.commission > s.price)) flags.push({ text: 'ค่ามือสูงกว่าราคาบริการ', sev: 'medium' });
      return { bill: b, flags, pass: flags.filter(f=>f.sev==='high').length === 0 };
    });

    const passed = analyzed.filter(a => a.pass).length;
    const failed = analyzed.filter(a => !a.pass).length;

    results.innerHTML = `
    <div class="alert-box ${failed===0?'alert-success':'alert-warning'}" style="margin-bottom:16px;">
      <i data-lucide="${failed===0?'check-circle':'alert-triangle'}"></i>
      <span>ตรวจสอบ ${analyzed.length} บิล — ผ่าน ${passed} | ไม่ผ่าน ${failed}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${analyzed.map(a => `
      <div class="ai-result-row ${a.pass?'pass':'fail'}">
        <i data-lucide="${a.pass?'check-circle':'x-circle'}" class="ai-result-icon"></i>
        <div style="flex:1;min-width:0;">
          <div class="ai-result-name">${a.bill.hn||''} — ${a.bill.customerName} <span style="font-size:0.75rem;color:var(--gray-500);">${formatDate(a.bill.date)}</span></div>
          ${a.flags.length ? `<div class="ai-result-flags" style="margin-top:4px;">
            ${a.flags.map(f => `<span class="badge ${f.sev==='high'?'badge-rejected':'badge-waiting'}">${f.text}</span>`).join('')}
          </div>` : '<div style="font-size:0.78rem;color:var(--green-600);">✓ ผ่านทุกเกณฑ์</div>'}
        </div>
        ${!a.pass ? `<button class="btn btn-danger btn-sm" onclick="audQuickAction('${a.bill.id}','ตีกลับ','AI: ไม่ผ่านการตรวจสอบอัตโนมัติ')">ตีกลับ</button>` : ''}
      </div>`).join('')}
    </div>`;
    lucide.createIcons();
  }, 3000);
}

// ── Users Management ──────────────────────────────────────
async function admRenderUsers(body) {
  body.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลดรายชื่อพนักงาน...</div>`;
  const users = await DB.getUsersSupabase();
  body.innerHTML = `
  <div class="glass-card" style="margin-bottom:16px;">
    <div class="section-header" style="margin-bottom:14px;"><span class="section-title">เพิ่มผู้ใช้ใหม่</span></div>
    <div class="form-row-3" style="gap:10px;margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">ชื่อ-สกุล <span class="required">*</span></label>
        <input id="nu-name" class="form-input" placeholder="ชื่อ นามสกุล" />
      </div>
      <div class="form-group">
        <label class="form-label">ชื่อเล่น</label>
        <input id="nu-nick" class="form-input" placeholder="ชื่อเล่น" />
      </div>
      <div class="form-group">
        <label class="form-label">Username <span class="required">*</span></label>
        <input id="nu-user" class="form-input" placeholder="username" />
      </div>
    </div>
    <div class="form-row-3" style="gap:10px;margin-bottom:14px;">
      <div class="form-group">
        <label class="form-label">รหัสผ่าน <span class="required">*</span></label>
        <input id="nu-pass" type="password" class="form-input" placeholder="รหัสผ่าน" />
      </div>
      <div class="form-group">
        <label class="form-label">สิทธิ์</label>
        <select id="nu-role" class="form-select">
          <option value="Frontdesk">Frontdesk</option>
          <option value="Audit">Audit (เห็นทั้งสองคิว)</option>
          <option value="CommissionAudit">ผู้ตรวจค่ามือ/คอมมิชชั่น</option>
          <option value="StockAudit">ผู้ตรวจตัดสต๊อก</option>
          <option value="OnlineSales">แอดมินขายออนไลน์</option>
          <option value="Admin">Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">สาขา</label>
        <select id="nu-branch" class="form-select">
          <option value="พิษณุโลก">พิษณุโลก</option>
          <option value="กำแพงเพชร">กำแพงเพชร</option>
          <option value="แม่สอด">แม่สอด</option>
          <option value="นครสวรรค์">นครสวรรค์</option>
        </select>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary" id="nu-submit-btn" onclick="admAddUser()"><i data-lucide="user-plus"></i> เพิ่มผู้ใช้</button>
    </div>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;">
      <span class="section-title">รายชื่อผู้ใช้ทั้งหมด (${users.length} คน)</span>
    </div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table>
        <thead><tr><th>ชื่อ</th><th>ชื่อเล่น</th><th>Username</th><th>สิทธิ์</th><th>สาขา</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `
          <tr style="${u.isActive ? '' : 'opacity:0.5;'}">
            <td style="font-weight:600;">${u.name||'-'}</td>
            <td>${u.nickname||'-'}</td>
            <td><code style="font-size:0.8rem;background:var(--gray-100);padding:2px 8px;border-radius:4px;">${u.username||'-'}</code></td>
            <td><span class="user-role role-${(u.role||'frontdesk').toLowerCase()}">${u.role||'-'}</span></td>
            <td>${u.branch||'-'}</td>
            <td>${u.isActive ? '<span style="color:var(--green-600, #16a34a);font-size:0.78rem;">● ใช้งานอยู่</span>' : '<span style="color:var(--gray-400);font-size:0.78rem;">● ปิดใช้งาน</span>'}</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="admToggleUserActive('${u.id}', ${!u.isActive})">
                ${u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              </button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
  lucide.createIcons();
}

async function admToggleUserActive(userId, newActive) {
  try {
    await DB.setUserActiveSupabase(userId, newActive);
    Toast.show(newActive ? 'เปิดใช้งานบัญชีเรียบร้อย' : 'ปิดใช้งานบัญชีเรียบร้อย', 'success');
    admRenderUsers(document.getElementById('adm-body'));
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

async function admAddUser() {
  const name = document.getElementById('nu-name')?.value.trim();
  const nick = document.getElementById('nu-nick')?.value.trim();
  const username = document.getElementById('nu-user')?.value.trim();
  const password = document.getElementById('nu-pass')?.value;
  const role = document.getElementById('nu-role')?.value || 'Frontdesk';
  const branch = document.getElementById('nu-branch')?.value || 'พิษณุโลก';

  if (!name || !username || !password) { Toast.show('กรุณากรอกข้อมูลให้ครบ', 'error'); return; }
  if (password.length < 4) { Toast.show('รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร', 'error'); return; }

  const btn = document.getElementById('nu-submit-btn');
  if (btn) btn.disabled = true;

  try {
    await DB.createUserSupabase({ username, password, name, nickname: nick || name.split(' ')[0], role, branch });
    Toast.show(`เพิ่มผู้ใช้ ${name} เรียบร้อย`, 'success');
    admRenderUsers(document.getElementById('adm-body'));
  } catch (e) {
    if (e.message === 'USERNAME_EXISTS') {
      Toast.show('Username นี้ถูกใช้แล้ว กรุณาเปลี่ยน', 'error');
    } else {
      console.error(e);
      Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── System Logs ───────────────────────────────────────────
function admRenderLogs(body) {
  const sysLogs = DB.getSystemLogs ? DB.getSystemLogs() : [];
  const users = DB.getUsers();

  body.innerHTML = `
  <div class="filter-bar" style="margin-bottom:12px;">
    <div class="filter-group">
      <label class="filter-label">ผู้ใช้</label>
      <select class="filter-select" id="slog-user" onchange="admFilterLogs()">
        <option value="">ทุกคน</option>
        ${users.map(u => `<option value="${u.id}">${u.nickname}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <label class="filter-label">จากวันที่</label>
      <input type="date" class="filter-input" id="slog-from" onchange="admFilterLogs()" />
    </div>
    <div class="filter-actions">
      <button class="btn btn-ghost btn-sm" onclick="admExportSysLogs()"><i data-lucide="download"></i> Export</button>
    </div>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="table-wrap" style="border:none;border-radius:0;" id="slog-table">
      ${admSysLogTable(sysLogs)}
    </div>
  </div>`;
  lucide.createIcons();
}

function admSysLogTable(logs) {
  if (!logs.length) return `<div class="empty-state" style="padding:32px;"><i data-lucide="activity"></i><h4>ยังไม่มี System Log</h4></div>`;
  return `<table>
    <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>สาขา</th><th>การกระทำ</th><th>รายละเอียด</th><th>IP (สมมติ)</th></tr></thead>
    <tbody>
      ${logs.map(l => `<tr>
        <td class="nowrap" style="font-size:0.78rem;">${formatDateTime(l.createdAt)}</td>
        <td>${getUserName(l.userId)}</td>
        <td>${l.branch||'-'}</td>
        <td><span class="badge badge-pending">${l.action||'-'}</span></td>
        <td style="font-size:0.8rem;max-width:200px;">${l.detail||'-'}</td>
        <td style="font-size:0.75rem;color:var(--gray-400);">192.168.1.${Math.floor(Math.random()*50)+10}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function admFilterLogs() {
  const uid = document.getElementById('slog-user')?.value;
  const from = document.getElementById('slog-from')?.value;
  let logs = DB.getSystemLogs ? DB.getSystemLogs() : [];
  if (uid) logs = logs.filter(l => l.userId === uid);
  if (from) logs = logs.filter(l => (l.createdAt||'') >= from);
  const table = document.getElementById('slog-table');
  if (table) { table.innerHTML = admSysLogTable(logs); lucide.createIcons(); }
}

function admExportSysLogs() {
  const logs = DB.getSystemLogs ? DB.getSystemLogs() : [];
  const rows = [['เวลา','ผู้ใช้','สาขา','การกระทำ','รายละเอียด']];
  logs.forEach(l => rows.push([l.createdAt, getUserName(l.userId), l.branch, l.action, l.detail]));
  const csv = rows.map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `system_logs_${todayISO()}.csv`;
  a.click();
}

// ── IMPORT CSV DATA ───────────────────────────────────────
let _importProgramsData = [];
let _importProductsData = [];
let _importUsersData = [];

function admRenderImport(body) {
  _importProgramsData = [];
  _importProductsData = [];
  _importUsersData = [];

  body.innerHTML = `
  <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; flex-wrap: wrap;">
    <!-- Users Import -->
    <div class="glass-card" style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;color:var(--burgundy-800);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <i data-lucide="users" style="color:var(--burgundy-500); width:18px;height:18px;"></i> นำเข้ารายชื่อพนักงาน (Users)
      </h3>
      <p style="font-size:0.8rem;color:var(--gray-500);margin-bottom:16px;">
        ใช้สำหรับนำเข้ารายชื่อพนักงานจริงจำนวนมากทีเดียว เหมาะสำหรับตอนเปิดสาขาใหม่
      </p>

      <div style="background:var(--gray-50);padding:12px;border-radius:var(--radius-md);font-size:0.75rem;color:var(--gray-600);margin-bottom:16px;line-height:1.4;">
        <strong>รูปแบบคอลัมน์ใน CSV (พนักงาน):</strong><br>
        <code>username, password, name, nickname, role, branch, position</code><br>
        role ต้องเป็น Frontdesk / Audit / CommissionAudit / StockAudit / OnlineSales / Admin<br>
        branch ต้องเป็นชื่อสาขาที่มีอยู่แล้วในระบบ
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;">
            <i data-lucide="file-spreadsheet"></i> เลือกไฟล์ CSV
            <input type="file" id="import-user-file" accept=".csv" style="display:none;" onchange="admHandleCSVImport(event, 'users')" />
          </label>
          <span id="import-user-filename" style="font-size:0.8rem;color:var(--gray-400);">ยังไม่ได้เลือกไฟล์</span>
        </div>

        <div id="import-user-preview" style="margin-top:12px;"></div>

        <button class="btn btn-primary" id="import-user-btn" onclick="admSubmitImport('users')" disabled style="margin-top:8px;align-self:flex-start;">
          <i data-lucide="upload"></i> ดำเนินการนำเข้ารายชื่อพนักงาน
        </button>
      </div>
    </div>

    <!-- Programs Import -->
    <div class="glass-card" style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;color:var(--burgundy-800);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <i data-lucide="clipboard-list" style="color:var(--burgundy-500); width:18px;height:18px;"></i> นำเข้าข้อมูลโปรแกรม/บริการ (Programs)
      </h3>
      <p style="font-size:0.8rem;color:var(--gray-500);margin-bottom:16px;">
        ใช้สำหรับการตั้งค่าเริ่มต้นหรืออัปเดตบริการทั้งหมดของคลินิก โดยรองรับไฟล์ CSV
      </p>
      
      <div style="background:var(--gray-50);padding:12px;border-radius:var(--radius-md);font-size:0.75rem;color:var(--gray-600);margin-bottom:16px;line-height:1.4;">
        <strong>รูปแบบคอลัมน์ใน CSV (โปรแกรม):</strong><br>
        <code>code, name, price, unit, category</code><br>
        หรือภาษาไทย: <code>รหัสโปรแกรม, ชื่อโปรแกรม, ราคา, หน่วย, หมวดหมู่</code>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;">
            <i data-lucide="file-spreadsheet"></i> เลือกไฟล์ CSV
            <input type="file" id="import-prog-file" accept=".csv" style="display:none;" onchange="admHandleCSVImport(event, 'programs')" />
          </label>
          <span id="import-prog-filename" style="font-size:0.8rem;color:var(--gray-400);">ยังไม่ได้เลือกไฟล์</span>
        </div>

        <div style="display:flex;align-items:center;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--charcoal);cursor:pointer;">
            <input type="radio" name="import-prog-mode" value="append" checked /> เพิ่มข้อมูลใหม่ต่อท้าย
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--charcoal);cursor:pointer;">
            <input type="radio" name="import-prog-mode" value="overwrite" /> ล้างและเขียนทับทั้งหมด
          </label>
        </div>

        <div id="import-prog-preview" style="margin-top:12px;"></div>

        <button class="btn btn-primary" id="import-prog-btn" onclick="admSubmitImport('programs')" disabled style="margin-top:8px;align-self:flex-start;">
          <i data-lucide="upload"></i> ดำเนินการนำเข้าข้อมูลโปรแกรม
        </button>
      </div>
    </div>

    <!-- Products Import -->
    <div class="glass-card" style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;color:var(--burgundy-800);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <i data-lucide="package" style="color:var(--burgundy-500); width:18px;height:18px;"></i> นำเข้าข้อมูลคลังยา/อุปกรณ์ (Products)
      </h3>
      <p style="font-size:0.8rem;color:var(--gray-500);margin-bottom:16px;">
        ใช้สำหรับการตั้งค่าสต๊อกเริ่มต้นจาก ERP (เช่น APSX) เข้าสู่คลังสินค้าของคลินิก
      </p>

      <div style="background:var(--gray-50);padding:12px;border-radius:var(--radius-md);font-size:0.75rem;color:var(--gray-600);margin-bottom:16px;line-height:1.4;">
        <strong>รูปแบบคอลัมน์ใน CSV (ยา/อุปกรณ์):</strong><br>
        <code>code, name, unit, category, stockQty</code><br>
        หรือภาษาไทย: <code>รหัสสินค้า, ชื่อสินค้า, หน่วย, หมวดหมู่, จำนวนคงเหลือ</code>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0;">
            <i data-lucide="file-spreadsheet"></i> เลือกไฟล์ CSV
            <input type="file" id="import-prod-file" accept=".csv" style="display:none;" onchange="admHandleCSVImport(event, 'products')" />
          </label>
          <span id="import-prod-filename" style="font-size:0.8rem;color:var(--gray-400);">ยังไม่ได้เลือกไฟล์</span>
        </div>

        <div style="display:flex;align-items:center;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--charcoal);cursor:pointer;">
            <input type="radio" name="import-prod-mode" value="append" checked /> เพิ่มข้อมูลใหม่ต่อท้าย
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--charcoal);cursor:pointer;">
            <input type="radio" name="import-prod-mode" value="overwrite" /> ล้างและเขียนทับทั้งหมด
          </label>
        </div>

        <div id="import-prod-preview" style="margin-top:12px;"></div>

        <button class="btn btn-primary" id="import-prod-btn" onclick="admSubmitImport('products')" disabled style="margin-top:8px;align-self:flex-start;">
          <i data-lucide="upload"></i> ดำเนินการนำเข้าข้อมูลคลังสินค้า
        </button>
      </div>
    </div>
  </div>`;
  lucide.createIcons();
}

function admHandleCSVImport(event, type) {
  const file = event.target.files[0];
  if (!file) return;

  const prefix = type === 'programs' ? 'prog' : (type === 'products' ? 'prod' : 'user');
  const filenameEl = document.getElementById(`import-${prefix}-filename`);
  if (filenameEl) filenameEl.textContent = file.name;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = ev.target.result;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length <= 1) {
        Toast.show('ไฟล์ไม่มีข้อมูลหรือรูปแบบไม่ถูกต้อง', 'error');
        return;
      }

      const rawHeaders = lines[0].split(',');
      const headers = rawHeaders.map(h => h.replace(/"/g, '').trim());

      const data = lines.slice(1).map(line => {
        const cols = [];
        let insideQuote = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            cols.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        cols.push(current.trim());

        const obj = {};
        headers.forEach((h, idx) => {
          let val = cols[idx] || '';
          val = val.replace(/^"|"$/g, '').trim();
          obj[h] = val;
        });
        return obj;
      });

      const previewEl = document.getElementById(`import-${prefix}-preview`);
      if (previewEl) {
        previewEl.innerHTML = `
          <div class="alert-box alert-success" style="padding: 8px 12px; font-size: 0.78rem; margin-bottom: 8px; border-radius: var(--radius-sm);">
            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
            <span>ตรวจสอบรูปแบบผ่าน: อ่านได้ ${data.length} รายการ</span>
          </div>
          <div class="table-wrap" style="max-height: 150px; overflow: auto; border-radius: var(--radius-sm);">
            <table style="font-size:0.75rem;">
              <thead>
                <tr>
                  ${headers.slice(0, 4).map(h => `<th>${h}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${data.slice(0, 5).map(row => `
                  <tr>
                    ${headers.slice(0, 4).map(h => `<td>${h.toLowerCase().includes('password') ? '••••••' : (row[h] || '-')}</td>`).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
        lucide.createIcons();
      }

      if (type === 'programs') {
        _importProgramsData = data;
        document.getElementById('import-prog-btn').disabled = false;
      } else if (type === 'products') {
        _importProductsData = data;
        document.getElementById('import-prod-btn').disabled = false;
      } else {
        _importUsersData = data;
        document.getElementById('import-user-btn').disabled = false;
      }
    } catch (e) {
      console.error(e);
      Toast.show('เกิดข้อผิดพลาดในการอ่านไฟล์ CSV: ' + e.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

async function admSubmitImport(type) {
  if (type === 'users') {
    await admSubmitUserImport();
    return;
  }

  const isProg = type === 'programs';
  const data = isProg ? _importProgramsData : _importProductsData;
  if (!data || data.length === 0) {
    Toast.show('ไม่มีข้อมูลสำหรับนำเข้า', 'error');
    return;
  }

  const mode = document.querySelector(`input[name="import-${isProg ? 'prog' : 'prod'}-mode"]:checked`).value;
  
  try {
    let currentData = isProg ? DB.getPrograms() : DB.getProducts();
    if (mode === 'overwrite') {
      currentData = [];
    }

    let successCount = 0;
    data.forEach(row => {
      let code = row.code || row['รหัสโปรแกรม'] || row['รหัสสินค้า'] || row.Code || '';
      let name = row.name || row['ชื่อโปรแกรม'] || row['ชื่อสินค้า'] || row.Name || '';
      let unit = row.unit || row['หน่วย'] || row.Unit || (isProg ? 'ครั้ง' : 'ชิ้น');
      let category = row.category || row['หมวดหมู่'] || row.Category || (isProg ? 'ทั่วไป' : 'ทั่วไป');
      
      if (!code || !name) return;

      if (isProg) {
        let price = parseFloat(row.price || row['ราคา'] || row.Price || 0);
        if (mode === 'append') {
          currentData = currentData.filter(p => p.code !== code);
        }
        currentData.push({ code, name, price, unit, category });
        successCount++;
      } else {
        let stockQty = parseInt(row.stockQty || row['จำนวนคงเหลือ'] || row.StockQty || 0);
        let typeVal = parseInt(row.type || row['ประเภท'] || 1);
        if (mode === 'append') {
          currentData = currentData.filter(p => p.code !== code);
        }
        currentData.push({ code, name, unit, category, type: typeVal, stockQty });
        successCount++;
      }
    });

    DB._set(isProg ? 'programs' : 'products', currentData);

    Toast.show(`นำเข้าข้อมูล ${successCount} รายการเรียบร้อยแล้ว!`, 'success');
    
    DB.saveAuditLog({
      action: `IMPORT_${type.toUpperCase()}`,
      target: `จำนวน ${successCount} รายการ (โหมด: ${mode})`,
      note: `นำเข้าผ่านไฟล์ CSV โดยแอดมิน`
    });

    admRenderImport(document.getElementById('adm-body'));
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาดขณะนำเข้าข้อมูล: ' + e.message, 'error');
  }
}

async function admSubmitUserImport() {
  const data = _importUsersData;
  if (!data || data.length === 0) {
    Toast.show('ไม่มีข้อมูลสำหรับนำเข้า', 'error');
    return;
  }

  const btn = document.getElementById('import-user-btn');
  const previewEl = document.getElementById('import-user-preview');
  if (btn) btn.disabled = true;

  let successCount = 0;
  let skipped = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const username = row.username || row.Username || row['ชื่อผู้ใช้'] || '';
    const password = row.password || row.Password || row['รหัสผ่าน'] || '';
    const name = row.name || row.Name || row['ชื่อ-สกุล'] || '';
    const nickname = row.nickname || row.Nickname || row['ชื่อเล่น'] || name.split(' ')[0] || '';
    const role = row.role || row.Role || row['สิทธิ์'] || 'Frontdesk';
    const branch = row.branch || row.Branch || row['สาขา'] || '';
    const position = row.position || row.Position || row['ตำแหน่ง'] || '';

    if (!username || !password || !name || !branch) {
      skipped.push(`แถวที่ ${i + 2}: ข้อมูลไม่ครบ`);
      continue;
    }

    if (previewEl) {
      previewEl.innerHTML = `<div style="font-size:0.8rem;color:var(--gray-500);">กำลังนำเข้า... ${i + 1}/${data.length}</div>`;
    }

    try {
      await DB.createUserSupabase({ username, password, name, nickname, role, branch, position });
      successCount++;
    } catch (e) {
      if (e.message === 'USERNAME_EXISTS') {
        skipped.push(`${username}: username ซ้ำ (ข้าม)`);
      } else {
        skipped.push(`${username}: ${e.message}`);
      }
    }
  }

  if (btn) btn.disabled = false;

  Toast.show(`นำเข้าพนักงานสำเร็จ ${successCount}/${data.length} คน`, successCount > 0 ? 'success' : 'error');

  if (previewEl) {
    previewEl.innerHTML = `
      <div class="alert-box ${successCount === data.length ? 'alert-success' : 'alert-warning'}" style="padding:8px 12px;font-size:0.78rem;border-radius:var(--radius-sm);">
        นำเข้าสำเร็จ ${successCount} คน ${skipped.length > 0 ? `— ข้าม ${skipped.length} รายการ` : ''}
      </div>
      ${skipped.length > 0 ? `<div style="font-size:0.72rem;color:var(--gray-500);margin-top:6px;max-height:100px;overflow:auto;">${skipped.join('<br>')}</div>` : ''}
    `;
  }

  DB.saveAuditLog({
    action: 'IMPORT_USERS',
    target: `นำเข้าพนักงาน ${successCount} คน`,
    note: `นำเข้าผ่านไฟล์ CSV โดยแอดมิน`
  });
}

