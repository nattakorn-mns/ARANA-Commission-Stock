let auditTab = 'commission';
let auditPage = 1;
function audCanAccessCommission() { return ['Admin', 'CommissionAudit'].includes(currentUser.role); }
function audCanAccessDeposits() { return ['Admin', 'Audit', 'CommissionAudit'].includes(currentUser.role); }
function audCanAccessStock() { return ['Admin', 'Audit', 'StockAudit'].includes(currentUser.role); }
function renderAudit(container) {
  const canCommission = audCanAccessCommission(), canDeposits = audCanAccessDeposits(), canStock = audCanAccessStock();
  auditTab = canCommission ? 'commission' : 'stock-opd'; auditPage = 1;
  container.innerHTML = `<div><div class="tab-bar">
    ${canCommission ? `<button class="tab-btn ${auditTab==='commission'?'active':''}" id="aud-tab-commission" onclick="audSwitch('commission')"><i data-lucide="badge-dollar-sign"></i>อนุมัติค่ามือ/คอมมิชชั่น</button>` : ''}
    ${canDeposits ? `<button class="tab-btn" id="aud-tab-deposits" onclick="audSwitch('deposits')"><i data-lucide="wallet-cards"></i>ตรวจยอดมัดจำ</button>` : ''}
    ${canDeposits ? `<button class="tab-btn" id="aud-tab-chat" onclick="audSwitch('chat')"><i data-lucide="message-circle"></i>ลูกค้าจากแชท</button>` : ''}
    ${canStock ? AUD_STOCK_TABS.map(t => `<button class="tab-btn ${auditTab===t.tab?'active':''}" id="aud-tab-${t.tab}" onclick="audSwitch('${t.tab}')"><i data-lucide="${t.icon}"></i>${t.label}<span class="badge badge-pending" id="aud-count-${t.kind}" style="display:none;margin-left:6px;padding:1px 8px;"></span></button>`).join('') : ''}
    ${audCanAccessEditRequests() ? `<button class="tab-btn" id="aud-tab-edits" onclick="audSwitch('edits')"><i data-lucide="file-pen-line"></i>คำขอแก้ไขบิล</button>` : ''}
    ${['Admin','Audit'].includes(currentUser.role) ? `<button class="tab-btn" id="aud-tab-compare" onclick="audSwitch('compare')"><i data-lucide="git-compare"></i>เทียบเบิกระบบ ARANA</button><button class="tab-btn" id="aud-tab-log" onclick="audSwitch('log')"><i data-lucide="clock"></i>ประวัติการอนุมัติ</button>` : ''}
    <button class="tab-btn" id="aud-tab-drafts" onclick="audSwitch('drafts')"><i data-lucide="file-clock"></i>แบบร่างค้าง</button>
    ${canStock ? `<button class="tab-btn" id="aud-tab-resync" onclick="audSwitch('resync')"><i data-lucide="refresh-ccw"></i>ตั้งยอดตาม ERP</button>` : ''}
  </div><div id="aud-body"></div></div>`;
  audRender(); lucide.createIcons();
  if (canStock) audRefreshStockCounts();
}
function audSwitch(tab) {
  if (tab === 'stock') tab = 'stock-opd';
  if (tab === 'commission' && !audCanAccessCommission()) return;
  if ((tab === 'deposits' || tab === 'chat') && !audCanAccessDeposits()) return;
  if (tab.startsWith('stock-') && !audCanAccessStock()) return;
  if (tab === 'edits' && !audCanAccessEditRequests()) return;
  if (tab === 'resync' && !audCanAccessStock()) return;
  auditTab = tab; auditPage = 1;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`aud-tab-${tab}`); if (el) el.classList.add('active'); audRender();
}
function audRender() {
  const body = document.getElementById('aud-body'); if (!body) return;
  body.dataset.stockKind = auditTab.startsWith('stock-') ? auditTab.slice(6) : '';
  if (auditTab === 'commission') audRenderOPD(body);
  else if (auditTab === 'deposits') audRenderDeposits(body);
  else if (auditTab === 'chat') audRenderChatVisits(body);
  else if (auditTab.startsWith('stock-')) audRenderStock(body, auditTab.slice(6));
  else if (auditTab === 'edits') audRenderEditRequests(body);
  else if (auditTab === 'compare') audRenderCompare(body);
  else if (auditTab === 'resync') rsyRender(body);
  else if (auditTab === 'drafts') draftsRenderAudit(body); else audRenderLog(body);
}
// ── TAB 1: Commission Audit ─────────────────────────────────────
async function audRenderOPD(body) {
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>`;
  const bills = await DB.getPendingBillsSupabase();

  body.innerHTML = `
  <div class="glass-card" style="margin-bottom:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <span style="font-size:0.84rem;color:var(--gray-600);">รอตรวจสอบ</span>
    <span class="badge badge-pending" style="font-size:1rem;padding:4px 14px;">${bills.length} บิล</span>
    <div style="width:100%; margin-top:4px;">
      <input type="text" class="filter-input" id="aud-search" placeholder="ค้นหา HN / ชื่อ..." oninput="audFilterOPD(this.value)" style="width:100%; max-width:300px;" />
    </div>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>HN</th>
            <th>ชื่อลูกค้า</th>
            <th>สาขา</th>
            <th>ผู้บันทึก</th>
            <th>สถานะ</th>
            <th style="text-align:center;">จัดการ</th>
          </tr>
        </thead>
        <tbody id="aud-opd-tbody">
          ${bills.length ? bills.map(b => audOPDRow(b)).join('') : `
          <tr><td colspan="7"><div class="empty-state" style="padding:24px;"><i data-lucide="check-circle"></i><h4>ไม่มีบิลรอตรวจสอบ</h4></div></td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
  window._auditPendingBills = bills;
  lucide.createIcons();
}

function audOPDRow(b) {
  return `<tr id="aud-row-${b.id}" class="clickable" onclick="audOpenBill('${b.id}')">
    <td class="nowrap">${formatDate(b.date)}</td>
    <td><code style="font-size:0.75rem;background:var(--gray-100);padding:2px 5px;border-radius:4px;">${b.hn||'-'}</code></td>
    <td style="font-weight:600;">${b.customerName||'-'}</td>
    <td>${b.branch||'-'}</td>
    <td style="font-size:0.8rem;">
      <div style="display:flex;align-items:center;gap:4px;">
        <i data-lucide="user" style="width:14px;height:14px;color:var(--gray-400);"></i>
        <span>${b.createdByName||'-'}</span>
      </div>
    </td>
    <td id="aud-status-${b.id}">${statusBadge(b.status)}</td>
    <td style="text-align:center;" onclick="event.stopPropagation();">
      <button class="btn btn-primary btn-sm" data-view-ok onclick="audOpenBill('${b.id}')"><i data-lucide="search"></i> ตรวจสอบ</button>
    </td>
  </tr>`;
}

function audFilterOPD(q) {
  const tbody = document.getElementById('aud-opd-tbody');
  if (!tbody) return;
  let bills = window._auditPendingBills || [];
  if (q) bills = bills.filter(b => b.hn?.toLowerCase().includes(q.toLowerCase()) || b.customerName?.toLowerCase().includes(q.toLowerCase()));
  tbody.innerHTML = bills.length ? bills.map(b => audOPDRow(b)).join('') :
    `<tr><td colspan="7"><div class="empty-state" style="padding:20px;"><i data-lucide="search"></i><h4>ไม่พบ</h4></div></td></tr>`;
  lucide.createIcons();
}

async function audQuickAction(billId, status, note) {
  try {
    await DB.auditBillSupabase(billId, status, currentUser.id, note || '');
    const row = document.getElementById(`aud-row-${billId}`);
    const statusEl = document.getElementById(`aud-status-${billId}`);
    if (statusEl) statusEl.innerHTML = statusBadge(status);
    if (row) { row.style.opacity = '0.5'; setTimeout(() => row.remove(), 400); }
    Toast.show(`${status === 'อนุมัติแล้ว' ? '✅ อนุมัติ' : '❌ ตีกลับ'}บิลเรียบร้อย`, status === 'อนุมัติแล้ว' ? 'success' : 'error');
    closeModalDirect();
    audRender();
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

function audQuickReject(billId) {
  openModal(`
  <div class="modal">
    <div class="modal-header">
      <h3 class="modal-title"><i data-lucide="x-circle"></i>ตีกลับบิล</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">เหตุผลที่ตีกลับ <span class="required">*</span></label>
        <textarea id="aud-reject-note" class="form-textarea" rows="4" placeholder="ระบุสิ่งที่ต้องแก้ไข..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-danger" onclick="audDoReject('${billId}')"><i data-lucide="x-circle"></i> ตีกลับ</button>
    </div>
  </div>`);
}

function audDoReject(billId) {
  const note = document.getElementById('aud-reject-note')?.value.trim();
  if (!note) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  closeModalDirect();
  audQuickAction(billId, 'ตีกลับ', note);
}

async function audOpenBill(billId) {
  const detail = await DB.getBillDetailSupabase(billId);
  if (!detail || !detail.bill) { Toast.show('ไม่พบข้อมูลบิลนี้', 'error'); return; }

  const bill = detail.bill;
  const images = detail.images || [];
  const services = detail.services || [];
  const sales = detail.sales || [];
  const supplies = detail.supplies || [];

  let imgIdx = 0;
  const imgSrc = images.length ? images[imgIdx]?.file_url || '' : '';

  openModal(`
  <div class="modal" style="width:1400px; max-width:98vw; height:90vh; max-height:900px; display:flex; flex-direction:column; border-radius:var(--radius-lg); box-shadow:var(--shadow-xl);">
    <div class="modal-header" style="flex-shrink:0; background:var(--white); border-bottom:1px solid var(--gray-200); z-index:10;">
      <h3 class="modal-title"><i data-lucide="file-text"></i>${bill.hn||''} — ${bill.customer_name}</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div style="flex:1; overflow:hidden; display:flex; flex-wrap:wrap; background:var(--gray-100);">
      <!-- Left: Image -->
      <div class="split-left" style="flex:1;min-width:300px;display:flex;flex-direction:column;border-right:1px solid var(--gray-200);">
        ${images.length ? `
        <div class="split-img-wrap" id="audImgWrap" style="flex:1;position:relative;background:#111;cursor:grab;min-height:0;width:100%;">
          <img id="aud-img" src="${imgSrc}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;transform-origin:center center;transition:transform 0.1s ease-out;pointer-events:none;" draggable="false" />
        </div>
        <div class="split-img-controls" style="display:flex;align-items:center;padding:8px 12px;background:var(--gray-900);gap:8px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(-0.2)"><i data-lucide="zoom-out"></i></button>
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(0.2)"><i data-lucide="zoom-in"></i></button>
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(0,'reset')"><i data-lucide="maximize-2"></i></button>
          <span class="split-img-counter" id="aud-img-counter" style="color:white;font-size:0.8rem;margin-left:8px;">${images.length > 1 ? `1/${images.length}` : ''}</span>
          <div style="margin-left:auto;display:flex;gap:6px;">
            ${images.length > 1 ? `
            <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audNavImg(-1,${images.length})"><i data-lucide="chevron-left"></i></button>
            <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audNavImg(1,${images.length})"><i data-lucide="chevron-right"></i></button>` : ''}
          </div>
        </div>
        </div>` : `
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--gray-400);flex-direction:column;gap:12px;background:var(--gray-50);">
          <i data-lucide="image-off" style="width:48px;height:48px;"></i><p>ไม่มีภาพ OPD</p>
        </div>`}
      </div>
      <!-- Right: Data -->
      <div class="split-right" style="flex:1;min-width:320px;display:flex;flex-direction:column;background:var(--white);">
        <div class="split-right-body" style="flex:1;overflow-y:auto;padding:20px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;background:var(--gray-50);padding:12px;border-radius:var(--radius-md);border:1px solid var(--gray-100);">
            <div><div style="font-size:0.75rem;color:var(--gray-500);">HN</div><div style="font-weight:700;">${bill.hn||'-'}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">วันที่</div><div style="font-weight:600;">${formatDate(bill.bill_date)}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">ลูกค้า</div><div style="font-weight:700;">${bill.customer_name}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">สาขา</div><div style="font-weight:600;">${bill.branch_name}</div></div>
            <div style="grid-column:span 2;">
              <div style="font-size:0.75rem;color:var(--gray-500);">ผู้บันทึก</div>
              <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
                <i data-lucide="user" style="width:16px;height:16px;color:var(--burgundy-500);"></i>
                ${bill.created_by_name||'-'}
              </div>
            </div>
          </div>

          ${services.length ? `
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">ค่ามือ</span></div>
          ${services.map(s => `
          <div class="audit-item" style="padding:10px;border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--white);">
            <div style="font-weight:600;margin-bottom:4px;font-size:1.1rem;color:var(--burgundy-800);">${s.program_name||s.program_code||'-'}</div>
            <div style="font-size:0.82rem;color:var(--gray-600);display:flex;justify-content:space-between;">
              <span>ราคา ฿${formatCurrency(s.price)}</span>
              <span style="font-weight:700;color:var(--burgundy-700);">ค่ามือ ฿${formatCurrency(s.commission)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--gray-500);margin-top:4px;">ผู้บันทึก/ผู้รับสิทธิ์: ${s.created_by_name||bill.created_by_name||'-'}</div>
          </div>`).join('')}` : ''}

          ${sales.length ? `
          <div class="section-header" style="margin:16px 0 10px;"><span class="section-title">ค่าคอมมิชชั่น</span></div>
          ${sales.map(s => `
          <div class="audit-item" style="padding:10px;border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--white);">
            <div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              ${typeBadge(s.sale_type)}
              <span style="font-weight:600;">${s.new_program_name||'-'}</span>
            </div>
            ${s.old_program_name ? `<div style="font-size:0.78rem;color:var(--gray-500);margin-bottom:6px;padding:6px;background:var(--gray-50);border-radius:4px;">
              โปรแกรมเดิม: <strong>${s.old_program_name}</strong>
            </div>` : ''}
            <div style="font-size:0.82rem;color:var(--gray-600);display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>ยอดชำระ: ฿${formatCurrency(s.amount_paid)}</span>
              <span style="font-weight:700;color:var(--burgundy-700);">คอม: ฿${formatCurrency(s.commission_amt)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--gray-500);">ผู้บันทึก/ผู้รับสิทธิ์: ${s.created_by_name||bill.created_by_name||'-'}</div>
          </div>`).join('')}` : ''}


        </div>
        <div class="split-right-footer" style="padding:16px;border-top:1px solid var(--gray-200);display:flex;gap:12px;background:var(--white);">
          <button class="btn btn-danger" style="flex:1;padding:12px;" onclick="audQuickReject('${billId}')">
            <i data-lucide="x-circle"></i> ตีกลับ
          </button>
          <button id="aud-approve-btn" class="btn btn-success" style="flex:1;padding:12px;" onclick="audQuickAction('${billId}','อนุมัติแล้ว')">
            <i data-lucide="check-circle"></i> อนุมัติ
          </button>
        </div>
      </div>
    </div>
  </div>`);

  document.querySelector('.modal-overlay').onclick = null;
  window._audImages = images.map(im => ({ data: im.file_url }));
  window._audImgIdx = 0;
  window._audScale = 1;
  window._audPanX = 0;
  window._audPanY = 0;
  lucide.createIcons();

  setTimeout(() => {
    const wrap = document.getElementById('audImgWrap');
    if (!wrap) return;
    let isDown = false;
    let startX, startY;
    wrap.addEventListener('mousedown', (e) => {
      isDown = true;
      wrap.style.cursor = 'grabbing';
      startX = e.pageX - window._audPanX;
      startY = e.pageY - window._audPanY;
    });
    wrap.addEventListener('mouseleave', () => { isDown = false; wrap.style.cursor = 'grab'; });
    wrap.addEventListener('mouseup', () => { isDown = false; wrap.style.cursor = 'grab'; });
    wrap.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      window._audPanX = e.pageX - startX;
      window._audPanY = e.pageY - startY;
      audUpdateTransform();
    });
  }, 100);
}

