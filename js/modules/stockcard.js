/**
 * ARANA CLINIC — Stock Card Module
 * js/modules/stockcard.js
 */

let scTab = 'stockcard';
let wcCounted = {};
let wcCategory = 'ทั้งหมด';

function renderStockCardShell(container) {
  container.innerHTML = `
  <div>
    <div id="sc-body"></div>
  </div>`;
}

function renderStockCard(container) {
  scTab = 'stockcard';
  renderStockCardShell(container);
  scRender();
  lucide.createIcons();
}

function scSwitch(tab) {
  scTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`sc-tab-${tab}`);
  if (el) el.classList.add('active');
  scRender();
}

function renderWeeklyCount(container) {
  scTab = 'weekly';
  renderStockCardShell(container);
  scRender();
  lucide.createIcons();
}

function renderBalance(container) {
  scTab = 'balance';
  renderStockCardShell(container);
  scRender();
  lucide.createIcons();
}

function scRender() {
  const body = document.getElementById('sc-body');
  if (!body) return;
  if (scTab === 'stockcard') scRenderStockCard(body);
  else if (scTab === 'weekly') scRenderWeekly(body);
  else scRenderBalance(body);
}

// ── TAB 1: Stock Card ─────────────────────────────────────
function scRenderStockCard(body) {
  const canExport = currentUser.role !== 'Frontdesk';
  const canSeeBalance = currentUser.role !== 'Frontdesk';

  body.innerHTML = `
  <div class="filter-bar" style="position:relative;">
    ${canExport ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="scExportCSV()" style="position:absolute; top:12px; right:12px; color:var(--gray-600);" title="Export"><i data-lucide="download"></i></button>` : ''}
    <div class="filter-group" style="grid-column: 1 / -1;">
      <label class="filter-label">ค้นหา</label>
      <input type="text" class="filter-input" id="sc-search" placeholder="รหัส / ชื่อสินค้า..." oninput="scRenderTable()" style="width:100%;" />
    </div>
    <div class="filter-group">
      <label class="filter-label">จากวันที่</label>
      <input type="date" class="filter-input" id="sc-from" onchange="scRenderTable()" />
    </div>
    <div class="filter-group">
      <label class="filter-label">ถึงวันที่</label>
      <input type="date" class="filter-input" id="sc-to" onchange="scRenderTable()" />
    </div>
    <div class="filter-group">
      <label class="filter-label">ประเภท</label>
      <select class="filter-select" id="sc-type" onchange="scRenderTable()">
        <option value="">ทั้งหมด</option>
        <option value="IN">รับเข้า</option>
        <option value="OUT">เบิกออก</option>
        <option value="TRANSFER">โอนสาขา</option>
      </select>
    </div>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden;">
    <div class="table-wrap" style="border:none;border-radius:0;" id="sc-table-wrap">
      <div class="loading-placeholder"><div class="spinner"></div></div>
    </div>
  </div>`;

  setTimeout(() => scRenderTable(), 100);
}

async function scRenderTable() {
  const search = document.getElementById('sc-search')?.value.toLowerCase() || '';
  const dateFrom = document.getElementById('sc-from')?.value || '';
  const dateTo = document.getElementById('sc-to')?.value || '';
  const type = document.getElementById('sc-type')?.value || '';
  const canSeeBalance = currentUser.role !== 'Frontdesk';

  const wrap = document.getElementById('sc-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading-placeholder"><div class="spinner"></div></div>`;

  let allLogs = await DB.getStockMovementSupabase(currentBranch);
  let logs = allLogs;
  if (dateFrom) logs = logs.filter(l => l.date >= dateFrom);
  if (dateTo) logs = logs.filter(l => l.date <= dateTo);
  if (type) logs = logs.filter(l => l.type === type);
  if (search) logs = logs.filter(l => l.productCode?.toLowerCase().includes(search) || l.productName?.toLowerCase().includes(search));

  // Calculate running balance (ยอดสะสมจากประวัติทั้งหมด ไม่กรองวันที่)
  const balMap = {};
  [...allLogs].reverse().forEach(l => {
    if (!balMap[l.productCode]) balMap[l.productCode] = 0;
    if (l.direction === 'IN') balMap[l.productCode] += (l.qty || 0);
    else if (l.direction === 'OUT') balMap[l.productCode] -= (l.qty || 0);
  });

  if (!logs.length) {
    wrap.innerHTML = `<div class="empty-state"><i data-lucide="database"></i><h4>ไม่มีรายการ</h4><p>ลองเปลี่ยนตัวกรอง</p></div>`;
    lucide.createIcons(); return;
  }

  wrap.innerHTML = `
  <table>
    <thead>
      <tr>
        <th>วันที่</th>
        <th>ประเภท</th>
        <th>รหัส</th>
        <th>รายการ</th>
        <th class="num">รับเข้า</th>
        <th class="num">เบิกออก</th>
        ${canSeeBalance ? '<th class="num">คงเหลือ</th>' : ''}
        <th>สถานะ</th>
        <th>ผู้บันทึก</th>
      </tr>
    </thead>
    <tbody>
      ${logs.map(l => {
        const isIn = l.direction === 'IN';
        const bal = balMap[l.productCode] || 0;
        return `<tr>
          <td class="nowrap">${formatDate(l.date)}</td>
          <td>${typeBadge(l.type)}</td>
          <td><code style="font-size:0.75rem;background:var(--gray-100);padding:2px 5px;border-radius:4px;">${l.productCode||'-'}</code></td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${l.productName||''}">${l.productName||'-'}</td>
          <td class="num stock-in">${isIn ? l.qty : '-'}</td>
          <td class="num stock-out">${!isIn ? l.qty : '-'}</td>
          ${canSeeBalance ? `<td class="num stock-bal ${bal<=0?'zero':bal<=5?'low':''}">${bal}</td>` : ''}
          <td>${statusBadge(l.auditStatus||'รอตรวจสอบ')}</td>
          <td style="font-size:0.78rem;">${l.createdByName||'-'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
  lucide.createIcons();
}

