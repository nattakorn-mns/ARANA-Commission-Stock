/**
 * ARANA CLINIC — Admin Module
 * js/modules/admin.js
 */

let adminTab = 'users';

// หน้า "ผู้ดูแลระบบ" (คุณออม 18/10): เอาแท็บ AI เดิมและ System Logs ออก (ใช้ข้อมูลตัวอย่างในเครื่อง ไม่ใช่ข้อมูลจริง)
function renderAdmin(container) {
  adminTab = 'users';
  container.innerHTML = `
  <div>
    <div class="tab-bar">
      <button class="tab-btn active" id="adm-tab-users" onclick="admSwitch('users')">
        <i data-lucide="users"></i>จัดการผู้ใช้
      </button>
      <button class="tab-btn" id="adm-tab-import" onclick="admSwitch('import')">
        <i data-lucide="file-up"></i>นำเข้าข้อมูล (Import)
      </button>
      <button class="tab-btn" id="adm-tab-positions" onclick="admSwitch('positions')">
        <i data-lucide="shield-check"></i>ตั้งค่าสิทธิ์เมนู
      </button>
      <button class="tab-btn" id="adm-tab-erpsync" onclick="admSwitch('erpsync')">
        <i data-lucide="upload-cloud"></i>สถานะซิงก์ ERP
      </button>
      <button class="tab-btn" id="adm-tab-notify" onclick="admSwitch('notify')">
        <i data-lucide="bell"></i>แจ้งเตือน
      </button>
      <button class="tab-btn" id="adm-tab-activity" onclick="admSwitch('activity')">
        <i data-lucide="history"></i>ประวัติการใช้งาน
      </button>
      <button class="tab-btn" id="adm-tab-aiplan" onclick="admSwitch('aiplan')">
        <i data-lucide="sparkles"></i>AI ช่วยตรวจ (แผนพัฒนา)
      </button>
    </div>
    <div id="adm-body"></div>
  </div>`;
  admRender();
  lucide.createIcons();
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
  if (adminTab === 'import') admRenderImport(body);
  else if (adminTab === 'positions') admRenderPositions(body);
  else if (adminTab === 'erpsync') admRenderErpSync(body);
  else if (adminTab === 'notify') admRenderNotify(body);
  else if (adminTab === 'aiplan') admRenderAiPlan(body);
  else if (adminTab === 'activity') admRenderActivity(body);
  else admRenderUsers(body);
}