function audUpdateTransform() {
  const img = document.getElementById('aud-img');
  if (img) {
    img.style.transform = `translate(${window._audPanX}px, ${window._audPanY}px) scale(${window._audScale})`;
  }
}

function audZoom(delta, mode) {
  if (mode === 'reset') { 
    window._audScale = 1; window._audPanX = 0; window._audPanY = 0; 
  } else { 
    window._audScale = Math.max(0.5, Math.min(4, window._audScale + delta)); 
  }
  audUpdateTransform();
}

function audNavImg(dir, total) {
  window._audImgIdx = (window._audImgIdx + dir + total) % total;
  const img = document.getElementById('aud-img');
  const ctr = document.getElementById('aud-img-counter');
  if (img && window._audImages) img.src = window._audImages[window._audImgIdx]?.data || '';
  if (ctr) ctr.textContent = `${window._audImgIdx+1}/${total}`;
  window._audScale = 1; window._audPanX = 0; window._audPanY = 0;
  audUpdateTransform();
}

// ── คำขอแก้ไขบิล (ข้อ 29): พนักงานแก้แล้วมีผลทันที → คุณออมอนุมัติ / ไม่อนุมัติ = คืนข้อมูลเดิม ──
function audCanAccessEditRequests() { return ['Admin', 'Audit', 'CommissionAudit', 'StockAudit'].includes(currentUser.role); }
function audCanDecideEdits() { return ['Admin', 'CommissionAudit'].includes(currentUser.role); }
let audEditRequests = [];
let audEditFilter = 'รออนุมัติ';
let audEditsNewFlow = true;

async function audRenderEditRequests(body) {
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  try {
    audEditRequests = await DB.listBillEditsSupabase(audEditFilter || null);
    audEditsNewFlow = true;
  } catch (e) {
    if (!(e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || '')))) {
      body.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>โหลดคำขอแก้ไขไม่สำเร็จ</h4><p>${DB.stockErrorText(e)}</p></div>`;
      lucide.createIcons(); return;
    }
    // ยังไม่ได้ติดตั้ง SQL ไฟล์ 18 → รายการคำขอแบบเดิม
    audEditsNewFlow = false;
    try { audEditRequests = await DB.listBillEditRequestsSupabase(audEditFilter || null); }
    catch (e2) { body.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>โหลดคำขอแก้ไขไม่สำเร็จ</h4><p>${DB.stockErrorText(e2)}</p></div>`; lucide.createIcons(); return; }
  }
  const esc = v => String(v ?? '-').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const who = r => esc(r.requested_by_nickname ? `${r.requested_by_name} (${r.requested_by_nickname})` : r.requested_by_name);
  const parts = r => [r.edit_commission ? 'ค่ามือ/ค่าคอม' : '', r.edit_supplies ? 'รายการเบิก' : ''].filter(Boolean).join(', ') || 'เพิ่มรูป';
  const canDecide = audCanDecideEdits();
  body.innerHTML = `<div class="glass-card" style="margin-bottom:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-weight:700;color:var(--gray-700);">การแก้ไขบิลรออนุมัติ</span>
      <span style="font-size:.8rem;color:var(--gray-500);">พนักงานแก้แล้ว ข้อมูลใหม่มีผลทันที · อนุมัติ = ใช้ข้อมูลใหม่ต่อ · ไม่อนุมัติ = ระบบคืนข้อมูลเดิมให้</span>
      <select class="filter-select" style="margin-left:auto;width:auto;" onchange="audEditFilter=this.value;audRenderEditRequests(document.getElementById('aud-body'))">
        ${['รออนุมัติ', 'อนุมัติแล้ว', 'ไม่อนุมัติ', ''].map(s => `<option value="${s}" ${s === audEditFilter ? 'selected' : ''}>${s || 'ทั้งหมด'}</option>`).join('')}
      </select></div>
    <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap"><table><thead><tr><th>วันที่แก้</th><th>บิล</th><th>สาขา</th><th>ผู้แก้</th><th>ส่วนที่แก้</th><th>เหตุผล</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${audEditRequests.length ? audEditRequests.map(r => `<tr>
      <td class="nowrap">${formatDate(r.created_at)}</td>
      <td><strong>${esc(r.hn)}</strong> — ${esc(r.customer_name)}<br><small>${formatDate(r.bill_date)}</small></td>
      <td>${esc(r.branch_name)}</td><td>${who(r)}</td><td>${audEditsNewFlow ? parts(r) : '-'}</td>
      <td style="max-width:260px;font-size:.82rem;">${esc(r.reason)}${r.decision_note ? `<br><small style="color:var(--gray-500);">ผล: ${esc(r.decision_note)}</small>` : ''}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="nowrap">${audEditsNewFlow && r.old_payload
          ? `<button class="btn btn-ghost btn-sm" data-view-ok onclick="audShowEditDiff('${r.id}')"><i data-lucide="git-compare"></i> ก่อน/หลัง</button>`
          : `<button class="btn btn-ghost btn-sm" data-view-ok onclick="audViewEditRequestBill('${r.bill_id}')"><i data-lucide="eye"></i></button>`}
        ${r.status === 'รออนุมัติ' && (canDecide || !audEditsNewFlow) ? `<button class="btn btn-success btn-sm" onclick="audDecideEdit('${r.id}', true)">อนุมัติ</button> <button class="btn btn-danger btn-sm" onclick="audPromptDeclineEdit('${r.id}')">ไม่อนุมัติ</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="8"><div class="empty-state">ไม่มีรายการ</div></td></tr>'}
    </tbody></table></div></div>`;
  lucide.createIcons();
}

function audViewEditRequestBill(billId) {
  if (audCanAccessCommission()) audOpenBill(billId); else audOpenStockRequest(billId);
}

