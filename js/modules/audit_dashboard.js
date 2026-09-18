// ── AUDIT DASHBOARD: แดชบอร์ด สรุปงานทีมออดิท ────────────────────
let adashTrendChart = null;
let adashMixChart = null;
let adashRange = 7;
let adashBranch = '';

function adashCanAccess() {
  return currentUser && ['Admin', 'Audit', 'CommissionAudit', 'StockAudit'].includes(currentUser.role);
}

function adashParseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function adashDayKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function adashPendingDays(v) {
  const d = adashParseDate(v);
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function adashAuditName(auditBy) {
  const u = DB.getUserById ? DB.getUserById(auditBy) : null;
  return (u && u.name) || auditBy || '-';
}

function adashStatusBadge(auditBy, action) {
  return action === 'อนุมัติ'
    ? `<span class="badge badge-success"><i data-lucide="user"></i>${adashAuditName(auditBy)}</span>`
    : `<span class="badge badge-danger"><i data-lucide="user"></i>${adashAuditName(auditBy)}</span>`;
}

// ── RENDER ────────────────────────────────────────────────
function renderAuditDashboard(container) {
  if (!adashCanAccess()) {
    container.innerHTML = `<div class="empty-state"><i data-lucide="lock"></i><h4>คุณไม่มีสิทธิ์เข้าถึงแดชบอร์ดนี้</h4></div>`;
    lucide.createIcons();
    return;
  }
  container.innerHTML = `
  <div class="filter-bar">
    <div class="filter-group">
      <label class="filter-label">ช่วงเวลา</label>
      <select class="filter-select" id="adash-range" onchange="adashReload()">
        <option value="7">7 วันล่าสุด</option>
        <option value="14">14 วันล่าสุด</option>
        <option value="30">30 วันล่าสุด</option>
      </select>
    </div>
    <div class="filter-group">
      <label class="filter-label">สาขา</label>
      <select class="filter-select" id="adash-branch" onchange="adashBranch = this.value; adashRenderData();">
        <option value="">ทุกสาขา</option>
        <option value="พิษณุโลก">พิษณุโลก</option>
        <option value="กำแพงเพชร">กำแพงเพชร</option>
        <option value="แม่สอด">แม่สอด</option>
      </select>
    </div>
    <div class="filter-group">
      <label class="filter-label">&nbsp;</label>
      <button class="btn btn-outline btn-sm" onclick="adashReload()"><i data-lucide="refresh-cw"></i>รีเฟรช</button>
    </div>
  </div>

  <div class="stats-grid" id="adash-kpi"></div>

  <div class="two-col" style="margin-bottom:22px;">
    <div class="glass-card" style="padding:16px;">
      <h4 style="margin:0 0 12px;font-size:0.95rem;">ผลงานการอนุมัติ/ตีกลับ รายวัน</h4>
      <div style="position:relative;height:280px;"><canvas id="adash-trend"></canvas></div>
    </div>
    <div class="glass-card" style="padding:16px;">
      <h4 style="margin:0 0 12px;font-size:0.95rem;">สัดส่วนงานค้างตรวจ</h4>
      <div style="position:relative;height:280px;"><canvas id="adash-mix"></canvas></div>
    </div>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;margin-bottom:22px;">
    <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <h4 style="margin:0;font-size:0.95rem;">ผลงานทีมออดิท รายบุคคล</h4>
      <span style="font-size:0.8rem;color:var(--gray-500);" id="adash-person-range"></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>ผู้ตรวจ</th><th class="num">อนุมัติ</th><th class="num">ตีกลับ</th><th class="num">รวม</th><th class="num">อัตราอนุมัติ</th><th>ตรวจล่าสุด</th></tr></thead>
      <tbody id="adash-person-tbody"></tbody>
    </table></div>
  </div>

  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <h4 style="margin:0;font-size:0.95rem;">งานค้างตรวจนานที่สุด</h4>
      <span style="font-size:0.8rem;color:var(--gray-500);">10 รายการแรก</span>

    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>ประเภท</th><th>วันที่</th><th>สาขา</th><th>รายการ</th><th>ผู้บันทึก</th><th class="num">ค้างมาแล้ว</th><th>จัดการ</th></tr></thead>
      <tbody id="adash-pending-tbody"></tbody>
    </table></div>
  </div>`;

  document.getElementById('adash-range').value = String(adashRange);
  document.getElementById('adash-branch').value = adashBranch;
  adashRenderData();
}

async function adashReload() {
  adashRange = Number(document.getElementById('adash-range')?.value || 7);
  Toast.show('กำลังรีเฟรชข้อมูล...', 'info');
  adashRenderData();
}

async function adashRenderData() {
  const kpi = document.getElementById('adash-kpi');
  if (!kpi) return;
  kpi.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);grid-column:1/-1;">กำลังโหลดข้อมูล...</div>`;

  const [bills, deposits, opdRequests, pendingStockLogs] = await Promise.all([
    DB.getPendingBillsSupabase ? DB.getPendingBillsSupabase() : [],
    DB.getPendingDepositsSupabase ? DB.getPendingDepositsSupabase() : [],
    DB.getPendingOpdStockRequestsSupabase ? DB.getPendingOpdStockRequestsSupabase() : [],
    DB.getPendingStockLogsSupabase ? DB.getPendingStockLogsSupabase() : []
  ]);
  const logs = DB.getAuditLogs ? DB.getAuditLogs() : [];

  // กรองสาขา
  const fb = list => adashBranch ? list.filter(x => (x.branch || x.branch_name || '') === adashBranch) : list;
  const fBills = fb(bills || []);
  const fDeposits = fb(deposits || []);
  const fOpdReq = fb(opdRequests || []);
  const fStockLogs = fb(pendingStockLogs || []);
  const fLogs = adashBranch ? logs.filter(l => {
    const t = l.targetType === 'deposit' ? (deposits || []).find(d => d.id === l.targetId)
      : l.targetType === 'bill' ? (bills || []).find(b => b.id === l.targetId) : null;
    return !l.targetType || !t || (t.branch || t.branch_name || '') === adashBranch;
  }) : logs;

  // ── KPI ──
  const allPending = [
    ...fBills.map(b => ({ ...b, _type: 'bill' })),
    ...fDeposits.map(d => ({ ...d, _type: 'deposit' })),
    ...fOpdReq.map(r => ({ ...r, _type: 'opd' })),
    ...fStockLogs.map(s => ({ ...s, _type: 'stock' }))
  ];
  const overdue = allPending.filter(x => adashPendingDays(x.date || x.createdAt || x.deposit_date) > 3).length;
  const todayKey = adashDayKey(new Date());
  const logsToday = fLogs.filter(l => {
    const d = adashParseDate(l.createdAt || l.date);
    return d && adashDayKey(d) === todayKey;
  });
  const approvedToday = logsToday.filter(l => l.action === 'อนุมัติ' || l.newStatus === 'อนุมัติแล้ว' || l.newStatus === 'ยืนยันแล้ว').length;
  const rejectedToday = logsToday.filter(l => l.action === 'ตีกลับ' || l.newStatus === 'ตีกลับ').length;

  kpi.innerHTML = `
    ${adashKpiCard('badge-dollar-sign', 'burgundy', 'รอตรวจค่ามือ/คอม', fBills.length, 'ใบ OPD')}
    ${adashKpiCard('wallet-cards', 'rose', 'รอตรวจยอดมัดจำ', fDeposits.length, 'รายการ')}
    ${adashKpiCard('package-check', 'orange', 'รอตรวจตัดสต๊อก', fOpdReq.length + fStockLogs.length, 'OPD + เบิก/รับ')}
    ${adashKpiCard('alarm-clock', 'purple', 'ค้างเกิน 3 วัน', overdue, 'รายการ')}
    ${adashKpiCard('check-circle-2', 'green', 'อนุมัติวันนี้', approvedToday, 'รายการ')}
    ${adashKpiCard('x-circle', 'blue', 'ตีกลับวันนี้', rejectedToday, 'รายการ')}
  `;

  adashRenderCharts(fLogs, adashRange, fBills, fDeposits, fOpdReq, fStockLogs);
  adashRenderPersonTable(fLogs, adashRange);
  adashRenderPendingTable(allPending);
  lucide.createIcons();
}