// ข้อ 27: ประวัติการใช้งานจริงจากระบบกลาง (เข้าระบบ / อนุมัติ / แก้ไข / ตั้งค่า) — ล่าสุด 1,000 รายการ
let admActivityRows = [];
function admRenderActivity(body) {
  const today = todayISO();
  const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  body.innerHTML = `
    <div class="filter-bar">
      <div class="filter-group"><label class="filter-label">จากวันที่</label><input type="date" class="filter-input" id="act-from" value="${weekAgo}" onchange="admLoadActivity()" /></div>
      <div class="filter-group"><label class="filter-label">ถึงวันที่</label><input type="date" class="filter-input" id="act-to" value="${today}" onchange="admLoadActivity()" /></div>
      <div class="filter-group"><label class="filter-label">ค้นหา</label><input type="text" class="filter-input" id="act-search" placeholder="ชื่อ / การกระทำ / รายละเอียด" oninput="admShowActivity()" /></div>
      <div class="filter-group"><label class="filter-label">การกระทำ</label><select class="filter-select" id="act-action" onchange="admShowActivity()"><option value="">ทั้งหมด</option></select></div>
    </div>
    <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap" id="act-wrap"><div class="loading-placeholder"><div class="spinner"></div></div></div></div>`;
  lucide.createIcons();
  admLoadActivity();
}
async function admLoadActivity() {
  const wrap = document.getElementById('act-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
  try {
    admActivityRows = await DB.adminActivityLogSupabase({ from: document.getElementById('act-from')?.value, to: document.getElementById('act-to')?.value });
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>ยังดูประวัติไม่ได้</h4><p>${/Could not find the function|PGRST202/.test(e.message || '') ? 'ต้องติดตั้งฐานข้อมูลรอบ 2 (SQL ไฟล์ 18) ก่อน' : (e.hint || e.message || e)}</p></div>`;
    lucide.createIcons(); return;
  }
  const sel = document.getElementById('act-action');
  if (sel) {
    const cur = sel.value;
    const actions = [...new Set(admActivityRows.map(r => r.action).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">ทั้งหมด</option>' + actions.map(a => `<option ${a === cur ? 'selected' : ''}>${a}</option>`).join('');
  }
  admShowActivity();
}
function admShowActivity() {
  const wrap = document.getElementById('act-wrap');
  if (!wrap) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const q = (document.getElementById('act-search')?.value || '').toLowerCase();
  const act = document.getElementById('act-action')?.value || '';
  const who = r => r.user_nickname ? `${r.user_name} (${r.user_nickname})` : (r.user_name || r.username || 'ระบบ');
  const rows = admActivityRows.filter(r => (!act || r.action === act)
    && (!q || [who(r), r.action, r.note, r.new_status, r.old_status].join(' ').toLowerCase().includes(q)));
  if (!rows.length) { wrap.innerHTML = '<div class="empty-state"><i data-lucide="history"></i><h4>ไม่มีประวัติในช่วงนี้</h4></div>'; lucide.createIcons(); return; }
  const when = t => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  wrap.innerHTML = `<table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="nowrap">${when(r.created_at)}</td><td class="col-text">${esc(who(r))}</td><td>${esc(r.action)}</td>
      <td class="nowrap">${r.old_status || r.new_status ? esc([r.old_status, r.new_status].filter(Boolean).join(' → ')) : '-'}</td>
      <td class="col-text" style="max-width:420px;font-size:.82rem;word-break:break-word;">${esc(r.note || '-')}</td></tr>`).join('')}
    </tbody></table>
    ${admActivityRows.length >= 1000 ? '<p style="padding:8px 12px;font-size:.8rem;color:var(--gray-500);">แสดง 1,000 รายการล่าสุด — เลือกช่วงวันที่ให้แคบลงเพื่อดูเก่ากว่านี้</p>' : ''}`;
}

// ห้องรอไว้พัฒนา — ยังไม่มีปุ่มหรือตัวเลข จะได้ไม่ลืมแผน (เห็นเฉพาะผู้ดูแลระบบ)
function admRenderAiPlan(body) {
  const plans = [
    'เตือนบิลที่ไม่มีรูป OPD',
    'เตือนบิลที่มีค่ามือแต่ไม่มีของเบิก',
    'เตือนค่ามือสูงกว่าราคาโปรแกรม',
    'เตือน % ค่าคอมไม่ตรงกับที่ตั้งไว้ในเมนูตั้งค่า',
    'เตือนของที่เบิกไม่ตรงกับรายงานจ่ายยาของ ERP',
    'กฎตรวจค่าคอม/ค่ามือเพิ่มเติมที่คุณออมจะแจ้งภายหลัง'
  ];
  body.innerHTML = `<div class="glass-card">
    <div class="section-header" style="margin-bottom:10px;"><span class="section-title">AI ช่วยตรวจ — แผนพัฒนา</span></div>
    <p style="color:var(--ink-3);margin:0 0 12px;">ยังไม่เปิดใช้งาน เมื่อพร้อมจะขึ้นเป็นป้ายเตือนที่บิลรอตรวจในห้องตรวจ ให้บัญชีเห็นจุดผิดก่อนเปิดบิล</p>
    <ul style="margin:0;padding-left:20px;line-height:1.9;">${plans.map(p => `<li>${p}</li>`).join('')}</ul>
  </div>`;
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
  const [usersRaw, positions] = await Promise.all([
    DB.adminListUsersWithPositionSupabase(),
    DB.adminListPositionsSupabase()
  ]);
  const users = (usersRaw || []).map(u => ({
    id: u.id, name: u.name, nickname: u.nickname, username: u.username,
    role: u.role, displayPosition: u.display_position, branch: u.branch, isActive: u.is_active
  }));
  const positionOptions = (positions || []).map(p => `<option value="${p.name}">${p.name}</option>`).join('');
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
          <option value="Admin">ผู้ดูแลระบบ</option>
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
    <div class="form-row-3" style="gap:10px;margin-bottom:14px;">
      <div class="form-group">
        <label class="form-label">ตำแหน่งที่แสดง (คุมเมนูที่เห็น)</label>
        <select id="nu-position" class="form-select">
          ${positionOptions}
        </select>
        <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px;">แยกจากช่อง "สิทธิ์" ด้านบน — ช่องนี้คุมว่าเมนูไหนโชว์ในแถบซ้าย ปรับได้ทีหลังที่แท็บ "ตั้งค่าสิทธิ์เมนู"</p>
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
        <thead><tr><th>ชื่อ</th><th>ชื่อเล่น</th><th>Username</th><th>สิทธิ์</th><th>ตำแหน่งที่แสดง</th><th>สาขา</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `
          <tr style="${u.isActive ? '' : 'opacity:0.5;'}">
            <td style="font-weight:600;">${u.name||'-'}</td>
            <td>${u.nickname||'-'}</td>
            <td><code style="font-size:0.8rem;background:var(--gray-100);padding:2px 8px;border-radius:4px;">${u.username||'-'}</code></td>
            <td><span class="user-role role-${(u.role||'frontdesk').toLowerCase()}">${roleLabel(u.role)}</span></td>
            <td>
              <select class="form-select" style="padding:4px 8px;font-size:0.8rem;" onchange="admChangeUserPosition('${u.id}', this.value)">
                <option value="">ยังไม่ตั้ง</option>
                ${(positions||[]).map(p => `<option value="${p.name}" ${p.name===u.displayPosition?'selected':''}>${p.name}</option>`).join('')}
              </select>
            </td>
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

async function admChangeUserPosition(userId, positionName) {
  try {
    await DB.adminSetUserPositionSupabase(userId, positionName || null);
    Toast.show('ปรับตำแหน่งที่แสดงเรียบร้อย', 'success');
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
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
  const position = document.getElementById('nu-position')?.value || null;

  if (!name || !username || !password) { Toast.show('กรุณากรอกข้อมูลให้ครบ', 'error'); return; }
  if (password.length < 4) { Toast.show('รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร', 'error'); return; }

  const btn = document.getElementById('nu-submit-btn');
  if (btn) btn.disabled = true;

  try {
    const newUserId = await DB.createUserSupabase({ username, password, name, nickname: nick || name.split(' ')[0], role, branch });
    if (position && newUserId) {
      try { await DB.adminSetUserPositionSupabase(newUserId, position); }
      catch (e2) { console.warn('ตั้งตำแหน่งที่แสดงไม่สำเร็จ (สร้างผู้ใช้สำเร็จแล้ว):', e2); }
    }
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


// ── ตั้งค่าสิทธิ์เมนูตามตำแหน่ง ──────────────────────────────
let admSelectedPosition = null;

async function admRenderPositions(body) {
  body.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>`;
  const positions = await DB.adminListPositionsSupabase();
  if (!admSelectedPosition && positions.length) admSelectedPosition = positions[0].name;

  body.innerHTML = `
  <div class="glass-card" style="margin-bottom:16px;">
    <div class="section-header" style="margin-bottom:14px;"><span class="section-title">เพิ่มตำแหน่งใหม่</span></div>
    <div style="display:flex;gap:10px;align-items:flex-end;">
      <div class="form-group" style="flex:1;">
        <label class="form-label">ชื่อตำแหน่งใหม่</label>
        <input id="np-name" class="form-input" placeholder="เช่น หัวหน้าสาขา" />
      </div>
      <div class="form-group" style="flex:2;">
        <label class="form-label">คำอธิบาย (ไม่บังคับ)</label>
        <input id="np-desc" class="form-input" placeholder="อธิบายสั้น ๆ ว่าตำแหน่งนี้ทำหน้าที่อะไร" />
      </div>
      <button class="btn btn-primary" onclick="admCreatePosition()"><i data-lucide="plus"></i> เพิ่มตำแหน่ง</button>
    </div>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;">
      <span class="section-title">เลือกตำแหน่งที่จะตั้งค่าสิทธิ์</span>
    </div>
    <div style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap;">
      ${positions.map(p => `
        <button class="btn ${p.name===admSelectedPosition?'btn-primary':'btn-ghost'} btn-sm" onclick="admSelectPosition('${p.name}')">${p.name}</button>
      `).join('')}
    </div>
  </div>

  <div id="adm-position-permissions" style="margin-top:16px;"></div>
  `;
  lucide.createIcons();
  if (admSelectedPosition) admRenderPositionPermissions();
}

function admSelectPosition(name) {
  admSelectedPosition = name;
  admRenderPositions(document.getElementById('adm-body'));
}

async function admCreatePosition() {
  const name = document.getElementById('np-name')?.value.trim();
  const desc = document.getElementById('np-desc')?.value.trim();
  if (!name) { Toast.show('กรุณาใส่ชื่อตำแหน่ง', 'error'); return; }
  try {
    await DB.adminCreatePositionSupabase(name, desc);
    Toast.show(`เพิ่มตำแหน่ง "${name}" เรียบร้อย ตั้งค่าสิทธิ์เมนูต่อได้เลย`, 'success');
    admSelectedPosition = name;
    admRenderPositions(document.getElementById('adm-body'));
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

async function admRenderPositionPermissions() {
  const el = document.getElementById('adm-position-permissions');
  if (!el) return;
  el.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลดสิทธิ์เมนูของ "${admSelectedPosition}"...</div>`;
  const rows = await DB.adminListMenuPermissionsSupabase(admSelectedPosition);

  el.innerHTML = `
  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;">
      <span class="section-title">เมนูที่ตำแหน่ง "${admSelectedPosition}" มองเห็นได้</span>
    </div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table>
        <thead><tr><th>เมนู</th><th style="text-align:center;">ดูได้</th><th style="text-align:center;">แก้ไข/บันทึกได้</th></tr></thead>
        <tbody>
          ${rows.map(r => `
          <tr>
            <td>${r.page_label || r.page_key}</td>
            <td style="text-align:center;">
              <input type="checkbox" id="view-${r.page_key}" ${r.can_view?'checked':''}
                onchange="admSavePermission('${r.page_key}', this.checked, document.getElementById('edit-${r.page_key}').checked, '${(r.page_label||r.page_key).replace(/'/g,"\'")}')" />
            </td>
            <td style="text-align:center;">
              <input type="checkbox" id="edit-${r.page_key}" ${r.can_edit?'checked':''}
                onchange="admSavePermission('${r.page_key}', document.getElementById('view-${r.page_key}').checked, this.checked, '${(r.page_label||r.page_key).replace(/'/g,"\'")}')" />
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>
  <p style="font-size:0.78rem;color:var(--gray-400);margin-top:10px;">ติ๊ก/ถอนติ๊กแล้วบันทึกทันที ไม่ต้องกดปุ่มเพิ่ม — พนักงานที่ล็อกอินอยู่แล้วต้องออกจากระบบแล้วเข้าใหม่ ถึงจะเห็นเมนูเปลี่ยนตามสิทธิ์ล่าสุด</p>`;
  lucide.createIcons();
}

async function admSavePermission(pageKey, canView, canEdit, pageLabel) {
  try {
    await DB.adminSetMenuPermissionSupabase(admSelectedPosition, pageKey, canView, canEdit, pageLabel);
    Toast.show('บันทึกสิทธิ์เรียบร้อย', 'success');
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// ── สถานะซิงก์ ERP (เบิกใช้วัสดุ/โอนสต็อก) — ขั้นเตรียมการ ──────
let admErpFilter = null;

// การ์ด "ดึงข้อมูลจาก ERP" (พนักงาน / สินค้า / ข้อมูลไว้ตรวจเทียบ) — อ่านอย่างเดียว ทุกเช้า 05:00
const ERP_DATASET_LABELS = { employees: 'ทะเบียนพนักงาน → บัญชีผู้ใช้', stock_items: 'รายชื่อสินค้า', stock_balance: 'ยอดคงเหลือ (ไว้เทียบ)',
  open_purchase_orders: 'PO รอรับของ', service_commissions: 'ค่ามือ/ค่าคอมหน้าร้าน (ไว้ตรวจเทียบ)', deposits: 'มัดจำ (ไว้ตรวจเทียบ)' };
async function admErpPullCard() {
  let st;
  try { st = await DB.adminErpSyncStatusSupabase(); }
  catch (e) { return `<div class="alert-box alert-warning" style="margin-bottom:16px;"><i data-lucide="info"></i><span>ยังไม่ได้ติดตั้งการดึงข้อมูลจาก ERP (SQL ไฟล์ 09)</span></div>`; }
  const rows = (st.datasets || []).map(d => `<tr><td>${ERP_DATASET_LABELS[d.dataset] || d.dataset}</td><td class="nowrap">${d.last_run_at ? formatDateTime(d.last_run_at) : '—'}</td><td>${d.last_count ?? '—'}</td><td style="color:var(--red-500,#dc2626);font-size:.8rem;">${d.last_error || ''}</td></tr>`).join('');
  return `<div class="glass-card" style="padding:0;overflow:hidden;margin-bottom:16px;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="section-title">ดึงข้อมูลจาก ERP (อ่านอย่างเดียว · ทุกเช้า 05:00)</span>
      <span style="font-size:.8rem;color:var(--gray-500);">บัญชีที่ผูก ERP ${st.users_linked} · สินค้าที่ตรง ERP ${st.products_linked}</span>
      ${currentUser.role === 'Admin' ? `<button class="btn btn-ghost btn-sm" data-write onclick="admErpPullNow()" ${st.configured ? '' : 'disabled title="ยังไม่ได้ตั้งค่า URL/คีย์ ตามไฟล์อ่านก่อน"'}><i data-lucide="refresh-cw"></i> ดึงจาก ERP ตอนนี้</button>` : ''}
    </div>
    ${st.configured ? '' : '<div style="padding:10px 16px;font-size:.82rem;color:var(--amber-700,#b45309);">ยังไม่ได้ตั้งค่าตัวดึงข้อมูล (Edge Function + คีย์) ทำตามไฟล์ อ่านก่อน-ตั้งค่าดึงข้อมูลจากERP.md</div>'}
    <div class="table-wrap" style="border:none;border-radius:0;"><table><thead><tr><th>ชุดข้อมูล</th><th>ดึงล่าสุด</th><th>จำนวนแถวรอบล่าสุด</th><th>ข้อผิดพลาด</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:14px;">ยังไม่เคยดึง</td></tr>'}</tbody></table></div></div>`;
}
async function admErpPullNow() {
  try { await DB.adminErpSyncNowSupabase(); Toast.show('เริ่มดึงข้อมูลจาก ERP แล้ว ใช้เวลาประมาณ 1 นาที แล้วกดรีเฟรชแท็บนี้', 'success', 6000); }
  catch (e) { Toast.show('สั่งดึงไม่สำเร็จ: ' + (e.message || e), 'error', 5000); }
}

async function admRenderErpSync(body) {
  body.innerHTML = `<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>`;
  const [rows, pullCard] = await Promise.all([DB.listStockLogsErpSyncSupabase(admErpFilter), admErpPullCard()]);

  const badge = (s) => {
    const map = {
      'รอส่ง': 'badge-waiting',
      'ส่งสำเร็จ': 'badge-approved',
      'ส่งไม่สำเร็จ': 'badge-rejected',
      'ไม่ต้องส่ง': 'badge-waiting',
      'ต้องยกเลิกที่ ERP': 'badge-rejected'
    };
    return `<span class="badge ${map[s]||''}">${s}</span>`;
  };

  body.innerHTML = pullCard + `
  <div class="alert-box alert-warning" style="margin-bottom:16px;">
    <i data-lucide="info"></i>
    <span>ภาพรวมทุกบรรทัด — การนำส่งเข้า ERP ปกติทำในห้องตรวจ (ตรวจเบิกใช้ / ตรวจรับเข้า / ตรวจโอน) ปุ่ม "ส่งเข้า ERP" ที่นี่จะส่งทั้งใบที่บรรทัดนั้นอยู่</span>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;display:flex;justify-content:space-between;align-items:center;">
      <span class="section-title">รายการเบิกใช้/โอนสต็อกที่อนุมัติแล้ว (${rows.length} รายการ)</span>
      <select class="form-select" style="width:auto;" onchange="admErpFilter=this.value||null;admRenderErpSync(document.getElementById('adm-body'))">
        <option value="">ทุกสถานะ</option>
        <option value="รอส่ง" ${admErpFilter==='รอส่ง'?'selected':''}>รอส่ง</option>
        <option value="ส่งสำเร็จ" ${admErpFilter==='ส่งสำเร็จ'?'selected':''}>ส่งสำเร็จ</option>
        <option value="ส่งไม่สำเร็จ" ${admErpFilter==='ส่งไม่สำเร็จ'?'selected':''}>ส่งไม่สำเร็จ</option>
        <option value="ไม่ต้องส่ง" ${admErpFilter==='ไม่ต้องส่ง'?'selected':''}>ไม่ต้องส่ง</option>
        <option value="ต้องยกเลิกที่ ERP" ${admErpFilter==='ต้องยกเลิกที่ ERP'?'selected':''}>ต้องยกเลิกที่ ERP</option>
      </select>
    </div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table>
        <thead><tr><th>วันที่</th><th>ประเภท</th><th>สาขา</th><th>สินค้า</th><th>จำนวน</th><th>สถานะ ERP</th><th>เลขที่เอกสาร ERP</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => `
          <tr>
            <td>${formatDate(r.log_date)}</td>
            <td>${r.move_type === 'TRANSFER' ? 'โอนสาขา' : r.move_type === 'IN' ? 'รับเข้า' : 'เบิกใช้'}</td>
            <td>${r.branch_name||'-'}${r.to_branch_name?' → '+r.to_branch_name:''}</td>
            <td>${r.product_name||r.product_code||'-'}</td>
            <td>${r.qty||'-'}</td>
            <td>${badge(r.erp_sync_status)}${r.erp_sync_error?`<div style="font-size:0.72rem;color:var(--red-500,#dc2626);margin-top:2px;">${r.erp_sync_error}</div>`:''}</td>
            <td>${r.erp_ref||'—'}</td>
            <td class="nowrap">${['รอส่ง','ส่งไม่สำเร็จ'].includes(r.erp_sync_status)&&r.audit_status!=='ตีกลับ'?`<button class="btn btn-ghost btn-sm" data-write onclick="admSyncStockLog('${r.id}')">ส่งเข้า ERP</button> <button class="btn btn-ghost btn-sm" data-write title="บัญชีคีย์รายการนี้เข้า ERP ด้วยมือแล้ว" onclick="admMarkKeyedInErp('${r.id}','${r.request_id||''}')">คีย์เข้า ERP แล้ว</button>`:''}${r.audit_status==='อนุมัติแล้ว'&&!r.is_opd&&r.request_id?` <button class="btn btn-ghost btn-sm" data-write style="color:var(--red-500,#dc2626);" onclick="audStockRevertPrompt('${r.request_id}', ${rows.filter(x=>x.request_id===r.request_id).length}, ${r.erp_sync_status==='ส่งสำเร็จ'})">ถอยการอนุมัติ</button>`:''}</td>
          </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:20px;">ไม่มีรายการ</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
  lucide.createIcons();
}

// ช่วงที่ยังไม่มีซิงก์อัตโนมัติ: บัญชีคีย์ตามใน ERP แล้วมากดปิดรายการ (ทั้งใบ) พร้อมเลขเอกสาร ERP
// Called from both the admin ERP tab and the audit room tabs.
function admErpRefreshView() {
  if (document.getElementById('aud-approved-stock') && typeof audRender === 'function') audRender();
  else if (document.getElementById('adm-body')) admRenderErpSync(document.getElementById('adm-body'));
}
async function admMarkKeyedInErp(logId, requestId) {
  const rows = (await DB.listStockLogsErpSyncSupabase(null)).filter(r => (requestId ? r.request_id === requestId : r.id === logId) && ['รอส่ง', 'ส่งไม่สำเร็จ'].includes(r.erp_sync_status));
  if (!rows.length) { Toast.show('ไม่พบรายการที่รอส่ง (อาจปิดไปแล้ว)', 'warning'); admErpRefreshView(); return; }
  const ref = prompt(`เลขที่เอกสารใน ERP (เช่น RQ-20261014-01 / GR-... / TF-...)\nจะปิดรายการ ${rows.length} บรรทัดของใบนี้`);
  if (ref === null) return;
  if (!ref.trim()) { Toast.show('กรุณาใส่เลขที่เอกสาร ERP', 'error'); return; }
  try {
    for (const r of rows) await DB.setStockLogErpSyncResultSupabase(r.id, 'ส่งสำเร็จ', ref.trim(), null);
    Toast.show(`บันทึกแล้ว: ${rows.length} บรรทัด อ้างอิง ${ref.trim()}`, 'success');
  } catch (e) { Toast.show('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error', 5000); }
  admErpRefreshView();
}

async function admSyncStockLog(logId) {
  const rows = await DB.listStockLogsErpSyncSupabase(null);
  const row = rows.find(r => r.id === logId);
  if (!row) { Toast.show('ไม่พบรายการนี้ (อาจถูกอัปเดตไปแล้ว)', 'error'); admRenderErpSync(document.getElementById('adm-body')); return; }
  try {
    const res = await DB.erpPushSupabase(row.request_id || row.id, 'send');
    Toast.show('ส่งเข้า ERP สำเร็จ' + (res.erp_doc_no ? ' — ' + res.erp_doc_no : ''), 'success', 5000);
  } catch (e) { Toast.show('ERP ไม่รับใบนี้: ' + (e.message || e), 'error', 9000); }
  admRenderErpSync(document.getElementById('adm-body'));
}

// ── แท็บ แจ้งเตือน (คุณออม 28/10, SQL ไฟล์ 23) ─────────────────
// ห้อง / กลุ่ม (เพิ่มเอง) · เรื่องที่ส่ง (ติ๊กเลือกห้อง) · รูปแบบข้อความ (แก้เอง + ดูตัวอย่าง) · ข้อความล่าสุด
let ntfSub = 'rooms';
let ntfData = null;
let ntfDeleteId = null;
const ntfEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NTF_PROVIDER = { telegram: 'Telegram', line: 'LINE' };
const NTF_SECRET_HINT = { TG_BOT_TOKEN: 'บอท Commission' };
const ntfErr = e => (e && e.hint) || DB.stockErrorText(e);

async function admRenderNotify(body) {
  body.innerHTML = '<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  try {
    const [channels, rooms, queue, defaults] = await Promise.all([DB.adminNotifyChannelsSupabase(), DB.adminNotifyRoomsSupabase(),
      DB.adminNotifyQueueSupabase(100), DB.adminNotifyTemplateDefaultsSupabase(), loadAppSettings()]);
    ntfData = { channels, rooms, queue, defaults };
  } catch (e) {
    const missing = /admin_notify_(rooms|template_defaults)|function .* does not exist|Could not find the function/i.test((e && e.message) || '');
    body.innerHTML = `<div class="glass-card" style="max-width:720px;">
      <div class="section-header" style="margin-bottom:10px;"><span class="section-title">แจ้งเตือน LINE / Telegram — ${missing ? 'รออัปเดตฐานข้อมูล' : 'ยังไม่ได้เปิดใช้'}</span></div>
      <p style="margin:0;color:var(--ink-2);">${missing ? 'หน้านี้ต้องรัน SQL ไฟล์ 23 (ห้องแจ้งเตือน + รูปแบบข้อความ) ใน Supabase ก่อน' : 'โหลดข้อมูลไม่สำเร็จ: ' + ntfEsc(ntfErr(e))}</p>
    </div>`;
    lucide.createIcons(); return;
  }
  const subs = [['rooms', 'users', 'ห้อง / กลุ่ม'], ['topics', 'list-checks', 'เรื่องที่ส่ง'], ['templates', 'file-text', 'รูปแบบข้อความ'], ['queue', 'inbox', 'ข้อความล่าสุด']];
  body.innerHTML = `<div class="ntf-subtabs">${subs.map(([k, icon, label]) =>
    `<button class="btn btn-sm ${k === ntfSub ? 'btn-primary' : 'btn-ghost'}" data-view-ok data-ntf-sub="${k}" onclick="admNotifySub('${k}')"><i data-lucide="${icon}"></i> ${label}</button>`).join('')}</div>
    <div id="ntf-body"></div>`;
  admNotifySub(ntfSub);
}

function admNotifySub(sub) {
  ntfSub = sub;
  document.querySelectorAll('[data-ntf-sub]').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.ntfSub === sub); b.classList.toggle('btn-ghost', b.dataset.ntfSub !== sub);
  });
  const el = document.getElementById('ntf-body');
  if (!el || !ntfData) return;
  el.innerHTML = sub === 'topics' ? ntfTopicsHtml() : sub === 'templates' ? ntfTemplatesHtml() : sub === 'queue' ? ntfQueueHtml() : ntfRoomsHtml();
  if (sub === 'templates') NOTIFY_TPL_META.forEach(m => admNotifyTplPreview(m.kind));
  lucide.createIcons();
}
function ntfReload() { admRenderNotify(document.getElementById('adm-body')); }
const ntfTopicLabel = k => ((ntfData.channels.find(c => c.key === k) || {}).label) || k;

// ---------- ห้อง / กลุ่ม ----------
function ntfRoomsHtml() {
  const { rooms } = ntfData;
  return `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
    <span>ห้อง = กลุ่ม Telegram หรือ LINE ที่ให้บอทส่งข้อความเข้า เพิ่มได้ไม่จำกัด แล้วไปเลือกที่แท็บ <b>เรื่องที่ส่ง</b> ว่าเรื่องไหนส่งเข้าห้องไหน
    <br>เลขห้อง Telegram: เชิญบอทและ @getidsbot เข้ากลุ่ม แล้วดูเลขที่ขึ้นต้นด้วย -100 · LINE: group id ขึ้นต้นด้วย C
    <br>บอทที่ใช้ส่ง = ชื่อ Secret ที่เก็บ token ไว้ใน Supabase (บอท Commission = TG_BOT_TOKEN) — หน้านี้ไม่เก็บ token</span></div>
  <div style="margin-bottom:12px;"><button class="btn btn-primary btn-sm" onclick="admNotifyRoomForm()"><i data-lucide="plus"></i> เพิ่มห้อง</button></div>
  ${rooms.length ? `<div class="ntf-grid">${rooms.map(r => `
    <div class="glass-card ntf-card${r.is_active ? '' : ' ntf-off'}">
      <div class="ntf-card-head"><strong>${ntfEsc(r.name)}</strong>
        <span class="badge ${r.provider === 'line' ? 'badge-approved' : 'badge-waiting'}">${NTF_PROVIDER[r.provider] || r.provider}</span>
        ${r.is_active ? '' : '<span class="badge badge-rejected">ปิดอยู่</span>'}</div>
      <div class="ntf-kv"><span>เลขห้อง</span><code>${ntfEsc(r.target_id)}</code></div>
      <div class="ntf-kv"><span>บอทที่ใช้ส่ง</span><span><code>${ntfEsc(r.secret_name)}</code>${NTF_SECRET_HINT[r.secret_name] ? ' · ' + NTF_SECRET_HINT[r.secret_name] : ''}</span></div>
      <div class="ntf-kv"><span>ใช้กับเรื่อง</span><span>${r.channel_keys.length ? r.channel_keys.map(k => ntfEsc(ntfTopicLabel(k))).join('<br>') : '<span style="color:var(--gray-400);">ยังไม่ได้เลือก</span>'}</span></div>
      <div class="ntf-kv"><span>เดือนนี้</span><span>ส่งแล้ว ${r.sent_this_month} · รอส่ง ${r.pending} · <span style="color:${r.failed ? 'var(--red-500,#dc2626)' : 'inherit'}">ไม่สำเร็จ ${r.failed}</span></span></div>
      ${r.last_error ? `<div class="ntf-err">ข้อผิดพลาดล่าสุด: ${ntfEsc(r.last_error)}</div>` : ''}
      ${r.note ? `<div class="ntf-note">${ntfEsc(r.note)}</div>` : ''}
      <div class="ntf-actions">
        <button class="btn btn-ghost btn-sm" data-write onclick="admNotifyTestRoom('${r.id}')"><i data-lucide="send"></i> ทดสอบส่ง</button>
        <button class="btn btn-ghost btn-sm" onclick="admNotifyRoomForm('${r.id}')"><i data-lucide="pencil"></i> แก้ไข</button>
        <button class="btn btn-ghost btn-sm ntf-danger" onclick="admNotifyDeleteRoom('${r.id}')"><i data-lucide="trash-2"></i> ลบ</button>
      </div>
    </div>`).join('')}</div>`
    : '<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">ยังไม่มีห้อง — กด "เพิ่มห้อง" เพื่อเริ่ม (เช่น กลุ่มเทส)</div>'}`;
}

function admNotifyRoomForm(id) {
  const r = id ? ntfData.rooms.find(x => x.id === id) : { name: '', provider: 'telegram', target_id: '', secret_name: 'TG_BOT_TOKEN', note: '', is_active: true };
  if (!r) return;
  const secrets = [...new Set(['TG_BOT_TOKEN', ...ntfData.rooms.map(x => x.secret_name)])];
  openModal(`<div class="modal" style="max-width:520px;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="${id ? 'pencil' : 'plus'}"></i>${id ? 'แก้ไขห้อง' : 'เพิ่มห้อง'}</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">ชื่อห้อง (ตั้งเองให้จำง่าย)</label>
        <input class="form-input" id="ntf-r-name" value="${ntfEsc(r.name)}" placeholder="เช่น กลุ่มเทส, กลุ่มอัพเซลรายลูกค้า"></div>
      <div class="form-group"><label class="form-label">ช่องทาง</label>
        <select class="form-input" id="ntf-r-prov" onchange="admNotifyProvChange()">
          <option value="telegram"${r.provider === 'telegram' ? ' selected' : ''}>Telegram</option><option value="line"${r.provider === 'line' ? ' selected' : ''}>LINE</option></select></div>
      <div class="form-group"><label class="form-label">เลขห้อง</label>
        <input class="form-input" id="ntf-r-target" value="${ntfEsc(r.target_id)}" style="font-family:monospace;" placeholder="${r.provider === 'line' ? 'Cxxxxxxxx' : '-1001234567890'}"></div>
      <div class="form-group"><label class="form-label">บอทที่ใช้ส่ง (ชื่อ Secret ใน Supabase)</label>
        <input class="form-input" id="ntf-r-secret" value="${ntfEsc(r.secret_name)}" list="ntf-secrets" style="font-family:monospace;text-transform:uppercase;">
        <datalist id="ntf-secrets">${secrets.map(s => `<option value="${ntfEsc(s)}">${ntfEsc(NTF_SECRET_HINT[s] || '')}</option>`).join('')}</datalist>
        <small style="color:var(--gray-500);">บอท Commission = TG_BOT_TOKEN · บอทใหม่: ตั้ง Secret ชื่อใหม่ใน Supabase ก่อน แล้วพิมพ์ชื่อนั้นที่นี่</small></div>
      <div class="form-group"><label class="form-label">หมายเหตุ (ไม่บังคับ)</label>
        <input class="form-input" id="ntf-r-note" value="${ntfEsc(r.note || '')}" placeholder="เช่น ใช้ทดลองก่อนย้ายไปกลุ่มจริง"></div>
      <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="ntf-r-active"${r.is_active ? ' checked' : ''}> เปิดใช้ห้องนี้</label>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-primary" id="ntf-r-save" onclick="admNotifySaveRoom('${id || ''}')"><i data-lucide="save"></i> บันทึก</button></div></div>`);
  lucide.createIcons();
}
function admNotifyProvChange() {
  const prov = document.getElementById('ntf-r-prov').value, sec = document.getElementById('ntf-r-secret');
  document.getElementById('ntf-r-target').placeholder = prov === 'line' ? 'Cxxxxxxxx' : '-1001234567890';
  if (prov === 'line' && sec.value === 'TG_BOT_TOKEN') { sec.value = ''; sec.placeholder = 'เช่น LINE_TOKEN_STOCK'; }
  if (prov === 'telegram' && !sec.value) sec.value = 'TG_BOT_TOKEN';
}
async function admNotifySaveRoom(id) {
  const v = k => (document.getElementById('ntf-r-' + k)?.value || '').trim();
  const btn = document.getElementById('ntf-r-save');
  if (btn) btn.disabled = true;
  try {
    await DB.adminNotifySaveRoomSupabase({ id: id || null, name: v('name'), provider: v('prov'), target_id: v('target'), secret_name: v('secret').toUpperCase(),
      note: v('note'), is_active: !!document.getElementById('ntf-r-active')?.checked });
    closeModalDirect();
    Toast.show(id ? 'แก้ไขห้องแล้ว ✓' : 'เพิ่มห้องแล้ว ✓ ต่อไปเลือกที่แท็บ "เรื่องที่ส่ง"', 'success', 4000);
    ntfReload();
  } catch (e) { Toast.show('บันทึกไม่สำเร็จ: ' + ntfErr(e), 'error', 6000); if (btn) btn.disabled = false; }
}
function admNotifyDeleteRoom(id) {
  const r = ntfData.rooms.find(x => x.id === id);
  if (!r) return;
  ntfDeleteId = id;
  confirmDialog(`ลบห้อง "${ntfEsc(r.name)}"?<br><small>เรื่องที่เลือกห้องนี้ไว้จะไม่ส่งเข้าห้องนี้อีก · ข้อความที่ยังรอส่งเข้าห้องนี้จะถูกยกเลิก</small>`, () => admNotifyDeleteRoomNow());
}
async function admNotifyDeleteRoomNow() {
  try { await DB.adminNotifyDeleteRoomSupabase(ntfDeleteId); Toast.show('ลบห้องแล้ว', 'success'); ntfReload(); }
  catch (e) { Toast.show('ลบไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}
async function admNotifyTestRoom(id) {
  try { await DB.adminNotifyTestRoomSupabase(id); Toast.show('ใส่ข้อความทดสอบในคิวแล้ว จะเข้ากลุ่มภายใน 2 นาที', 'success', 5000); }
  catch (e) { Toast.show('ทดสอบไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}

// ---------- เรื่องที่ส่ง ----------
function ntfTopicsHtml() {
  const { channels, rooms } = ntfData;
  return `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
    <span>ติ๊กเลือกห้องที่จะให้ส่งแต่ละเรื่อง เลือกได้หลายห้อง (เช่น ช่วงทดลองส่งทั้งกลุ่มเทสและกลุ่มจริง) · ไม่เลือกห้อง = ไม่ส่ง · แก้แล้วกด <b>บันทึก</b> ของเรื่องนั้น
    <br>เวลาส่ง: ข้อความทันทีภายใน 2 นาที · สรุปรายคน = น้องกดยืนยันยอดเอง · สรุปสต็อก + สรุปสิ้นวัน 23:30</span></div>
  <div class="ntf-grid">${channels.map(c => `
    <div class="glass-card ntf-card${c.is_active ? '' : ' ntf-off'}">
      <div class="ntf-card-head"><strong>${ntfEsc(c.label)}</strong></div>
      <label class="ntf-switch"><input type="checkbox" id="ntf-t-on-${c.key}"${c.is_active ? ' checked' : ''}> เปิดใช้เรื่องนี้</label>
      <div class="ntf-room-list">${rooms.length ? rooms.map(r => `<label class="ntf-room-pick${r.is_active ? '' : ' ntf-off'}">
          <input type="checkbox" data-topic="${c.key}" value="${r.id}"${c.room_ids.includes(r.id) ? ' checked' : ''}>
          <span>${ntfEsc(r.name)} <small>${NTF_PROVIDER[r.provider] || ''}${r.is_active ? '' : ' · ปิดอยู่'}</small></span></label>`).join('')
        : '<span style="color:var(--gray-400);">ยังไม่มีห้อง — เพิ่มที่แท็บ "ห้อง / กลุ่ม"</span>'}</div>
      <div class="ntf-kv"><span>คิว</span><span>รอส่ง ${c.pending} · <span style="color:${c.failed ? 'var(--red-500,#dc2626)' : 'inherit'}">ไม่สำเร็จ ${c.failed}</span></span></div>
      <div class="ntf-actions">
        <button class="btn btn-primary btn-sm" onclick="admNotifySaveTopic('${c.key}')"><i data-lucide="save"></i> บันทึก</button>
        <button class="btn btn-ghost btn-sm" data-write onclick="admNotifyTest('${c.key}')"><i data-lucide="send"></i> ทดสอบส่ง</button>
      </div>
    </div>`).join('')}</div>
  <div class="glass-card" style="padding:14px 16px;margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-weight:700;color:var(--gray-700);">สร้างสรุปตอนนี้:</span>
    <input type="date" class="filter-input" id="ntf-build-date" value="${todayISO()}">
    <button class="btn btn-ghost btn-sm" data-write onclick="admNotifyBuild('stock_daily')">สรุปสต็อก</button>
    <button class="btn btn-ghost btn-sm" data-write onclick="admNotifyBuild('day_end')">สรุปสิ้นวัน (ตีกลับ / ยังไม่ยืนยันยอด)</button>
    <span style="font-size:.78rem;color:var(--gray-500);">สรุปวันเดียวกันสร้างซ้ำไม่ได้ (กันส่งซ้ำ)</span>
  </div>`;
}
async function admNotifySaveTopic(key) {
  const ids = [...document.querySelectorAll(`input[data-topic="${key}"]:checked`)].map(i => i.value);
  try {
    await DB.adminNotifySetTopicSupabase(key, ids, document.getElementById('ntf-t-on-' + key)?.checked);
    Toast.show(ids.length ? `บันทึกแล้ว ✓ ส่งเข้า ${ids.length} ห้อง` : 'บันทึกแล้ว — เรื่องนี้ยังไม่ส่งเข้าห้องไหน', ids.length ? 'success' : 'warning', 4000);
    ntfReload();
  } catch (e) { Toast.show('บันทึกไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}
async function admNotifyTest(key) {
  try {
    const id = await DB.adminNotifyTestSupabase(key);
    Toast.show(id ? 'ใส่ข้อความทดสอบในคิวแล้ว จะเข้าทุกห้องที่บันทึกไว้ภายใน 2 นาที' : 'เรื่องนี้ยังไม่ได้เลือกห้อง หรือปิดอยู่ — ติ๊กห้องแล้วกดบันทึกก่อน', id ? 'success' : 'warning', 5000);
  } catch (e) { Toast.show('ทดสอบไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}
async function admNotifyBuild(kind) {
  try {
    const n = await DB.adminNotifyBuildSupabase(kind, document.getElementById('ntf-build-date')?.value || null);
    Toast.show(n ? `สร้างสรุป ${n} ข้อความ เข้าคิวส่งแล้ว` : 'ไม่มีรายการในวันนั้น หรือสร้างไปแล้ว', n ? 'success' : 'warning', 4000);
  } catch (e) { Toast.show('สร้างสรุปไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}

// ---------- รูปแบบข้อความ ----------
const ntfTplDefault = kind => (ntfData && ntfData.defaults && ntfData.defaults[kind]) || NOTIFY_SHARE_DEFAULTS[kind] || '';
const ntfTplCurrent = kind => notifyTemplate(kind, ntfData && ntfData.defaults);
function ntfTemplatesHtml() {
  const own = appSettings.notify_templates || {};
  const card = m => {
    const text = ntfTplCurrent(m.kind);
    return `<div class="glass-card ntf-tpl">
      <div class="ntf-card-head"><strong>${ntfEsc(m.title)}</strong>${own[m.kind] ? '<span class="badge badge-waiting">แก้แล้ว</span>' : ''}</div>
      <div class="ntf-tpl-when">${ntfEsc(m.when)}${m.topic ? ' · เรื่อง: ' + ntfEsc(ntfTopicLabel(m.topic)) : ''}</div>
      <div class="ntf-tpl-cols">
        <div><label class="form-label">รูปแบบ</label>
          <textarea class="form-input ntf-tpl-text" id="ntf-tx-${m.kind}" rows="${Math.min(18, Math.max(4, text.split('\n').length + 1))}" oninput="admNotifyTplPreview('${m.kind}')">${ntfEsc(text)}</textarea>
          <div class="ntf-chips">${Object.keys(m.sample).map(k => `<button type="button" class="ntf-chip" onclick="admNotifyTplInsert('${m.kind}','${k}')">{${ntfEsc(k)}}</button>`).join('')}</div></div>
        <div><label class="form-label">ตัวอย่างข้อความที่จะส่ง</label><pre class="stock-share-preview" id="ntf-pv-${m.kind}"></pre></div>
      </div>
      <div class="ntf-actions">
        <button class="btn btn-primary btn-sm" onclick="admNotifyTplSave('${m.kind}')"><i data-lucide="save"></i> บันทึก</button>
        <button class="btn btn-ghost btn-sm" onclick="admNotifyTplReset('${m.kind}')"><i data-lucide="rotate-ccw"></i> ใช้รูปแบบเดิม</button>
      </div></div>`;
  };
  return `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
    <span>แก้ข้อความในกล่องซ้าย แล้วดูตัวอย่างทางขวาได้ทันที · กดปุ่ม <b>{ชื่อข้อมูล}</b> เพื่อแทรกตรงตำแหน่งเคอร์เซอร์ · ข้อความอื่น (หัวข้อ อีโมจิ) แสดงตามที่พิมพ์
    <br>บรรทัดแบบ "หัวข้อ: {ข้อมูล}" ถ้าไม่มีข้อมูล จะไม่แสดงบรรทัดนั้น · กด <b>บันทึก</b> แล้วข้อความต่อไปจะใช้รูปแบบใหม่ · กด "ใช้รูปแบบเดิม" แล้วบันทึก เพื่อกลับไปแบบเดิม</span></div>
  <h4 class="ntf-group-title">ข้อความบอท (ส่งเข้ากลุ่มอัตโนมัติ)</h4>
  ${NOTIFY_TPL_META.filter(m => m.group === 'bot').map(card).join('')}
  <h4 class="ntf-group-title">ปุ่มแชร์เข้ากลุ่ม LINE (พนักงานกดเองหลังบันทึก)</h4>
  ${NOTIFY_TPL_META.filter(m => m.group === 'share').map(card).join('')}`;
}
function admNotifyTplPreview(kind) {
  const m = NOTIFY_TPL_META.find(x => x.kind === kind), tx = document.getElementById('ntf-tx-' + kind), pv = document.getElementById('ntf-pv-' + kind);
  if (m && tx && pv) pv.textContent = notifyFill(tx.value, m.sample) || '(ข้อความว่าง — จะไม่ส่ง)';
}
function admNotifyTplInsert(kind, key) {
  const tx = document.getElementById('ntf-tx-' + kind);
  if (!tx) return;
  const s = tx.selectionStart ?? tx.value.length, e = tx.selectionEnd ?? s, ins = '{' + key + '}';
  tx.value = tx.value.slice(0, s) + ins + tx.value.slice(e);
  tx.focus(); tx.selectionStart = tx.selectionEnd = s + ins.length;
  admNotifyTplPreview(kind);
}
function admNotifyTplReset(kind) {
  const tx = document.getElementById('ntf-tx-' + kind);
  if (!tx) return;
  tx.value = ntfTplDefault(kind);
  admNotifyTplPreview(kind);
  Toast.show('ใส่รูปแบบเดิมในกล่องแล้ว — กดบันทึกเพื่อใช้', 'info', 4000);
}
async function admNotifyTplSave(kind) {
  const text = (document.getElementById('ntf-tx-' + kind)?.value || '').replace(/\r/g, '').trim();
  if (text.length > 2000) { Toast.show('รูปแบบยาวเกิน 2,000 ตัวอักษร', 'error'); return; }
  const all = { ...(appSettings.notify_templates || {}) };
  if (!text || text === ntfTplDefault(kind).trim()) delete all[kind]; else all[kind] = text;
  try {
    await DB.saveAppSettingSupabase('notify_templates', all);
    appSettings.notify_templates = all;
    Toast.show(all[kind] ? 'บันทึกรูปแบบแล้ว ✓ ข้อความต่อไปใช้รูปแบบนี้' : 'กลับไปใช้รูปแบบเดิมแล้ว ✓', 'success', 4000);
    admNotifySub('templates');
  } catch (e) { Toast.show('บันทึกไม่สำเร็จ: ' + ntfErr(e), 'error', 5000); }
}

// ---------- ข้อความล่าสุด ----------
function ntfQueueHtml() {
  const { queue } = ntfData;
  const badge = s => `<span class="badge ${{ 'ส่งแล้ว': 'badge-approved', 'รอส่ง': 'badge-waiting', 'ส่งไม่สำเร็จ': 'badge-rejected', 'ข้าม': 'badge-waiting' }[s] || ''}">${ntfEsc(s)}</span>`;
  return `<div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;display:flex;justify-content:space-between;align-items:center;">
      <span class="section-title">ข้อความล่าสุด (${queue.length})</span>
      <button class="btn btn-ghost btn-sm" data-view-ok onclick="ntfReload()"><i data-lucide="refresh-cw"></i> รีเฟรช</button></div>
    <div class="table-wrap" style="border:none;border-radius:0;"><table>
      <thead><tr><th>เวลา</th><th>ห้อง</th><th>ประเภท</th><th>ข้อความ</th><th>สถานะ</th><th>ครั้งที่</th><th>ข้อผิดพลาด</th></tr></thead>
      <tbody>${queue.length ? queue.map(q => `<tr>
        <td class="nowrap">${formatDateTime(q.created_at)}</td><td>${ntfEsc(q.room_name || q.channel_key)}</td><td>${ntfEsc(q.kind)}</td>
        <td style="max-width:360px;font-size:.8rem;white-space:pre-wrap;">${ntfEsc(q.preview)}</td>
        <td>${badge(q.status)}</td><td>${q.attempts}</td><td style="font-size:.78rem;color:var(--red-500,#dc2626);">${ntfEsc(q.last_error || '')}</td>
      </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:18px;">ยังไม่มีข้อความ</td></tr>'}</tbody></table></div>
  </div>`;
}

