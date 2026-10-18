/**
 * ARANA CLINIC — Inventory Module
 * js/modules/inventory.js
 */

let invTab = 'out';
let invRows = [];
let invPhotos = [];
let invProductsCache = [];
// Kept across a failed attempt so pressing save again cannot create the same request twice.
let invRequestId = null;

function invNewRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function renderInventory(container, defaultTab) {
  invTab = defaultTab || 'out';
  invRequestId = null;
  invRows = [{ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' }];
  invPhotos = [];

  container.innerHTML = `<div><div id="inv-body">กำลังโหลดรายการสินค้า...</div></div>`;

  invPoNo = ''; invPoRows = []; invOthers = [];
  [invProductsCache] = await Promise.all([DB.getProductsSupabase(), invTab === 'in' ? invLoadPos() : null]);
  invRender();
  lucide.createIcons();
}

async function invSwitchTab(tab) {
  invTab = tab;
  invPoNo = ''; invPoRows = []; invOthers = [];
  if (tab === 'in') await invLoadPos();
  invRequestId = null;
  invRows = [{ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' }];
  invPhotos = [];
  document.querySelectorAll('.inv-tab-btn').forEach(b => {
    b.className = 'inv-tab-btn';
  });
  const tabMap = { out: 'active-orange', in: 'active-blue', transfer: 'active-purple' };
  const btn = document.getElementById(`inv-tab-${tab}`);
  if (btn) btn.classList.add(tabMap[tab]);
  invRender();
}

function invRender() {
  const body = document.getElementById('inv-body');
  if (!body) return;

  const tabInfo = {
    out: { title: 'เบิกใช้วัสดุ/อุปกรณ์', color: 'orange', icon: 'package-minus', desc: 'บันทึกรายการที่ใช้กับลูกค้าวันนี้ กรุณาแนบรูปภาพประกอบ' },
    in:  { title: 'รับเข้าสต๊อก', color: 'blue', icon: 'package-plus', desc: 'บันทึกรายการสินค้าที่ได้รับจาก Supplier หรือจากการโอน' },
    transfer: { title: 'เบิกโอนข้ามสาขา', color: 'purple', icon: 'truck', desc: 'โอนสต๊อกให้สาขาอื่น กรุณาแนบรูปภาพใบเบิกโอน' },
  };
  const info = tabInfo[invTab];
  const branches = ['พิษณุโลก','กำแพงเพชร','แม่สอด','นครสวรรค์'].filter(b => b !== currentBranch);

  body.innerHTML = `
  <div class="glass-card bg-pastel-${info.color}" style="margin-bottom:16px;border-top:3px solid var(--${info.color}-500); padding:20px;">
    <div class="section-header" style="margin-bottom:12px;">
      <span class="section-title ${info.color}"><i data-lucide="${info.icon}" style="width:16px;height:16px;display:inline;margin-right:4px;"></i>${info.title}</span>
      <span style="display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;">
        <button class="btn btn-ghost btn-sm" onclick="erpExcelTemplate()" title="แบบฟอร์มเปล่าสำหรับกรอกมือ แล้วนำเข้า ERP"><i data-lucide="file-spreadsheet"></i> แบบฟอร์มเปล่า (.xlsx)</button>
        ${['Audit','StockAudit','Admin'].includes(currentUser.role) ? `<button class="btn btn-ghost btn-sm" onclick="erpExcelExport('${{ out: 'OUT', in: 'IN', transfer: 'TRANSFER' }[invTab]}')" title="รายการที่อนุมัติแล้วแต่ยังไม่เข้า ERP"><i data-lucide="download"></i> Export เข้า ERP (.xlsx)</button>` : ''}
      </span>
    </div>

    <div class="form-row" style="margin-bottom:16px;">
      <div class="form-group">
        <label class="form-label">วันที่ <span class="required">*</span></label>
        <input id="inv-date" type="date" class="form-input" value="${todayISO()}" max="${todayISO()}" />
      </div>
      <div class="form-group">
        <label class="form-label">สาขาที่เบิก</label>
        <input class="form-input" value="${currentBranch}" readonly />
      </div>
    </div>

    ${invTab === 'transfer' ? `
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">โอนไปสาขา <span class="required">*</span></label>
      <select id="inv-to-branch" class="form-select">
        <option value="">-- เลือกสาขาปลายทาง --</option>
        ${branches.map(b => `<option value="${b}">${b}</option>`).join('')}
      </select>
    </div>` : ''}

    ${invTab === 'in' ? invPoSectionHtml() : ''}

    ${invTab === 'out' ? `
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">เบิกใช้ในส่วนไหน <span class="required">*</span></label>
      <select id="inv-source" class="form-select">
        <option value="">-- เลือกแหล่งที่มา --</option>
        <option value="ห้องตรวจ">ห้องตรวจ (ผู้ช่วยแพทย์)</option>
        <option value="ห้องทรีทเมนท์">ห้องทรีทเมนท์</option>
        <option value="ทั่วไป">ของใช้ทั่วไป/สำนักงาน</option>
      </select>
      <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px;">เลือกให้ตรงนะคะ ข้อมูลนี้จะช่วยให้บัญชีเทียบยอดกับ OPD ได้ง่ายขึ้น</p>
    </div>` : ''}

    ${invTab === 'in' ? `<div id="inv-po-rows"></div><div id="inv-others"></div>` : `
    <div class="section-header" style="margin-bottom:10px;">
      <span class="section-title ${info.color}">รายการ${invTab==='out'?'เบิก':'โอน'}</span>
    </div>

    <div id="inv-rows-list"></div>

    <button class="btn btn-ghost btn-sm" onclick="invAddRow()" style="margin-bottom:20px;">
      <i data-lucide="plus"></i> เพิ่มรายการ
    </button>`}

    <div class="section-header" style="margin-bottom:10px;">
      <span class="section-title">ภาพถ่ายประกอบ <span class="required">*</span></span>
    </div>
    <div class="photo-upload-area" id="inv-photo-area" onclick="document.getElementById('inv-photo-input').click()">
      <i data-lucide="camera"></i>
      <p>คลิกแนบรูปภาพใบเบิก / ใบส่งสินค้า<br><span style="font-size:0.75rem;">อย่างน้อย 1 ภาพ (บังคับ)</span></p>
    </div>
    <input id="inv-photo-input" type="file" multiple accept="image/*" style="display:none;" onchange="invHandlePhotos(event)" />
    <div class="photo-thumbnails" id="inv-thumbs" style="margin-top:10px;"></div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-100);">
      <button class="btn btn-ghost" onclick="invReset()"><i data-lucide="rotate-ccw"></i> ล้างฟอร์ม</button>
      <button class="btn btn-${info.color}" onclick="invSubmit()">
        <i data-lucide="save"></i> บันทึก${invTab==='out'?'การเบิก':invTab==='in'?'การรับ':'การโอน'}
      </button>
    </div>
  </div>`;

  if (invTab === 'in') { invRenderPoRows(); invRenderOthers(); } else invRenderRows();
  lucide.createIcons();
}

// ── รับของเข้าตาม PO (คุณออม 18/10) ─────────────────────────────
// พนักงานเห็นแค่ชื่อสินค้าใน PO แล้วนับเอง (ไม่เห็นจำนวนที่สั่ง) — บัญชีเห็นจำนวนค้างรับตอนตรวจ
// ของที่มาแต่ไม่อยู่ใน PO ใส่ใน "ของใช้อื่นๆ" ให้บัญชีตัดสิน
let invPos = [];
let invPoNo = '';
let invPoRows = [];
let invOthers = [];

async function invLoadPos() {
  try { invPos = await DB.listOpenPosForReceivingSupabase(currentBranch); }
  catch (e) { invPos = null; console.error(e); }
}
function invEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function invPoSectionHtml() {
  if (invPos === null) return `<div class="alert-box alert-warning" style="margin-bottom:16px;"><i data-lucide="alert-triangle"></i><span>โหลดรายการ PO ไม่สำเร็จ กรุณารีเฟรชหน้า</span></div>`;
  const list = invPos.length ? `<div class="table-wrap" style="margin-bottom:12px;"><table><thead><tr><th>เลขที่ PO</th><th>วันที่สั่ง</th><th>ผู้ขาย</th><th>รายการ</th><th></th></tr></thead><tbody>
    ${invPos.map(p => `<tr style="${p.po_no === invPoNo ? 'background:var(--blue-50,#eff6ff);' : ''}"><td style="font-weight:700;">${invEsc(p.po_no)}</td><td class="nowrap">${p.order_date ? formatDate(p.order_date) : '-'}</td><td>${invEsc(p.vendor || 'ไม่ระบุผู้ขาย')}</td><td>${(p.items || []).length} รายการ</td><td>${p.po_no === invPoNo ? '<span class="badge badge-approved">กำลังรับ</span>' : `<button class="btn btn-ghost btn-sm" onclick="invSelectPo('${invEsc(p.po_no)}')">เลือก</button>`}</td></tr>`).join('')}
  </tbody></table></div>` : `<div class="empty-state" style="padding:16px;margin-bottom:12px;">ยังไม่มี PO ค้างรับของสาขา${invEsc(currentBranch)} — ถ้ามีของมาแต่ไม่มี PO ใส่ใน "ของใช้อื่นๆ" ด้านล่าง</div>`;
  return `<div class="section-header" style="margin-bottom:8px;"><span class="section-title blue">ใบสั่งซื้อ (PO) ที่รอรับของ</span><span style="font-size:.75rem;color:var(--gray-500);margin-left:8px;">เรียงจาก PO ที่สั่งนานที่สุด · อัปเดต 05:00 / 11:00 / 17:00</span></div>${list}`;
}

function invSelectPo(poNo) {
  const po = (invPos || []).find(p => p.po_no === poNo);
  if (!po) return;
  invPoNo = poNo;
  invPoRows = (po.items || []).map(i => ({ sku: i.sku, name: i.name, unit: i.unit, expiry: !!i.expiry_controlled, qty: '', expireDate: '', note: '' }));
  invRequestId = null;
  invRender();
}

function invRenderPoRows() {
  const box = document.getElementById('inv-po-rows');
  if (!box) return;
  if (!invPoNo) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section-header" style="margin-bottom:8px;"><span class="section-title blue">รายการรับของตาม ${invEsc(invPoNo)}</span>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="invPoNo='';invPoRows=[];invRender()">ไม่รับ PO นี้</button></div>
  <p style="font-size:.78rem;color:var(--gray-500);margin:0 0 10px;">นับของที่มาถึงจริงแล้วกรอกจำนวนให้ครบทุกบรรทัด (จำนวนเต็ม) — ของที่ยังไม่มาใส่ 0</p>
  ${invPoRows.map((r, i) => `<div style="display:grid;grid-template-columns:minmax(0,2fr) 110px 70px ${r.expiry ? '150px ' : ''}minmax(0,1.5fr);gap:10px;align-items:flex-end;margin-bottom:8px;padding:10px 12px;background:var(--gray-50);border-radius:var(--radius-md);border:1px solid var(--gray-100);">
    <div><div style="font-weight:600;">${invEsc(r.name)}</div><div style="font-size:.72rem;color:var(--gray-500);">${invEsc(r.sku)}</div></div>
    <div class="form-group"><label class="form-label">จำนวนรับจริง <span class="required">*</span></label><input type="number" class="form-input" min="0" step="1" inputmode="numeric" value="${invEsc(r.qty)}" style="text-align:center;" oninput="invPoRows[${i}].qty=this.value" /></div>
    <div class="form-group"><label class="form-label">หน่วย</label><input class="form-input" value="${invEsc(r.unit || '-')}" readonly /></div>
    ${r.expiry ? `<div class="form-group"><label class="form-label">วันหมดอายุ <span class="required">*</span></label><input type="date" class="form-input" value="${invEsc(r.expireDate)}" onchange="invPoRows[${i}].expireDate=this.value" /></div>` : ''}
    <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" value="${invEsc(r.note)}" placeholder="เช่น กล่องบุบ" oninput="invPoRows[${i}].note=this.value" /></div>
  </div>`).join('')}`;
}

function invRenderOthers() {
  const box = document.getElementById('inv-others');
  if (!box) return;
  box.innerHTML = `<div class="section-header" style="margin:14px 0 8px;"><span class="section-title blue">ของใช้อื่นๆ</span><span style="font-size:.75rem;color:var(--gray-500);margin-left:8px;">ของที่มาถึงแต่ไม่อยู่ใน PO — ถ่ายรูปแนบ บัญชีจะตรวจว่าเข้าคลังหรือไม่</span></div>
  ${invOthers.map((o, i) => `<div style="display:grid;grid-template-columns:minmax(0,2fr) 100px 100px minmax(0,1.5fr) auto;gap:10px;align-items:flex-end;margin-bottom:8px;padding:10px 12px;background:var(--gray-50);border-radius:var(--radius-md);border:1px solid var(--gray-100);">
    <div class="form-group"><label class="form-label">ชื่อของ <span class="required">*</span></label><input class="form-input" value="${invEsc(o.name)}" placeholder="เช่น กระดาษทิชชู่" oninput="invOthers[${i}].name=this.value" /></div>
    <div class="form-group"><label class="form-label">จำนวน <span class="required">*</span></label><input type="number" class="form-input" min="0" step="any" value="${invEsc(o.qty)}" style="text-align:center;" oninput="invOthers[${i}].qty=this.value" /></div>
    <div class="form-group"><label class="form-label">หน่วย</label><input class="form-input" value="${invEsc(o.unit)}" placeholder="ชิ้น/กล่อง" oninput="invOthers[${i}].unit=this.value" /></div>
    <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" value="${invEsc(o.note)}" oninput="invOthers[${i}].note=this.value" /></div>
    <button class="btn btn-ghost btn-icon btn-sm" style="color:var(--red-500);" onclick="invOthers.splice(${i},1);invRenderOthers()"><i data-lucide="trash-2"></i></button>
  </div>`).join('')}
  <button class="btn btn-ghost btn-sm" onclick="invOthers.push({name:'',qty:'',unit:'',note:''});invRenderOthers()" style="margin-bottom:20px;"><i data-lucide="plus"></i> เพิ่มของใช้อื่นๆ</button>`;
  lucide.createIcons();
}

// Returns the receiving payload, or a Thai error message string.
function invCollectReceiving() {
  const lines = [];
  if (invPoNo) {
    for (const r of invPoRows) {
      const raw = String(r.qty).trim();
      if (raw === '') return `กรุณากรอกจำนวนให้ครบทุกบรรทัด (ของที่ยังไม่มาใส่ 0): ${r.name}`;
      const q = Number(raw);
      if (!Number.isInteger(q) || q < 0) return `จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป: ${r.name}`;
      if (q > 0 && r.expiry && !r.expireDate) return `กรุณากรอกวันหมดอายุ: ${r.name}`;
      lines.push({ product_code: r.sku, qty: q, note: r.note || 'รับเข้าสต๊อก', expire_date: q > 0 ? (r.expireDate || null) : null });
    }
  }
  const others = [];
  for (const o of invOthers) {
    if (!String(o.name).trim() && String(o.qty).trim() === '') continue;
    const q = Number(o.qty);
    if (!String(o.name).trim() || !(q > 0)) return 'ของใช้อื่นๆ ต้องมีชื่อและจำนวนมากกว่า 0';
    others.push({ name: String(o.name).trim(), qty: q, unit: String(o.unit || '').trim(), note: String(o.note || '').trim() });
  }
  if (!lines.some(l => l.qty > 0) && !others.length) return 'กรุณาเลือก PO แล้วกรอกจำนวนที่รับ หรือเพิ่มของใช้อื่นๆ อย่างน้อย 1 รายการ';
  return { lines, others };
}

function invRenderRows() {
  const list = document.getElementById('inv-rows-list');
  if (!list) return;
  const products = invProductsCache;
  list.innerHTML = invRows.map((row, i) => {
    const prodUID = 'invprod-' + row.id;
    window['ssInvProd_' + row.id] = function(code) { invRowProduct(row.id, code); };
    const prodItems = products.map(p => ({ code: p.code, name: p.name, extra: p.code }));
    
    return `
    <div class="inv-row" style="display:grid;grid-template-columns:2fr 100px 80px ${invTab === 'in' ? '130px 140px ' : ''}2fr auto;gap:10px;align-items:flex-end;margin-bottom:10px;padding:12px;background:var(--gray-50);border-radius:var(--radius-md);border:1px solid var(--gray-100);">
      <div class="form-group">
        <label class="form-label">รายการ${i===0?'<span class="required">*</span>':''}</label>
        ${buildSS(prodUID, prodItems, row.productCode, 'ssInvProd_' + row.id, '-- ค้นหาสินค้า --')}
      </div>
      <div class="form-group">
        <label class="form-label">จำนวน</label>
        <input type="number" class="form-input" value="${row.qty}" min="0" step="any" inputmode="decimal" style="text-align:center;"
          oninput="invRowQty('${row.id}',this.value)" />
      </div>
      <div class="form-group">
        <label class="form-label">หน่วย</label>
        <input type="text" class="form-input" value="${row.unit}" readonly placeholder="-" style="width:100%;" />
      </div>
      ${invTab === 'in' ? `
      <div class="form-group">
        <label class="form-label">เลขล็อต</label>
        <input type="text" class="form-input" value="${row.lotNo||''}" placeholder="Lot" autocomplete="off"
          oninput="invRowField('${row.id}','lotNo',this.value)" />
      </div>
      <div class="form-group">
        <label class="form-label">วันหมดอายุ</label>
        <input type="date" class="form-input" value="${row.expireDate||''}"
          onchange="invRowField('${row.id}','expireDate',this.value)" />
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">หมายเหตุ</label>
        <input type="text" class="form-input" value="${row.note||''}" placeholder="ระบุเหตุผล/เคส..."
          oninput="invRowNote('${row.id}',this.value)" />
      </div>
      ${i > 0 ? `<button class="btn btn-ghost btn-icon btn-sm" style="color:var(--red-500);" onclick="invRemoveRow('${row.id}')"><i data-lucide="trash-2"></i></button>` : '<div></div>'}
    </div>`;
  }).join('');
  lucide.createIcons();
}

function invAddRow() {
  invRows.push({ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' });
  invRenderRows();
}

function invRowProduct(id, code) {
  const r = invRows.find(x => x.id === id);
  if (!r) return;
  const p = invProductsCache.find(x => x.code === code);
  r.productCode = code;
  r.productName = p ? p.name : '';
  r.unit = p ? p.unit : '';
  invRenderRows();
}
function invRowField(id, key, val) { const r = invRows.find(x => x.id === id); if (r) r[key] = String(val || '').trim(); }
function invRowQty(id, val) { const r = invRows.find(x => x.id === id); if (r) r.qty = parseQty(val) ?? r.qty; }
function invRowNote(id, val) { const r = invRows.find(x => x.id === id); if (r) r.note = val; }
function invRemoveRow(id) { if (invRows.length <= 1) return; invRows = invRows.filter(x => x.id !== id); invRenderRows(); }

async function invHandlePhotos(e) {
  for (const f of Array.from(e.target.files)) {
    const b64 = await fileToBase64(f);
    invPhotos.push({ id: 'ip_'+Date.now()+Math.random(), name: f.name, data: b64 });
  }
  invRenderPhotos();
  e.target.value = '';
}

function invRenderPhotos() {
  const thumbs = document.getElementById('inv-thumbs');
  const area = document.getElementById('inv-photo-area');
  if (area) area.className = 'photo-upload-area' + (invPhotos.length ? ' has-files' : '');
  if (!thumbs) return;
  thumbs.innerHTML = invPhotos.map(p => `
    <div class="photo-thumb-wrap">
      <img src="${p.data}" class="photo-thumb" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-md);border:2px solid var(--gray-200);" onerror="this.style.display='none'" />
      <button class="photo-thumb-del" onclick="invRemovePhoto('${p.id}')">×</button>
    </div>`).join('');
}

function invRemovePhoto(id) { invPhotos = invPhotos.filter(p => p.id !== id); invRenderPhotos(); }

async function invSubmit() {
  const date = document.getElementById('inv-date')?.value;
  if (!date) { Toast.show('กรุณาเลือกวันที่', 'error'); return; }

  let receiving = null;
  if (invTab === 'in') {
    receiving = invCollectReceiving();
    if (typeof receiving === 'string') { Toast.show(receiving, 'error', 5000); return; }
  }
  const validRows = invTab === 'in' ? [] : invRows.filter(r => r.productCode && r.qty > 0);
  if (invTab !== 'in' && !validRows.length) { Toast.show('กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'error'); return; }

  if (invPhotos.length === 0) { Toast.show('กรุณาแนบภาพถ่ายอย่างน้อย 1 ภาพ', 'error'); return; }

  let toBranch = null;
  if (invTab === 'transfer') {
    toBranch = document.getElementById('inv-to-branch')?.value;
    if (!toBranch) { Toast.show('กรุณาเลือกสาขาปลายทาง', 'error'); return; }
  }

  let source = null;
  if (invTab === 'out') {
    source = document.getElementById('inv-source')?.value;
    if (!source) { Toast.show('กรุณาเลือกว่าเบิกใช้ในส่วนไหน (ห้องตรวจ/ทรีทเมนท์/ทั่วไป)', 'error'); return; }
  }

  const typeByTab = { out: 'OUT', in: 'IN', transfer: 'TRANSFER' };
  const defaultNoteByTab = { out: 'เบิกใช้', in: 'รับเข้าสต๊อก', transfer: `โอนไปสาขา ${toBranch}` };

  const submitBtn = document.querySelector(`.btn-${{out:'orange',in:'blue',transfer:'purple'}[invTab]}`);
  if (submitBtn) submitBtn.disabled = true;

  if (!invRequestId) invRequestId = invNewRequestId();
  try {
    const res = await DB.saveStockRequestSupabase({
      requestId: invRequestId,
      branch: currentBranch,
      toBranch,
      moveType: typeByTab[invTab],
      source,
      date,
      poNo: invTab === 'in' ? (invPoNo || null) : null,
      supplier: null,
      lines: invTab === 'in' ? receiving.lines : validRows.map(r => ({ product_code: r.productCode, qty: r.qty, note: r.note || defaultNoteByTab[invTab] })),
      others: invTab === 'in' ? receiving.others : [],
      images: invPhotos.map(p => p.data)
    });
    const count = invTab === 'in' ? receiving.lines.filter(l => l.qty > 0).length + receiving.others.length : validRows.length;
    Toast.show(res && res.duplicate
      ? 'ใบนี้บันทึกเข้าระบบไปแล้วก่อนหน้านี้ ✓ ไม่ได้บันทึกซ้ำ'
      : `บันทึกสำเร็จ — ${count} รายการ ⏳ รอบัญชีอนุมัติ${invTab === 'in' ? ' (สต็อกจะเพิ่มเมื่ออนุมัติ)' : ' (สต็อกจะถูกตัดเมื่ออนุมัติ)'}`, 'success', 5000);
    if (invTab === 'in') { invPoNo = ''; invPoRows = []; invOthers = []; await invLoadPos(); }
    invReset();
  } catch (e) {
    console.error(e);
    Toast.show('บันทึกไม่สำเร็จ: ' + DB.stockErrorText(e), 'error', 6000);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function invReset() {
  invRequestId = null;
  invPoNo = ''; invPoRows = []; invOthers = [];
  invRows = [{ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' }];
  invPhotos = [];
  invRender();
}
