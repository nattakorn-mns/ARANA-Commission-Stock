/* Approved full presentation adapter for the real "สรุปยอดของฉัน" data. */
let summaryLayoutStatus = 'all', summaryLayoutPeriod = 'all', summaryLayoutBranch = '', summaryDeposits = [];
const sumFmt = v => '฿' + Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumDate = v => { const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' }); };
const sumEsc = v => String(v ?? '-').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sumStatusClass(s) { return s === 'อนุมัติแล้ว' ? 'approved' : (s === 'ตีกลับ' || s === 'รอแก้ไข' ? 'revision' : 'pending'); }
// Deposit commission: status follows the money check (payment_status); a cancelled commission earns nothing.
function sumDepositRows() {
  return (summaryDeposits || []).map(d => {
    const paid = d.payment_status === 'ยืนยันแล้ว' || d.payment_status === 'เชื่อม OPD แล้ว';
    const cancelled = d.commission_status === 'ยกเลิก' || /^คืน/.test(d.payment_status || '');
    const status = cancelled ? 'ยกเลิก' : paid ? 'อนุมัติแล้ว' : (d.payment_status || 'รอตรวจสอบ');
    const base = Number(d.deposit_amount || 0), earned = cancelled ? 0 : Number(d.commission_amt || 0);
    return { id:d.id, kind:'deposit', date:d.deposit_date, branch:d.branch_name, customer:d.customer_name, program:d.program_name || '-', source:'มัดจำทางแชท', fee:0, pct:Number(d.commission_pct || 0), base, earned, full:0, status };
  });
}
function sumRows() {
  const bills = histGetBills();
  const services = historyRemote ? historyRemote.services : (DB._get('bill_services') || []);
  const sales = historyRemote ? historyRemote.sales : (DB._get('bill_sales') || []);
  const rows = [];
  bills.forEach(b => {
    const sv = services.filter(x => x.billId === b.id && !x.is_superseded && (historyRemote || currentUser.role !== 'Frontdesk' || x.createdBy === currentUser.id));
    const sl = sales.filter(x => x.billId === b.id && !x.is_superseded && (historyRemote || currentUser.role !== 'Frontdesk' || x.createdBy === currentUser.id));
    const fee = sv.reduce((n,x) => n + Number(x.commission || 0), 0), status = b.status || 'รอตรวจสอบ';
    const programs = sv.map(x => x.programName || x.programCode).filter(Boolean);
    // The service fee belongs to the bill, so it gets one row of its own; sale rows never repeat it.
    if (sv.length || !sl.length) rows.push({ id:b.id, date:b.date, branch:b.branch, customer:b.customerName, program:programs.join(', ') || '-', source:'ค่ามือ', fee, pct:null, base:0, earned:0, full:0, status });
    sl.forEach(x => {
      const base = Number(x.commissionBase || x.amountPaid || 0), earned = Number(x.commissionAmt || 0);
      const pct = x.commissionPct != null && x.commissionPct !== '' ? Number(x.commissionPct) : (base ? Math.round(earned / base * 10000) / 100 : null);
      rows.push({ id:b.id, date:b.date, branch:b.branch, customer:b.customerName, program:x.newProgram || programs.join(', ') || '-', source:x.type === 'upsell' ? 'อัพเซลส์' : x.type === 'crosssell' ? 'ขายเพิ่ม' : 'ขายสินค้า', fee:0, pct, base, earned, full:Number(x.amountPaid || x.commissionBase || 0), status });
    });
  });
  return rows.concat(sumDepositRows());
}
// "รอแก้ไข" tab covers both the old and the new name for sent-back items.
const SUM_REVISION = ['ตีกลับ', 'รอแก้ไข'];
function sumRender() {
  const el = document.getElementById('sum-layout-table'); if (!el) return;
  let rows = sumRows(), today = todayISO();
  if (summaryLayoutPeriod === 'today') rows = rows.filter(x => x.date === today);
  if (summaryLayoutPeriod === 'week') { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-6); rows = rows.filter(x => x.date >= d.toISOString().slice(0,10) && x.date <= today); }
  if (summaryLayoutPeriod === 'month') rows = rows.filter(x => String(x.date || '').slice(0,7) === today.slice(0,7));
  if (summaryLayoutPeriod === 'year') rows = rows.filter(x => String(x.date || '').slice(0,4) === today.slice(0,4));
  if (summaryLayoutBranch) rows = rows.filter(x => x.branch === summaryLayoutBranch);
  if (summaryLayoutStatus === 'ตีกลับ') rows = rows.filter(x => SUM_REVISION.includes(x.status));
  else if (summaryLayoutStatus !== 'all') rows = rows.filter(x => x.status === summaryLayoutStatus);
  // Totals follow the filters on screen and include items still waiting for audit (status column tells them apart).
  const total = (key, filter, list) => (list || rows).filter(filter || (() => true)).reduce((n,x) => n + Number(x[key] || 0), 0);
  const approved = rows.filter(x => x.status === 'อนุมัติแล้ว');
  const set = (id,v) => { const e = document.getElementById(id); if (e) e.textContent = sumFmt(v); };
  const setOk = (id,v) => { const e = document.getElementById(id); if (e) e.textContent = 'อนุมัติแล้ว ' + sumFmt(v); };
  const bySource = s => x => x.source === s;
  set('sum-fee',total('fee')); setOk('sum-fee-ok',total('fee',null,approved));
  [['sum-upsell','อัพเซลส์'],['sum-cross','ขายเพิ่ม'],['sum-product','ขายสินค้า'],['sum-deposit','มัดจำทางแชท']].forEach(([id,s]) => { set(id,total('earned',bySource(s))); setOk(id+'-ok',total('earned',bySource(s),approved)); });
  set('sum-total-fee',total('fee')); set('sum-total-comm',total('earned')); set('sum-perf-upsell',total('full',bySource('อัพเซลส์'))); set('sum-perf-cross',total('full',bySource('ขายเพิ่ม'))); set('sum-perf-product',total('full',bySource('ขายสินค้า'))); set('sum-perf-total',total('full'));
  el.innerHTML = rows.length ? `<div class="summary-table-scroll"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>ชื่อลูกค้า</th><th>ชื่อโปรแกรม</th><th>ค่ามือ</th><th>คอมมิชชั่น</th><th>คิด %</th><th>ยอดที่ได้</th><th>%ค่าคอมที่ได้</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows.map(x => `<tr><td data-label="วันที่">${sumDate(x.date)}</td><td data-label="สาขา">${sumEsc(x.branch)}</td><td data-label="ชื่อลูกค้า"><strong>${sumEsc(x.customer)}</strong></td><td data-label="ชื่อโปรแกรม"><small>${sumEsc(x.program)}</small></td><td data-label="ค่ามือ" class="num">${x.fee ? sumFmt(x.fee) : '—'}</td><td data-label="คอมมิชชั่น"><span class="summary-type">${sumEsc(x.source)}</span></td><td data-label="คิด %" class="num">${x.pct == null ? '—' : sumEsc(x.pct + '%')}</td><td data-label="ยอดที่ได้" class="num">${x.source === 'ค่ามือ' ? '—' : sumFmt(x.base)}</td><td data-label="%ค่าคอมที่ได้" class="num emphasis">${x.source === 'ค่ามือ' ? '—' : sumFmt(x.earned)}</td><td data-label="สถานะ"><span class="summary-status ${sumStatusClass(x.status)}">${sumEsc(x.status)}</span></td><td>${x.kind === 'deposit' ? '' : `<button class="btn btn-ghost btn-icon btn-sm" onclick="histViewBill('${x.id}')"><i data-lucide="eye"></i></button>`}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><i data-lucide="inbox"></i><h4>ยังไม่มีรายการในตัวกรองนี้</h4><p>ลองเปลี่ยนช่วงเวลา สาขา หรือสถานะ</p></div>`;
  lucide.createIcons();
}
function sumPeriod(v) { summaryLayoutPeriod = v; sumRender(); }
function sumBranch(v) { summaryLayoutBranch = v; sumRender(); }
function sumTab(v,b) { summaryLayoutStatus = v; document.querySelectorAll('#sum-layout-tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); sumRender(); }
renderHistory = function(container) {
  container.innerHTML = `<div class="summary-preview"><div class="summary-welcome"><div><span class="eyebrow">ภาพรวมรายได้ของคุณ</span><h1>สรุปยอดของฉัน</h1><p>ยอดที่ส่งเข้าระบบจะแสดงทันที พร้อมสถานะการตรวจสอบของแต่ละรายการ</p></div><div class="summary-period"><i data-lucide="calendar-days"></i><select onchange="sumPeriod(this.value)"><option value="all">ทั้งหมด</option><option value="today">วันนี้</option><option value="week">สัปดาห์นี้</option><option value="month">เดือนนี้</option><option value="year">ปีนี้</option></select></div></div><div id="hist-db-status" style="display:none;margin:0 0 14px;padding:9px 14px;font-size:.82rem;border-radius:8px;background:var(--gray-100);"></div><div class="summary-kpis"><div class="summary-kpi kpi-service"><span>ค่ามือ</span><strong id="sum-fee">฿0</strong><small id="sum-fee-ok">รวมรอตรวจ</small></div><div class="summary-kpi kpi-upsell"><span>ค่าคอม อัพเซลส์</span><strong id="sum-upsell">฿0</strong><small id="sum-upsell-ok">รวมรอตรวจ</small></div><div class="summary-kpi kpi-cross"><span>ค่าคอม ขายเพิ่ม</span><strong id="sum-cross">฿0</strong><small id="sum-cross-ok">รวมรอตรวจ</small></div><div class="summary-kpi kpi-product"><span>ค่าคอม ขายสินค้า</span><strong id="sum-product">฿0</strong><small id="sum-product-ok">รวมรอตรวจ</small></div><div class="summary-kpi kpi-admin"><span>ค่าคอม มัดจำทางแชท</span><strong id="sum-deposit">฿0</strong><small id="sum-deposit-ok">รวมรอตรวจ</small></div><div class="summary-kpi kpi-total"><span>รวมทั้งหมด</span><div class="summary-total-lines"><div>ค่ามือ <strong id="sum-total-fee">฿0</strong></div><div>ค่าคอมมิชชั่น <strong id="sum-total-comm">฿0</strong></div></div></div></div><div class="summary-performance"><div><span>ยอดอัพเซลส์</span><strong id="sum-perf-upsell">฿0</strong></div><div><span>ยอดขายเพิ่ม</span><strong id="sum-perf-cross">฿0</strong></div><div><span>ยอดขายสินค้า</span><strong id="sum-perf-product">฿0</strong></div><div><span>รวมยอดทั้งหมด</span><strong id="sum-perf-total">฿0</strong></div></div><div class="summary-toolbar"><div class="summary-tabs" id="sum-layout-tabs"><button class="active" data-status="all" onclick="sumTab(this.dataset.status,this)">ทั้งหมด</button><button data-status="รอตรวจสอบ" onclick="sumTab(this.dataset.status,this)">รอตรวจสอบ</button><button data-status="อนุมัติแล้ว" onclick="sumTab(this.dataset.status,this)">อนุมัติแล้ว</button><button data-status="ตีกลับ" onclick="sumTab(this.dataset.status,this)">รอแก้ไข</button></div><label class="summary-branch"><i data-lucide="map-pin"></i><select onchange="sumBranch(this.value)"><option value="">ทุกสาขา</option><option>พิษณุโลก</option><option>กำแพงเพชร</option><option>แม่สอด</option><option>นครสวรรค์</option></select></label></div><div id="sum-layout-table" class="summary-table-wrap"></div></div>`;
  summaryLayoutPeriod = 'all'; summaryLayoutStatus = 'all'; summaryLayoutBranch = ''; summaryDeposits = [];
  histLoadRemote();
  DB.getMyDepositsSupabase().then(d => { summaryDeposits = d; if (historyRemote) sumRender(); });
  lucide.createIcons();
};