async function scExportCSV() {
  const logs = await DB.getStockMovementSupabase(currentBranch);
  const rows = [['วันที่','ประเภท','รหัส','รายการ','รับเข้า','เบิกออก','สถานะ','ผู้บันทึก']];
  logs.forEach(l => rows.push([l.date,l.type,l.productCode,l.productName,l.direction==='IN'?l.qty:'',l.direction!=='IN'?l.qty:'',l.auditStatus,l.createdByName]));
  const csv = rows.map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `stock_card_${currentBranch}_${todayISO()}.csv`;
  a.click();
}

// ── TAB 2: Weekly Count ───────────────────────────────────
function scRenderWeekly(body) {
  const weekStart = getWeekStart();
  wcCounted = {};
  const catOptions = ['ทั้งหมด','ยา','วัสดุ','อุปกรณ์','สำนักงาน'];

  body.innerHTML = `
  <div class="glass-card" style="margin-bottom:16px;">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="form-group">
        <label class="form-label">สัปดาห์ที่นับ</label>
        <input type="date" class="filter-input" id="wc-week" value="${weekStart}" onchange="scRenderWeeklyTable()" />
      </div>
      <div class="form-group">
        <label class="form-label">หมวดหมู่</label>
        <select class="filter-select" id="wc-cat" onchange="wcCategory=this.value;scRenderWeeklyTable()">
          ${catOptions.map(c => `<option value="${c}" ${c===wcCategory?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label class="form-label">ค้นหา</label>
        <input type="text" class="filter-input" id="wc-search" placeholder="ชื่อสินค้า..." oninput="scRenderWeeklyTable()" style="width:100%;" />
      </div>
    </div>
    <div id="weekly-table-wrap"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;gap:8px;">
      <button class="btn btn-primary" onclick="wcSaveAll()">
        <i data-lucide="check-circle"></i> บันทึกรายการที่นับแล้ว
      </button>
    </div>
  </div>
  <div id="wc-result-wrap"></div>`;

  scRenderWeeklyTable();
}

function scRenderWeeklyTable() {
  const wrap = document.getElementById('weekly-table-wrap');
  if (!wrap) return;
  const search = document.getElementById('wc-search')?.value.toLowerCase() || '';
  const cat = wcCategory;
  const canSeeBalance = currentUser.role !== 'Frontdesk';

  let products = DB.getProducts();
  if (cat !== 'ทั้งหมด') products = products.filter(p => p.category === cat);
  if (search) products = products.filter(p => p.name?.toLowerCase().includes(search) || p.code?.toLowerCase().includes(search));

  const counted = products.filter(p => wcCounted[p.code] !== undefined);
  const notCounted = products.filter(p => wcCounted[p.code] === undefined);

  const balMap = DB.getStockBalance(currentBranch);

  const renderSection = (list, title, isCounted) => `
    <div class="count-section">
      <div class="count-section-header ${isCounted?'counted':'not-counted'}">
        <i data-lucide="${isCounted?'check-circle':'clock'}"></i>
        ${title} (${list.length} รายการ)
      </div>
      ${list.length ? list.map(p => {
        const counted = wcCounted[p.code];
        const sysBal = balMap[p.code] || 0;
        return `
        <div class="count-row" id="count-row-${p.code}">
          <div class="count-row-info">
            <div class="count-row-code">${p.code}</div>
            <div class="count-row-name" style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${p.name}</div>
          </div>
          ${isCounted ? `
            <span class="count-result-badge count-match" style="margin-right:4px;">นับแล้ว: ${counted}</span>
          ` : `
            <input type="number" class="count-input" id="wc-input-${p.code}" placeholder="0" min="0"
              value="${counted !== undefined ? counted : ''}" oninput="wcSetCount('${p.code}',this.value)" />
          `}
          <span class="count-unit">${p.unit||''}</span>
        </div>`;
      }).join('') : `<p style="font-size:0.82rem;color:var(--gray-400);padding:8px 12px;">ไม่มีรายการ</p>`}
    </div>`;

  wrap.innerHTML = renderSection(notCounted, 'ยังไม่นับ', false) + renderSection(counted, 'นับแล้ว', true);
  lucide.createIcons();
}

function wcSetCount(code, val) {
  const n = parseInt(val);
  if (!isNaN(n) && n >= 0) wcCounted[code] = n;
  else delete wcCounted[code];
}

function wcSaveAll() {
  const week = document.getElementById('wc-week')?.value || getWeekStart();
  const canSeeBalance = currentUser.role !== 'Frontdesk';
  const balMap = DB.getStockBalance(currentBranch);
  const codes = Object.keys(wcCounted);

  if (!codes.length) { Toast.show('กรุณานับสต๊อกอย่างน้อย 1 รายการ', 'warning'); return; }

  codes.forEach(code => {
    DB.saveWeeklyCount({ weekStart: week, branch: currentBranch, productCode: code, counted: wcCounted[code], countedBy: currentUser.id, countedAt: new Date().toISOString() });
  });

  Toast.show(`บันทึกผลการนับ ${codes.length} รายการเรียบร้อย`, 'success');

  // Show results
  const resultWrap = document.getElementById('wc-result-wrap');
  if (!resultWrap) return;

  const mismatches = codes.filter(c => wcCounted[c] !== (balMap[c]||0));
  const matches = codes.filter(c => wcCounted[c] === (balMap[c]||0));

  let html = `<div class="glass-card">
    <div class="section-header" style="margin-bottom:12px;"><span class="section-title">ผลการเช็คสต๊อก</span></div>`;

  if (mismatches.length === 0) {
    html += `<div class="alert-box alert-success"><i data-lucide="check-circle"></i><span>สต๊อกตรงทั้งหมด ${codes.length} รายการ ✓</span></div>`;
  } else {
    html += `<div class="alert-box alert-warning" style="margin-bottom:12px;"><i data-lucide="alert-triangle"></i><span>พบสต๊อกไม่ตรง ${mismatches.length} รายการ</span></div>`;
    mismatches.forEach(code => {
      const p = DB.getProductByCode(code);
      const sys = balMap[code] || 0;
      const cnt = wcCounted[code];
      const diff = cnt - sys;
      html += `
        <div class="count-row" style="border:1px solid var(--red-100);background:var(--red-100);">
          <div class="count-row-info">
            <div class="count-row-code">${code}</div>
            <div class="count-row-name">${p?.name||code}</div>
          </div>
          ${canSeeBalance ? `
          <span style="font-size:0.82rem;color:var(--gray-500);">ระบบ: ${sys} | นับได้: ${cnt}</span>
          <span class="count-result-badge ${diff>0?'count-match':'count-mismatch'}">${diff>0?'+':''}${diff} ${p?.unit||''}</span>
          ` : `<span class="count-result-badge count-mismatch">ไม่ตรง</span>`}
        </div>`;
    });
    if (matches.length) html += `<p style="margin-top:10px;font-size:0.8rem;color:var(--green-600);">✓ ตรงอีก ${matches.length} รายการ</p>`;
  }
  html += `</div>`;
  resultWrap.innerHTML = html;
  lucide.createIcons();
  scRenderWeeklyTable();
}

// ── TAB 3: Balance (Audit/Admin) ─────────────────────────
function scRenderBalance(body) {
  body.innerHTML = `
  <div class="filter-bar" style="position:relative;">
    <button class="btn btn-ghost btn-icon btn-sm" onclick="balExport()" style="position:absolute; top:12px; right:12px; color:var(--gray-600);" title="Export"><i data-lucide="download"></i></button>
    <div class="filter-group" style="grid-column: 1 / -1;">
      <label class="filter-label">ค้นหา</label>
      <input type="text" class="filter-input" id="bal-search" placeholder="รหัส / ชื่อ..." oninput="balRender()" style="width:100%;" />
    </div>
    <div class="filter-group">
      <label class="filter-label">หมวดหมู่</label>
      <select class="filter-select" id="bal-cat" onchange="balRender()">
        <option value="">ทั้งหมด</option>
        <option value="ยา">ยา</option>
        <option value="วัสดุ">วัสดุ</option>
        <option value="อุปกรณ์">อุปกรณ์</option>
        <option value="สำนักงาน">สำนักงาน</option>
      </select>
    </div>
    <div class="filter-group">
      <label class="filter-label">สาขา</label>
      <select class="filter-select" id="bal-branch" onchange="balRender()">
        <option value="ALL">ทุกสาขา</option>
        <option value="พิษณุโลก">พิษณุโลก</option>
        <option value="กำแพงเพชร">กำแพงเพชร</option>
        <option value="แม่สอด">แม่สอด</option>
        <option value="นครสวรรค์">นครสวรรค์</option>
      </select>
    </div>
  </div>
  <div class="card" style="padding:0;overflow:hidden;">
    <div class="table-wrap" style="border:none;border-radius:0;box-shadow:none;" id="bal-table-wrap">
      <div class="loading-placeholder"><div class="spinner"></div></div>
    </div>
  </div>`;

  // Set default branch to ALL
  document.getElementById('bal-branch').value = 'ALL';

  setTimeout(() => balRender(), 100);
}

async function balRender() {
  const search = document.getElementById('bal-search')?.value.toLowerCase() || '';
  const cat = document.getElementById('bal-cat')?.value || '';
  const branch = document.getElementById('bal-branch')?.value || 'ALL';
  const wrap = document.getElementById('bal-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading-placeholder"><div class="spinner"></div></div>`;

  const isAll = branch === 'ALL';
  const allBalances = await DB.getAllBranchBalancesSupabase();

  // จัดกลุ่มข้อมูลตามสินค้า
  const productMap = {};
  allBalances.forEach(r => {
    if (!productMap[r.product_code]) {
      productMap[r.product_code] = { code: r.product_code, name: r.product_name, category: r.category, unit: r.unit, byBranch: {} };
    }
    productMap[r.product_code].byBranch[r.branch_name] = r.qty_on_hand;
  });
  let products = Object.values(productMap);

  if (cat) products = products.filter(p => p.category === cat);
  if (search) products = products.filter(p => p.code?.toLowerCase().includes(search) || p.name?.toLowerCase().includes(search));

  const branchList = ['พิษณุโลก','กำแพงเพชร','แม่สอด','นครสวรรค์'];

  wrap.innerHTML = `
  <table>
    <thead>
      <tr>
        <th>รหัส</th>
        <th>รายการ</th>
        <th>หมวดหมู่</th>
        <th>หน่วย</th>
        ${isAll ? branchList.map(b => `<th class="num">${b}</th>`).join('') + '<th class="num">รวมทั้งหมด</th>' : `
        <th class="num">คงเหลือ</th>
        <th>สถานะ</th>
        `}
      </tr>
    </thead>
    <tbody>
      ${products.map(p => {
        if (isAll) {
          const vals = branchList.map(b => p.byBranch[b] || 0);
          const total = vals.reduce((a,b) => a+b, 0);
          return `<tr>
            <td><code style="font-size:0.75rem;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;">${p.code}</code></td>
            <td style="font-weight:600;">${p.name}</td>
            <td>${p.category||'-'}</td>
            <td>${p.unit||'-'}</td>
            ${vals.map(v => `<td class="num ${v<=0?'text-red-500':''}">${v}</td>`).join('')}
            <td class="num" style="font-weight:700;">${total}</td>
          </tr>`;
        } else {
          const bal = p.byBranch[branch] || 0;
          const isLow = bal > 0 && bal <= 10;
          const isZero = bal <= 0;
          return `<tr style="${isZero?'background:var(--red-50);':isLow?'background:var(--amber-50);':''}">
            <td><code style="font-size:0.75rem;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;">${p.code}</code></td>
            <td style="font-weight:600;">${p.name}</td>
            <td>${p.category||'-'}</td>
            <td>${p.unit||'-'}</td>
            <td class="num stock-bal ${isZero?'zero':isLow?'low':''}">${bal}</td>
            <td>${isZero?'<span class="badge badge-rejected">หมด</span>':isLow?'<span class="badge badge-waiting">ใกล้หมด</span>':'<span class="badge badge-approved">ปกติ</span>'}</td>
          </tr>`;
        }
      }).join('')}
    </tbody>
  </table>`;
  window._balProductsCache = products;
  lucide.createIcons();
}

function balExport() {
  const branch = document.getElementById('bal-branch')?.value || 'ALL';
  const isAll = branch === 'ALL';
  const branchList = ['พิษณุโลก','กำแพงเพชร','แม่สอด','นครสวรรค์'];
  const products = window._balProductsCache || [];
  let rows = [];

  if (isAll) {
    rows.push(['รหัส','รายการ','หมวดหมู่','หน่วย', ...branchList, 'รวมทั้งหมด']);
    products.forEach(p => {
      const vals = branchList.map(b => p.byBranch[b] || 0);
      const total = vals.reduce((a,b) => a+b, 0);
      rows.push([p.code, p.name, p.category, p.unit, ...vals, total]);
    });
  } else {
    rows.push(['รหัส','รายการ','หมวดหมู่','หน่วย','คงเหลือ']);
    products.forEach(p => rows.push([p.code, p.name, p.category, p.unit, p.byBranch[branch] || 0]));
  }

  const csv = rows.map(r => r.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `stock_balance_${branch}_${todayISO()}.csv`;
  a.click();
}