// ก่อน/หลัง: เทียบทีละบรรทัด แถวที่เปลี่ยนไฮไลต์
function audShowEditDiff(requestId) {
  const r = audEditRequests.find(x => x.id === requestId);
  if (!r) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const o = r.old_payload || {}, n = r.new_payload || {};
  const money = v => v == null || v === '' ? '-' : '฿' + formatCurrency(Number(v) || 0);
  const svc = s => `${esc(s.program_name || s.program_code)} · ราคา ${money(s.price)} · ค่ามือ ${money(s.commission)}`;
  const sale = s => `${esc(s.type === 'upsell' ? 'อัพเซลส์' : s.type === 'product' ? 'ขายสินค้า' : 'ขายเพิ่ม')}: ${esc(s.new_program)} ${money(s.new_price)} · ชำระ ${money(s.amount_paid)} · ${Number(s.commission_pct) || 0}% = ${money(s.commission_amt)}`;
  const sup = s => `${esc(s.product_name || s.product_code)} × ${Number(s.qty) || 0}`;
  const block = (title, a, b, fmt) => {
    const left = (a || []).map(fmt), right = (b || []).map(fmt);
    if (!left.length && !right.length) return '';
    const rows = Math.max(left.length, right.length);
    let html = `<tr><th colspan="2" style="text-align:left !important;background:var(--gray-50);">${title}</th></tr>`;
    for (let i = 0; i < rows; i++) {
      const changed = left[i] !== right[i];
      html += `<tr${changed ? ' class="aud-diff-changed"' : ''}><td class="col-text">${left[i] || '<span style="color:var(--gray-400);">—</span>'}</td><td class="col-text">${right[i] || '<span style="color:var(--gray-400);">ลบออก</span>'}</td></tr>`;
    }
    return html;
  };
  const head = (label, a, b) => a === b ? '' : `<tr class="aud-diff-changed"><td class="col-text">${label}: ${esc(a || '-')}</td><td class="col-text">${label}: ${esc(b || '-')}</td></tr>`;
  const headRows = head('HN', o.hn, n.hn) + head('ชื่อลูกค้า', o.customer_name, n.customer_name) + head('วันที่', String(o.date || '').slice(0, 10), String(n.date || '').slice(0, 10)) + head('ลูกค้ามาจาก', o.customer_source, n.customer_source);
  openModal(`<div class="modal" style="max-width:860px;width:95%;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="git-compare"></i>ก่อน / หลังแก้ไข — ${esc(r.hn)} ${esc(r.customer_name)}</h3>
    <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <p style="margin:0 0 10px;font-size:.85rem;"><b>เหตุผล:</b> ${esc(r.reason)} · <b>ผู้แก้:</b> ${esc(r.requested_by_name)} · ${formatDate(r.created_at)}</p>
      <div class="table-wrap"><table class="aud-diff"><thead><tr><th>ก่อนแก้</th><th>หลังแก้ (ใช้อยู่ตอนนี้)</th></tr></thead><tbody>
        ${headRows}
        ${block('ค่ามือ', o.services, n.services, svc)}
        ${block('อัพเซลส์ / ขายเพิ่ม / ขายสินค้า', o.sales, n.sales, sale)}
        ${block('รายการเบิก', o.supplies, n.supplies, sup)}
      </tbody></table></div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px;" data-view-ok onclick="closeModalDirect();audViewEditRequestBill('${r.bill_id}')"><i data-lucide="eye"></i> เปิดบิลเต็ม</button>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ปิด</button>
      ${r.status === 'รออนุมัติ' && audCanDecideEdits() ? `<button class="btn btn-danger" onclick="audPromptDeclineEdit('${r.id}')">ไม่อนุมัติ (คืนข้อมูลเดิม)</button><button class="btn btn-success" onclick="audDecideEdit('${r.id}', true)">อนุมัติ</button>` : ''}</div></div>`, { width: '880px' });
}

async function audDecideEdit(requestId, approve, note) {
  try {
    if (audEditsNewFlow) await DB.decideBillEditSupabase(requestId, approve, note || null);
    else await DB.decideBillEditRequestSupabase(requestId, approve, note || null);
    closeModalDirect();
    Toast.show(audEditsNewFlow
      ? (approve ? 'อนุมัติการแก้ไขแล้ว ✓' : 'ไม่อนุมัติแล้ว — คืนข้อมูลเดิมให้แล้ว')
      : (approve ? 'อนุมัติคำขอแก้ไขแล้ว — พนักงานแก้บิลได้' : 'ไม่อนุมัติคำขอแก้ไขแล้ว'), approve ? 'success' : 'error');
    audRenderEditRequests(document.getElementById('aud-body'));
  } catch (e) { Toast.show('ทำรายการไม่สำเร็จ: ' + DB.stockErrorText(e), 'error', 5000); }
}

function audPromptDeclineEdit(requestId) {
  openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ไม่อนุมัติคำขอแก้ไข</h3></div><div class="modal-body"><label class="form-label">เหตุผล <span class="required">*</span></label><textarea id="aud-edit-decline-note" class="form-textarea" rows="3"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoDeclineEdit('${requestId}')">ยืนยันไม่อนุมัติ</button></div></div>`);
}

function audDoDeclineEdit(requestId) {
  const note = document.getElementById('aud-edit-decline-note')?.value.trim();
  if (!note) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  audDecideEdit(requestId, false, note);
}

async function audRenderDeposits(body) {
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลดยอดมัดจำ...</div>`;
  const rows = await DB.getPendingDepositsSupabase();
  body.innerHTML = `
  <div class="glass-card" style="margin-bottom:12px;padding:14px 16px;">
    <span style="font-size:0.84rem;color:var(--gray-600);">รอตรวจว่าเงินเข้าจริง</span>
    <span class="badge badge-pending" style="margin-left:8px;">${rows.length} รายการ</span>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap"><table>
    <thead><tr><th>วันที่</th><th>สาขา</th><th>ลูกค้า</th><th>โปรแกรม</th><th class="num">ยอดมัดจำ</th><th class="num">ค่าคอม</th><th>ผู้ปิดยอด</th><th>หลักฐาน</th><th>จัดการ</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr id="dep-audit-row-${r.id}">
      <td>${formatDate(r.deposit_date)}</td><td>${r.branch_name||'-'}</td><td><strong>${r.customer_name||'-'}</strong><br><small>${r.customer_phone||''}</small></td>
      <td>${r.program_name||'-'}</td><td class="num">฿${formatCurrency(r.deposit_amount||0)}</td><td class="num">฿${formatCurrency(r.commission_amt||0)}</td>
      <td>${r.created_by_name||'-'}</td><td><button class="btn btn-ghost btn-sm" onclick="audOpenDeposit('${r.id}')">ดูหลักฐาน</button></td>
      <td><button class="btn btn-success btn-sm" onclick="audDepositAction('${r.id}','ยืนยันแล้ว')">ยืนยันเงินเข้า</button> <button class="btn btn-danger btn-sm" onclick="audRejectDeposit('${r.id}')">ตีกลับ</button></td>
    </tr>`).join('') : `<tr><td colspan="9"><div class="empty-state" style="padding:24px;"><i data-lucide="check-circle"></i><h4>ไม่มียอดมัดจำรอตรวจ</h4></div></td></tr>`}</tbody>
  </table></div></div>`;
  lucide.createIcons();
}

async function audOpenDeposit(depositId) {
  try {
    const detail = await DB.getDepositDetailSupabase(depositId);
    const d = detail?.deposit, images = detail?.images || [];
    if (!d) { Toast.show('ไม่พบข้อมูลยอดมัดจำ', 'error'); return; }
    openModal(`<div class="modal" style="width:1100px;max-width:96vw;">
      <div class="modal-header"><h3 class="modal-title"><i data-lucide="wallet-cards"></i>ตรวจยอดมัดจำ — ${d.customer_name}</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div>
      <div class="modal-body" style="display:flex;flex-wrap:wrap;gap:16px;">
        <div style="background:#111;padding:8px;max-height:62vh;overflow:auto;flex:1 1 300px;">${images.length ? images.map(im=>`<img src="${im.file_url}" alt="หลักฐาน" style="width:100%;margin-bottom:10px;" />`).join('') : '<p style="color:white;padding:20px;">ไม่มีหลักฐาน</p>'}</div>
        <div style="flex:1 1 320px;"><p><strong>วันที่:</strong> ${formatDate(d.deposit_date)} &nbsp; <strong>สาขา:</strong> ${d.branch_name||'-'}</p>
          <p><strong>ลูกค้า:</strong> ${d.customer_name} ${d.customer_phone ? `(${d.customer_phone})` : ''}</p>
          <p><strong>โปรแกรม:</strong> ${d.program_name||'-'}</p><p><strong>ช่องทาง:</strong> ${d.channel||'-'}</p>
          <p><strong>วิธีชำระ:</strong> ${d.payment_method||'-'}</p><p><strong>เลขอ้างอิง:</strong> ${d.payment_reference||'-'}</p>
          <div class="alert-box alert-info"><span>ยอดมัดจำ <strong>฿${formatCurrency(d.deposit_amount||0)}</strong><br>ค่าคอมเมื่อยืนยัน <strong>฿${formatCurrency(d.commission_amt||0)}</strong> (${d.commission_pct||0}%)</span></div>
          <p><strong>ผู้ปิดยอด:</strong> ${d.created_by_name||'-'}</p><p><strong>หมายเหตุ:</strong> ${d.note||'-'}</p>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-danger" onclick="closeModalDirect();audRejectDeposit('${depositId}')">ตีกลับ</button><button class="btn btn-success" onclick="audDepositAction('${depositId}','ยืนยันแล้ว')">ยืนยันเงินเข้าและรับรองค่าคอม</button></div>
    </div>`);
    lucide.createIcons();
  } catch (e) { Toast.show('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error'); }
}

async function audDepositAction(depositId, status, note) {
  try {
    await DB.auditDepositSupabase(depositId, status, currentUser.id, note || '');
    closeModalDirect(); Toast.show(status === 'ยืนยันแล้ว' ? 'ยืนยันเงินเข้าและรับรองค่าคอมแล้ว' : 'ตีกลับยอดมัดจำแล้ว', status === 'ยืนยันแล้ว' ? 'success' : 'warning'); audRender();
  } catch (e) { Toast.show('ดำเนินการไม่สำเร็จ: ' + e.message, 'error'); }
}

function audRejectDeposit(depositId) {
  openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ตีกลับยอดมัดจำ</h3></div><div class="modal-body"><label class="form-label">เหตุผลที่ตีกลับ <span class="required">*</span></label><textarea id="dep-reject-note" class="form-textarea" rows="4"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoRejectDeposit('${depositId}')">ยืนยันตีกลับ</button></div></div>`);
}

function audDoRejectDeposit(depositId) {
  const note = document.getElementById('dep-reject-note')?.value.trim();
  if (!note) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  audDepositAction(depositId, 'ตีกลับ', note);
}

