/**
 * ARANA CLINIC — OPD Module (Phase A — Fixed & Searchable)
 * js/modules/opd.js
 *
 * Fixes in this version:
 * 1. Shared bill upsell — load services from shared bill for upsell
 * 2. Walk-in option in upsell dropdown (oldPrice=0)
 * 3. 'จ่ายเพิ่มจากมัดจำ' payType -> commissionBase = amountPaid directly
 * 4. Editable commission base + HR Note field when manually edited
 * 5. Mandatory OPD photo validation
 * 6. Searchable Select (SS) for Programs and Supplies
 * 7. Cursor-stable inputs and real-time calc from previous fixes
 */

// ── Search-Select (SS) Component ──────────────────────────
(function injectSSStyles() {
  if (document.getElementById('ss-styles')) return;
  const s = document.createElement('style');
  s.id = 'ss-styles';
  s.textContent = `
    .ss-wrap { position:relative; }
    .ss-input { width:100%; }
    .ss-list {
      display:none; position:absolute; z-index:9999; width:100%;
      max-height:360px; overflow-y:auto; background:#fff;
      border:1px solid hsl(220,8%,82%); border-radius:10px;
      box-shadow:0 8px 24px rgba(139,26,58,0.10); margin-top:2px;
    }
    .ss-item {
      padding:8px 12px; cursor:pointer; font-size:0.82rem;
      border-bottom:1px solid hsl(220,8%,96%); line-height:1.4;
    }
    .ss-item:hover, .ss-item.active { background:hsl(345,50%,96%); color:hsl(345,65%,32%); }
    .ss-item-code { color:hsl(220,10%,55%); font-size:0.72rem; margin-right:6px; }
    .ss-item-header { padding:6px 12px; font-size:0.75rem; font-weight:700; color:var(--burgundy-800); background:var(--burgundy-50); pointer-events:none; }
  `;
  document.head.appendChild(s);
})();

