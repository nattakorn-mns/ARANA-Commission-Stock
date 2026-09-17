/**
 * ARANA CLINIC — History Module
 * js/modules/history.js
 */

let historyState = { page: 1, perPage: 10, filters: { dateFrom: '', dateTo: '', status: '', branch: '' } };

function renderHistory(container) {
  historyState.page = 1;
  container.innerHTML = `
  <div style="max-width:1200px; margin:0 auto;">
    <!-- Dashboard Summary (Frontdesk KPI) -->
    <div style="margin-bottom:14px;"><h2 style="margin:0 0 4px;">สรุปยอดของฉัน</h2><p style="margin:0;color:var(--gray-500);font-size:.9rem;">ดูค่ามือ ค่าคอมมิชชั่น และสถานะรายการของตัวเอง</p></div>
    <div id="hist-kpi-dashboard" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:10px;margin-bottom:16px;"></div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-group">
        <label class="filter-label">จากวันที่</label>
        <input type="date" class="filter-input" id="hist-from" onchange="histApplyFilter()" />
      </div>
      <div class="filter-group">
        <label class="filter-label">ถึงวันที่</label>
        <input type="date" class="filter-input" id="hist-to" onchange="histApplyFilter()" />
      </div>
      <div class="filter-group">
        <label class="filter-label">สาขา</label>
        <select class="filter-select" id="hist-branch" onchange="histApplyFilter()">
          <option value="">ทุกสาขา</option>
          <option value="พิษณุโลก">พิษณุโลก</option>
          <option value="กำแพงเพชร">กำแพงเพชร</option>
          <option value="แม่สอด">แม่สอด</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">สถานะ</label>
        <div style="display:flex; gap:8px;">
          <select class="filter-select" id="hist-status" onchange="histApplyFilter()" style="flex:1;">
            <option value="">ทุกสถานะ</option>
            <option value="ฉบับร่าง">ฉบับร่าง</option>
            <option value="รอตรวจสอบ">รอตรวจสอบ</option>
            <option value="อนุมัติแล้ว">อนุมัติแล้ว</option>
            <option value="ตีกลับ">ตีกลับ</option>
          </select>
          <button class="btn btn-secondary btn-sm" onclick="histClearFilter()" style="padding:0 12px; white-space:nowrap;"><i data-lucide="x"></i> ล้าง</button>
        </div>
      </div>
    </div>

    <!-- Table / Cards -->
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div id="history-content"></div>
    </div>
    <div id="history-pagination"></div>
  </div>`;

  histRender();
  lucide.createIcons();
}