function adashKpiCard(icon, color, label, value, sub) {
  return `<div class="stat-card">
    <div class="stat-icon ${color}"><i data-lucide="${icon}"></i></div>
    <div class="stat-body">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${color === 'burgundy' ? 'burgundy' : color === 'rose' ? 'rose' : ''}">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>
  </div>`;
}

// ── CHARTS ────────────────────────────────────────────────
function adashRenderCharts(logs, rangeDays, bills, deposits, opdReq, stockLogs) {
  // Bar: อนุมัติ/ตีกลับ รายวัน n วันล่าสุด
  const days = [];
  const approved = [], rejected = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = adashDayKey(d);
    days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    const dayLogs = logs.filter(l => {
      const dd = adashParseDate(l.createdAt || l.date);
      return dd && adashDayKey(dd) === key;
    });
    approved.push(dayLogs.filter(l => l.action === 'อนุมัติ' || l.newStatus === 'อนุมัติแล้ว' || l.newStatus === 'ยืนยันแล้ว').length);
    rejected.push(dayLogs.filter(l => l.action === 'ตีกลับ' || l.newStatus === 'ตีกลับ').length);
  }

  const trendCtx = document.getElementById('adash-trend');
  if (trendCtx) {
    if (adashTrendChart) { adashTrendChart.destroy(); adashTrendChart = null; }
    adashTrendChart = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [
          { label: 'อนุมัติ', data: approved, backgroundColor: 'rgba(34,155,110,0.75)', borderRadius: 6, maxBarThickness: 26 },
          { label: 'ตีกลับ', data: rejected, backgroundColor: 'rgba(214,69,65,0.7)', borderRadius: 6, maxBarThickness: 26 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'IBM Plex Sans Thai' } } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
        }
      }
    });
  }

  // Doughnut: สัดส่วนงานค้าง 4 ประเภท
  const mixCtx = document.getElementById('adash-mix');
  if (mixCtx) {
    if (adashMixChart) { adashMixChart.destroy(); adashMixChart = null; }
    adashMixChart = new Chart(mixCtx, {
      type: 'doughnut',
      data: {
        labels: ['ค่ามือ/คอม', 'ยอดมัดจำ', 'ตัดสต๊อก OPD', 'เบิก/รับทั่วไป'],
        datasets: [{
          data: [bills.length, deposits.length, opdReq.length, stockLogs.length],
          backgroundColor: ['rgba(139,26,58,0.8)', 'rgba(228,105,133,0.8)', 'rgba(245,158,66,0.8)', 'rgba(59,130,246,0.75)'],
          borderWidth: 2, borderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'IBM Plex Sans Thai' } } } }
      }
    });
  }
}

