/**
 * ARANA CLINIC — Admin Dashboard Module
 * js/modules/admin_dashboard.js
 */

let adminDashboardState = {
  filters: { branch: '', dateFrom: '', dateTo: '' }
};

function renderAdminDashboard(container) {
  // Set default filters if not set (e.g. today's date)
  if (!adminDashboardState.filters.dateFrom && !adminDashboardState.filters.dateTo) {
    const isoDate = todayISO();
    adminDashboardState.filters.dateFrom = isoDate;
    adminDashboardState.filters.dateTo = isoDate;
  }

  container.innerHTML = `
  <div style="max-width:1200px; margin:0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
      <h2 style="color:var(--burgundy-900); display:flex; align-items:center; gap:8px;">
        <i data-lucide="layout-dashboard"></i> ระบบ Admin Dashboard
      </h2>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar" style="margin-bottom:20px;">
      <div class="filter-group">
        <label class="filter-label">สาขา</label>
        <select class="filter-select" id="ad-branch" onchange="adApplyFilter()">
          <option value="">ทุกสาขา</option>
          <option value="พิษณุโลก">พิษณุโลก</option>
          <option value="กำแพงเพชร">กำแพงเพชร</option>
          <option value="แม่สอด">แม่สอด</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">จากวันที่</label>
        <input type="date" class="filter-input" id="ad-date-from" onchange="adApplyFilter()" />
      </div>
      <div class="filter-group">
        <label class="filter-label">ถึงวันที่</label>
        <div style="display:flex; gap:8px;">
          <input type="date" class="filter-input" id="ad-date-to" onchange="adApplyFilter()" style="flex:1;" />
          <button class="btn btn-secondary btn-sm" onclick="adClearFilter()" style="padding:0 12px; white-space:nowrap;"><i data-lucide="x"></i> ล้าง</button>
        </div>
      </div>
    </div>

    <!-- KPIs -->
    <div id="ad-kpi-container" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:24px;">
      <!-- Populated by JS -->
    </div>

    <!-- Photo Gallery -->
    <div class="glass-card">
      <h3 style="margin-bottom:16px; display:flex; align-items:center; gap:8px; color:var(--gray-800);">
        <i data-lucide="image"></i> คลังรูปภาพ OPD (Photo Gallery)
      </h3>
      <div id="ad-gallery-container" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:16px;">
        <!-- Populated by JS -->
      </div>
    </div>
  </div>`;

  // Set filter UI values
  document.getElementById('ad-branch').value = adminDashboardState.filters.branch;
  document.getElementById('ad-date-from').value = adminDashboardState.filters.dateFrom;
  document.getElementById('ad-date-to').value = adminDashboardState.filters.dateTo;

  adRenderContent();
  lucide.createIcons();
}

function adApplyFilter() {
  adminDashboardState.filters.branch = document.getElementById('ad-branch').value;
  adminDashboardState.filters.dateFrom = document.getElementById('ad-date-from').value;
  adminDashboardState.filters.dateTo = document.getElementById('ad-date-to').value;
  adRenderContent();
}

function adClearFilter() {
  adminDashboardState.filters = { branch: '', dateFrom: '', dateTo: '' };
  renderAdminDashboard(document.getElementById('page-content'));
}

function adRenderContent() {
  const f = adminDashboardState.filters;
  
  // 1. Get all bills that match the filters
  let bills = DB.getBills();
  if (f.branch) bills = bills.filter(b => b.branch === f.branch);
  if (f.dateFrom) bills = bills.filter(b => b.date >= f.dateFrom);
  if (f.dateTo) bills = bills.filter(b => b.date <= f.dateTo);

  const billIds = new Set(bills.map(b => b.id));

  // 2. Get images that belong to the filtered bills
  const allImages = DB._get ? (DB._get('bill_images') || []) : [];
  const filteredImages = allImages.filter(img => billIds.has(img.billId));

  // 3. Render KPIs
  const kpiContainer = document.getElementById('ad-kpi-container');
  if (kpiContainer) {
    kpiContainer.innerHTML = `
      <div class="stat-card bg-pastel-blue" style="padding:16px; border-radius:12px; border:none; box-shadow:var(--shadow-sm);">
        <div style="font-size:0.85rem; color:var(--burgundy-800); font-weight:600; margin-bottom:4px;">จำนวนบิลทั้งหมด</div>
        <div style="font-size:1.5rem; font-weight:800; color:var(--burgundy-900);">${bills.length} บิล</div>
      </div>
      <div class="stat-card bg-pastel-pink" style="padding:16px; border-radius:12px; border:none; box-shadow:var(--shadow-sm);">
        <div style="font-size:0.85rem; color:var(--burgundy-800); font-weight:600; margin-bottom:4px;">จำนวนรูปภาพ OPD</div>
        <div style="font-size:1.5rem; font-weight:800; color:var(--burgundy-900);">${filteredImages.length} รูป</div>
      </div>
    `;
  }

  // 4. Render Gallery
  const galleryContainer = document.getElementById('ad-gallery-container');
  if (galleryContainer) {
    if (filteredImages.length === 0) {
      galleryContainer.style.display = 'block';
      galleryContainer.innerHTML = `<div class="empty-state" style="padding:40px 0;"><i data-lucide="image-off"></i><h4>ไม่พบรูปภาพ</h4><p>ไม่มีรูปภาพ OPD ตามเงื่อนไขที่เลือก</p></div>`;
      lucide.createIcons();
      return;
    }

    galleryContainer.style.display = 'grid';
    galleryContainer.innerHTML = filteredImages.map(img => {
      const bill = bills.find(b => b.id === img.billId) || {};
      return `
        <div style="background:var(--white); border:1px solid var(--gray-200); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-sm); display:flex; flex-direction:column;">
          <div style="height:180px; width:100%; overflow:hidden; cursor:pointer;" onclick="adViewImage('${img.data}', '${bill.hn || '-'}', '${bill.customerName || '-'}')">
            <img src="${img.data}" style="width:100%; height:100%; object-fit:cover; transition:var(--transition);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" />
          </div>
          <div style="padding:12px;">
            <div style="font-weight:700; color:var(--gray-800); font-size:0.9rem; margin-bottom:4px;">${bill.customerName || 'ไม่ระบุชื่อ'}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <code style="font-size:0.75rem; background:var(--gray-100); padding:2px 6px; border-radius:4px;">${bill.hn || '-'}</code>
              <span style="font-size:0.75rem; color:var(--gray-500);">${formatDate(bill.date)}</span>
            </div>
            <div style="font-size:0.75rem; color:var(--burgundy-600); margin-top:6px; text-align:right;">
              ${bill.branch || '-'}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function adViewImage(src, hn, customerName) {
  openModal(`
    <div class="modal" style="max-width:800px; width:95%; background:transparent; box-shadow:none;">
      <div style="text-align:right; margin-bottom:8px;">
        <button class="btn btn-ghost btn-icon" style="color:white; background:rgba(0,0,0,0.5);" onclick="closeModalDirect()"><i data-lucide="x"></i></button>
      </div>
      <div style="background:white; border-radius:12px; overflow:hidden;">
        <img src="${src}" style="width:100%; display:block;" />
        <div style="padding:16px; background:var(--white);">
          <div style="font-weight:700; font-size:1.1rem; margin-bottom:4px;">${customerName}</div>
          <div style="color:var(--gray-500); font-size:0.9rem;">HN: ${hn}</div>
        </div>
      </div>
    </div>
  `);
  lucide.createIcons();
}