function buildSS(uid, items, selectedCode, onPickFn, placeholder) {
  const isProg = uid.toLowerCase().includes('prog');
  const sel = items.find(x => x.code === selectedCode && !x.isHeader);
  let display = '';
  if (sel) {
    if (sel.code === 'walkin' || sel.code === 'manual') display = sel.name;
    else if (sel.code.startsWith('svc:') || sel.code.startsWith('shared:')) display = sel.name;
    else if (isProg) display = sel.name;
    else display = sel.name; // Removed code prefix
  }
  
  const opts = items.map(item => {
    if (item.isHeader) {
      return `<div class="ss-item-header">${item.name}</div>`;
    }
    const name = (item.name||'').replace(/"/g,'&quot;');
    const search = (item.code + ' ' + item.name).toLowerCase();
    
    const showCode = !isProg && (item.code !== 'walkin' && item.code !== 'manual' && !item.code.startsWith('svc:') && !item.code.startsWith('shared:'));
    const codeHtml = showCode ? `<span class="ss-item-code">${item.code}</span>` : '';
    
    return `<div class="ss-item" data-code="${item.code}" data-text="${search}" onmousedown="ssPick(event,'${uid}','${item.code}','${onPickFn}')">${codeHtml}${name}</div>`;
  }).join('');
  return `<div class="ss-wrap" id="sswrap-${uid}">
    <input type="text" class="form-input ss-input" id="ssinput-${uid}" value="${display.replace(/"/g,'&quot;')}" placeholder="${placeholder||'พิมพ์เพื่อค้นหา...'}" autocomplete="off" oninput="ssFilter('${uid}')" onfocus="ssOpen(event,'${uid}')" />
    <input type="hidden" id="ssval-${uid}" value="${selectedCode||''}" />
    <div class="ss-list" id="sslist-${uid}">${opts}</div>
  </div>`;
}

function ssFilter(uid) {
  const inp = document.getElementById('ssinput-' + uid);
  const list = document.getElementById('sslist-' + uid);
  if (!inp || !list) return;
  const q = inp.value.toLowerCase().trim();
  let visible = 0;
  list.querySelectorAll('.ss-item').forEach(el => {
    const match = !q || el.dataset.text.includes(q);
    el.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  list.querySelectorAll('.ss-item-header').forEach(el => {
    el.style.display = q ? 'none' : ''; // Hide headers when searching
  });
  list.style.display = visible ? 'block' : 'none';
}

function ssOpen(e, uid) {
  document.querySelectorAll('.ss-list').forEach(l => { if (l.id !== 'sslist-' + uid) l.style.display = 'none'; });
  ssFilter(uid);
  const list = document.getElementById('sslist-' + uid);
  if (list) list.style.display = 'block';
  e.stopPropagation();
}

function ssPick(e, uid, code, cbName) {
  e.preventDefault();
  let label = code;
  const items = document.querySelectorAll('#sslist-' + uid + ' .ss-item');
  items.forEach(el => {
    if (el.dataset.code === code) {
      const clone = el.cloneNode(true);
      const codeSpan = clone.querySelector('.ss-item-code');
      if (codeSpan) codeSpan.remove();
      const extraSpan = clone.querySelector('span');
      if (extraSpan) extraSpan.remove();
      
      label = clone.textContent.trim();
    }
  });
  const inp = document.getElementById('ssinput-' + uid);
  const val = document.getElementById('ssval-' + uid);
  if (inp) inp.value = label;
  if (val) val.value = code;
  const list = document.getElementById('sslist-' + uid);
  if (list) list.style.display = 'none';
  if (cbName && typeof window[cbName] === 'function') window[cbName](code);
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.ss-wrap')) {
    document.querySelectorAll('.ss-list').forEach(l => l.style.display = 'none');
  }
});

// ── State ──────────────────────────────────────────────────
let opdState = {
  billId: null,
  isShared: false,
  sharedBillId: null,
  sharedBillServices: [],
  linkedDepositId: null,
  photos: [],
  services: [],
  sales: [],
  supplies: [],
};
let opdProgramsCache = [];
let opdProductsCache = [];

const COM_PCTS = [0, 0.5, 0.65, 0.75, 1, 1.3, 1.5, 2, 2.5, 3, 5];
const PAY_TYPES = ['จ่ายเต็ม', 'มัดจำ', 'แบ่งชำระ', 'จ่ายเพิ่มจากมัดจำ'];
const INSTALLMENTS = [
  { value: '', label: '— เลือกงวด —' },
  { value: '1', label: 'งวดที่ 1' },
  { value: '2', label: 'งวดที่ 2' },
  { value: '3', label: 'งวดที่ 3' },
];

// ── Main Render ────────────────────────────────────────────
async function renderOPD(container) {
  if (window._editingOpdState) {
    opdState = window._editingOpdState;
    window._editingOpdState = null;
  } else {
    opdState = { billId: null, isShared: false, sharedBillId: null, sharedBillServices: [], linkedDepositId: null, photos: [], services: [], sales: [], supplies: [] };
  }

  container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลดข้อมูล...</div>`;
  [opdProgramsCache, opdProductsCache] = await Promise.all([
    DB.getProgramsSupabase(),
    DB.getProductsSupabase()
  ]);

  container.innerHTML = `
  <div class="opd-form" id="opd-form">
    <!-- Bill Mode -->
    <div class="glass-card" style="padding:16px 20px;margin-bottom:0;">
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">
          <input type="radio" name="bill-mode" value="new" checked onchange="opdSetMode('new')" style="accent-color:var(--burgundy-600);width:16px;height:16px;" />
          <span>สร้างบิลใหม่</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">
          <input type="radio" name="bill-mode" value="shared" onchange="opdSetMode('shared')" style="accent-color:var(--burgundy-600);width:16px;height:16px;" />
          <span>พ่วง OPD ลูกค้าคนเดิม</span>
        </label>
      </div>

      <!-- Shared Bill Search -->
      <div id="shared-search-wrap" style="display:none;margin-top:14px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">ค้นหาบิลที่เปิดอยู่ (HN หรือชื่อลูกค้า)</label>
          <input id="shared-search" class="form-input" placeholder="HN-0001 หรือ ชื่อ..." oninput="opdSearchSharedBills(this.value)" />
        </div>
        <div id="shared-results" style="margin-top:8px;"></div>
        <div id="shared-info" style="display:none;margin-top:8px;" class="alert-box alert-info">
          <i data-lucide="info"></i>
          <span id="shared-info-text"></span>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto;white-space:nowrap;" onclick="opdCancelSharedBill()">
            <i data-lucide="x"></i> ยกเลิกการเลือก
          </button>
        </div>
      </div>
    </div>

    <!-- Customer & Date -->
    <div class="opd-section" id="customer-section">
      <div class="opd-section-head" onclick="opdToggleSection('customer-body')">
        <h3><i data-lucide="user-plus"></i>ข้อมูลลูกค้า</h3>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="opd-section-body" id="customer-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">วันที่รับบริการ <span class="required">*</span></label>
            <input id="opd-date" type="date" class="form-input" value="${todayISO()}" max="${todayISO()}" />
          </div>
          <div class="form-group">
            <label class="form-label">สาขา</label>
            <input id="opd-branch" class="form-input" value="${currentBranch}" readonly />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">HN <span class="required">*</span></label>
            <div style="display:flex;gap:8px;">
              <input id="opd-hn" class="form-input" placeholder="HN-0001" style="flex:1;" />
              <button class="btn btn-secondary btn-sm" onclick="opdAutoHN()" title="สร้าง HN ใหม่">
                <i data-lucide="hash"></i> สร้างใหม่
              </button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">ชื่อลูกค้า <span class="required">*</span></label>
            <input id="opd-customer" class="form-input" placeholder="ชื่อ-นามสกุล" />
          </div>
        </div>
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">เชื่อมยอดมัดจำเดิม (ถ้ามี)</label>
          <input id="opd-deposit-search" class="form-input" placeholder="ค้นหาด้วยชื่อลูกค้า เบอร์โทร HN หรือเลขมัดจำ" oninput="opdSearchDeposits(this.value)" />
          <div id="opd-deposit-results" style="margin-top:8px;"></div>
          <div id="opd-deposit-info" class="alert-box alert-success" style="display:none;margin-top:8px;"></div>
        </div>
      </div>
    </div>

    <!-- Section 1: Services (ค่ามือ) -->
    <div class="opd-section" id="services-section">
      <div class="opd-section-head" onclick="opdToggleSection('services-body')">
        <h3><i data-lucide="sparkles"></i>ค่ามือ (รายการบริการที่ทำ)</h3>
        <span class="opd-section-count" id="services-count">0</span>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="opd-section-body" id="services-body">
        <div id="services-list"></div>
        <button class="btn btn-primary btn-sm" onclick="opdAddService()">
          <i data-lucide="plus"></i> เพิ่มรายการบริการ
        </button>
      </div>
    </div>

    <!-- Section 2: Sales/Commission -->
    <div class="opd-section" id="sales-section">
      <div class="opd-section-head" onclick="opdToggleSection('sales-body')">
        <h3><i data-lucide="trending-up"></i>ค่าคอมมิชชั่น (ขาย/อัพเซลส์)</h3>
        <span class="opd-section-count" id="sales-count">0</span>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="opd-section-body" id="sales-body">
        <div id="sales-list"></div>
        <div id="sale-type-picker" style="display:none;">
          <p style="font-size:0.8rem;font-weight:600;color:var(--gray-600);margin-bottom:8px;">เลือกประเภทรายการ:</p>
          <div class="sale-type-selector">
            <button class="sale-type-btn upsell" onclick="opdAddSale('upsell')">
              <i data-lucide="arrow-up-right"></i>อัพเซลส์
            </button>
            <button class="sale-type-btn crosssell" onclick="opdAddSale('crosssell')">
              <i data-lucide="shuffle"></i>ขายเพิ่ม
            </button>
            <button class="sale-type-btn product" onclick="opdAddSale('product')">
              <i data-lucide="package"></i>ขายสินค้า
            </button>
          </div>
          <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="opdHideTypePicker()">ยกเลิก</button>
        </div>
        <div id="sale-add-btn-wrap">
          <button class="btn btn-primary btn-sm" onclick="opdShowTypePicker()">
            <i data-lucide="plus"></i> เพิ่มรายการขาย
          </button>
        </div>
      </div>
    </div>

    <!-- Section 3: Supplies -->
    <div class="opd-section" id="supplies-section">
      <div class="opd-section-head" onclick="opdToggleSection('supplies-body')">
        <h3><i data-lucide="pill"></i>เบิกยา/วัสดุ/อุปกรณ์ <span id="supply-required-badge" style="display:none;background:var(--red-500);color:white;font-size:0.68rem;padding:2px 7px;border-radius:999px;margin-left:6px;font-weight:700;">จำเป็น</span></h3>
        <span class="opd-section-count" id="supplies-count">0</span>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="opd-section-body" id="supplies-body">
        <div id="supplies-list"></div>
        <button class="btn btn-primary btn-sm" onclick="opdAddSupply()">
          <i data-lucide="plus"></i> เพิ่มรายการเบิก
        </button>
      </div>
    </div>

    <!-- Section 4: Photos -->
    <div class="opd-section" id="photos-section">
      <div class="opd-section-head" onclick="opdToggleSection('photos-body')">
        <h3 style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; white-space:nowrap;"><i data-lucide="camera"></i>ภาพ OPD <span style="color:var(--red-500);font-size:0.75rem;font-weight:400;">(บังคับแนบอย่างน้อย 1 รูป)</span></h3>
        <span class="opd-section-count" id="photos-count">0</span>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="opd-section-body" id="photos-body">
        <div class="photo-upload-area" id="photo-upload-area" onclick="document.getElementById('photo-input').click()">
          <i data-lucide="upload-cloud"></i>
          <p>คลิกเพื่ออัปโหลดรูป OPD<br><span style="font-size:0.75rem;">รองรับ JPG, PNG — บนมือถือเปิดกล้องถ่ายได้เลย</span></p>
        </div>
        <input id="photo-input" type="file" multiple accept="image/*" capture="environment" style="display:none;" onchange="opdHandlePhotos(event)" />
        <div class="photo-thumbnails" id="photo-thumbs"></div>
      </div>
    </div>

    <!-- Submit -->
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding-bottom:20px;">
      <button class="btn btn-ghost" onclick="opdReset()"><i data-lucide="rotate-ccw"></i> ล้างฟอร์ม</button>
      <button class="btn btn-primary" onclick="opdSubmit()" id="opd-submit-btn">
        <i data-lucide="save"></i> บันทึก OPD
      </button>
    </div>
  </div>`;
  lucide.createIcons();
}

// ── Mode & Shared Bill ─────────────────────────────────────
function opdSetMode(mode) {
  const sw = document.getElementById('shared-search-wrap');
  const cs = document.getElementById('customer-section');
  if (mode === 'shared') {
    sw.style.display = 'block';
    cs.style.display = 'none';
    opdState.isShared = true;
  } else {
    sw.style.display = 'none';
    cs.style.display = 'block';
    opdState.isShared = false;
    opdState.sharedBillId = null;
    opdState.sharedBillServices = [];
    document.getElementById('shared-info').style.display = 'none';
    opdRenderSales(); // refresh dropdowns
  }
}

let opdSharedSearchTimer = null;
function opdSearchSharedBills(q) {
  const res = document.getElementById('shared-results');
  if (!q.trim()) { res.innerHTML = ''; return; }
  clearTimeout(opdSharedSearchTimer);
  res.innerHTML = '<p style="font-size:0.82rem;color:var(--gray-400);padding:8px 0;">กำลังค้นหา...</p>';
  opdSharedSearchTimer = setTimeout(() => opdRunSharedSearch(q), 250);
}

async function opdRunSharedSearch(q) {
  const res = document.getElementById('shared-results');
  const bills = await DB.searchOpenOpdBillsSupabase(q, currentBranch);
  if (!bills.length) {
    res.innerHTML = '<p style="font-size:0.82rem;color:var(--gray-400);padding:8px 0;">ไม่พบบิลที่เปิดอยู่</p>';
    return;
  }
  res.innerHTML = bills.slice(0, 5).map(b => `
    <div class="count-row" style="cursor:pointer;" onclick="opdSelectSharedBill('${b.id}')">
      <div class="count-row-info">
        <div class="count-row-code">${b.hn || '-'} | ${formatDate(b.date)} | ${b.branch}</div>
        <div class="count-row-name">${b.customerName}</div>
      </div>
      <span class="badge badge-pending">เปิดอยู่</span>
    </div>`).join('');
}

async function opdSelectSharedBill(billId) {
  const detail = await DB.getBillDetailSupabase(billId);
  const raw = detail?.bill;
  const bill = raw ? { id: raw.id, hn: raw.hn, customerName: raw.customer_name, date: raw.bill_date, branch: raw.branch_name } : null;
  if (!bill) return;
  opdState.sharedBillId = billId;
  
  // Load services from shared bill
  opdState.sharedBillServices = (detail.services || []).map(sv => ({ programCode: sv.program_code, programName: sv.program_name, price: sv.price }));

  document.getElementById('shared-results').innerHTML = '';
  document.getElementById('shared-search').value = `${bill.hn} — ${bill.customerName}`;
  const info = document.getElementById('shared-info');
  info.style.display = 'flex';
  document.getElementById('shared-info-text').textContent = `เลือกบิลของ: ${bill.customerName} (${bill.hn}) วันที่ ${formatDate(bill.date)}`;
  
  opdRenderSales(); // Refresh sales to update upsell dropdowns
}

function opdCancelSharedBill() {
  opdState.sharedBillId = null;
  opdState.sharedBillServices = [];
  document.getElementById('shared-search').value = '';
  document.getElementById('shared-results').innerHTML = '';
  document.getElementById('shared-info').style.display = 'none';
  opdRenderSales();
}

let opdDepositSearchTimer = null;
function opdSearchDeposits(q) {
  const res = document.getElementById('opd-deposit-results');
  if (!res) return;
  if (!q.trim()) { res.innerHTML = ''; return; }
  clearTimeout(opdDepositSearchTimer);
  res.innerHTML = '<p style="font-size:0.82rem;color:var(--gray-400);padding:8px 0;">กำลังค้นหา...</p>';
  opdDepositSearchTimer = setTimeout(async () => {
    const rows = await DB.searchConfirmedDepositsSupabase(q, currentBranch);
    res.innerHTML = rows.length ? rows.map(d => `<div class="count-row" style="cursor:pointer;" onclick="opdSelectDeposit('${d.id}')"><div class="count-row-info"><div class="count-row-code">${d.deposit_no} | ${formatDate(d.deposit_date)} | ฿${formatCurrency(d.deposit_amount)}</div><div class="count-row-name">${d.customer_name} — ${d.program_name}</div></div><span class="badge badge-approved">เงินเข้าแล้ว</span></div>`).join('') : '<p style="font-size:0.82rem;color:var(--gray-400);padding:8px 0;">ไม่พบยอดมัดจำที่ยืนยันแล้ว</p>';
    window._opdDepositResults = rows;
    lucide.createIcons();
  }, 250);
}

function opdSelectDeposit(depositId) {
  const d = (window._opdDepositResults || []).find(x => x.id === depositId);
  if (!d) return;
  opdState.linkedDepositId = d.id;
  document.getElementById('opd-hn').value = d.hn || document.getElementById('opd-hn').value;
  document.getElementById('opd-customer').value = d.customer_name;
  document.getElementById('opd-deposit-search').value = `${d.deposit_no} — ${d.customer_name}`;
  document.getElementById('opd-deposit-results').innerHTML = '';
  const info = document.getElementById('opd-deposit-info');
  info.style.display = 'flex';
  info.innerHTML = `<i data-lucide="check-circle"></i><span>เชื่อมยอดมัดจำ ฿${formatCurrency(d.deposit_amount)} แล้ว — ค่าคอมยอดนี้ได้รับสิทธิ์ไปแล้ว กรุณาอย่ากรอกค่าคอมก้อนเดิมซ้ำใน OPD</span><button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="opdClearDeposit()">ยกเลิก</button>`;
  lucide.createIcons();
}

function opdClearDeposit() {
  opdState.linkedDepositId = null;
  if (document.getElementById('opd-deposit-search')) document.getElementById('opd-deposit-search').value = '';
  if (document.getElementById('opd-deposit-results')) document.getElementById('opd-deposit-results').innerHTML = '';
  if (document.getElementById('opd-deposit-info')) document.getElementById('opd-deposit-info').style.display = 'none';
}

function opdToggleSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('collapsed');
}

function opdAutoHN() {
  document.getElementById('opd-hn').value = DB.nextHN();
}

function opdShowTypePicker() {
  document.getElementById('sale-type-picker').style.display = 'block';
  document.getElementById('sale-add-btn-wrap').style.display = 'none';
}
function opdHideTypePicker() {
  document.getElementById('sale-type-picker').style.display = 'none';
  document.getElementById('sale-add-btn-wrap').style.display = 'block';
}

// ── Services ───────────────────────────────────────────────
function opdAddService() {
  const id = 'svc_' + Date.now();
  opdState.services.push({ id, programCode: '', programName: '', price: 0, commission: 0 });
  opdRenderServices();
  opdCheckSupplyRequired();
}

function opdRenderServices() {
  const container = document.getElementById('services-list');
  if (!container) return;
  const programs = opdProgramsCache.map(p => ({ code: p.code, name: p.name, extra: '฿' + formatCurrency(p.price) }));
  
  container.innerHTML = opdState.services.map((s) => {
    const uid = 'svcprog-' + s.id;
    window['ssSvcProg_' + s.id] = function(code) { opdSvcProgram(s.id, code); };
    return `
    <div class="service-row" id="svcrow-${s.id}" style="position:relative; padding-top:20px;">
      <button class="btn btn-ghost btn-icon btn-sm" style="position:absolute; top:4px; right:4px; color:var(--red-500); z-index:10;" onclick="opdRemoveService('${s.id}')" title="ลบรายการ">
        <i data-lucide="trash-2"></i>
      </button>
      <div style="padding-right:24px;">
        <label class="form-label">โปรแกรม/บริการ</label>
        ${buildSS(uid, programs, s.programCode, 'ssSvcProg_' + s.id, 'พิมพ์ค้นหาโปรแกรม...')}
      </div>
      <div>
        <label class="form-label">ราคา (฿)</label>
        <input type="number" class="form-input" id="svc-price-${s.id}" style="width:110px;"
          value="${s.price || ''}" placeholder="0"
          oninput="opdSvcPriceInput('${s.id}', this.value)" />
      </div>
      <div>
        <label class="form-label">ค่ามือ (฿)</label>
        <input type="number" class="form-input" id="svc-comm-${s.id}" style="width:110px;"
          value="${s.commission || ''}" placeholder="0"
          oninput="opdSvcCommInput('${s.id}', this.value)" />
      </div>
    </div>`;
  }).join('');
  document.getElementById('services-count').textContent = opdState.services.length;
  lucide.createIcons();
  opdCheckSupplyRequired();
}

function opdSvcPriceInput(id, val) {
  const s = opdState.services.find(x => x.id === id);
  if (s) s.price = parseFloat(val) || 0;
}
function opdSvcCommInput(id, val) {
  const s = opdState.services.find(x => x.id === id);
  if (s) s.commission = parseFloat(val) || 0;
  opdCheckSupplyRequired();
}
function opdSvcProgram(id, code) {
  const s = opdState.services.find(x => x.id === id);
  if (!s) return;
  const p = opdProgramsCache.find(x => x.code === code);
  s.programCode = code;
  s.programName = p ? p.name : '';
  s.price = p ? p.price : 0;
  const priceEl = document.getElementById('svc-price-' + id);
  if (priceEl) priceEl.value = s.price || '';
  opdRenderSales(); // update upsell dropdowns
}
function opdRemoveService(id) {
  opdState.services = opdState.services.filter(s => s.id !== id);
  opdRenderServices();
  opdRenderSales();
}

function opdCheckSupplyRequired() {
  const badge = document.getElementById('supply-required-badge');
  if (!badge) return;
  const hasCommission = opdState.services.some(s => (s.commission || 0) > 0);
  badge.style.display = hasCommission ? 'inline-block' : 'none';
}

// ── Sales ──────────────────────────────────────────────────
function opdAddSale(type) {
  const id = 'sale_' + Date.now();
  opdState.sales.push({
    id, type,
    oldProgram: '', oldProgramManual: false, oldPrice: 0,
    newProgram: '', newPrice: 0,
    payType: 'จ่ายเต็ม', installmentNo: '',
    amountPaid: 0, commissionBase: 0, commissionBaseManual: false, commissionNote: '',
    commissionPct: 1, commissionAmt: 0
  });
  opdHideTypePicker();
  opdRenderSales();
}

function opdRenderSales() {
  const container = document.getElementById('sales-list');
  if (!container) return;
  container.innerHTML = opdState.sales.map(s => opdBuildSaleCard(s)).join('');
  document.getElementById('sales-count').textContent = opdState.sales.length;
  lucide.createIcons();
}

function opdBuildSaleCard(s) {
  const isProduct = s.type === 'product';
  const isUpsell  = s.type === 'upsell';
  const labels    = { upsell:'อัพเซลส์', crosssell:'ขายเพิ่ม (Cross-sell)', product:'ขายสินค้า 5%' };
  const badgeColor = { upsell:'hsl(270,55%,42%)', crosssell:'hsl(145,55%,35%)', product:'hsl(38,80%,40%)' };
  const programs  = opdProgramsCache.map(p => ({ code: p.code, name: p.name, extra: '฿' + formatCurrency(p.price) }));
  const needInstallment = (s.payType === 'แบ่งชำระ');
  const needAmount = (s.payType !== 'จ่ายเต็ม');

  // Build old-program options for upsell using buildSS array format
  const oldProgItems = [];
  oldProgItems.push({ code: 'walkin', name: '🚶 Walk-in (ไม่มีโปรฯเดิม)' });
  
  const ownSvcs = opdState.services.filter(sv => sv.programCode);
  if (ownSvcs.length) {
    oldProgItems.push({ isHeader: true, name: '★ บริการของฉันวันนี้' });
    ownSvcs.forEach(sv => {
      oldProgItems.push({ code: 'svc:' + sv.programCode, name: sv.programName || sv.programCode, extra: '฿' + formatCurrency(sv.price) });
    });
  }
  
  if (opdState.sharedBillServices && opdState.sharedBillServices.length) {
    oldProgItems.push({ isHeader: true, name: '★ บริการจากบิลเพื่อน' });
    opdState.sharedBillServices.forEach(sv => {
      const key = 'shared:' + (sv.programCode || sv.id);
      oldProgItems.push({ code: key, name: sv.programName || sv.programCode || '-', extra: '฿' + formatCurrency(sv.price || 0) });
    });
  }
  
  oldProgItems.push({ isHeader: true, name: 'โปรแกรมทั้งหมด' });
  oldProgItems.push({ code: 'manual', name: '— ระบุใหม่เอง —' });
  opdProgramsCache.forEach(p => {
    oldProgItems.push({ code: p.code, name: p.name });
  });

  const oldProgUID = 'saleold-' + s.id;
  window['ssSaleOldProg_' + s.id] = function(code) { opdUpsellOldSelect(s.id, code); };

  const newProgUID = 'salenp-' + s.id;
  window['ssSaleNewProg_' + s.id] = function(code) { opdSaleNewProgram(s.id, code); };
  
  const currentOldValue = s.oldProgramManual ? 'manual' : s.oldProgram;

  return `
  <div class="sale-card ${s.type}" id="salecard-${s.id}" style="margin-bottom:14px;position:relative;padding-top:36px;border-radius:var(--radius-lg);border:1.5px solid var(--glass-border);background:var(--glass-bg);">
    <div style="position:absolute;top:0;left:0;background:${badgeColor[s.type]};color:white;font-size:0.7rem;font-weight:700;padding:4px 12px;border-radius:var(--radius-lg) 0 var(--radius-md) 0;letter-spacing:0.03em;">
      ${labels[s.type]}
    </div>
    <button class="btn btn-ghost btn-icon btn-sm" style="position:absolute;top:4px;right:6px;color:var(--red-500);" onclick="opdRemoveSale('${s.id}')">
      <i data-lucide="trash-2"></i>
    </button>

    <div style="padding:0 16px 16px;">
      ${isUpsell ? `
      <div class="form-row" style="margin-bottom:10px;">
        <div class="form-group">
          <label class="form-label">โปรแกรมเดิมที่ลูกค้ามี</label>
          ${buildSS(oldProgUID, oldProgItems, currentOldValue, 'ssSaleOldProg_' + s.id, 'พิมพ์ค้นหาโปรแกรมเดิม...')}
        </div>
        <div class="form-group">
          <label class="form-label">ราคาที่จองไว้ (฿)</label>
          <input type="number" class="form-input" id="upsell-oldprice-${s.id}"
            value="${s.oldPrice||''}" placeholder="0"
            oninput="opdSaleNumInput('${s.id}','oldPrice',this.value)" />
        </div>
      </div>
      ${s.oldProgramManual ? `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">ระบุชื่อโปรแกรมเดิม</label>
        <input type="text" class="form-input" id="upsell-oldmanual-${s.id}"
          value="${s.oldProgram||''}" placeholder="ชื่อโปรแกรมเดิม"
          oninput="opdSaleTextInput('${s.id}','oldProgram',this.value)" />
      </div>` : ''}
      ` : ''}

      <div class="form-row" style="margin-bottom:10px;">
        <div class="form-group">
          <label class="form-label">โปรแกรมใหม่ที่ขาย <span class="required">*</span></label>
          ${buildSS(newProgUID, programs, s.newProgram, 'ssSaleNewProg_' + s.id, 'พิมพ์ค้นหาโปรแกรม...')}
        </div>
        <div class="form-group">
          <label class="form-label">ราคาโปรแกรมใหม่ (฿)</label>
          <input type="number" class="form-input" id="sale-newprice-${s.id}"
            value="${s.newPrice||''}" placeholder="0"
            oninput="opdSaleNumInput('${s.id}','newPrice',this.value)" />
        </div>
      </div>

      <div class="form-row" style="margin-bottom:10px;">
        <div class="form-group">
          <label class="form-label">รูปแบบการชำระ</label>
          <select class="form-select" onchange="opdSalePayType('${s.id}',this.value)">
            ${PAY_TYPES.map(pt => `<option value="${pt}" ${s.payType===pt?'selected':''}>${pt}</option>`).join('')}
          </select>
        </div>
        ${needAmount ? `
        <div class="form-group">
          <label class="form-label">ยอดที่ชำระวันนี้ (฿)</label>
          <input type="number" class="form-input" id="sale-amount-${s.id}"
            value="${s.amountPaid||''}" placeholder="0"
            oninput="opdSaleNumInput('${s.id}','amountPaid',this.value)" />
        </div>` : '<div></div>'}
      </div>

      ${needInstallment ? `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">งวดที่ชำระ</label>
        <select class="form-select" id="sale-inst-${s.id}" onchange="opdSaleTextInput('${s.id}','installmentNo',this.value)">
          ${INSTALLMENTS.map(inst => `<option value="${inst.value}" ${s.installmentNo===inst.value?'selected':''}>${inst.label}</option>`).join('')}
        </select>
      </div>` : ''}

      <div class="form-row" style="margin-bottom:6px;">
        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:6px;">
            ฐานคิดค่าคอม (฿)
            ${s.commissionBaseManual ? '<span style="color:var(--amber-600);font-size:0.72rem;font-weight:700;">✏ แก้มือแล้ว</span>' : '<span style="color:var(--gray-400);font-size:0.73rem;">(อัตโนมัติ)</span>'}
          </label>
          <input type="number" class="form-input" id="sale-base-${s.id}" value="${s.commissionBase}"
            style="font-weight:700;color:var(--burgundy-700);${s.commissionBaseManual ? 'background:hsl(38,100%,97%);border-color:hsl(38,80%,60%);' : 'background:var(--gray-50);'}"
            oninput="opdSaleBaseManual('${s.id}',this.value)" />
        </div>
        <div class="form-group">
          <label class="form-label">% ค่าคอม ${isProduct ? '<span style="color:var(--amber-600);font-size:0.72rem;">(5% ตายตัว)</span>' : ''}</label>
          ${isProduct
            ? `<input type="text" class="form-input" value="5%" readonly style="background:var(--gray-50);" />`
            : `<select class="form-select" onchange="opdSaleCommPct('${s.id}',this.value)">
                ${COM_PCTS.map(p => `<option value="${p}" ${s.commissionPct==p?'selected':''}>${p}%</option>`).join('')}
               </select>`
          }
        </div>
      </div>

      ${s.commissionBaseManual ? `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label" style="color:var(--amber-700);">หมายเหตุถึง HR (เหตุผลที่แก้ฐานคิดค่าคอม)</label>
        <input type="text" class="form-input" id="sale-note-${s.id}"
          value="${s.commissionNote||''}" placeholder="ระบุเหตุผล..."
          oninput="opdSaleTextInput('${s.id}','commissionNote',this.value)"
          style="border-color:var(--amber-400);" />
      </div>` : ''}

      <div style="background:var(--burgundy-50);border:1px solid var(--burgundy-100);border-radius:var(--radius-md);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.84rem;font-weight:600;color:var(--burgundy-800);">ค่าคอมมิชชั่นที่ได้</span>
        <span id="sale-result-${s.id}" style="font-size:1.1rem;font-weight:800;color:var(--burgundy-700);">฿${formatCurrency(s.commissionAmt)}</span>
      </div>
    </div>
  </div>`;
}

// ── Sale Handlers ──────────────────────────────────────────
function opdSaleNumInput(id, key, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  s[key] = parseFloat(val) || 0;
  if (key === 'newPrice' && s.payType === 'จ่ายเต็ม') s.amountPaid = s.newPrice;
  if (!s.commissionBaseManual) opdCalcSale(s);
  opdUpdateSaleResult(s);
}

function opdSaleTextInput(id, key, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (s) s[key] = val;
}

function opdSaleNewProgram(id, code) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  const p = opdProgramsCache.find(x => x.code === code);
  s.newProgram = code;
  s.newPrice = p ? p.price : 0;
  if (s.payType === 'จ่ายเต็ม') s.amountPaid = s.newPrice;
  if (!s.commissionBaseManual) opdCalcSale(s);
  opdRenderSales();
}

function opdUpsellOldSelect(id, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  
  if (val === 'manual') {
    s.oldProgramManual = true; s.oldProgram = ''; s.oldPrice = 0;
  } else if (val === 'walkin') {
    s.oldProgramManual = false; s.oldProgram = 'walkin'; s.oldPrice = 0;
  } else if (val.startsWith('svc:')) {
    const code = val.replace('svc:', '');
    const svc = opdState.services.find(sv => sv.programCode === code);
    s.oldProgramManual = false; s.oldProgram = code; s.oldPrice = svc ? svc.price : 0;
  } else if (val.startsWith('shared:')) {
    const key = val.replace('shared:', '');
    const svc = opdState.sharedBillServices.find(sv => (sv.programCode || sv.id) === key);
    s.oldProgramManual = false; s.oldProgram = val; s.oldPrice = svc ? (svc.price || 0) : 0;
  } else {
    s.oldProgramManual = false; s.oldProgram = val;
    const p = opdProgramsCache.find(x => x.code === val);
    s.oldPrice = p ? p.price : 0;
  }

  const oldPriceEl = document.getElementById('upsell-oldprice-' + id);
  if (oldPriceEl) oldPriceEl.value = s.oldPrice || '';
  if (!s.commissionBaseManual) opdCalcSale(s);
  opdRenderSales();
}

function opdSalePayType(id, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  s.payType = val;
  if (val === 'จ่ายเต็ม') { s.amountPaid = s.newPrice; s.installmentNo = ''; }
  else if (val !== 'แบ่งชำระ') { s.installmentNo = ''; }
  if (!s.commissionBaseManual) opdCalcSale(s);
  opdRenderSales();
}

function opdSaleCommPct(id, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  s.commissionPct = parseFloat(val) || 0;
  opdCalcSale(s);
  opdUpdateSaleResult(s);
}

function opdSaleBaseManual(id, val) {
  const s = opdState.sales.find(x => x.id === id);
  if (!s) return;
  s.commissionBase = parseFloat(val) || 0;
  const wasManual = s.commissionBaseManual;
  s.commissionBaseManual = true;
  s.commissionAmt = (s.commissionBase * s.commissionPct) / 100;
  
  if (!wasManual) {
    opdRenderSales(); // Re-render to show Note input
  } else {
    opdUpdateSaleResult(s); // Update text
  }
}

function opdCalcSale(s) {
  if (s.commissionBaseManual) {
    s.commissionAmt = (s.commissionBase * s.commissionPct) / 100;
    return;
  }
  
  if (s.type === 'product') {
    s.commissionPct = 5;
    s.commissionBase = s.amountPaid;
  } else if (s.type === 'upsell') {
    if (s.payType === 'จ่ายเพิ่มจากมัดจำ') {
      s.commissionBase = s.amountPaid;
    } else {
      s.commissionBase = Math.max(0, s.amountPaid - (s.oldPrice || 0));
    }
  } else {
    if (s.payType === 'จ่ายเพิ่มจากมัดจำ') {
      s.commissionBase = s.amountPaid;
    } else {
      s.commissionBase = s.amountPaid;
    }
  }
  s.commissionAmt = (s.commissionBase * s.commissionPct) / 100;
}

function opdUpdateSaleResult(s) {
  const baseEl   = document.getElementById(`sale-base-${s.id}`);
  const resultEl = document.getElementById(`sale-result-${s.id}`);
  if (baseEl && !s.commissionBaseManual) baseEl.value = s.commissionBase;
  if (resultEl) resultEl.textContent = `฿${formatCurrency(s.commissionAmt)}`;
}

function opdRemoveSale(id) {
  opdState.sales = opdState.sales.filter(s => s.id !== id);
  opdRenderSales();
}

// ── Supplies ───────────────────────────────────────────────
function opdAddSupply() {
  const id = 'sup_' + Date.now();
  opdState.supplies.push({ id, productCode: '', productName: '', qty: 1, unit: '' });
  opdRenderSupplies();
}

function opdRenderSupplies() {
  const container = document.getElementById('supplies-list');
  if (!container) return;
  const products = opdProductsCache.map(p => ({ code: p.code, name: p.name, extra: p.unit }));
  
  container.innerHTML = opdState.supplies.map(s => {
    const uid = 'supprod-' + s.id;
    window['ssSupprod_' + s.id] = function(code) { opdSupplyProduct(s.id, code); };
    return `
    <div class="supply-row" id="suprow-${s.id}" style="display:grid;grid-template-columns:2fr 80px 60px auto;align-items:end;gap:8px;margin-bottom:8px;">
      <div>
        <label class="form-label">รายการยา/วัสดุ</label>
        ${buildSS(uid, products, s.productCode, 'ssSupprod_' + s.id, 'พิมพ์รหัสหรือชื่อสินค้า...')}
      </div>
      <div>
        <label class="form-label">จำนวน</label>
        <input type="number" class="form-input" value="${s.qty}" min="1"
          oninput="opdSupplyQtyInput('${s.id}',this.value)" style="text-align:center;" />
      </div>
      <div>
        <label class="form-label">หน่วย</label>
        <input type="text" class="form-input" id="sup-unit-${s.id}" value="${s.unit}" readonly placeholder="-" />
      </div>
      <button class="btn btn-ghost btn-icon btn-sm" style="color:var(--red-500);align-self:flex-end;" onclick="opdRemoveSupply('${s.id}')">
        <i data-lucide="trash-2"></i>
      </button>
    </div>`;
  }).join('');
  
  document.getElementById('supplies-count').textContent = opdState.supplies.length;
  lucide.createIcons();
}

function opdSupplyProduct(id, code) {
  const s = opdState.supplies.find(x => x.id === id);
  if (!s) return;
  const p = opdProductsCache.find(x => x.code === code);
  s.productCode = code;
  s.productName = p ? p.name : '';
  s.unit = p ? p.unit : '';
  const unitEl = document.getElementById('sup-unit-' + id);
  if (unitEl) unitEl.value = s.unit;
}

function opdSupplyQtyInput(id, val) {
  const s = opdState.supplies.find(x => x.id === id);
  if (s) s.qty = parseInt(val) || 1;
}

function opdRemoveSupply(id) {
  opdState.supplies = opdState.supplies.filter(s => s.id !== id);
  opdRenderSupplies();
}

// ── Photos ─────────────────────────────────────────────────
async function opdHandlePhotos(e) {
  const files = Array.from(e.target.files);
  for (const f of files) {
    if (!f.type.startsWith('image/')) {
      const b64 = await fileToBase64(f);
      opdState.photos.push({ name: f.name, data: b64, id: 'ph_' + Date.now() + Math.random() });
      continue;
    }
    // Compress image
    const b64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const max_size = 1000;
          if (width > height) {
            if (width > max_size) { height *= max_size / width; width = max_size; }
          } else {
            if (height > max_size) { width *= max_size / height; height = max_size; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(f);
    });
    opdState.photos.push({ name: f.name, data: b64, id: 'ph_' + Date.now() + Math.random() });
  }
  opdRenderPhotos();
  e.target.value = '';
}

function opdRenderPhotos() {
  const wrap = document.getElementById('photo-thumbs');
  const area = document.getElementById('photo-upload-area');
  if (area) area.className = 'photo-upload-area' + (opdState.photos.length ? ' has-files' : '');
  if (!wrap) return;
  wrap.innerHTML = opdState.photos.map(p => `
    <div class="photo-thumb-wrap">
      ${p.data.startsWith('data:image')
        ? `<img src="${p.data}" class="photo-thumb" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-md);border:2px solid var(--gray-200);" />`
        : `<div style="width:80px;height:80px;background:var(--gray-100);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--gray-500);text-align:center;padding:4px;">${p.name}</div>`
      }
      <button class="photo-thumb-del" onclick="opdRemovePhoto('${p.id}')">×</button>
    </div>`).join('');
  document.getElementById('photos-count').textContent = opdState.photos.length;
}

function opdRemovePhoto(id) {
  opdState.photos = opdState.photos.filter(p => p.id !== id);
  opdRenderPhotos();
}

// ── Submit ─────────────────────────────────────────────────
async function opdSubmit() {
  const btn = document.getElementById('opd-submit-btn');

  if (opdState.isShared && !opdState.sharedBillId) { Toast.show('กรุณาเลือก OPD ที่ต้องการพ่วง', 'error'); return; }
  const sharedDetail = opdState.isShared ? await DB.getBillDetailSupabase(opdState.sharedBillId) : null;
  const hn           = opdState.isShared ? sharedDetail?.bill?.hn : document.getElementById('opd-hn').value.trim();
  const customerName = opdState.isShared ? sharedDetail?.bill?.customer_name : document.getElementById('opd-customer').value.trim();
  const date         = opdState.isShared ? sharedDetail?.bill?.bill_date : document.getElementById('opd-date').value;
  const branch       = opdState.isShared ? sharedDetail?.bill?.branch_name : currentBranch;
  if (!hn)           { Toast.show('กรุณากรอก HN', 'error'); return; }
  if (!customerName) { Toast.show('กรุณากรอกชื่อลูกค้า', 'error'); return; }
  if (!date)         { Toast.show('กรุณาเลือกวันที่', 'error'); return; }

  if (opdState.services.length === 0 && opdState.sales.length === 0) {
    Toast.show('กรุณาเพิ่มอย่างน้อย 1 รายการ (ค่ามือหรือรายการขาย)', 'error'); return;
  }

  if (!opdState.isShared && opdState.photos.length === 0) {
    Toast.show('⚠️ กรุณาแนบรูป OPD อย่างน้อย 1 รูปก่อนบันทึก', 'error', 5000);
    const photosBody = document.getElementById('photos-body');
    if (photosBody) photosBody.classList.remove('collapsed');
    return;
  }

  const hasCommission = opdState.services.some(s => (s.commission || 0) > 0);
  if (hasCommission && opdState.supplies.length === 0) {
    Toast.show('⚠️ มีรายการค่ามือ — กรุณาเพิ่มรายการเบิกยา/วัสดุอย่างน้อย 1 รายการ', 'error', 5000);
    const suppliesBody = document.getElementById('supplies-body');
    if (suppliesBody) suppliesBody.classList.remove('collapsed');
    return;
  }

  btn.classList.add('loading'); btn.disabled = true;

  const payload = {
    hn, customer_name: customerName, date, branch_name: branch, created_by: currentUser.id,
    linked_deposit_id: opdState.isShared ? null : opdState.linkedDepositId,
    services: opdState.services
      .filter(s => s.programCode || s.price)
      .map(s => ({ program_code: s.programCode, price: s.price, commission: s.commission })),
    sales: opdState.sales
      .filter(s => s.newProgram || s.newPrice)
      .map(s => ({
        type: s.type, old_program: s.oldProgram, old_price: s.oldPrice, new_program: s.newProgram,
        amount_paid: s.amountPaid, commission_base: s.commissionBase, commission_pct: s.commissionPct, commission_amt: s.commissionAmt
      })),
    supplies: opdState.supplies
      .filter(s => s.productCode)
      .map(s => ({ product_code: s.productCode, qty: s.qty })),
    images: opdState.photos.map(p => ({ data: p.data, name: p.name }))
  };

  try {
    if (opdState.isShared) await DB.appendOpdBillSupabase(opdState.sharedBillId, payload);
    else await DB.createOpdBillSupabase(payload);
    Toast.show(opdState.isShared ? 'พ่วงรายการกับ OPD เดิมเรียบร้อย ✓' : 'บันทึก OPD เรียบร้อย ✓ — รออนุมัติ', 'success', 4000);
    opdReset();
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาดขณะบันทึก: ' + e.message, 'error');
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

function opdSaveDraft() {
  const btn = document.getElementById('opd-draft-btn');
  let billId, hn, customerName, date, branch;

  if (opdState.isShared) {
    if (!opdState.sharedBillId) { Toast.show('กรุณาเลือกบิลที่ต้องการลงร่วม', 'error'); return; }
    const oldBill = DB.getBillById(opdState.sharedBillId);
    hn = oldBill.hn; customerName = oldBill.customerName; date = oldBill.date; branch = oldBill.branch;
  } else {
    hn           = document.getElementById('opd-hn').value.trim();
    customerName = document.getElementById('opd-customer').value.trim();
    date         = document.getElementById('opd-date').value;
    branch       = currentBranch;
    // For draft, we don't strictly require all fields, but we need at least something to identify it.
    if (!hn && !customerName) { Toast.show('กรุณากรอก HN หรือ ชื่อลูกค้า อย่างน้อย 1 อย่างเพื่อบันทึกร่าง', 'error'); return; }
    if (!date) date = todayISO();
  }

  btn.classList.add('loading'); btn.disabled = true;

  setTimeout(() => {
    if (opdState.billId && !opdState.isShared) {
      // Editing an existing bill (could be an existing draft)
      const b = DB.getBillById(opdState.billId);
      if (b) {
        b.hn = hn;
        b.customerName = customerName;
        b.date = date;
        b.status = 'ฉบับร่าง'; // Set to draft
        b.auditNote = '';
        DB.saveBill(b);
      }
      billId = opdState.billId;

      // Mark old records as superseded
      DB.getBillServices(billId).filter(s => !s.is_superseded).forEach(s => { s.is_superseded = true; DB.saveBillService(s); });
      DB.getBillSales(billId).filter(s => !s.is_superseded).forEach(s => { s.is_superseded = true; DB.saveBillSale(s); });
      DB.getBillSupplies(billId).filter(s => !s.is_superseded).forEach(s => { s.is_superseded = true; DB.saveBillSupply(s); });
      
      // Remove old images
      if (DB.getBillImages && DB.deleteBillImage) {
        const oldImgs = DB.getBillImages(billId);
        oldImgs.forEach(img => DB.deleteBillImage(img.id));
      }

      // Remove old stock logs tied to this bill (Draft shouldn't have stock logs, but just in case)
      if (DB._get && DB._set) {
        let slogs = DB._get('stock_logs') || [];
        slogs = slogs.filter(l => l.opdBillId !== billId);
        DB._set('stock_logs', slogs);
      }
    } else {
      // Create new draft
      const payload = { hn, customerName, date, branch, createdBy: currentUser.id, status: 'ฉบับร่าง' };
      if (opdState.isShared) payload.parentBillId = opdState.sharedBillId;
      const bill = DB.saveBill(payload);
      billId = bill.id;
    }

    opdState.services.forEach(s => {
      if (!s.programCode && !s.price) return;
      DB.saveBillService({ billId, programCode: s.programCode, programName: s.programName, price: s.price, commission: s.commission, createdBy: currentUser.id, is_superseded: false });
    });

    opdState.sales.forEach(s => {
      if (!s.newProgram && !s.newPrice) return;
      DB.saveBillSale({ 
        billId, type: s.type, 
        oldProgram: s.oldProgram, oldPrice: s.oldPrice, 
        newProgram: s.newProgram, newPrice: s.newPrice, 
        payType: s.payType, installmentNo: s.installmentNo, amountPaid: s.amountPaid, 
        commissionBase: s.commissionBase, commissionBaseManual: s.commissionBaseManual, commissionNote: s.commissionNote,
        commissionPct: s.commissionPct, commissionAmt: s.commissionAmt, 
        createdBy: currentUser.id, is_superseded: false 
      });
    });

    opdState.supplies.forEach(s => {
      if (!s.productCode) return;
      DB.saveBillSupply({ billId, productCode: s.productCode, productName: s.productName, qty: s.qty, unit: s.unit, createdBy: currentUser.id, is_superseded: false });
      // Note: We DO NOT auto-create stock logs for drafts. Stock logs are only created upon actual submission.
    });

    opdState.photos.forEach(p => {
      DB.saveBillImage({ billId, name: p.name, data: p.data });
    });

    btn.classList.remove('loading'); btn.disabled = false;
    Toast.show('บันทึกร่างเรียบร้อย สามารถเรียกดูและทำรายการต่อได้ที่หน้า "ประวัติบิลของฉัน"', 'success', 4000);
    opdReset();
    
    // Redirect to history tab to show the draft
    if (typeof navigate === 'function') navigate('history');
  }, 400);
}

function opdReset() {
  opdState = { billId: null, isShared: false, sharedBillId: null, sharedBillServices: [], linkedDepositId: null, photos: [], services: [], sales: [], supplies: [] };
  renderOPD(document.getElementById('page-content'));
}

// ── Edit Bill Mode ──────────────────────────────────────────
function opdEditBill(billId) {
  Toast.show('ฟีเจอร์แก้ไขบิลกำลังปรับปรุงให้ใช้กับฐานข้อมูลใหม่ ยังไม่พร้อมใช้งานตอนนี้ค่ะ', 'error', 5000);
  return;
  // eslint-disable-next-line no-unreachable
  const bill = DB.getBillById(billId);
  if (!bill) return;

  if (typeof appSwitchTab === 'function') appSwitchTab('opd');

  const oldSvcs = DB.getBillServices(bill.id).filter(s => !s.is_superseded).map(s => ({...s, id: 's_'+Date.now()+Math.random()}));
  const oldSales = DB.getBillSales(bill.id).filter(s => !s.is_superseded).map(s => ({...s, id: 'sl_'+Date.now()+Math.random()}));
  const oldSups = DB.getBillSupplies(bill.id).filter(s => !s.is_superseded).map(s => ({...s, id: 'sp_'+Date.now()+Math.random()}));
  const oldPhotos = (DB.getBillImages ? DB.getBillImages(bill.id) : []).map(p => ({...p, id: 'ph_'+Date.now()+Math.random()}));

  window._editingOpdState = {
    billId: bill.id,
    isShared: false,
    sharedBillId: null,
    sharedBillServices: [],
    linkedDepositId: null,
    photos: oldPhotos,
    services: oldSvcs.length ? oldSvcs : [{ id: 's_'+Date.now(), programCode: '', programName: '', price: 0, commission: 0 }],
    sales: oldSales,
    supplies: oldSups
  };

  if (typeof navigate === 'function') {
    navigate('opd');
  } else {
    renderOPD(document.getElementById('page-content'));
  }

  setTimeout(() => {
    document.getElementById('opd-hn').value = bill.hn || '';
    document.getElementById('opd-customer').value = bill.customerName || '';
    document.getElementById('opd-date').value = bill.date ? bill.date.split('T')[0] : todayISO();
    
    // Lock bill mode radios
    const radios = document.querySelectorAll('input[name="bill-mode"]');
    radios.forEach(r => r.disabled = true);
    
    // Add edit banner
    const form = document.getElementById('opd-form');
    if (form) {
      const banner = document.createElement('div');
      banner.className = 'alert-box alert-warning';
      banner.style.marginBottom = '16px';
      banner.innerHTML = `<i data-lucide="pencil"></i><span>กำลังแก้ไขบิล <strong>${bill.hn || ''}</strong> — ${bill.customerName} (บันทึกเพื่อส่งให้ Audit ตรวจใหม่)</span>`;
      form.insertBefore(banner, form.firstChild);
    }
    
    opdRenderServices();
    opdRenderSales();
    opdRenderSupplies();
    opdRenderPhotos();
    lucide.createIcons();
  }, 100);
}

