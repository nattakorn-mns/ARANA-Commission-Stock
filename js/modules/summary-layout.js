/* Approved full presentation adapter for the real "สรุปยอดของฉัน" data. */
let summaryLayoutStatus = 'all', summaryLayoutPeriod = 'all', summaryLayoutBranch = '';
const sumFmt = v => '฿' + Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sumDate = v => { const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' }); };
const sumEsc = v => String(v ?? '-').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sumStatusClass(s) { return s === 'อนุมัติแล้ว' ? 'approved' : (s === 'ตีกลับ' || s === 'รอแก้ไข' ? 'revision' : 'pending'); }
function sumRows() {
  const bills = histGetBills();
  const services = historyRemote ? historyRemote.services : (DB._get('bill_services') || []);
  const sales = historyRemote ? historyRemote.sales : (DB._get('bill_sales') || []);
  const rows = [];
  bills.forEach(b => {
    const sv = services.filter(x => x.billId === b.id && !x.is_superseded && (historyRemote || currentUser.role !== 'Frontdesk' || x.createdBy === currentUser.id));
    const sl = sales.filter(x => x.billId === b.id && !x.is_superseded && (historyRemote || currentUser.role !== 'Frontdesk' || x.createdBy === currentUser.id));
    const fee = sv.reduce((n,x) => n + Number(x.commission || 0), 0), status = b.status || 'รอตรวจสอบ';
    const programs = sv.map(x => x.programName).filter(Boolean);
    if (!sl.length) rows.push({ id:b.id, date:b.date, branch:b.branch, customer:b.customerName, program:programs.join(', ') || '-', source:'ค่ามือ', fee, rate:'—', base:0, earned:0, full:0, status });
    sl.forEach(x => rows.push({ id:b.id, date:b.date, branch:b.branch, customer:b.customerName, program:x.newProgram || programs.join(', ') || '-', source:x.type === 'upsell' ? 'อัพเซลส์' : x.type === 'crosssell' ? 'ขายเพิ่ม' : 'ขายสินค้า', fee, rate:(x.commissionPct || 0) + '%', base:Number(x.commissionBase || x.amountPaid || 0), earned:Number(x.commissionAmt || 0), full:Number(x.amountPaid || x.commissionBase || 0), status }));
  });
  return rows;
}
function sumRender() {
  const el = document.getElementById('sum-layout-table'); if (!el) return;
  let rows = sumRows(), now = new Date(), today = now.toISOString().slice(0,10);
  if (summaryLayoutPeriod === 'today') rows = rows.filter(x => x.date === today);
  if (summaryLayoutPeriod === 'week') { const d = new Date(now); d.setDate(d.getDate()-6); rows = rows.filter(x => x.date >= d.toISOString().slice(0,10) && x.date <= today); }
  if (summaryLayoutPeriod === 'month') rows = rows.filter(x => String(x.date || '').slice(0,7) === today.slice(0,7));
  if (summaryLayoutPeriod === 'year') rows = rows.filter(x => String(x.date || '').slice(0,4) === today.slice(0,4));
  if (summaryLayoutBranch) rows = rows.filter(x => x.branch === summaryLayoutBranch);
  if (summaryLayoutStatus !== 'all') rows = rows.filter(x => x.status === summaryLayoutStatus);
  const all = sumRows(), total = (key, filter) => all.filter(filter || (() => true)).reduce((n,x) => n + Number(x[key] || 0), 0);
  const set = (id,v) => { const e = document.getElementById(id); if (e) e.textContent = sumFmt(v); };
  set('sum-fee',total('fee')); set('sum-upsell',total('earned',x=>x.source==='อัพเซลส์')); set('sum-cross',total('earned',x=>x.source==='ขายเพิ่ม')); set('sum-product',total('earned',x=>x.source==='ขายสินค้า')); set('sum-deposit',0); set('sum-total-fee',total('fee')); set('sum-total-comm',total('earned')); set('sum-perf-upsell',total('full',x=>x.source==='อัพเซลส์')); set('sum-perf-cross',total('full',x=>x.source==='ขายเพิ่ม')); set('sum-perf-product',total('full',x=>x.source==='ขายสินค้า')); set('sum-perf-total',total('full'));
  el.innerHTML = rows.length ? `<div class="summary-table-scroll"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>ชื่อลูกค้า</th><th>ชื่อโปรแกรม</th><th>ค่ามือ</th><th>คอมมิชชั่น</th><th>คิด %</th><th>ยอดที่ได้</th><th>%ค่าคอมที่ได้</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows.map(x => `<tr><td data-label="วันที่">${sumDate(x.date)}</td><td data-label="สาขา">${sumEsc(x.branch)}</td><td data-label="ชื่อลูกค้า"><strong>${sumEsc(x.customer)}</strong></td><td data-label="ชื่อโปรแกรม"><small>${sumEsc(x.program)}</small></td><td data-label="ค่ามือ" class="num">${x.fee ? sumFmt(x.fee) : '—'}</td><td data-label="คอมมิชชั่น"><span class="summary-type">${sumEsc(x.source)}</span></td><td data-label="คิด %" class="num">${sumEsc(x.rate)}</td><td data-label="ยอดที่ได้" class="num">${x.source === 'ค่ามือ' ? '—' : sumFmt(x.base)}</td><td data-label="%ค่าคอมที่ได้" class="num emphasis">${x.source === 'ค่ามือ' ? '—' : sumFmt(x.earned)}</td><td data-label="สถานะ"><span class="summary-status ${sumStatusClass(x.status)}">${sumEsc(x.status)}</span></td><td><button class="btn btn-ghost btn-icon btn-sm" onclick="histViewBill('${x.id}')"><i data-lucide="eye"></i></button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><i data-lucide="inbox"></i><h4>ยังไม่มีรายการในตัวกรองนี้</h4><p>ลองเปลี่ยนช่วงเวลา สาขา หรือสถานะ</p></div>`;
  lucide.createIcons();
}
function sumPeriod(v) { summaryLayoutPeriod = v; sumRender(); }
function sumBranch(v) { summaryLayoutBranch = v; sumRender(); }
function sumTab(v,b) { summaryLayoutStatus = v; document.querySelectorAll('#sum-layout-tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); sumRender(); }
renderHistory = function(container) {
  container.innerHTML = `<div class="summary-preview"><div class="summary-welcome"><div><span class="eyebrow">ภาพรวมรายได้ของคุณ</span><h1>สรุปยอดของฉัน</h1><p>ยอดที่ส่งเข้าระบบจะแสดงทันที พร้อมสถานะการตรวจสอบของแต่ละรายการ</p></div><div class="summary-period"><i data-lucide="calendar-days"></i><select onchange="sumPeriod(this.value)"><option value="all">ทั้งหมด</option><option value="today">วันนี้</option><option value="week">สัปดาห์นี้</option><option value="month">เดือนนี้</option><option value="year">ปีนี้</option></select></div></div><div id="hist-db-status" style="display:none;margin:0 0 14px;padding:9px 14px;font-size:.82rem;border-radius:8px;background:var(--gray-100);"></div><div class="summary-kpis"><div class="summary-kpi kpi-service"><span>ค่ามือ</span><strong id="sum-fee">฿0</strong><small>ยอดที่ได้จริง</small></div><div class="summary-kpi kpi-upsell"><span>ค่าคอม อัพเซลส์</span><strong id="sum-upsell">฿0</strong><small>ยอดที่ได้จริง</small></div><div class="summary-kpi kpi-cross"><span>ค่าคอม ขายเพิ่ม</span><strong id="sum-cross">฿0</strong><small>ยอดที่ได้จริง</small></div><div class="summary-kpi kpi-product"><span>ค่าคอม ขายสินค้า</span><strong id="sum-product">฿0</strong><small>ยอดที่ได้จริง</small></div><div class="summary-kpi kpi-admin"><span>ค่าคอม มัดจำทางแชท</span><strong id="sum-deposit">฿0</strong><small>ยอดที่ได้จริง</small></div><div class="summary-kpi kpi-total"><span>รวมทั้งหมด</span><div class="summary-total-lines"><div>ค่ามือ <strong id="sum-total-fee">฿0</strong></div><div>ค่าคอมมิชชั่น <strong id="sum-total-comm">฿0</strong></div></div></div></div><div class="summary-performance"><div><span>ยอดอัพเซลส์</span><strong id="sum-perf-upsell">฿0</strong></div><div><span>ยอดขายเพิ่ม</span><strong id="sum-perf-cross">฿0</strong></div><div><span>ยอดขายสินค้า</span><strong id="sum-perf-product">฿0</strong></div><div><span>รวมยอดทั้งหมด</span><strong id="sum-perf-total">฿0</strong></div></div><div class="summary-toolbar"><div class="summary-tabs" id="sum-layout-tabs"><button class="active" data-status="all" onclick="sumTab(this.dataset.status,this)">ทั้งหมด</button><button data-status="รอตรวจสอบ" onclick="sumTab(this.dataset.status,this)">รอตรวจสอบ</button><button data-status="อนุมัติแล้ว" onclick="sumTab(this.dataset.status,this)">อนุมัติแล้ว</button><button data-status="ตีกลับ" onclick="sumTab(this.dataset.status,this)">รอแก้ไข</button></div><label class="summary-branch"><i data-lucide="map-pin"></i><select onchange="sumBranch(this.value)"><option value="">ทุกสาขา</option><option>พิษณุโลก</option><option>กำแพงเพชร</option><option>แม่สอด</option><option>นครสวรรค์</option></select></label></div><div id="sum-layout-table" class="summary-table-wrap"></div></div>`;
  summaryLayoutPeriod = 'all'; summaryLayoutStatus = 'all'; summaryLayoutBranch = '';
  histLoadRemote();
  lucide.createIcons();
};