function histGetBills() {
  const f = historyState.filters;
  let bills = DB.getBills();

  if (currentUser.role === 'Frontdesk') {
    const allServices = (DB._get('bill_services') || []);
    const allSales = (DB._get('bill_sales') || []);
    const allSupplies = (DB._get('bill_supplies') || []);
    const myBillIds = new Set([
      ...bills.filter(b => b.createdBy === currentUser.id).map(b => b.id),
      ...allServices.filter(s => s.createdBy === currentUser.id).map(s => s.billId),
      ...allSales.filter(s => s.createdBy === currentUser.id).map(s => s.billId),
      ...allSupplies.filter(s => s.createdBy === currentUser.id).map(s => s.billId),
    ]);
    bills = bills.filter(b => myBillIds.has(b.id));
  }

  if (f.dateFrom) bills = bills.filter(b => b.date >= f.dateFrom);
  if (f.dateTo) bills = bills.filter(b => b.date <= f.dateTo);
  if (f.status) bills = bills.filter(b => b.status === f.status);
  if (f.branch) bills = bills.filter(b => b.branch === f.branch);
  return bills.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function histApplyFilter() {
  historyState.filters.dateFrom = document.getElementById('hist-from').value;
  historyState.filters.dateTo = document.getElementById('hist-to').value;
  historyState.filters.branch = document.getElementById('hist-branch').value;
  historyState.filters.status = document.getElementById('hist-status').value;
  historyState.page = 1;
  histRender();
}

function histClearFilter() {
  ['hist-from','hist-to','hist-branch','hist-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  historyState.filters = { dateFrom: '', dateTo: '', status: '', branch: '' };
  historyState.page = 1;
  histRender();
}

function histRender() {
  const bills = histGetBills();
  const total = bills.length;
  
  // KPI Calculation
  let sumService = 0, sumUpsell = 0, sumCrosssell = 0, sumProduct = 0;
  const allServices = (DB._get('bill_services') || []);
  const allSales = (DB._get('bill_sales') || []);
  const billIds = new Set(bills.map(b => b.id));
  
  const myServices = allServices.filter(s => billIds.has(s.billId) && !s.is_superseded && (currentUser.role !== 'Frontdesk' || s.createdBy === currentUser.id));
  const mySales = allSales.filter(s => billIds.has(s.billId) && !s.is_superseded && (currentUser.role !== 'Frontdesk' || s.createdBy === currentUser.id));
  
  sumService = myServices.reduce((a, s) => a + (s.commission || 0), 0);
  mySales.forEach(s => {
    if (s.type === 'upsell') sumUpsell += (s.commissionAmt || 0);
    else if (s.type === 'crosssell') sumCrosssell += (s.commissionAmt || 0);
    else if (s.type === 'product') sumProduct += (s.commissionAmt || 0);
  });
  
  const grandTotal = sumService + sumUpsell + sumCrosssell + sumProduct;
  
  const kpiEl = document.getElementById('hist-kpi-dashboard');
  if (kpiEl) {
    kpiEl.style.gridTemplateColumns = 'repeat(6, 1fr)';
    kpiEl.innerHTML = `
      <div class="stat-card bg-pastel-pink" style="padding:12px;border-radius:8px;border:none;box-shadow:var(--shadow-sm);grid-column:span 2;">
        <div style="font-size:0.75rem;color:var(--burgundy-800);font-weight:600;margin-bottom:2px;">ค่ามือ</div>
        <div style="font-size:1.05rem;font-weight:800;color:var(--burgundy-900);">฿${formatCurrency(sumService)}</div>
      </div>
      <div class="stat-card bg-pastel-purple" style="padding:12px;border-radius:8px;border:none;box-shadow:var(--shadow-sm);grid-column:span 2;">
        <div style="font-size:0.75rem;color:var(--burgundy-800);font-weight:600;margin-bottom:2px;">ค่าคอม อัพเซลส์</div>
        <div style="font-size:1.05rem;font-weight:800;color:var(--burgundy-900);">฿${formatCurrency(sumUpsell)}</div>
      </div>
      <div class="stat-card bg-pastel-green" style="padding:12px;border-radius:8px;border:none;box-shadow:var(--shadow-sm);grid-column:span 2;">
        <div style="font-size:0.75rem;color:var(--burgundy-800);font-weight:600;margin-bottom:2px;">ค่าคอม ขายเพิ่ม</div>
        <div style="font-size:1.05rem;font-weight:800;color:var(--burgundy-900);">฿${formatCurrency(sumCrosssell)}</div>
      </div>
      <div class="stat-card bg-pastel-yellow" style="padding:12px;border-radius:8px;border:none;box-shadow:var(--shadow-sm);grid-column:span 3;">
        <div style="font-size:0.75rem;color:var(--burgundy-800);font-weight:600;margin-bottom:2px;">ค่าคอม ขายสินค้า</div>
        <div style="font-size:1.05rem;font-weight:800;color:var(--burgundy-900);">฿${formatCurrency(sumProduct)}</div>
      </div>
      <div class="stat-card bg-pastel-blue" style="padding:12px;border-radius:8px;border:none;box-shadow:var(--shadow-sm);grid-column:span 3;">
        <div style="font-size:0.8rem;color:var(--burgundy-800);font-weight:700;margin-bottom:2px;">รวมทั้งหมด</div>
        <div style="font-size:1.15rem;font-weight:800;color:var(--burgundy-900);">฿${formatCurrency(grandTotal)}</div>
      </div>
    `;
  }

  const { page, perPage } = historyState;
  const start = (page - 1) * perPage;
  const pageBills = bills.slice(start, start + perPage);
  const content = document.getElementById('history-content');
  if (!content) return;

  if (!pageBills.length) {
    content.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><h4>ไม่มีบิลในระบบ</h4><p>ยังไม่มีบิลที่บันทึกในระยะเวลาที่เลือก</p></div>`;
    document.getElementById('history-pagination').innerHTML = '';
    lucide.createIcons();
    return;
  }

  content.innerHTML = `
    <div class="table-wrap" style="border:none;border-radius:0;overflow-x:auto;">
      <table style="white-space:nowrap;">
        <thead>
          <tr>
            <th rowspan="2">วันที่</th>
            <th rowspan="2">HN</th>
            <th rowspan="2">ชื่อลูกค้า</th>
            <th rowspan="2">สาขา</th>
            <th rowspan="2" style="text-align:right; border-left:1px solid var(--gray-200); background:var(--gray-50);">ค่ามือ</th>
            <th colspan="2" style="text-align:center; border-left:1px solid var(--gray-200); background:var(--gray-50);">ค่าคอมมิชชั่น</th>
            <th colspan="2" style="text-align:center; border-left:1px solid var(--gray-200); background:var(--gray-50);">ขายสินค้า</th>
            <th rowspan="2" style="border-left:1px solid var(--gray-200);">สถานะ</th>
            <th rowspan="2" style="text-align:left;">จัดการ</th>
          </tr>
          <tr>
            <th style="text-align:right; border-left:1px solid var(--gray-200); font-size:0.75rem; background:var(--white);">ยอดเต็ม</th>
            <th style="text-align:right; font-size:0.75rem; background:var(--white);">ที่ได้จริง</th>
            <th style="text-align:right; border-left:1px solid var(--gray-200); font-size:0.75rem; background:var(--white);">ยอดเต็ม</th>
            <th style="text-align:right; font-size:0.75rem; background:var(--white);">ที่ได้จริง</th>
          </tr>
        </thead>
        <tbody>
          ${pageBills.map(b => {
            const bSvcs = myServices.filter(s => s.billId === b.id);
            const bSales = mySales.filter(s => s.billId === b.id);
            
            const isShared = b.parentBillId || DB.getBills().some(x => x.parentBillId === b.id);
            
            let svcFull = 0, svcEarn = 0;
            let commFull = 0, commEarn = 0;
            let prodFull = 0, prodEarn = 0;
            
            bSvcs.forEach(s => { svcFull += (s.price||0); svcEarn += (s.commission||0); });
            bSales.forEach(s => {
               if (s.type === 'product') {
                 prodFull += (s.commissionBase || s.amountPaid || 0);
                 prodEarn += (s.commissionAmt || 0);
               } else {
                 commFull += (s.commissionBase || s.amountPaid || 0);
                 commEarn += (s.commissionAmt || 0);
               }
            });

            return `
            <tr>
              <td>${formatDate(b.date)}</td>
              <td><code style="font-size:0.78rem;background:var(--gray-100);padding:2px 6px;border-radius:4px;">${b.hn || '-'}</code></td>
              <td style="font-weight:600;">${b.customerName || '-'} ${isShared ? '<span class="badge badge-product" style="font-size:0.65rem;padding:2px 4px;margin-left:4px;">บิลร่วม</span>' : ''}</td>
              <td>${b.branch || '-'}</td>
              
              <td style="text-align:right; border-left:1px solid var(--gray-100); color:var(--burgundy-700); font-weight:700;">฿${formatCurrency(svcEarn)}</td>
              
              <td style="text-align:right; border-left:1px solid var(--gray-100); color:var(--gray-500); font-size:0.85rem;">฿${formatCurrency(commFull)}</td>
              <td style="text-align:right; color:var(--burgundy-700); font-weight:700;">฿${formatCurrency(commEarn)}</td>
              
              <td style="text-align:right; border-left:1px solid var(--gray-100); color:var(--gray-500); font-size:0.85rem;">฿${formatCurrency(prodFull)}</td>
              <td style="text-align:right; color:var(--burgundy-700); font-weight:700;">฿${formatCurrency(prodEarn)}</td>
              
              <td style="border-left:1px solid var(--gray-100);">${statusBadge(b.status)}</td>
              <td style="text-align:left;">
                <div style="display:flex;gap:4px;justify-content:flex-start;">
                  <button class="btn btn-ghost btn-icon btn-sm" title="ดูรายละเอียด" onclick="histViewBill('${b.id}')">
                    <i data-lucide="eye"></i>
                  </button>
                  ${(b.status === 'ตีกลับ' || b.status === 'รอแก้ไข') ? `
                  <button class="btn btn-primary btn-sm" title="แก้ไขบิล" onclick="histDoEditBill('${b.id}')">
                    <i data-lucide="edit"></i> แก้ไขบิล
                  </button>` : ''}
                  ${b.status === 'ฉบับร่าง' ? `
                  <button class="btn btn-primary btn-sm" title="ทำรายการต่อ" onclick="histDoEditBill('${b.id}')">
                    <i data-lucide="pencil"></i> ทำรายการต่อ
                  </button>` : ''}
                  ${(b.status === 'รอตรวจสอบ' || b.status === 'อนุมัติแล้ว') ? `
                  <button class="btn btn-secondary btn-sm" title="ขอแก้ไข" onclick="histRequestEdit('${b.id}')">
                    <i data-lucide="pencil"></i> ขอแก้ไข
                  </button>` : ''}
                  ${b.status === 'ตีกลับ' && b.auditNote ? `
                  <button class="btn btn-warning btn-sm" title="เหตุผลตีกลับ" onclick="histShowNote('${b.id}')">
                    <i data-lucide="message-square"></i>
                  </button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  // Pagination
  const pages = Math.ceil(total / perPage);
  const pag = document.getElementById('history-pagination');
  if (pages <= 1) { pag.innerHTML = ''; } else {
    pag.innerHTML = `
      <div class="pagination">
        <span class="page-info">แสดง ${(page-1)*perPage+1} ถึง ${Math.min(page*perPage, total)} ทั้งหมด ${total} รายการ</span>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="page-btn" onclick="histGoPage(${page-1})" ${page<=1?'disabled':''}>
            <i data-lucide="chevron-left" style="width:14px;height:14px;"></i>
          </button>
          ${Array.from({length:pages},(_,i)=>i+1).map(p =>
            `<button class="page-btn ${p===page?'active':''}" onclick="histGoPage(${p})">${p}</button>`
          ).join('')}
          <button class="page-btn" onclick="histGoPage(${page+1})" ${page>=pages?'disabled':''}>
            <i data-lucide="chevron-right" style="width:14px;height:14px;"></i>
          </button>
        </div>
      </div>`;
  }
  lucide.createIcons();
}

function histGoPage(p) {
  historyState.page = p;
  histRender();
}

function histViewBill(billId) {
  const bill = DB.getBillById(billId);
  if (!bill) return;

  const services = DB.getBillServices(billId).filter(s => s.createdBy === currentUser.id || currentUser.role !== 'Frontdesk');
  const sales = DB.getBillSales(billId).filter(s => s.createdBy === currentUser.id || currentUser.role !== 'Frontdesk');
  const supplies = DB.getBillSupplies(billId).filter(s => s.createdBy === currentUser.id || currentUser.role !== 'Frontdesk');
  const images = DB.getBillImages ? DB.getBillImages(billId) : [];

  const totalService = services.filter(s=>!s.is_superseded).reduce((a,s)=>a+(s.commission||0),0);
  const totalCommission = sales.filter(s=>!s.is_superseded).reduce((a,s)=>a+(s.commissionAmt||0),0);

  // Split View Modal
  openModal(`
  <div class="modal" style="max-width:900px; width:95%;">
    <div class="modal-header">
      <h3 class="modal-title"><i data-lucide="file-text"></i>รายละเอียดบิล</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    
    <div class="modal-body" style="padding:0;">
      <!-- Shared Header -->
      <div style="padding:16px 20px;background:var(--burgundy-50);border-bottom:1px solid var(--burgundy-100);">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));gap:8px;">
          <div><span style="font-size:0.75rem;color:var(--gray-500);">HN</span><br/><strong style="font-size:0.95rem;">${bill.hn||'-'}</strong></div>
          <div style="grid-column:span 2;"><span style="font-size:0.75rem;color:var(--gray-500);">ชื่อลูกค้า</span><br/><strong style="font-size:0.95rem;">${bill.customerName}</strong></div>
          <div><span style="font-size:0.75rem;color:var(--gray-500);">วันที่</span><br/><strong>${formatDate(bill.date)}</strong></div>
          <div><span style="font-size:0.75rem;color:var(--gray-500);">สาขา</span><br/><strong>${bill.branch}</strong></div>
          <div><span style="font-size:0.75rem;color:var(--gray-500);">สถานะ</span><br/>${statusBadge(bill.status)}</div>
        </div>
        ${bill.auditNote ? `<div class="alert-box alert-warning" style="margin-top:12px;"><i data-lucide="alert-triangle"></i><span><strong>หมายเหตุ Audit:</strong> ${bill.auditNote}</span></div>` : ''}
      </div>

      <!-- Split Layout -->
      <div style="display:flex; flex-wrap:wrap;">
        
        <!-- Left: OPD Photos -->
        <div style="flex:1; min-width:300px; max-width:400px; background:var(--gray-50); border-right:1px solid var(--gray-200); padding:20px; max-height:600px; overflow-y:auto;">
          <h4 style="font-size:0.9rem;font-weight:700;color:var(--gray-700);margin-bottom:12px;display:flex;align-items:center;gap:6px;"><i data-lucide="camera" style="width:16px;height:16px;"></i> รูป OPD</h4>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${images.length 
              ? images.map(img => `<img src="${img.data}" style="width:100%; border-radius:var(--radius-md); border:1px solid var(--gray-200); box-shadow:var(--glass-shadow);" />`).join('') 
              : '<div style="padding:20px; text-align:center; color:var(--gray-400); font-size:0.8rem; border:1px dashed var(--gray-300); border-radius:var(--radius-md);">ไม่มีรูปภาพที่บันทึกไว้</div>'
            }
          </div>
        </div>

        <!-- Right: Data Details -->
        <div style="flex:2; min-width:320px; padding:20px; max-height:600px; overflow-y:auto;">
          ${services.length ? `
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">ค่ามือ</span></div>
          ${services.map(s => `
            <div class="${s.is_superseded?'superseded':''}" style="display:flex;justify-content:space-between;padding:10px 12px;background:${s.is_superseded?'var(--gray-50)':'var(--white)'};border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:6px;">
              <div style="display:flex; flex-direction:column; gap:2px;">
                <div style="font-size:0.7rem;color:var(--gray-500);">ลงโดย: ${getUserName(s.createdBy)}</div>
                <div>
                  ${s.is_superseded?'<span class="badge badge-superseded" style="margin-right:6px;">แก้ไขแล้ว</span>':''}
                  <span style="font-size:0.86rem;font-weight:600;">${s.programName||s.programCode||'-'}</span>
                </div>
              </div>
              <div style="text-align:right; align-self:flex-end;">
                <div style="font-size:0.9rem;font-weight:700;color:var(--burgundy-700);">ค่ามือ ฿${formatCurrency(s.commission)}</div>
              </div>
            </div>`).join('')}
          <div style="text-align:right;font-weight:700;color:var(--burgundy-700);margin-top:4px;font-size:0.9rem;margin-bottom:16px;">รวมค่ามือ ฿${formatCurrency(totalService)}</div>
          ` : ''}

          ${sales.length ? `
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">ค่าคอมมิชชั่น</span></div>
          ${sales.map(s => `
            <div class="${s.is_superseded?'superseded':''}" style="padding:10px 12px;background:${s.is_superseded?'var(--gray-50)':'var(--white)'};border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:6px;">
              <div style="margin-bottom:6px;">
                <div style="font-size:0.7rem;color:var(--gray-500);margin-bottom:4px;">ลงโดย: ${getUserName(s.createdBy)}</div>
                <div style="display:flex; align-items:center;">
                  ${s.is_superseded?'<span class="badge badge-superseded" style="margin-right:6px;">แก้ไขแล้ว</span>':''}
                  ${typeBadge(s.type)}
                  <span style="font-size:0.86rem;font-weight:600;margin-left:6px;">${s.newProgram||'-'}</span>
                </div>
              </div>
              <div style="font-size:0.78rem;color:var(--gray-500);margin-bottom:4px;padding:6px;background:var(--gray-50);border-radius:4px;">
                <div style="margin-bottom:2px;">ยอดลูกค้าจ่ายจริง: <strong>฿${formatCurrency(s.amountPaid)}</strong> ${s.installmentNo?`(งวด ${s.installmentNo})`:''}</div>
                ${s.oldProgram ? `<div>โปรแกรมเดิม: ${s.oldProgram} (฿${formatCurrency(s.oldPrice)})</div>` : ''}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;border-top:1px dashed var(--gray-200);padding-top:6px;">
                <div style="font-size:0.78rem;color:var(--gray-600);">
                  ฐานคิด ${s.commissionBaseManual?'<span style="color:var(--amber-600);font-weight:700;">(แก้เอง)</span>':''} ฿${formatCurrency(s.commissionBase)} × ${s.commissionPct}%
                  ${s.commissionNote ? `<br/><span style="color:var(--amber-700);">หมายเหตุ: ${s.commissionNote}</span>` : ''}
                </div>
                <div style="font-size:1rem;font-weight:800;color:var(--burgundy-700);">฿${formatCurrency(s.commissionAmt)}</div>
              </div>
            </div>`).join('')}
          <div style="text-align:right;font-weight:700;color:var(--burgundy-700);margin-top:4px;font-size:0.9rem;margin-bottom:16px;">รวมค่าคอม ฿${formatCurrency(totalCommission)}</div>
          ` : ''}

          ${supplies.length ? `
          <div class="section-header" style="margin-bottom:10px;"><span class="section-title">รายการเบิกวัสดุ/ยา</span></div>
          ${supplies.map(s => `
            <div class="${s.is_superseded?'superseded':''}" style="display:flex;justify-content:space-between;padding:8px 12px;background:${s.is_superseded?'var(--gray-50)':'var(--white)'};border:1px solid var(--gray-100);border-radius:var(--radius-sm);margin-bottom:5px;">
              <span style="font-size:0.84rem;">${s.is_superseded?'<span class="badge badge-superseded" style="margin-right:4px;">แก้ไขแล้ว</span>':''} <code>${s.productCode}</code> — ${s.productName||'-'}</span>
              <span style="font-weight:700;white-space:nowrap;">${s.qty} ${s.unit||''}</span>
            </div>`).join('')}
          ` : ''}
        </div>
      </div>
    </div>
    
    <div class="modal-footer" style="border-top:1px solid var(--gray-200);">
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <span style="font-size:0.85rem;color:var(--gray-600);">รวมที่ได้จากบิลนี้ (เฉพาะที่คุณลง): <strong style="color:var(--burgundy-700);font-size:1.1rem;margin-left:4px;">฿${formatCurrency(totalService+totalCommission)}</strong></span>
      </div>
      <button class="btn btn-ghost" onclick="closeModalDirect()">ปิดหน้าต่าง</button>
    </div>
  </div>`);
  
  lucide.createIcons();
}

function histRequestEdit(billId) {
  openModal(`
  <div class="modal">
    <div class="modal-header">
      <h3 class="modal-title"><i data-lucide="pencil"></i>ขอแก้ไขบิล</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="alert-box alert-info" style="margin-bottom:16px;">
        <i data-lucide="info"></i>
        <span>คำขอแก้ไขจะถูกส่งให้ Audit พิจารณา — บิลจะสามารถแก้ไขได้เมื่อได้รับการอนุมัติ</span>
      </div>
      <div class="form-group">
        <label class="form-label">เหตุผลที่ขอแก้ไข <span class="required">*</span></label>
        <textarea id="edit-reason" class="form-textarea" placeholder="อธิบายสิ่งที่ต้องการแก้ไข..." rows="4"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="histSubmitEditRequest('${billId}')">
        <i data-lucide="send"></i> ส่งคำขอ
      </button>
    </div>
  </div>`);
}

function histSubmitEditRequest(billId) {
  const reason = document.getElementById('edit-reason')?.value.trim();
  if (!reason) { Toast.show('กรุณากรอกเหตุผลที่ขอแก้ไข', 'error'); return; }
  DB.saveEditRequest({ billId, requestedBy: currentUser.id, reason, status: 'รอการอนุมัติ' });
  closeModalDirect();
  Toast.show('ส่งคำขอแก้ไขเรียบร้อย — รอ Audit พิจารณา 📨', 'success', 4000);
  histRender();
}

function histDoEditBill(billId) {
  if (typeof opdEditBill === 'function') {
    closeModalDirect();
    opdEditBill(billId);
  }
}

function histShowNote(billId) {
  const bill = DB.getBillById(billId);
  if (!bill || !bill.auditNote) return;
  openModal(`
  <div class="modal">
    <div class="modal-header">
      <h3 class="modal-title"><i data-lucide="message-square"></i>เหตุผลที่ตีกลับ</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <div class="alert-box alert-error">
        <i data-lucide="x-circle"></i>
        <span>${bill.auditNote}</span>
      </div>
      <p style="margin-top:12px;font-size:0.82rem;color:var(--gray-500);">ตีกลับโดย: ${getUserName(bill.auditBy)} เมื่อ ${formatDateTime(bill.auditDate)}</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModalDirect()">ปิด</button>
      <button class="btn btn-warning" onclick="closeModalDirect();histRequestEdit('${billId}')"><i data-lucide="pencil"></i> ขอแก้ไข</button>
    </div>
  </div>`);
}