// ── TABLES ────────────────────────────────────────────────
function adashRenderPersonTable(logs, rangeDays) {
  const tbody = document.getElementById('adash-person-tbody');
  if (!tbody) return;
  const from = new Date(); from.setDate(from.getDate() - rangeDays);
  const inRange = logs.filter(l => {
    const d = adashParseDate(l.createdAt || l.date);
    return d && d >= from;
  });
  const byPerson = {};
  inRange.forEach(l => {
    const k = l.auditBy || '-';
    (byPerson[k] ||= { approved: 0, rejected: 0, last: null });
    if (l.action === 'อนุมัติ' || l.newStatus === 'อนุมัติแล้ว' || l.newStatus === 'ยืนยันแล้ว') byPerson[k].approved++;
    else if (l.action === 'ตีกลับ' || l.newStatus === 'ตีกลับ') byPerson[k].rejected++;
    const d = adashParseDate(l.createdAt || l.date);
    if (d && (!byPerson[k].last || d > byPerson[k].last)) byPerson[k].last = d;
  });
  const rows = Object.entries(byPerson).sort((a, b) => (b[1].approved + b[1].rejected) - (a[1].approved + a[1].rejected));
  const rangeLabel = document.getElementById('adash-person-range');
  if (rangeLabel) rangeLabel.textContent = `${rangeDays} วันล่าสุด · รวม ${inRange.length} รายการ`;
  tbody.innerHTML = rows.length ? rows.map(([k, v]) => {
    const total = v.approved + v.rejected;
    const rate = total ? Math.round((v.approved / total) * 100) : 0;
    const rateColor = rate >= 80 ? 'var(--green-600)' : rate >= 50 ? 'var(--orange-500)' : 'var(--rose-500)';
    return `<tr>
      <td style="font-weight:600;">${adashAuditName(k)}</td>
      <td class="num" style="color:var(--green-600);font-weight:700;">${v.approved}</td>
      <td class="num" style="color:var(--rose-500);font-weight:700;">${v.rejected}</td>
      <td class="num">${total}</td>
      <td class="num" style="color:${rateColor};font-weight:700;">${rate}%</td>
      <td class="nowrap" style="font-size:0.82rem;color:var(--gray-500);">${v.last ? formatDate(v.last.toISOString()) + ' ' + v.last.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty-state" style="padding:20px;"><i data-lucide="inbox"></i><h4>ไม่มีประวัติการตรวจในช่วงนี้</h4></div></td></tr>`;
}

function adashRenderPendingTable(allPending) {
  const tbody = document.getElementById('adash-pending-tbody');
  if (!tbody) return;
  const withDays = allPending.map(x => ({ ...x, _days: adashPendingDays(x.date || x.createdAt || x.deposit_date) }));
  withDays.sort((a, b) => b._days - a._days);
  const top = withDays.slice(0, 10);
  tbody.innerHTML = top.length ? top.map(x => {
    const typeCfg = {
      bill: { label: 'ค่ามือ/คอม', badge: 'badge-service', tab: 'commission', canGo: !audCanAccessCommission || audCanAccessCommission() },
      deposit: { label: 'ยอดมัดจำ', badge: 'badge-in', tab: 'deposits', canGo: !audCanAccessDeposits || audCanAccessDeposits() },
      opd: { label: 'ตัดสต๊อก OPD', badge: 'badge-out', tab: 'stock', canGo: !audCanAccessStock || audCanAccessStock() },
      stock: { label: 'เบิก/รับทั่วไป', badge: 'badge-transfer', tab: 'stock', canGo: !audCanAccessStock || audCanAccessStock() }
    }[x._type];
    const name = x.customerName || x.customer_name || (x.productName ? `${x.productName}${x.qty ? ' x' + x.qty : ''}` : '-') || '-';
    const dateVal = x.date || x.deposit_date || x.createdAt;
    const overdueCls = x._days > 3 ? 'color:var(--rose-500);font-weight:700;' : 'color:var(--gray-600);';
    const goBtn = typeCfg.canGo
      ? `<button class="btn btn-outline btn-sm" onclick="adashGoAudit('${typeCfg.tab}')"><i data-lucide="arrow-right-circle"></i>ไปตรวจ</button>`
      : `<span style="font-size:0.78rem;color:var(--gray-400);">-</span>`;
    return `<tr>
      <td><span class="badge ${typeCfg.badge}">${typeCfg.label}</span></td>
      <td class="nowrap">${formatDate(dateVal)}</td>
      <td>${x.branch || x.branch_name || '-'}</td>
      <td style="font-weight:600;">${name}</td>
      <td style="font-size:0.82rem;">${x.createdByName || x.created_by_name || '-'}</td>
      <td class="num" style="${overdueCls}">${x._days} วัน</td>
      <td>${goBtn}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state" style="padding:20px;"><i data-lucide="check-circle-2"></i><h4>ไม่มีงานค้างตรวจ 🎉</h4></div></td></tr>`;
}

function adashGoAudit(tab) {
  navigate('audit');
  if (typeof audSwitch === 'function') {
    setTimeout(() => audSwitch(tab), 50);
  }
}
