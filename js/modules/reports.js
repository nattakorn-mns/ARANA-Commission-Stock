/**
 * ARANA CLINIC — Reports Module
 * js/modules/reports.js
 */

let reportChart = null;
let reportRows = [];
let reportRequest = 0;
let reportLoading = false;
const rptEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function renderReports(container) {
  const users = [];
  reportRows = [];
  const isAdmin = ['Admin','Audit','CommissionAudit'].includes(currentUser.role);
  const fromStr = todayISO().slice(0, 7) + '-01';

  container.innerHTML = `
  <div>
    <!-- Filter -->
    <div class="filter-bar" style="margin-bottom:16px; position:relative;">
      <div class="filter-actions" style="position:absolute; top:12px; right:12px; display:flex; gap:4px;">
        <button class="btn btn-ghost btn-icon btn-sm" style="color:var(--gray-600);" onclick="rptExport()" title="Export CSV"><i data-lucide="download"></i></button>
        <button class="btn btn-ghost btn-icon btn-sm" style="color:var(--gray-600);" onclick="window.print()" title="พิมพ์"><i data-lucide="printer"></i></button>
      </div>
      ${isAdmin ? `<div class="filter-group">
        <label class="filter-label">พนักงาน</label>
        <select class="filter-select" id="rpt-user" onchange="rptRender()" style="min-width:140px;">
          <option value="">ทุกคน</option>
          ${users.map(u => `<option value="${u.id}">${u.nickname} (${u.name.split(' ')[0]})</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="filter-group">
        <label class="filter-label">จากวันที่</label>
        <input type="date" class="filter-input" id="rpt-from" value="${fromStr}" onchange="rptLoad()" style="min-width:130px;" />
      </div>
      <div class="filter-group">
        <label class="filter-label">ถึงวันที่</label>
        <input type="date" class="filter-input" id="rpt-to" value="${todayISO()}" onchange="rptLoad()" style="min-width:130px;" />
      </div>
      <div class="filter-group">
        <label class="filter-label">ประเภท</label>
        <select class="filter-select" id="rpt-cat" onchange="rptRender()">
          <option value="">ทั้งหมด</option>
          <option value="service">ค่ามือ</option>
          <option value="commission">ค่าคอมมิชชั่น</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">สาขา</label>
        <select class="filter-select" id="rpt-branch" onchange="rptRender()">
          <option value="">ทุกสาขา</option>
          <option value="พิษณุโลก">พิษณุโลก</option>
          <option value="กำแพงเพชร">กำแพงเพชร</option>
          <option value="แม่สอด">แม่สอด</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">คอมมิชชั่น %</label>
        <select class="filter-select" id="rpt-pct" onchange="rptRender()">
          <option value="">ทั้งหมด</option>
          <option value="0">0%</option>
          <option value="1">1%</option>
          <option value="2">2%</option>
          <option value="3">3%</option>
          <option value="5">5%</option>
          <option value="10">10%</option>
        </select>
      </div>
      <div class="filter-group" style="grid-column: 1 / -1;">
        <label class="filter-label">ค้นหา</label>
        <input type="text" class="filter-input" id="rpt-search" placeholder="ลูกค้า, โปรแกรม..." oninput="rptRender()" style="width:100%;" />
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="stats-grid" id="rpt-kpi" style="margin-bottom:20px;"></div>

    <!-- Chart -->
    <div class="chart-wrap" style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <h3 style="font-size:0.95rem;font-weight:700;color:var(--burgundy-800);">แนวโน้มค่าคอมมิชชั่น/ค่ามือ</h3>
      </div>
      <canvas id="rpt-chart"></canvas>
    </div>

    <!-- Table -->
    <div class="glass-card" style="padding:0;overflow:hidden;" id="rpt-table-card">
      <div class="section-header" style="padding:14px 16px;border-bottom:1px solid var(--gray-100);margin:0;">
        <span class="section-title">รายละเอียด</span>
        <span id="rpt-total-badge" class="badge badge-pending" style="margin-left:8px;"></span>
      </div>
      <div class="table-wrap" style="border:none;border-radius:0;" id="rpt-table-wrap">
        <div class="loading-placeholder"><div class="spinner"></div></div>
      </div>
    </div>
  </div>`;

  lucide.createIcons();
  rptLoad();
}

async function rptLoad() {
  const request = ++reportRequest;
  reportRows = [];
  reportLoading = false;
  rptRender();
  reportLoading = true;
  const wrap = document.getElementById('rpt-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-placeholder">กำลังโหลดรายงานที่อนุมัติแล้ว...</div>';
  try {
    const rows = await DB._appRpc('get_approved_reports', {
      from: document.getElementById('rpt-from').value,
      to: document.getElementById('rpt-to').value
    });
    if (request !== reportRequest || !wrap.isConnected) return;
    reportRows = rows || [];
    const select = document.getElementById('rpt-user');
    if (select) {
      const selected = select.value;
      const users = new Map(reportRows.map(r => [r.employeeId, r.employeeName]));
      select.innerHTML = '<option value="">ทุกคน</option>' + [...users].map(([id,name]) =>
        '<option value="' + rptEscape(id) + '">' + rptEscape(name) + '</option>').join('');
      if (users.has(selected)) select.value = selected;
    }
    reportLoading = false;
    rptRender();
  } catch (error) {
    if (request !== reportRequest || !wrap.isConnected) return;
    reportLoading = false;
    wrap.innerHTML = '<div class="empty-state">โหลดรายงานไม่สำเร็จ กรุณาลองใหม่หรือล็อกอินใหม่ <button class="btn btn-primary" onclick="rptLoad()">ลองอีกครั้ง</button></div>';
    console.error('Report load failed:', error);
  }
}

function rptGetRows() {
  const from = document.getElementById('rpt-from')?.value || '';
  const to = document.getElementById('rpt-to')?.value || '';
  const userId = document.getElementById('rpt-user')?.value || '';
  const branch = document.getElementById('rpt-branch')?.value || '';
  const cat = document.getElementById('rpt-cat')?.value || '';
  const search = document.getElementById('rpt-search')?.value.toLowerCase() || '';
  const pct = document.getElementById('rpt-pct')?.value || '';

  const role = currentUser.role;
  const uid = userId || (role === 'Frontdesk' ? currentUser.id : '');
  let rows = reportRows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  if (branch) rows = rows.filter(r => r.branch === branch);
  if (userId) rows = rows.filter(r => r.employeeId === userId);
  if (cat) rows = rows.filter(r => r.category === cat);
  if (pct) rows = rows.filter(r => r.commissionPct == pct);
  if (search) {
    rows = rows.filter(r =>
      (r.customerName || '').toLowerCase().includes(search) ||
      (r.oldProgram || '').toLowerCase().includes(search) ||
      (r.newProgram || '').toLowerCase().includes(search)
    );
  }
  return rows;
}

function rptRender() {
  if (reportLoading) return;
  const rows = rptGetRows();
  const active = rows.filter(r => !r.is_superseded);

  const totalService = active.filter(r => r.category === 'service').reduce((a, r) => a + (r.commissionAmt || 0), 0);
  const totalCommission = active.filter(r => r.category === 'commission').reduce((a, r) => a + (r.commissionAmt || 0), 0);
  const billSet = new Set(active.map(r => r.date + r.customerName));
  const custSet = new Set(active.map(r => r.customerName));

  // KPI
  const kpi = document.getElementById('rpt-kpi');
  if (kpi) kpi.innerHTML = `
    <div class="stat-card" style="padding:12px; gap:12px;">
      <div class="stat-icon burgundy"><i data-lucide="sparkles"></i></div>
      <div class="stat-body">
        <div class="stat-label">รวมค่ามือ</div>
        <div class="stat-value burgundy">฿${formatCurrency(totalService)}</div>
      </div>
    </div>
    <div class="stat-card" style="padding:12px; gap:12px;">
      <div class="stat-icon rose"><i data-lucide="trending-up"></i></div>
      <div class="stat-body">
        <div class="stat-label">รวมค่าคอมมิชชั่น</div>
        <div class="stat-value rose">฿${formatCurrency(totalCommission)}</div>
      </div>
    </div>
    <div class="stat-card" style="padding:12px; gap:12px;">
      <div class="stat-icon green"><i data-lucide="file-text"></i></div>
      <div class="stat-body">
        <div class="stat-label">จำนวนรายการ</div>
        <div class="stat-value">${active.length}</div>
      </div>
    </div>
    <div class="stat-card" style="padding:12px; gap:12px;">
      <div class="stat-icon blue"><i data-lucide="users"></i></div>
      <div class="stat-body">
        <div class="stat-label">ลูกค้า</div>
        <div class="stat-value">${custSet.size} คน</div>
      </div>
    </div>`;
  lucide.createIcons();

  // Chart
  rptDrawChart(active);

  // Table
  const wrap = document.getElementById('rpt-table-wrap');
  const badge = document.getElementById('rpt-total-badge');
  if (badge) badge.textContent = `${rows.length} รายการ`;
  if (!wrap) return;

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><i data-lucide="bar-chart-3"></i><h4>ไม่มีข้อมูลในช่วงเวลาที่เลือก</h4></div>`;
    lucide.createIcons(); return;
  }

  wrap.innerHTML = `
  <table>
    <thead>
      <tr>
        <th>วันที่</th>
        <th>สาขา</th>
        <th>พนักงาน</th>
        <th>ลูกค้า</th>
        <th>ประเภท</th>
        <th>โปรฯเดิม</th>
        <th>รายการใหม่/บริการ</th>
        <th class="num">ยอดลค.จ่าย</th>
        <th class="num">ฐานคิด</th>
        <th class="num">%</th>
        <th class="num" style="width:13%;">ค่ามือ</th>
        <th class="num" style="width:13%;">ค่าคอมมิชชั่น</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr class="${r.is_superseded?'superseded':''}">
        <td class="nowrap">${formatDate(r.date)}</td>
        <td>${rptEscape(r.branch||'-')}</td>
        <td style="font-size:0.8rem;">${rptEscape(r.employeeName || '-')}</td>
        <td style="font-weight:600;">${rptEscape(r.customerName||'-')}</td>
        <td>${r.category==='service'?'<span class="badge badge-service">ค่ามือ</span>':typeBadge(r.saleType)}</td>
        <td style="font-size:0.78rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${rptEscape(r.oldProgram||'')}">${r.oldProgram?`<span title="${rptEscape(r.oldProgram)}">${rptEscape(r.oldProgram.slice(0,20))}${r.oldProgram.length>20?'...':''}</span>`:'-'}</td>
        <td style="font-weight:600;min-width:150px;white-space:normal;" title="${rptEscape(r.newProgram||'')}">${rptEscape(r.newProgram||'-')}</td>
        <td class="num">${r.amountPaid?'฿'+formatCurrency(r.amountPaid):'-'}</td>
        <td class="num">${r.commissionBase?'฿'+formatCurrency(r.commissionBase):'-'}</td>
        <td class="num">${r.commissionPct?r.commissionPct+'%':'-'}</td>
        <td class="num" style="font-weight:700;color:var(--burgundy-700);">${r.category==='service'?'฿'+formatCurrency(r.commissionAmt||0):'-'}</td>
        <td class="num" style="font-weight:700;color:var(--rose-500);">${r.category==='commission'?'฿'+formatCurrency(r.commissionAmt||0):'-'}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr style="background:var(--burgundy-50);font-weight:700;">
        <td colspan="10" style="text-align:right;padding:10px 14px;color:var(--burgundy-800);">รวมทั้งหมด</td>
        <td class="num" style="color:var(--burgundy-700);font-size:1rem;">฿${formatCurrency(totalService)}</td>
        <td class="num" style="color:var(--rose-500);font-size:1rem;">฿${formatCurrency(totalCommission)}</td>
      </tr>
    </tfoot>
  </table>`;
}

function rptDrawChart(rows) {
  const ctx = document.getElementById('rpt-chart');
  if (!ctx) return;
  if (reportChart) { reportChart.destroy(); reportChart = null; }

  const byDate = {};
  rows.forEach(r => {
    const d = r.date?.slice(0, 10) || '';
    if (!byDate[d]) byDate[d] = { service: 0, commission: 0 };
    if (r.category === 'service') byDate[d].service += (r.commissionAmt || 0);
    else byDate[d].commission += (r.commissionAmt || 0);
  });
  const labels = Object.keys(byDate).sort();

  reportChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(d => formatDate(d)),
      datasets: [
        { label: 'ค่ามือ', data: labels.map(d => byDate[d]?.service || 0), backgroundColor: 'hsla(345,65%,45%,0.7)', borderColor: 'hsl(345,65%,45%)', borderWidth: 1, borderRadius: 4 },
        { label: 'ค่าคอมมิชชั่น', data: labels.map(d => byDate[d]?.commission || 0), backgroundColor: 'hsla(345,75%,62%,0.5)', borderColor: 'hsl(345,75%,62%)', borderWidth: 1, borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ฿${formatCurrency(ctx.raw)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '฿'+formatCurrency(v) } } }
    }
  });
}

function rptExport() {
  if (reportLoading) return;
  const rows = rptGetRows();
  const headers = ['วันที่','สาขา','พนักงาน','ลูกค้า','ประเภท','รายการ','ยอดจ่าย','ฐานคิด','%','ค่ามือ','ค่าคอมมิชชั่น'];
  const data = rows.map(r => [
    r.date, r.branch, r.employeeName, r.customerName, r.category, r.newProgram||'',
    r.amountPaid||0, r.commissionBase||0, r.commissionPct||0,
    r.category==='service'?(r.commissionAmt||0):0,
    r.category==='commission'?(r.commissionAmt||0):0
  ]);
  const csv = [headers, ...data].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `report_${todayISO()}.csv`;
  a.click();
}