// ── TAB 2: Stock Audit — split into 4 rooms (คุณออม 18/10) ────────────
// OPD supplies are cut by ERP itself at service time, so they never go to ERP from here;
// once approved they wait for the "เทียบเบิกระบบ ARANA" tab. เบิกใช้/รับเข้า/โอน go to ERP after approval.
const AUD_STOCK_TABS = [
  { tab: 'stock-opd', kind: 'opd', icon: 'clipboard-check', label: 'ตรวจเบิก OPD' },
  { tab: 'stock-out', kind: 'out', icon: 'package-minus', label: 'ตรวจเบิกใช้' },
  { tab: 'stock-in', kind: 'in', icon: 'package-plus', label: 'ตรวจรับเข้า' },
  { tab: 'stock-transfer', kind: 'transfer', icon: 'arrow-left-right', label: 'ตรวจโอนออก-รับเข้าข้ามสาขา' }
];
const AUD_KIND_MOVE = { out: 'OUT', in: 'IN', transfer: 'TRANSFER' };
const AUD_KIND_NAME = { opd: 'เบิกจาก OPD', out: 'เบิกใช้', in: 'รับเข้า', transfer: 'โอนออก-รับเข้าข้ามสาขา' };
function audStockKindOf(type) { return type === 'IN' ? 'in' : type === 'TRANSFER' ? 'transfer' : 'out'; }

async function audLoadPendingStock() {
  const [opdRequests, pendingStockLogs, stockImages] = await Promise.all([
    DB.getPendingOpdStockRequestsSupabase(),
    DB.getPendingStockLogsSupabase(),
    DB.getPendingStockLogImagesSupabase()
  ]);
  const imageMap = (stockImages || []).reduce((map, image) => {
    (map[image.logId] ||= []).push(image.fileUrl);
    return map;
  }, {});
  const stockLogs = (pendingStockLogs || []).map(log => ({ ...log, images: imageMap[log.id] || [] }));
  window._auditPendingStockLogs = stockLogs;
  const grouped = Object.values(stockLogs.reduce((a, x) => { const k = x.requestId || x.id; (a[k] ||= { ...x, requestId: k, items: [] }).items.push(x); return a; }, {}));
  return {
    opd: (opdRequests || []).map(r => ({ ...r, rowType: 'opd', itemCount: r.supplyCount || 0 })),
    groups: grouped.map(r => ({ ...r, rowType: 'stock', kind: audStockKindOf(r.type), itemCount: r.items.length }))
  };
}
function audSetStockCounts(p) {
  const counts = { opd: p.opd.length, out: 0, in: 0, transfer: 0 };
  p.groups.forEach(g => { counts[g.kind]++; });
  Object.entries(counts).forEach(([k, n]) => {
    const el = document.getElementById('aud-count-' + k);
    if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
  });
}
async function audRefreshStockCounts() {
  try { audSetStockCounts(await audLoadPendingStock()); } catch (e) { console.error(e); }
}

async function audRenderStock(body, kind) {
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  const pending = await audLoadPendingStock();
  audSetStockCounts(pending);
  const rows = kind === 'opd' ? pending.opd : pending.groups.filter(g => g.kind === kind);
  const isOpd = kind === 'opd';
  const typeBadge = r => r.rowType === 'opd' ? '<span class="badge badge-service">เบิกจาก OPD</span>'
    : `<span class="badge badge-${r.type === 'IN' ? 'in' : 'out'}">${AUD_KIND_NAME[r.kind]}</span>`;
  const label = r => r.rowType === 'opd' ? (r.customerName || '-')
    : (r.kind === 'in' && r.poNo ? r.poNo + ' · ' : '') + (r.items || []).slice(0, 3).map(i => i.productName || i.productCode).join(', ') + ((r.items || []).length > 3 ? ` และอีก ${r.items.length - 3}` : '');
  const where = r => (r.branch || '-') + (r.toBranch ? ' → ' + r.toBranch : '');
  const note = isOpd
    ? 'ตรวจกับรูปใบ OPD แล้วกดอนุมัติ — รายการที่อนุมัติแล้วจะไปรอเทียบกับรายงานจ่ายยา/อุปกรณ์ของ ERP ในแท็บ "เทียบเบิกระบบ ARANA" (ไม่ต้องนำส่ง ERP เพราะ ERP ตัดสต็อกเองตอนใช้บริการ)'
    : 'ตรวจกับรูปหลักฐานแล้วกดอนุมัติ — ใบที่อนุมัติแล้วจะย้ายไปส่วน "ตรวจแล้ว รอนำส่ง ERP" ด้านล่าง';
  body.innerHTML = `<div class="glass-card" style="margin-bottom:12px;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span style="font-size:.9rem;color:var(--gray-700);font-weight:700;">${AUD_KIND_NAME[kind]} — รอตรวจ</span><span class="badge badge-pending" style="font-size:1rem;padding:4px 12px;">${rows.length} ${isOpd ? 'ใบ' : 'คำขอ'}</span><span style="font-size:.8rem;color:var(--gray-500);flex-basis:100%;">${note}</span></div>
  <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap"><table><thead><tr><th>วันที่/เวลา</th><th>สาขา</th><th>ประเภท</th><th>${isOpd ? 'ลูกค้า' : 'รายการ'}</th><th>จำนวน</th><th>ผู้บันทึก</th><th>หลักฐาน</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
  ${rows.length ? rows.map(r => `<tr id="stock-audit-row-${r.rowType}-${r.rowType === 'opd' ? r.billId : r.requestId}"><td class="nowrap">${formatDate(r.date)}${r.createdAt ? `<br><small>${new Date(r.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</small>` : ''}</td><td>${where(r)}</td><td>${typeBadge(r)}</td><td style="font-weight:600;">${label(r)}</td><td>${r.itemCount} รายการ</td><td>${r.createdByName || '-'}</td><td><button class="btn btn-ghost btn-sm" onclick="${r.rowType === 'opd' ? `audOpenStockRequest('${r.billId}')` : `audOpenStockRequestGroup('${r.requestId}')`}"><i data-lucide="eye"></i> ดูรายละเอียด</button></td><td>${statusBadge(r.auditStatus || 'รอตรวจสอบ')}</td><td class="nowrap"><button class="btn btn-success btn-sm" onclick="${r.rowType === 'opd' ? `audStockAction('${r.billId}','อนุมัติแล้ว')` : `audStockRequestAction('${r.requestId}','อนุมัติแล้ว')`}">อนุมัติ</button> <button class="btn btn-danger btn-sm" onclick="${r.rowType === 'opd' ? `audStockReject('${r.billId}')` : `audStockRequestReject('${r.requestId}')`}">ตีกลับ</button></td></tr>`).join('') : `<tr><td colspan="9"><div class="empty-state">ไม่มี${AUD_KIND_NAME[kind]}รอตรวจ</div></td></tr>`}
  </tbody></table></div></div>
  ${kind === 'in' ? '<div id="aud-others"></div>' : ''}
  ${kind === 'transfer' ? '<div id="aud-receipts" style="margin-top:12px;"></div>' : ''}
  ${isOpd ? '' : `<div class="glass-card" style="margin-top:12px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-weight:700;color:var(--gray-700);">ตรวจแล้ว รอนำส่ง ERP</span>
      <label style="font-size:.8rem;color:var(--gray-600);display:flex;align-items:center;gap:4px;"><input type="checkbox" id="aud-approved-all" onchange="audLoadApprovedStock('${kind}')"> แสดงที่ส่งแล้วด้วย</label>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto;" data-write onclick="erpExcelExport('${AUD_KIND_MOVE[kind]}')" title="รวมทุกใบที่ยังไม่เข้า ERP เป็นไฟล์เดียว"><i data-lucide="download"></i> Excel ทุกใบที่รอส่ง</button>
    </div>
    <div style="font-size:.78rem;color:var(--gray-500);margin-top:4px;">กด "นำส่งเข้า ERP" ระบบส่งเข้า ERP ทันทีและได้เลขเอกสารกลับมา · ถ้า ERP ไม่รับจะขึ้นเหตุผลใต้สถานะ · ใบที่คีย์มือใน ERP ไปแล้วกด "คีย์เข้า ERP แล้ว" · อนุมัติผิดกด "ถอยการอนุมัติ" ระบบจะคืนของเข้าคลัง (และยกเลิกใน ERP ถ้าส่งไปแล้ว)</div>
    <div id="aud-approved-stock"></div>
  </div>`}`;
  lucide.createIcons();
  if (!isOpd) audLoadApprovedStock(kind);
  if (kind === 'in') audLoadOthers();
  if (kind === 'transfer' && typeof audLoadReceipts === 'function') audLoadReceipts();
}

