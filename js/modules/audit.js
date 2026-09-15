let auditTab = 'commission';
let auditPage = 1;
function audCanAccessCommission() { return ['Admin', 'CommissionAudit'].includes(currentUser.role); }
function audCanAccessStock() { return ['Admin', 'Audit', 'StockAudit'].includes(currentUser.role); }
function renderAudit(container) {
  const canCommission = audCanAccessCommission(), canStock = audCanAccessStock();
  auditTab = canCommission ? 'commission' : 'stock'; auditPage = 1;
  container.innerHTML = `<div><div class="tab-bar">
    ${canCommission ? `<button class="tab-btn ${auditTab==='commission'?'active':''}" id="aud-tab-commission" onclick="audSwitch('commission')"><i data-lucide="badge-dollar-sign"></i>อนุมัติค่ามือ/คอมมิชชั่น</button>` : ''}
    ${canCommission ? `<button class="tab-btn" id="aud-tab-deposits" onclick="audSwitch('deposits')"><i data-lucide="wallet-cards"></i>ตรวจยอดมัดจำ</button>` : ''}
    ${canStock ? `<button class="tab-btn ${auditTab==='stock'?'active':''}" id="aud-tab-stock" onclick="audSwitch('stock')"><i data-lucide="package-check"></i>อนุมัติตัดสต๊อก</button>` : ''}
    ${['Admin','Audit'].includes(currentUser.role) ? `<button class="tab-btn" id="aud-tab-compare" onclick="audSwitch('compare')"><i data-lucide="git-compare"></i>เทียบเบิก APSX</button><button class="tab-btn" id="aud-tab-log" onclick="audSwitch('log')"><i data-lucide="clock"></i>ประวัติการอนุมัติ</button>` : ''}
  </div><div id="aud-body"></div></div>`;
  audRender(); lucide.createIcons();
}
function audSwitch(tab) {
  if ((tab === 'commission' || tab === 'deposits') && !audCanAccessCommission()) return;
  if (tab === 'stock' && !audCanAccessStock()) return;
  auditTab = tab; auditPage = 1;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`aud-tab-${tab}`); if (el) el.classList.add('active'); audRender();
}
function audRender() {
  const body = document.getElementById('aud-body'); if (!body) return;
  if (auditTab === 'commission') audRenderOPD(body);
  else if (auditTab === 'deposits') audRenderDeposits(body);
  else if (auditTab === 'stock') audRenderStock(body);
  else if (auditTab === 'compare') audRenderCompare(body); else audRenderLog(body);
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
      <button class="btn btn-primary btn-sm" onclick="audOpenBill('${b.id}')"><i data-lucide="search"></i> ตรวจสอบ</button>
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

function audEditRequestRow(r) {
  const b = DB.getBillById(r.billId) || {};
  return `<tr id="aud-req-${r.id}" class="clickable" onclick="audOpenEditRequest('${r.id}')" style="background:var(--amber-50);">
    <td class="nowrap">${formatDate(b.date || '')}</td>
    <td><code style="font-size:0.75rem;background:var(--gray-100);padding:2px 5px;border-radius:4px;">${b.hn||'-'}</code></td>
    <td style="font-weight:600;">${b.customerName||'-'}</td>
    <td>${b.branch||'-'}</td>
    <td style="font-size:0.8rem;">
      <div style="display:flex;align-items:center;gap:4px;">
        <i data-lucide="user" style="width:14px;height:14px;color:var(--gray-400);"></i>
        <span>${getUserName(r.requestedBy)}</span>
      </div>
      <div style="margin-top:4px;color:var(--amber-700);font-size:0.75rem;"><i data-lucide="message-square" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> ${r.reason||'ขอแก้ไข'}</div>
    </td>
    <td id="aud-req-status-${r.id}"><span class="badge badge-waiting">คำขอแก้ไข</span></td>
    <td style="text-align:center;" onclick="event.stopPropagation();">
      <button class="btn btn-warning btn-sm" onclick="audOpenEditRequest('${r.id}')"><i data-lucide="search"></i> ตรวจสอบ</button>
    </td>
  </tr>`;
}

function audOpenEditRequest(reqId) {
  const req = DB.getEditRequests().find(r => r.id === reqId);
  if (!req) return;
  const billId = req.billId;
  const bill = DB.getBillById(billId);
  if (!bill) return;

  const images = DB.getBillImages ? DB.getBillImages(billId) : [];
  const services = DB.getBillServices(billId);
  const sales = DB.getBillSales(billId);
  const supplies = DB.getBillSupplies(billId);

  let imgIdx = 0;
  const imgSrc = images.length ? images[imgIdx]?.data || '' : '';

  openModal(`
  <div class="modal" style="width:1400px; max-width:98vw; height:90vh; max-height:900px; display:flex; flex-direction:column; border-radius:var(--radius-lg); box-shadow:var(--shadow-xl);">
    <div class="modal-header" style="flex-shrink:0; background:var(--amber-50); border-bottom:1px solid var(--amber-200); z-index:10;">
      <h3 class="modal-title" style="color:var(--amber-800);"><i data-lucide="pencil"></i>พิจารณาคำขอแก้ไขบิล — ${bill.hn||''} — ${bill.customerName}</h3>
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
          <i data-lucide="image-off" style="width:48px;height:48px;"></i><p>ไม่มีภาพ OPD</p>
        </div>`}
      </div>
      <!-- Right: Data -->
      <div class="split-right" style="flex:1;min-width:320px;display:flex;flex-direction:column;background:var(--white);">
        <div class="split-right-body" style="flex:1;overflow-y:auto;padding:20px;">
          <div class="alert-box alert-warning" style="margin-bottom:12px;">
            <i data-lucide="info"></i>
            <span><strong>เหตุผลที่ขอแก้ไข:</strong> ${req.reason}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;background:var(--gray-50);padding:12px;border-radius:var(--radius-md);border:1px solid var(--gray-100);">
            <div><div style="font-size:0.75rem;color:var(--gray-500);">HN</div><div style="font-weight:700;">${bill.hn||'-'}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">วันที่</div><div style="font-weight:600;">${formatDate(bill.date)}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">ลูกค้า</div><div style="font-weight:700;">${bill.customerName}</div></div>
            <div><div style="font-size:0.75rem;color:var(--gray-500);">สาขา</div><div style="font-weight:600;">${bill.branch}</div></div>
            <div style="grid-column:span 2;">
              <div style="font-size:0.75rem;color:var(--gray-500);">ผู้บันทึก</div>
              <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
                <i data-lucide="user" style="width:16px;height:16px;color:var(--burgundy-500);"></i>
                ${getUserName(bill.createdBy)}
              </div>
            </div>
          </div>
          ${services.length ? `
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">ค่ามือ</span></div>
          ${services.map(s => `
          <div class="audit-item ${s.is_superseded?'superseded':''}" style="padding:10px;border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:8px;background:${s.is_superseded?'var(--gray-50)':'var(--white)'};">
            <div style="font-weight:600;margin-bottom:4px;font-size:1.1rem;color:var(--burgundy-800);">${s.is_superseded?'<span class="badge badge-superseded">ยกเลิก</span> ':''}${(DB.getProgramByCode?DB.getProgramByCode(s.programCode)?.name:null)||s.programName||s.programCode||'-'}</div>
            <div style="font-size:0.82rem;color:var(--gray-600);display:flex;justify-content:space-between;">
              <span></span>
              <span style="font-weight:700;color:var(--burgundy-700);">ค่ามือ ฿${formatCurrency(s.commission)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--gray-400);margin-top:4px;">ลงโดย: ${getUserName(s.createdBy)}</div>
          </div>`).join('')}` : ''}
          ${sales.length ? `
          <div class="section-header" style="margin:16px 0 10px;"><span class="section-title">ค่าคอมมิชชั่น</span></div>
          ${sales.map(s => `
          <div class="audit-item ${s.is_superseded?'superseded':''}" style="padding:10px;border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:8px;background:${s.is_superseded?'var(--gray-50)':'var(--white)'};">
            <div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              ${s.is_superseded?'<span class="badge badge-superseded">ยกเลิก</span>':''}
              ${typeBadge(s.type)}
              <span style="font-weight:600;">${s.newProgram||'-'}</span>
            </div>
            ${s.oldProgram ? `<div style="font-size:0.78rem;color:var(--gray-500);margin-bottom:6px;padding:6px;background:var(--gray-50);border-radius:4px;">
              โปรแกรมเดิม: <strong>${s.oldProgram}</strong> (฿${formatCurrency(s.oldPrice)}) <i data-lucide="arrow-right" style="width:12px;display:inline-block;vertical-align:middle;margin:0 4px;"></i> อัพเป็น: <strong>${s.newProgram}</strong> (฿${formatCurrency(s.newPrice)})
            </div>` : ''}
            <div style="font-size:0.82rem;color:var(--gray-600);display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>ยอดเต็ม/ส่วนต่าง: ฿${formatCurrency(s.commissionBase)} × ${s.commissionPct}%</span>
              <span style="font-weight:700;color:var(--burgundy-700);">คอม: ฿${formatCurrency(s.commissionAmt)}</span>
            </div>
          </div>`).join('')}` : ''}
        </div>
        <div class="split-right-footer" style="padding:16px;border-top:1px solid var(--gray-200);display:flex;gap:12px;background:var(--white);">
          <button class="btn btn-danger" style="flex:1;padding:12px;" onclick="audPromptRejectEdit('${req.id}', '${billId}')">
            <i data-lucide="x-circle"></i> ไม่อนุมัติให้แก้
          </button>
          <button class="btn btn-success" style="flex:1;padding:12px;" onclick="audApproveEdit('${req.id}','${billId}')">
            <i data-lucide="check-circle"></i> อนุมัติให้แก้
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

function audApproveEdit(reqId, billId) {
  if (DB.updateEditRequest) DB.updateEditRequest(reqId, 'อนุมัติแล้ว', currentUser.id);
  if (DB.updateBillStatus) DB.updateBillStatus(billId, 'รอแก้ไข', currentUser.id, 'อนุมัติให้แก้ไขได้');
  closeModalDirect();
  Toast.show('อนุมัติคำขอแก้ไขแล้ว', 'success');
  audRender();
}
function audPromptRejectEdit(reqId, billId) {
  closeModalDirect();
  setTimeout(() => {
    openModal(`
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title"><i data-lucide="x-circle"></i>ไม่อนุมัติคำขอแก้ไข</h3>
        <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">เหตุผลที่ไม่อนุมัติ <span class="required">*</span></label>
          <textarea id="aud-edit-reject-note" class="form-textarea" rows="4" placeholder="ระบุเหตุผลที่ไม่อนุมัติให้แก้ไขบิล..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
        <button class="btn btn-danger" onclick="audDoRejectEdit('${reqId}', '${billId}')"><i data-lucide="x-circle"></i> ยืนยันไม่อนุมัติ</button>
      </div>
    </div>`);
    lucide.createIcons();
  }, 300);
}
function audDoRejectEdit(reqId, billId) {
  const note = document.getElementById('aud-edit-reject-note')?.value.trim();
  if (!note) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  if (DB.updateEditRequest) DB.updateEditRequest(reqId, 'ไม่อนุมัติ', currentUser.id, note);
  if (DB.updateBillStatus) DB.updateBillStatus(billId, 'อนุมัติแล้ว', currentUser.id, 'ไม่อนุมัติให้แก้ไข: ' + note);
  closeModalDirect();
  Toast.show('ปฏิเสธคำขอแก้ไขแล้ว', 'warning');
  audRender();
}

// ── TAB: Deposit payment verification ─────────────────────
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

// ── TAB 2: Stock Audit ────────────────────────────────────
async function audRenderStock(body) {
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>`;
  const requests = await DB.getPendingOpdStockRequestsSupabase();
  body.innerHTML = `<div class="glass-card" style="margin-bottom:12px;padding:14px 16px;"><span style="font-size:0.84rem;color:var(--gray-600);">รายการ OPD รอตรวจตัดสต๊อก</span> <span class="badge badge-pending">${requests.length} ใบ</span><p style="font-size:0.78rem;color:var(--gray-500);margin:6px 0 0;">1 แถวต่อ 1 ใบ OPD</p></div>
  <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>ชื่อลูกค้า</th><th>โปรแกรมบริการ</th><th>รายการเบิก</th><th>ผู้บันทึก</th><th>สถานะ</th><th>OPD</th><th>จัดการ</th></tr></thead><tbody>
  ${requests.length ? requests.map(r => `<tr id="opd-stock-row-${r.billId}"><td>${formatDate(r.date)}</td><td>${r.branch||'-'}</td><td>${r.customerName||'-'}</td><td>${r.programSummary||'-'}</td><td>${r.supplyCount} รายการ</td><td>${r.createdByName||'-'}</td><td>${statusBadge(r.auditStatus)}</td><td><button class="btn btn-ghost btn-sm" onclick="audOpenStockRequest('${r.billId}')">ดู OPD</button></td><td><button class="btn btn-success btn-sm" onclick="audStockAction('${r.billId}','อนุมัติแล้ว')">อนุมัติ</button> <button class="btn btn-danger btn-sm" onclick="audStockReject('${r.billId}')">ตีกลับ</button></td></tr>`).join('') : `<tr><td colspan="9"><div class="empty-state">ไม่มี OPD รอตรวจตัดสต๊อก</div></td></tr>`}
  </tbody></table></div></div>`;
  lucide.createIcons();
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
  openModal(`<div class="modal" style="width:1280px;max-width:98vw;height:86vh;display:flex;flex-direction:column;"><div class="modal-header"><h3 class="modal-title">ตรวจตัดสต๊อก — ${bill.customer_name||'-'}</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()">×</button></div><div style="flex:1;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;"><div style="background:#111;padding:8px;">${images.length ? images.map(im=>`<img src="${im.file_url}" alt="รูป OPD" style="width:100%;margin-bottom:10px;" />`).join('') : `<p style="color:white;">ไม่มีรูป OPD</p>`}</div><div><p><strong>วันที่:</strong> ${formatDate(bill.bill_date)} &nbsp; <strong>สาขา:</strong> ${bill.branch_name||'-'}</p><p><strong>ลูกค้า:</strong> ${bill.customer_name||'-'} &nbsp; <strong>HN:</strong> ${bill.hn||'-'}</p><h4>รายการเบิกทั้งหมด (${supplies.length} รายการ)</h4><div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>รหัสสินค้า</th><th>รายการเบิก</th><th>จำนวน</th><th>หน่วย</th></tr></thead><tbody>${supplies.map(s=>`<tr><td>${s.category||'ทั่วไป'}</td><td>${s.product_code||'-'}</td><td>${s.product_name||'-'}</td><td>${s.qty}</td><td>${s.unit||'-'}</td></tr>`).join('')}</tbody></table></div></div></div><div class="modal-footer"><button class="btn btn-danger" onclick="audStockReject('${billId}')">ตีกลับทั้งชุด</button><button class="btn btn-success" onclick="audStockAction('${billId}','อนุมัติแล้ว')">อนุมัติตัดสต๊อก</button></div></div>`);
  lucide.createIcons();
}
function audOpenStockLog(logId) {
  Toast.show('หน้าต่างรายละเอียดนี้กำลังปรับปรุง กรุณาใช้ปุ่มอนุมัติ/ตีกลับจากตารางแทนไปก่อนนะคะ', 'error', 5000);
  return;
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

// ── TAB 3: APSX Compare ──────────────────────────────────
function audRenderCompare(body) {
  body.innerHTML = `
  <div class="glass-card">
    <div class="section-header" style="margin-bottom:14px;"><span class="section-title">เทียบเบิก APSX vs ระบบ</span></div>
    <div class="alert-box alert-info" style="margin-bottom:16px;">
      <i data-lucide="info"></i>
      <span>นำเข้าไฟล์ CSV จาก APSX เพื่อเทียบกับรายการเบิกในระบบของสาขา ${currentBranch}</span>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
      <label class="btn btn-secondary" style="cursor:pointer;">
        <i data-lucide="upload"></i> นำเข้าไฟล์ APSX (.csv)
        <input type="file" accept=".csv" style="display:none;" onchange="audLoadCSV(event)" />
      </label>
      <button class="btn btn-primary" id="aud-compare-btn" onclick="audRunCompare()" disabled>
        <i data-lucide="git-compare"></i> ตรวจสอบ
      </button>
    </div>
    <div id="csv-preview"></div>
    <div id="compare-result"></div>
  </div>`;
  lucide.createIcons();
}

window._apsxData = [];
function audLoadCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
    _apsxData = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.replace(/"/g,'').trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i]||'');
      return obj;
    }).filter(r => r[headers[0]]);

    const preview = document.getElementById('csv-preview');
    if (preview) {
      preview.innerHTML = `
      <div class="alert-box alert-success" style="margin-bottom:12px;"><i data-lucide="check-circle"></i><span>โหลด ${_apsxData.length} รายการจากไฟล์ CSV</span></div>
      <div class="table-wrap" style="max-height:200px;overflow:auto;margin-bottom:12px;">
        <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${_apsxData.slice(0,10).map(row => `<tr>${headers.map(h => `<td>${row[h]||''}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div>`;
    }
    const btn = document.getElementById('aud-compare-btn');
    if (btn) btn.disabled = false;
    lucide.createIcons();
  };
  reader.readAsText(file, 'UTF-8');
}

function audRunCompare() {
  const result = document.getElementById('compare-result');
  if (!result) return;
  result.innerHTML = `<div class="loading-placeholder" style="height:120px;"><div class="spinner"></div><p>AI กำลังวิเคราะห์...</p></div>`;
  lucide.createIcons();

  setTimeout(() => {
    const syslogs = DB.getStockLogs({ branch: currentBranch, auditStatus: 'อนุมัติแล้ว' });
    const sysMap = {};
    syslogs.forEach(l => {
      if (!sysMap[l.productCode]) sysMap[l.productCode] = 0;
      if (l.direction === 'IN') sysMap[l.productCode] += l.qty;
      else if (l.direction === 'OUT') sysMap[l.productCode] -= l.qty;
    });

    const rows = _apsxData.map(row => {
      const code = row['รหัสสินค้า'] || row['code'] || Object.values(row)[0];
      const name = row['ชื่อสินค้า'] || row['name'] || Object.values(row)[1];
      const apsxQty = parseInt(row['จำนวน'] || row['qty'] || Object.values(row)[2]) || 0;
      const sysQty = sysMap[code] || 0;
      const diff = sysQty - apsxQty;
      return { code, name, apsxQty, sysQty, diff, match: diff === 0 };
    });

    const mismatches = rows.filter(r => !r.match).length;

    result.innerHTML = `
    <div class="${mismatches===0?'alert-box alert-success':'alert-box alert-warning'}" style="margin-bottom:12px;">
      <i data-lucide="${mismatches===0?'check-circle':'alert-triangle'}"></i>
      <span>${mismatches===0?'ข้อมูลตรงกันทั้งหมด':'พบความคลาดเคลื่อน '+mismatches+' รายการ'}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th class="num">APSX</th><th class="num">ระบบ</th><th class="num">ต่าง</th><th>สถานะ</th></tr></thead>
        <tbody>
          ${rows.map(r => `
          <tr style="${r.match?'':'background:var(--red-100)'}">
            <td><code style="font-size:0.75rem;background:rgba(0,0,0,0.06);padding:2px 5px;border-radius:4px;">${r.code}</code></td>
            <td>${r.name||'-'}</td>
            <td class="num">${r.apsxQty}</td>
            <td class="num">${r.sysQty}</td>
            <td class="num" style="font-weight:700;color:${r.diff>0?'var(--green-600)':r.diff<0?'var(--red-600)':'var(--gray-500)'};">${r.diff>0?'+':''}${r.diff}</td>
            <td>${r.match?'<span class="badge badge-approved">ตรง</span>':'<span class="badge badge-rejected">ไม่ตรง</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
    lucide.createIcons();
  }, 1500);
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

