/**
 * ARANA CLINIC — Inventory Module
 * js/modules/inventory.js
 */

let invTab = 'out';
let invRows = [];
let invPhotos = [];
let invProductsCache = [];

async function renderInventory(container, defaultTab) {
  invTab = defaultTab || 'out';
  invRows = [{ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' }];
  invPhotos = [];

  container.innerHTML = `<div><div id="inv-body">กำลังโหลดรายการสินค้า...</div></div>`;

  invProductsCache = await DB.getProductsSupabase();
  invRender();
  lucide.createIcons();
}

function invSwitchTab(tab) {
  invTab = tab;
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

    <div class="section-header" style="margin-bottom:10px;">
      <span class="section-title ${info.color}">รายการ${invTab==='out'?'เบิก':invTab==='in'?'รับ':'โอน'}</span>
    </div>

    <div id="inv-rows-list"></div>

    <button class="btn btn-ghost btn-sm" onclick="invAddRow()" style="margin-bottom:20px;">
      <i data-lucide="plus"></i> เพิ่มรายการ
    </button>

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

  invRenderRows();
  lucide.createIcons();
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
    <div class="inv-row" style="display:grid;grid-template-columns:2fr 100px 80px 2fr auto;gap:10px;align-items:flex-end;margin-bottom:10px;padding:12px;background:var(--gray-50);border-radius:var(--radius-md);border:1px solid var(--gray-100);">
      <div class="form-group">
        <label class="form-label">รายการ${i===0?'<span class="required">*</span>':''}</label>
        ${buildSS(prodUID, prodItems, row.productCode, 'ssInvProd_' + row.id, '-- ค้นหาสินค้า --')}
      </div>
      <div class="form-group">
        <label class="form-label">จำนวน</label>
        <input type="number" class="form-input" value="${row.qty}" min="1" style="text-align:center;"
          oninput="invRowQty('${row.id}',this.value)" />
      </div>
      <div class="form-group">
        <label class="form-label">หน่วย</label>
        <input type="text" class="form-input" value="${row.unit}" readonly placeholder="-" style="width:100%;" />
      </div>
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
function invRowQty(id, val) { const r = invRows.find(x => x.id === id); if (r) r.qty = parseInt(val)||1; }
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

  const validRows = invRows.filter(r => r.productCode && r.qty > 0);
  if (!validRows.length) { Toast.show('กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'error'); return; }

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

  const directionByTab = { out: 'OUT', in: 'IN', transfer: 'OUT' };
  const typeByTab = { out: 'OUT', in: 'IN', transfer: 'TRANSFER' };
  const defaultNoteByTab = { out: 'เบิกใช้', in: 'รับเข้าสต๊อก', transfer: `โอนไปสาขา ${toBranch}` };

  const submitBtn = document.querySelector(`.btn-${{out:'orange',in:'blue',transfer:'purple'}[invTab]}`);
  if (submitBtn) submitBtn.disabled = true;

  try {
    const requestId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `REQ-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let firstLogId = null;
    for (const r of validRows) {
      const logId = await DB.saveStockLogSupabase({
        branch: currentBranch,
        toBranch,
        productCode: r.productCode,
        direction: directionByTab[invTab],
        type: typeByTab[invTab],
        qty: r.qty,
        note: r.note || defaultNoteByTab[invTab],
        createdBy: currentUser.id,
        source,
        requestId
      });
      if (!firstLogId) firstLogId = logId;
    }

    if (firstLogId) {
      for (const p of invPhotos) {
        await DB.saveStockLogImageSupabase(firstLogId, p.data);
      }
    }

    Toast.show(`บันทึกสำเร็จ — ${validRows.length} รายการ ⏳ รอ Audit อนุมัติ`, 'success', 4000);
    invReset();
  } catch (e) {
    console.error(e);
    Toast.show('เกิดข้อผิดพลาดขณะบันทึก: ' + e.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function invReset() {
  invRows = [{ id: 'r_' + Date.now(), productCode: '', productName: '', qty: 1, unit: '', note: '' }];
  invPhotos = [];
  invRender();
}