async function audLoadApprovedStock(kind) {
  const box = document.getElementById('aud-approved-stock');
  if (!box) return;
  box.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  const showAll = document.getElementById('aud-approved-all')?.checked;
  const move = AUD_KIND_MOVE[kind];
  const rows = (await DB.listStockLogsErpSyncSupabase(null)).filter(r => !r.is_opd && r.move_type === move
    && (r.erp_sync_status === 'ต้องยกเลิกที่ ERP'
        || (r.audit_status === 'อนุมัติแล้ว' && (showAll || ['รอส่ง', 'ส่งไม่สำเร็จ'].includes(r.erp_sync_status)))));
  const groups = Object.values(rows.reduce((a, r) => { const k = r.request_id || r.id; (a[k] ||= { ...r, requestId: k, items: [] }).items.push(r); return a; }, {}));
  const waiting = g => g.items.some(i => ['รอส่ง', 'ส่งไม่สำเร็จ'].includes(i.erp_sync_status));
  const toCancel = g => g.items.some(i => i.erp_sync_status === 'ต้องยกเลิกที่ ERP');
  const erpCell = g => {
    const s = toCancel(g) ? 'ต้องยกเลิกที่ ERP' : waiting(g) ? (g.items.some(i => i.erp_sync_status === 'ส่งไม่สำเร็จ') ? 'ส่งไม่สำเร็จ' : 'รอส่ง') : g.items[0].erp_sync_status;
    const cls = s === 'ส่งสำเร็จ' ? 'badge-approved' : ['ส่งไม่สำเร็จ', 'ต้องยกเลิกที่ ERP'].includes(s) ? 'badge-rejected' : 'badge-waiting';
    const ref = g.items.find(i => i.erp_ref)?.erp_ref;
    const err = g.items.find(i => i.erp_sync_error)?.erp_sync_error;
    return `<span class="badge ${cls}">${s}</span>${ref ? `<div style="font-size:.72rem;color:var(--gray-500);margin-top:2px;">${ref}</div>` : ''}${err && s !== 'ส่งสำเร็จ' ? `<div style="font-size:.72rem;color:var(--red-500,#dc2626);margin-top:2px;max-width:260px;">${err}</div>` : ''}`;
  };
  const sent = g => g.items.every(i => i.erp_sync_status === 'ส่งสำเร็จ');
  const actions = g => {
    // โอน 2 ขั้น: ยกเลิกใบโอนออกใน ERP ได้จนกว่าปลายทางรับ (ERP ตรวจเองอีกชั้น)
    if (toCancel(g)) return `<button class="btn btn-danger btn-sm" data-write onclick="audErpReverse('${g.requestId}','${kind}')">ยกเลิกใน ERP</button>`;
    let h = '';
    if (waiting(g)) h += `<button class="btn btn-primary btn-sm" data-write onclick="audSendToErp('${g.requestId}','${kind}', this)"><i data-lucide="send"></i> นำส่งเข้า ERP</button> <button class="btn btn-ghost btn-sm" data-write title="คีย์ใบนี้ใน ERP ด้วยมือแล้ว ใส่เลขเอกสาร ERP เพื่อปิดรายการ" onclick="admMarkKeyedInErp('${g.items[0].id}','${g.request_id || ''}')">คีย์เข้า ERP แล้ว</button> `;
    // โอน: ถอยได้จนกว่าบัญชีอนุมัติการรับ (ฐานข้อมูลตรวจและแจ้งเหตุผลถ้าถอยไม่ได้)
    h +=`<button class="btn btn-ghost btn-sm" data-write style="color:var(--red-500,#dc2626);" onclick="audStockRevertPrompt('${g.requestId}', ${g.items.length}, ${sent(g)})">ถอยการอนุมัติ</button>`;
    return h;
  };
  const itemCell = g => g.items.map(i => {
    const exp = kind === 'in' && i.po_qty_expected != null ? Number(i.po_qty_expected) : null;
    const flag = exp == null ? '' : Number(i.qty) > exp ? ` <span style="color:var(--red-600);font-weight:700;">(สั่ง ${exp} · รับเกิน)</span>` : Number(i.qty) < exp ? ` <span style="color:var(--gray-500);">(ค้างรับ ${exp})</span>` : ' <span style="color:var(--green-600);">✓</span>';
    return (i.product_name || i.product_code) + ' × ' + i.qty + flag;
  }).join('<br>');
  box.innerHTML = groups.length ? `<div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>รายการ</th>${kind === 'in' ? '<th>PO / ผู้ขาย</th>' : ''}<th>สถานะ ERP</th><th></th></tr></thead><tbody>${groups.map(g => `<tr><td class="nowrap">${formatDate(g.log_date)}</td><td>${g.branch_name || '-'}${g.to_branch_name ? ' → ' + g.to_branch_name : ''}</td><td style="font-size:.82rem;">${itemCell(g)}</td>${kind === 'in' ? `<td style="font-size:.82rem;">${g.po_no || '-'}${g.supplier_name ? '<br>' + g.supplier_name : ''}</td>` : ''}<td>${erpCell(g)}</td><td class="nowrap">${actions(g)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-state">${showAll ? 'ไม่มีรายการที่อนุมัติแล้ว' : 'ไม่มีใบที่รอนำส่ง ERP'}</div>`;
  lucide.createIcons();
}

// ส่งใบที่อนุมัติแล้วเข้า ERP (ผ่าน Edge Function — คีย์ ERP ไม่อยู่ในเบราว์เซอร์)
async function audSendToErp(requestId, kind, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง...'; }
  try {
    const res = await DB.erpPushSupabase(requestId, 'send');
    Toast.show('นำส่งเข้า ERP สำเร็จ' + (res.erp_doc_no ? ' — เลขเอกสาร ' + res.erp_doc_no : ''), 'success', 5000);
  } catch (e) {
    Toast.show('ERP ไม่รับใบนี้: ' + (e.message || e), 'error', 9000);
  }
  audLoadApprovedStock(kind);
}
async function audErpReverse(requestId, kind) {
  try {
    await DB.erpPushSupabase(requestId, 'reverse');
    Toast.show('ยกเลิกใบนี้ใน ERP แล้ว', 'success', 4000);
  } catch (e) {
    Toast.show('ยกเลิกใน ERP ไม่สำเร็จ: ' + (e.message || e), 'error', 9000);
  }
  audLoadApprovedStock(kind);
}
function audStockRevertPrompt(requestId, count, sentToErp) {
  const erpNote = sentToErp ? 'ใบนี้ส่งเข้า ERP แล้ว ระบบจะยกเลิกใบนี้ใน ERP ให้ด้วย' : 'ใบนี้ยังไม่ได้ส่งเข้า ERP';
  openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ถอยการอนุมัติ</h3></div><div class="modal-body"><div class="alert-box alert-warning" style="margin-bottom:12px;"><i data-lucide="alert-triangle"></i><span>ระบบจะคืนของ ${count} รายการในใบนี้กลับเข้าคลัง และเปลี่ยนสถานะเป็น "ตีกลับ" ให้พนักงานส่งใบใหม่ที่ถูกต้อง — ${erpNote}</span></div><label class="form-label">เหตุผล <span class="required">*</span></label><textarea id="aud-stock-revert-note" class="form-textarea" rows="3"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoStockRevert('${requestId}', ${!!sentToErp})">ยืนยันถอยการอนุมัติ</button></div></div>`);
}
async function audDoStockRevert(requestId, sentToErp) {
  const note = document.getElementById('aud-stock-revert-note')?.value.trim();
  if (!note) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  try {
    await DB.revertStockRequestSupabase(requestId, note);
    closeModalDirect();
    Toast.show('ถอยการอนุมัติแล้ว — คืนของเข้าคลังเรียบร้อย', 'success', 4000);
  } catch (e) {
    Toast.show('ถอยการอนุมัติไม่สำเร็จ: ' + (/UNKNOWN_ACTION/.test(e.message || '') ? 'ยังไม่ได้ติดตั้ง SQL ชุดวันที่ 26/09' : DB.stockErrorText(e)), 'error', 6000);
    return;
  }
  if (sentToErp) {
    try { await DB.erpPushSupabase(requestId, 'reverse'); Toast.show('ยกเลิกใบนี้ใน ERP แล้ว', 'success', 4000); }
    catch (e) { Toast.show('คืนของในระบบนี้แล้ว แต่ยกเลิกใน ERP ไม่สำเร็จ: ' + (e.message || e) + ' — กด "ยกเลิกใน ERP" อีกครั้งในรายการ', 'error', 10000); }
  }
  if (document.getElementById('aud-approved-stock')) audRender();
  else if (typeof admRenderErpSync === 'function' && document.getElementById('adm-body')) admRenderErpSync(document.getElementById('adm-body'));
}
async function audStockAction(billId,status,note) {
  try { await DB.auditOpdStockRequestSupabase(billId,status,currentUser.id,note||''); Toast.show(status === 'อนุมัติแล้ว' ? 'อนุมัติตัดสต๊อกเรียบร้อย' : 'ตีกลับรายการตัดสต๊อกแล้ว',status === 'อนุมัติแล้ว' ? 'success' : 'error'); closeModalDirect(); audRender(); }
  catch(e) { console.error(e); Toast.show('เกิดข้อผิดพลาด: '+e.message,'error'); }
}
function audStockReject(billId) {
  openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ตีกลับรายการตัดสต๊อก</h3></div><div class="modal-body"><label class="form-label">เหตุผลที่ตีกลับ</label><textarea id="aud-stock-reject-note" class="form-textarea" rows="4"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoStockReject('${billId}')">ตีกลับทั้งชุด</button></div></div>`);
}
function audDoStockReject(billId) { const note=document.getElementById('aud-stock-reject-note')?.value.trim(); if(!note){Toast.show('กรุณาระบุเหตุผล','error');return;} closeModalDirect(); audStockAction(billId,'ตีกลับ',note); }
async function audOpenStockRequest(billId) {
  const detail=await DB.getBillDetailSupabase(billId); if(!detail?.bill){Toast.show('ไม่พบข้อมูล OPD นี้','error');return;}
  const bill=detail.bill, supplies=detail.supplies||[], images=detail.images||[];
  const programs = detail.services || [];
  const recorder = bill.created_by_name || bill.createdByName || bill.created_by || '';
  const programHtml = programs.length ? programs.map((p,i)=>`<div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px;margin-bottom:8px;"><div style="font-weight:700;color:var(--burgundy-700);">โปรแกรม ${i+1}: ${p.program_name||'-'}</div></div>`).join('') : '<div class="empty-state">ไม่พบโปรแกรมใน OPD</div>';
  const supplyHtml = supplies.length ? supplies.map((s,i)=>`<tr><td style="width:44px;text-align:center;"><input type="checkbox" class="aud-stock-check" data-index="${i}" aria-label="ตรวจแล้ว ${s.product_name||''}"></td><td><div style="font-weight:600;">${s.product_name||'-'}</div><div style="font-size:.72rem;color:var(--gray-500);">${s.product_code||''}${s.category?' · '+s.category:''}</div></td><td style="text-align:right;white-space:nowrap;">${s.qty}</td><td style="white-space:nowrap;">${s.unit||'-'}</td></tr>`).join('') : '<tr><td colspan="4">ไม่พบรายการเบิก</td></tr>';
  const imgUrls = images.map(im=>im.file_url).filter(Boolean);
  window._audImgs = imgUrls;
  const viewer = imgUrls.length
    ? `<div id="aud-img-stage" style="position:relative;flex:1;overflow:hidden;background:#111;border-radius:10px;cursor:grab;">
         <img id="aud-img" src="${imgUrls[0]}" alt="รูป OPD" draggable="false" style="position:absolute;top:50%;left:50%;max-width:none;width:100%;transform:translate(-50%,-50%);transform-origin:center center;user-select:none;-webkit-user-drag:none;">
       </div>
       <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;">
         <div style="display:flex;gap:6px;">
           <button class="btn btn-ghost btn-sm" onclick="audImgStep(-1)">‹ ก่อนหน้า</button>
           <span id="aud-img-count" style="align-self:center;font-size:.8rem;color:var(--gray-600);">1 / ${imgUrls.length}</span>
           <button class="btn btn-ghost btn-sm" onclick="audImgStep(1)">ถัดไป ›</button>
         </div>
         <div style="display:flex;gap:6px;">
           <button class="btn btn-ghost btn-sm" onclick="audImgZoom(-1)">−</button>
           <span id="aud-img-zoom" style="align-self:center;font-size:.8rem;color:var(--gray-600);min-width:46px;text-align:center;">100%</span>
           <button class="btn btn-ghost btn-sm" onclick="audImgZoom(1)">+</button>
           <button class="btn btn-ghost btn-sm" onclick="audImgReset()">รีเซ็ต</button>
         </div>
       </div>
       <div style="font-size:.72rem;color:var(--gray-500);padding-top:4px;">เลื่อนล้อเมาส์เพื่อซูม · กดค้างแล้วลากเพื่อเลื่อนดู</div>`
    : `<div style="flex:1;display:flex;align-items:center;justify-content:center;background:#111;border-radius:10px;color:#fff;">ไม่มีรูป OPD</div>`;
  openModal(`<div class="modal" style="width:96vw;max-width:1800px;height:92vh;display:flex;flex-direction:column;">
    <div class="modal-header"><h3 class="modal-title">ตรวจตัดสต๊อก — ${bill.customer_name||'-'}</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div>
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;">
      <div style="display:flex;flex-direction:column;min-height:0;">${viewer}</div>
      <div style="overflow:auto;min-height:0;">
        <div style="background:var(--gray-50);padding:12px;border-radius:8px;margin-bottom:12px;">
          <p><strong>วันที่:</strong> ${formatDate(bill.bill_date)} &nbsp; <strong>สาขา:</strong> ${bill.branch_name||'-'}</p>
          <p><strong>ลูกค้า:</strong> ${bill.customer_name||'-'} &nbsp; <strong>HN:</strong> ${bill.hn||'-'}</p>
          ${recorder?`<p><strong>ผู้บันทึก:</strong> ${recorder}</p>`:''}
        </div>
        <h4 style="margin:0 0 8px;">โปรแกรมบริการ</h4>${programHtml}
        <h4 style="margin:14px 0 8px;">รายการเบิกใน OPD (${supplies.length} รายการ)</h4>
        <div style="font-size:.78rem;color:var(--gray-500);margin-bottom:6px;">ติ๊กเฉพาะรายการที่ตรวจแล้วและตรงกับหลักฐาน</div>
        <div class="table-wrap"><table><thead><tr><th>ตรวจแล้ว</th><th>รายการเบิกของ</th><th style="text-align:right;">จำนวน</th><th>หน่วยนับ</th></tr></thead><tbody>${supplyHtml}</tbody></table></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-danger" onclick="audStockReject('${billId}')">ตีกลับรายการที่ไม่ผ่าน</button><button class="btn btn-success" onclick="audConfirmStockApprove('${billId}')">อนุมัติทั้งใบ</button></div>
  </div>`, { width: '1800px' });
  lucide.createIcons();
  audImgInit();
}
var _audImgView = { i:0, z:1, x:0, y:0 };
function audImgApply(){
  const el=document.getElementById('aud-img'); if(!el) return;
  el.style.transform=`translate(calc(-50% + ${_audImgView.x}px), calc(-50% + ${_audImgView.y}px)) scale(${_audImgView.z})`;
  const zl=document.getElementById('aud-img-zoom'); if(zl) zl.textContent=Math.round(_audImgView.z*100)+'%';
  const cl=document.getElementById('aud-img-count'); if(cl) cl.textContent=(_audImgView.i+1)+' / '+((window._audImgs||[]).length||1);
}
function audImgReset(){ _audImgView.z=1; _audImgView.x=0; _audImgView.y=0; audImgApply(); }
function audImgZoom(dir){ _audImgView.z=Math.min(6,Math.max(0.5,_audImgView.z*(dir>0?1.2:1/1.2))); audImgApply(); }
function audImgStep(delta){
  const imgs=window._audImgs||[]; if(imgs.length<2) return;
  _audImgView.i=(_audImgView.i+delta+imgs.length)%imgs.length;
  const el=document.getElementById('aud-img'); if(el) el.src=imgs[_audImgView.i];
  audImgReset();
}
function audImgInit(){
  const stage=document.getElementById('aud-img-stage'); if(!stage) return;
  _audImgView={i:0,z:1,x:0,y:0}; audImgApply();
  stage.addEventListener('wheel',function(e){
    e.preventDefault();
    const dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);
    _audImgView.z=Math.min(6,Math.max(0.5,_audImgView.z*Math.exp(-dy*0.0015)));
    audImgApply();
  },{passive:false});
  let dragging=false,sx=0,sy=0,ox=0,oy=0;
  stage.addEventListener('pointerdown',function(e){dragging=true;sx=e.clientX;sy=e.clientY;ox=_audImgView.x;oy=_audImgView.y;stage.setPointerCapture(e.pointerId);stage.style.cursor='grabbing';});
  stage.addEventListener('pointermove',function(e){if(!dragging)return;_audImgView.x=ox+(e.clientX-sx);_audImgView.y=oy+(e.clientY-sy);audImgApply();});
  const end=function(){dragging=false;stage.style.cursor='grab';};
  stage.addEventListener('pointerup',end); stage.addEventListener('pointercancel',end);
}
function audConfirmStockApprove(billId) { const checks=[...document.querySelectorAll('.aud-stock-check')]; if(checks.some(c=>!c.checked)){Toast.show('กรุณาตรวจและติ๊กให้ครบทุกรายการก่อนอนุมัติ','warning');return;} audStockAction(billId,'อนุมัติแล้ว'); }
function audOpenStockRequestGroup(requestId){
  const items=(window._auditPendingStockLogs||[]).filter(x=>(x.requestId||x.id)===requestId);
  if(!items.length){Toast.show('ไม่พบคำขอ','error');return;}
  const first=items[0];
  const isIn=first.type==='IN';
  const cmp=i=>{if(!isIn||i.poQtyExpected==null)return '';const e=Number(i.poQtyExpected),q=Number(i.qty);return q>e?'<span class="badge badge-rejected">รับเกิน '+(q-e)+'</span>':q<e?'<span class="badge badge-waiting">รับบางส่วน (ค้าง '+(e-q)+')</span>':'<span class="badge badge-approved">ตรง</span>';};
  const list=items.map(i=>`<tr style="${isIn&&i.poQtyExpected!=null&&Number(i.qty)>Number(i.poQtyExpected)?'background:var(--red-100)':''}"><td>${i.productCode||'-'}</td><td>${i.productName||'-'}</td><td>${i.qty} ${i.unit||''}</td>${isIn?`<td>${i.poQtyExpected==null?'-':i.poQtyExpected}</td><td>${cmp(i)}</td><td>${i.expireDate?formatDate(i.expireDate):'-'}</td>`:`<td>${i.source||'-'}</td>`}<td>${i.note||'-'}</td></tr>`).join('');
  const poInfo=isIn?`<div><small>เลขที่ PO (ERP)</small><strong>${first.poNo||'-'}</strong></div><div><small>ผู้ขาย</small><strong>${first.supplierName||'-'}</strong></div>`:'';
  const evidence=[...new Set(items.flatMap(i=>i.images||[]))].filter(url=>/^data:image\/|^https:\/\//.test(String(url)));
  const photos=evidence.length ? evidence.map((url,index)=>`<img src="${String(url).replace(/"/g,'&quot;')}" alt="หลักฐานรายการ ${index+1}" style="width:100%;max-height:280px;object-fit:contain;background:#fff;border-radius:10px;border:1px solid var(--gray-200);margin-bottom:10px;">`).join('') : '<div style="min-height:220px;display:flex;align-items:center;justify-content:center;padding:18px;text-align:center;color:var(--gray-500);background:var(--gray-50);border:1px dashed var(--gray-300);border-radius:10px;">ยังไม่มีรูปหลักฐาน</div>';
  openModal(`<div class="modal" style="width:1100px;max-width:96vw;"><div class="modal-header"><h3 class="modal-title">รายละเอียดคำขอเบิก/รับ</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div><div class="modal-body"><div class="detail-grid"><div><small>วันที่</small><strong>${formatDate(first.date)}</strong></div><div><small>สาขา</small><strong>${first.branch||'-'}</strong></div><div><small>ผู้บันทึก</small><strong>${first.createdByName||'-'}</strong></div>${poInfo}<div><small>ประเภท</small><strong>${first.type==='IN'?'รับของเข้า':first.type==='TRANSFER'?'โอนข้ามสาขา':'เบิกใช้งาน'}</strong></div></div><div style="display:grid;grid-template-columns:minmax(240px,.8fr) minmax(0,1.4fr);gap:18px;margin-top:18px;align-items:start;"><section><h4 style="margin:0 0 10px;">รูปหลักฐาน (${evidence.length})</h4>${photos}</section><section><h4 style="margin:0 0 10px;">รายการทั้งหมด (${items.length})</h4><div class="table-wrap"><table><thead><tr><th>รหัส</th><th>รายการ</th><th>${isIn?'รับจริง':'จำนวน'}</th>${isIn?'<th>ค้างรับใน PO</th><th>ผล</th><th>วันหมดอายุ</th>':'<th>แหล่งที่มา</th>'}<th>หมายเหตุ</th></tr></thead><tbody>${list}</tbody></table></div></section></div></div><div class="modal-footer"><button class="btn btn-danger" onclick="audStockRequestReject('${requestId}')">ตีกลับทั้งคำขอ</button><button class="btn btn-success" onclick="audStockRequestAction('${requestId}','อนุมัติแล้ว')">อนุมัติทั้งคำขอ</button></div></div>`);
}
function audStockRequestAction(id,status,note){DB.auditStockRequestSupabase(id,status,currentUser.id,note||'').then(()=>{Toast.show(status==='อนุมัติแล้ว'?'อนุมัติคำขอแล้ว':'ตีกลับคำขอแล้ว',status==='อนุมัติแล้ว'?'success':'error');closeModalDirect();audRender();}).catch(e=>Toast.show('เกิดข้อผิดพลาด: '+DB.stockErrorText(e),'error',5000));}
function audStockRequestReject(id){openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ตีกลับคำขอเบิก/รับ</h3></div><div class="modal-body"><label class="form-label">เหตุผลที่ตีกลับ</label><textarea id="aud-stock-request-note" class="form-textarea" rows="4"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoStockRequestReject('${id}')">ยืนยันตีกลับทั้งคำขอ</button></div></div>`);}
function audDoStockRequestReject(id){const n=document.getElementById('aud-stock-request-note')?.value.trim();if(!n){Toast.show('กรุณาระบุเหตุผล','error');return;}audStockRequestAction(id,'ตีกลับ',n);}
function audOpenStockLog(logId) {
  const log=(window._auditPendingStockLogs||[]).find(x=>x.id===logId); if(!log){Toast.show('ไม่พบรายการสต๊อก','error');return;}
  openModal(`<div class="modal" style="width:980px;max-width:96vw;"><div class="modal-header"><h3 class="modal-title">ตรวจสอบรายการสต๊อก</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;"><div style="background:#111;min-height:260px;display:flex;align-items:center;justify-content:center;color:white;">ยังไม่มีรูปแนบ</div><div><div class="detail-grid"><div><small>วันที่</small><strong>${formatDate(log.date)}</strong></div><div><small>สาขา</small><strong>${log.branch||'-'}</strong></div><div><small>ประเภท</small><strong>${log.type==='IN'?'รับของเข้า':'เบิกใช้'}</strong></div><div><small>ผู้บันทึก</small><strong>${log.createdByName||'-'}</strong></div></div><h4 style="margin-top:18px;">รายการ</h4><div class="audit-item" style="display:flex;justify-content:space-between;padding:12px;background:var(--gray-50);border-radius:8px;"><span>${log.productCode||'-'} — ${log.productName||'-'}</span><strong>${log.qty} ${log.unit||''}</strong></div><p style="color:var(--gray-600);font-size:.85rem;">หมายเหตุ: ${log.note||'-'}</p></div></div><div class="modal-footer"><button class="btn btn-danger" onclick="audStockLogReject('${logId}')">ตีกลับ</button><button class="btn btn-success" onclick="audStockLogAction('${logId}','อนุมัติแล้ว')">อนุมัติ</button></div></div>`);
  lucide.createIcons();
}
function audStockLogAction(logId,status,note){ DB.auditStockLogSupabase(logId,status,currentUser.id,note||'').then(()=>{Toast.show(status==='อนุมัติแล้ว'?'อนุมัติรายการสต๊อกแล้ว':'ตีกลับรายการสต๊อกแล้ว',status==='อนุมัติแล้ว'?'success':'error');closeModalDirect();audRender();}).catch(e=>Toast.show('เกิดข้อผิดพลาด: '+DB.stockErrorText(e),'error',5000)); }
function audStockLogReject(logId){ openModal(`<div class="modal"><div class="modal-header"><h3 class="modal-title">ตีกลับรายการสต๊อก</h3></div><div class="modal-body"><label class="form-label">เหตุผลที่ตีกลับ</label><textarea id="aud-stock-log-note" class="form-textarea" rows="4"></textarea></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button><button class="btn btn-danger" onclick="audDoStockLogReject('${logId}')">ยืนยันตีกลับ</button></div></div>`); }
function audDoStockLogReject(logId){const n=document.getElementById('aud-stock-log-note')?.value.trim();if(!n){Toast.show('กรุณาระบุเหตุผล','error');return;}audStockLogAction(logId,'ตีกลับ',n);}
/* Legacy stock-log modal retained below for reference; the unified modal above is now used.
  const images = DB.getStockLogImages ? DB.getStockLogImages(logId) : [];

  let imgIdx = 0;
  const imgSrc = images.length ? images[imgIdx]?.data || '' : '';

  openModal(`
  <div class="modal" style="width:1200px; max-width:95vw; height:85vh; max-height:900px; display:flex; flex-direction:column; border-radius:var(--radius-lg); box-shadow:var(--shadow-xl);">
    <div class="modal-header" style="flex-shrink:0; background:var(--white); border-bottom:1px solid var(--gray-200); z-index:10;">
      <h3 class="modal-title"><i data-lucide="package"></i>ตรวจสอบสต๊อก — ${log.productName||'-'}</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div style="flex:1; overflow:hidden; display:flex; flex-wrap:wrap; background:var(--gray-100);">
      <!-- Left: Image -->
      <div class="split-left" style="flex:1;min-width:300px;display:flex;flex-direction:column;border-right:1px solid var(--gray-200);">
        ${images.length ? `
        <div class="split-img-wrap" id="audImgWrap" style="flex:1;position:relative;background:#111;cursor:grab;min-height:0;width:100%;">
          <img id="aud-img" src="${imgSrc}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;transform-origin:center center;transition:transform 0.1s ease-out;pointer-events:none;" draggable="false" />
        </div>
        <div class="split-img-controls" style="display:flex;align-items:center;padding:8px 12px;background:var(--gray-900);gap:8px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(-0.2)"><i data-lucide="zoom-out"></i></button>
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(0.2)"><i data-lucide="zoom-in"></i></button>
          <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audZoom(0,'reset')"><i data-lucide="maximize-2"></i></button>
          <span class="split-img-counter" id="aud-img-counter" style="color:white;font-size:0.8rem;margin-left:8px;">${images.length > 1 ? `1/${images.length}` : ''}</span>
          <div style="margin-left:auto;display:flex;gap:6px;">
            ${images.length > 1 ? `
            <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audNavImg(-1,${images.length})"><i data-lucide="chevron-left"></i></button>
            <button class="btn btn-ghost btn-sm" style="color:white;" onclick="audNavImg(1,${images.length})"><i data-lucide="chevron-right"></i></button>` : ''}
          </div>
        </div>
        <div style="background:var(--cream);padding:14px 16px;border-top:1px solid var(--gray-200);display:flex;justify-content:center;">
          <span style="font-size:0.85rem;color:var(--gray-600);"><i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></i>สามารถลากรูปหรือซูมดูรายละเอียดได้</span>
        </div>` : `
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--gray-400);flex-direction:column;gap:12px;background:var(--gray-50);">
          <i data-lucide="image-off" style="width:48px;height:48px;"></i><p>ไม่มีภาพถ่ายสต๊อก</p>
        </div>`}
      </div>
      <!-- Right: Data -->
      <div class="split-right" style="flex:1;min-width:320px;display:flex;flex-direction:column;background:var(--white);">
        <div class="split-right-body" style="flex:1;overflow-y:auto;padding:20px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;background:var(--gray-50);padding:12px;border-radius:var(--radius-md);border:1px solid var(--gray-100);">
            <div><div style="font-size:0.75rem;color:var(--gray-500);">วันที่</div><div style="font-weight:600;">${formatDate(log.date)}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">สาขา</div><div style="font-weight:600;">${log.branch}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">ประเภท</div><div>${typeBadge(log.type)}</div></div>
            <div style="grid-column:span 2;">
              <div style="font-size:0.75rem;color:var(--gray-500);">ผู้บันทึก</div>
              <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
                <i data-lucide="user" style="width:16px;height:16px;color:var(--burgundy-500);"></i>
                ${getUserName(log.createdBy)}
              </div>
            </div>
          </div>
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">รายการ</span></div>
          <div class="audit-item" style="padding:10px;border:1px solid var(--blue-200);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--blue-50);display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:600;font-size:0.9rem;">${log.productCode} — ${log.productName||'-'}</div>
            <div style="font-weight:700;white-space:nowrap;font-size:1rem;color:var(--blue-800);">${log.qty} ${log.unit||''}</div>
          </div>
          <div style="font-size:0.85rem;color:var(--gray-600);margin-top:10px;">หมายเหตุ: ${log.note||'-'}</div>
        </div>
        <div class="split-right-footer" style="padding:16px;border-top:1px solid var(--gray-200);display:flex;gap:12px;background:var(--white);">
          <button class="btn btn-danger" style="flex:1;padding:12px;" onclick="audQuickStockReject('${log.id}')">
            <i data-lucide="x-circle"></i> ตีกลับ
          </button>
          <button class="btn btn-success" style="flex:1;padding:12px;" onclick="audQuickStockApprove('${log.id}')">
            <i data-lucide="check-circle"></i> อนุมัติ
          </button>
        </div>
      </div>
    </div>
  </div>`);

  document.querySelector('.modal-overlay').onclick = null;
  window._audImages = images;
  window._audImgIdx = 0;
  window._audScale = 1;
  window._audPanX = 0;
  window._audPanY = 0;
  lucide.createIcons();

  // Attach Drag/Pan Events
  setTimeout(() => {
    const wrap = document.getElementById('audImgWrap');
    if (!wrap) return;
    let isDragging = false;
    let startX, startY;
    wrap.addEventListener('mousedown', e => { isDragging = true; startX = e.clientX - _audPanX; startY = e.clientY - _audPanY; wrap.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => { if (!isDragging) return; _audPanX = e.clientX - startX; _audPanY = e.clientY - startY; audApplyTransform(); });
    window.addEventListener('mouseup', () => { isDragging = false; wrap.style.cursor = 'grab'; });
    wrap.addEventListener('wheel', e => { e.preventDefault(); audZoom(e.deltaY > 0 ? -0.1 : 0.1); });
  }, 100);
}

function audQuickStockApprove(logId) { audStockAction(logId, 'อนุมัติแล้ว'); closeModalDirect(); }
function audQuickStockReject(logId) { closeModalDirect(); audStockReject(logId); }
*/

// ── ของใช้อื่นๆ (ของที่มาถึงแต่ไม่อยู่ใน PO) — บัญชีตัดสิน ไม่เข้าสต็อก ไม่ส่ง ERP ──
function audEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function audLoadOthers() {
  const box = document.getElementById('aud-others');
  if (!box) return;
  let rows;
  try { rows = await DB.listReceiveOtherItemsSupabase(true); }
  catch (e) { box.innerHTML = ''; console.error(e); return; }
  window._audOthers = rows;
  if (!rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="glass-card" style="margin-top:12px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span style="font-weight:700;color:var(--gray-700);">ของใช้อื่นๆ รอตรวจ</span><span class="badge badge-pending">${rows.length} รายการ</span>
    <span style="font-size:.78rem;color:var(--gray-500);flex-basis:100%;">ของที่มาถึงแต่ไม่อยู่ใน PO — ไม่เข้าคลัง (ของใช้ทั่วไป/บริษัทสั่งให้) หรือ ต้องเปิด PO ใน ERP ก่อนแล้วค่อยรับเข้าตาม PO</span></div>
    <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>ของ</th><th>จำนวน</th><th>ผู้บันทึก</th><th>มากับ PO</th><th>หลักฐาน</th><th></th></tr></thead><tbody>
    ${rows.map(o => `<tr><td class="nowrap">${formatDate(o.log_date)}</td><td>${audEsc(o.branch_name || '-')}</td><td style="font-weight:600;">${audEsc(o.item_name)}${o.note ? `<div style="font-size:.75rem;color:var(--gray-500);font-weight:400;">${audEsc(o.note)}</div>` : ''}</td><td>${o.qty} ${audEsc(o.unit || '')}</td><td>${audEsc(o.created_by_name || '-')}</td><td>${audEsc(o.po_no || '-')}</td><td>${(o.images || []).length ? `<button class="btn btn-ghost btn-sm" onclick="audOtherImages('${o.id}')"><i data-lucide="image"></i> ดูรูป</button>` : (o.po_no ? '<span style="font-size:.75rem;color:var(--gray-500);">รูปอยู่กับใบ PO</span>' : '-')}</td>
      <td class="nowrap"><button class="btn btn-ghost btn-sm" data-write onclick="audDecideOther('${o.id}','ไม่เข้าคลัง')">ไม่เข้าคลัง</button> <button class="btn btn-ghost btn-sm" data-write onclick="audDecideOther('${o.id}','ต้องเปิด PO')">ต้องเปิด PO</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  lucide.createIcons();
}
function audOtherImages(id) {
  const o = (window._audOthers || []).find(x => x.id === id);
  const imgs = (o?.images || []).filter(u => /^data:image\/|^https:\/\/|^storage:/.test(String(u)));
  openModal(`<div class="modal" style="width:900px;max-width:96vw;"><div class="modal-header"><h3 class="modal-title">หลักฐาน — ${audEsc(o?.item_name || '')}</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div><div class="modal-body">${imgs.map((u, i) => `<img src="${String(u).replace(/"/g, '&quot;')}" alt="หลักฐาน ${i + 1}" style="width:100%;max-height:70vh;object-fit:contain;margin-bottom:10px;border-radius:10px;border:1px solid var(--gray-200);">`).join('') || 'ไม่มีรูป'}</div></div>`);
}
async function audDecideOther(id, decision) {
  try {
    await DB.decideReceiveOtherItemSupabase(id, decision, null);
    Toast.show(decision === 'ต้องเปิด PO' ? 'บันทึกแล้ว — เปิด PO ใน ERP แล้วให้สาขารับเข้าตาม PO' : 'บันทึกแล้ว — ไม่เข้าคลัง', 'success', 4000);
  } catch (e) { Toast.show('บันทึกไม่สำเร็จ: ' + DB.stockErrorText(e), 'error', 5000); }
  audLoadOthers();
}

// ── TAB 3: เทียบเบิกระบบ ARANA — OPD ที่บัญชีอนุมัติแล้ว vs รายงานจ่ายยา/อุปกรณ์ (หน้าร้าน) ของ ERP ──
const AUD_CMP_STYLE = {
  'ตรง': 'badge-approved', 'จำนวนไม่ตรง': 'badge-rejected', 'มีใน ERP แต่ไม่ได้บันทึก': 'badge-rejected',
  'บันทึกแต่ไม่มีใน ERP': 'badge-waiting', 'รอบัญชีตรวจ': 'badge-pending', 'ยอดรวมรายวัน (ไม่มี HN)': 'badge-waiting'
};
function audRenderCompare(body) {
  const to = todayISO();
  const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  body.innerHTML = `
  <div class="glass-card">
    <div class="section-header" style="margin-bottom:10px;"><span class="section-title">เทียบเบิกระบบ ARANA</span></div>
    <div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
      <span>เทียบของที่พนักงานบันทึกพ่วงบิล OPD (เฉพาะที่บัญชีอนุมัติแล้ว) กับรายงานสรุปการจ่ายยา/อุปกรณ์ (หน้าร้าน) ของ ERP ต่อ วันที่ + สาขา + HN + สินค้า · ข้อมูล ERP อัปเดตทุกเช้า 05:00</span></div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;">
      <div class="form-group"><label class="form-label">ตั้งแต่</label><input type="date" id="cmp-from" class="form-input" value="${from}" max="${to}"></div>
      <div class="form-group"><label class="form-label">ถึง</label><input type="date" id="cmp-to" class="form-input" value="${to}" max="${to}"></div>
      <div class="form-group"><label class="form-label">สาขา</label><select id="cmp-branch" class="form-select"><option value="">ทุกสาขา</option>${['พิษณุโลก', 'กำแพงเพชร', 'แม่สอด', 'นครสวรรค์'].map(b => `<option>${b}</option>`).join('')}</select></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:.85rem;margin-bottom:10px;"><input type="checkbox" id="cmp-problems" checked onchange="audShowCompare()"> เฉพาะที่ต้องตรวจ</label>
      <button class="btn btn-primary" style="margin-bottom:4px;" onclick="audRunCompare()"><i data-lucide="git-compare"></i> เทียบ</button>
      <button class="btn btn-ghost" style="margin-bottom:4px;" onclick="audExportCompare()"><i data-lucide="download"></i> Excel</button>
    </div>
    <div id="compare-result"></div>
  </div>`;
  lucide.createIcons();
  audRunCompare();
}
window._audCompare = [];
async function audRunCompare() {
  const box = document.getElementById('compare-result');
  if (!box) return;
  box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">กำลังเทียบ...</div>';
  try {
    window._audCompare = await DB.dispenseCompareSupabase(document.getElementById('cmp-from').value, document.getElementById('cmp-to').value, document.getElementById('cmp-branch').value);
  } catch (e) {
    box.innerHTML = `<div class="alert-box alert-warning"><i data-lucide="alert-triangle"></i><span>${/INVALID_RANGE/.test(e.message || '') ? 'เลือกช่วงวันที่ไม่เกิน 2 เดือน' : 'เทียบไม่สำเร็จ: ' + audEsc(e.message || e)}</span></div>`;
    lucide.createIcons(); return;
  }
  audShowCompare();
}
function audShowCompare() {
  const box = document.getElementById('compare-result');
  if (!box) return;
  const all = window._audCompare || [];
  const counts = all.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const onlyProblems = document.getElementById('cmp-problems')?.checked;
  const rows = onlyProblems ? all.filter(r => r.status !== 'ตรง') : all;
  const summary = Object.keys(AUD_CMP_STYLE).filter(k => counts[k]).map(k => `<span class="badge ${AUD_CMP_STYLE[k]}" style="margin-right:6px;">${k} ${counts[k]}</span>`).join('') || '<span style="color:var(--gray-500);">ไม่มีข้อมูลในช่วงนี้</span>';
  box.innerHTML = `<div style="margin-bottom:10px;">${summary}</div>
  ${rows.length ? `<div class="table-wrap" style="max-height:65vh;overflow:auto;"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>HN</th><th>ลูกค้า</th><th>สินค้า</th><th class="num">ERP</th><th class="num">ARANA</th><th class="num">รอตรวจ</th><th>ผล</th><th>เอกสาร ERP</th></tr></thead><tbody>
  ${rows.map(r => `<tr style="${['จำนวนไม่ตรง', 'มีใน ERP แต่ไม่ได้บันทึก'].includes(r.status) ? 'background:var(--red-100)' : ''}"><td class="nowrap">${formatDate(r.d)}</td><td>${audEsc(r.branch)}</td><td>${audEsc(r.hn || '-')}</td><td>${audEsc(r.customer_name || '-')}</td><td>${audEsc(r.item_name || r.sku)}<div style="font-size:.72rem;color:var(--gray-500);">${audEsc(r.sku)}</div></td><td class="num">${r.erp_qty ?? '-'}</td><td class="num">${r.ext_qty ?? '-'}</td><td class="num">${r.ext_wait_qty ? r.ext_wait_qty : ''}</td><td><span class="badge ${AUD_CMP_STYLE[r.status] || ''}">${r.status}</span></td><td style="font-size:.75rem;">${audEsc(r.erp_docs || '')}</td></tr>`).join('')}
  </tbody></table></div>` : `<div class="empty-state">${all.length ? 'ทุกรายการตรงกัน 🎉' : 'ไม่มีข้อมูลในช่วงนี้'}</div>`}`;
  lucide.createIcons();
}
async function audExportCompare() {
  const rows = window._audCompare || [];
  if (!rows.length) { Toast.show('ยังไม่มีผลเทียบ', 'warning'); return; }
  try {
    const ExcelJS = await erpExcelLoadLib();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('เทียบเบิก');
    ws.addRow(['วันที่', 'สาขา', 'HN', 'ลูกค้า', 'รหัสสินค้า', 'สินค้า', 'ERP', 'ARANA', 'รอตรวจ', 'ผล', 'เอกสาร ERP']);
    rows.forEach(r => ws.addRow([r.d, r.branch, r.hn || '', r.customer_name || '', r.sku, r.item_name || '', r.erp_qty ?? '', r.ext_qty ?? '', r.ext_wait_qty || '', r.status, r.erp_docs || '']));
    await erpExcelDownload(wb, `เทียบเบิกระบบARANA-${document.getElementById('cmp-from').value}-${document.getElementById('cmp-to').value}.xlsx`);
  } catch (e) { Toast.show(e.message || String(e), 'error', 5000); }
}

// ── TAB 4: Audit Log ─────────────────────────────────────
function audRenderLog(body) {
  let logs = DB.getAuditLogs ? DB.getAuditLogs() : [];
  
  // Enrich logs with Branch and CreatedBy dynamically
  const richLogs = logs.map(l => {
    let branch = '-', createdBy = null;
    if (l.targetType === 'bill') {
      const b = DB.getBillById(l.targetId);
      if (b) { branch = b.branch; createdBy = b.createdBy; }
    } else if (l.targetType === 'stock_log') {
      const sl = (DB._get('stock_logs')||[]).find(x => x.id === l.targetId);
      if (sl) { branch = sl.branch; createdBy = sl.createdBy; }
    }
    return { ...l, branch, createdBy };
  });

  richLogs.sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  body.innerHTML = `
  <div class="filter-bar" style="margin-bottom:12px;">
    <div class="filter-group">
      <label class="filter-label">ค้นหา</label>
      <input type="text" class="filter-input" id="alog-search" placeholder="รหัสอ้างอิง..." oninput="audFilterLog()" />
    </div>
    <div class="filter-group">
      <label class="filter-label">จากวันที่</label>
      <input type="date" class="filter-input" id="alog-from" onchange="audFilterLog()" />
    </div>
    <div class="filter-group">
      <label class="filter-label">ถึงวันที่</label>
      <input type="date" class="filter-input" id="alog-to" onchange="audFilterLog()" />
    </div>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table>
        <thead>
          <tr>
            <th>วันเวลา</th>
            <th>รหัสอ้างอิง</th>
            <th>สาขา</th>
            <th>ผู้บันทึก</th>
            <th>ผู้อนุมัติ</th>
            <th>การกระทำ</th>
            <th>สถานะเดิม</th>
            <th>สถานะใหม่</th>
            <th>หมายเหตุ</th>
            <th style="text-align:center;">จัดการ</th>
          </tr>
        </thead>
        <tbody id="aud-log-tbody"></tbody>
      </table>
    </div>
  </div>`;
  window._audRichLogs = richLogs;
  audFilterLog();
  lucide.createIcons();
}

function audFilterLog() {
  const tbody = document.getElementById('aud-log-tbody');
  if (!tbody || !window._audRichLogs) return;
  
  let filtered = window._audRichLogs;
  const search = document.getElementById('alog-search')?.value.toLowerCase();
  const dFrom = document.getElementById('alog-from')?.value;
  const dTo = document.getElementById('alog-to')?.value;

  if (search) filtered = filtered.filter(l => l.targetId?.toLowerCase().includes(search));
  if (dFrom) filtered = filtered.filter(l => l.createdAt >= dFrom);
  if (dTo) filtered = filtered.filter(l => l.createdAt.slice(0,10) <= dTo);

  tbody.innerHTML = filtered.length ? filtered.map(l => `
  <tr>
    <td class="nowrap" style="font-size:0.75rem;">${formatDateTime(l.createdAt)}</td>
    <td><code style="font-size:0.75rem;background:var(--gray-100);padding:2px 4px;border-radius:4px;">${l.targetId?.slice(0,8)||'-'}</code></td>
    <td style="font-size:0.8rem;">${l.branch}</td>
    <td style="font-size:0.8rem;">${getUserName(l.createdBy)}</td>
    <td style="font-size:0.8rem;">${getUserName(l.auditBy)}</td>
    <td><span class="badge ${l.action.includes('อนุมัติ')?'badge-approved':'badge-rejected'}">${l.action}</span></td>
    <td>${statusBadge(l.oldStatus)}</td>
    <td>${statusBadge(l.newStatus)}</td>
    <td style="font-size:0.8rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${l.note||''}">${l.note||'-'}</td>
    <td style="text-align:center;">
      <button class="btn btn-warning btn-sm" onclick="audRevertLog('${l.targetType}','${l.targetId}')"><i data-lucide="rotate-ccw"></i> คืนสถานะ</button>
    </td>
  </tr>`).join('') : `
  <tr><td colspan="10"><div class="empty-state" style="padding:24px;"><i data-lucide="clock"></i><h4>ไม่พบประวัติ</h4></div></td></tr>`;
  lucide.createIcons();
}

function audRevertLog(targetType, targetId) {
  openModal(`
  <div class="modal">
    <div class="modal-header">
      <h3 class="modal-title"><i data-lucide="rotate-ccw"></i>คืนสถานะ</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="alert-box alert-warning"><i data-lucide="alert-triangle"></i><span>ต้องการคืนสถานะของรายการนี้กลับเป็น "รอตรวจสอบ" หรือไม่?</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-warning" onclick="DB.revertAuditStatus && DB.revertAuditStatus('${targetType}','${targetId}','${currentUser.id}');closeModalDirect();Toast.show('คืนสถานะแล้ว','success');audRender();">
        <i data-lucide="rotate-ccw"></i> ยืนยัน
      </button>
    </div>
  </div>`);
}

