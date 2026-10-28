/**
 * ARANA Staff — โอนข้ามสาขา 2 ขั้น (ข้อ 17, SQL ไฟล์ 19)
 *  - เมนู "รับโอนข้ามสาขา": ปลายทางนับรับแบบไม่เห็นจำนวนที่ส่ง + ถ่ายรูป
 *  - หน้า "เบิกโอนข้ามสาขา": ใบที่บัญชีส่งกลับให้ต้นทางแก้ (เบิกผิด)
 *  - Audit Room แท็บโอน: เทียบส่ง vs รับ → อนุมัติ / ต้นทางแก้ / นับใหม่ / ของหายจริง
 */
const trfEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trfQty = v => (v == null || v === '') ? '-' : String(Math.round(Number(v) * 1000) / 1000);
const trfMissing = e => e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));
function trfErr(e) {
  const map = { NOT_WAITING: 'ใบนี้ไม่ได้รออยู่แล้ว (อาจมีคนทำไปแล้ว) กรุณารีเฟรชหน้า', COUNT_REQUIRED: 'กรุณากรอกจำนวนทุกรายการ (ไม่ได้รับ/ไม่ได้ส่ง ใส่ 0)',
    EVIDENCE_REQUIRED: 'กรุณาถ่ายรูปของที่รับอย่างน้อย 1 รูป', COUNT_MISMATCH: 'จำนวนส่งกับรับไม่ตรงกัน', RECEIVED_MORE_THAN_SENT: 'ปลายทางนับได้มากกว่าที่ส่ง — ให้ต้นทางแก้ หรือให้นับใหม่',
    NOTE_REQUIRED: 'กรุณาระบุเหตุผล', NOT_IN_TRANSFER: 'มีสินค้าที่ไม่อยู่ในใบโอนนี้', FORBIDDEN_BRANCH: 'ทำได้เฉพาะสาขาของตัวเอง' };
  const code = Object.keys(map).find(k => (e?.message || '').includes(k));
  return code ? map[code] : (trfMissing(e) ? 'ยังไม่ได้ติดตั้งฐานข้อมูลโอน 2 ขั้น (SQL ไฟล์ 19)' : DB.stockErrorText(e));
}

// ── ปลายทาง: รับโอนข้ามสาขา ──────────────────────────────
let trfIncoming = [];
let trfCounts = {};
let trfPhotos = [];
let trfOpen = null;

async function renderTransferReceive(container) {
  trfOpen = null;
  container.innerHTML = `<div id="trf-body"><div class="loading-placeholder"><div class="spinner"></div></div></div>`;
  try { trfIncoming = await DB.listIncomingTransfersSupabase(currentBranch); }
  catch (e) {
    document.getElementById('trf-body').innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>โหลดรายการไม่สำเร็จ</h4><p>${trfErr(e)}</p></div>`;
    lucide.createIcons(); return;
  }
  trfRenderList();
}

function trfRenderList() {
  const body = document.getElementById('trf-body');
  if (!body) return;
  body.innerHTML = `
    <div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
      <span>ของที่สาขาอื่นโอนมาให้สาขา<b>${trfEsc(currentBranch)}</b> และบัญชีอนุมัติแล้ว — เปิดใบ นับของจริงทุกรายการ ถ่ายรูป แล้วกดบันทึก (ระบบจะไม่บอกจำนวนที่ส่งมา)</span></div>
    ${trfIncoming.length ? trfIncoming.map(t => `
      <div class="glass-card trf-card" onclick="trfOpenCount('${t.request_id}')">
        <div class="trf-card-main">
          <div class="trf-card-title"><i data-lucide="truck"></i> จากสาขา${trfEsc(t.from_branch)}</div>
          <div class="trf-card-sub">วันที่โอน ${formatDate(t.log_date)} · ผู้ส่ง ${trfEsc(t.sent_by || '-')} · ${t.items.length} รายการ</div>
          ${t.recount ? `<div class="trf-card-warn"><i data-lucide="rotate-ccw"></i> บัญชีขอให้นับใหม่${t.recount_note ? ': ' + trfEsc(t.recount_note) : ''}</div>` : ''}
        </div>
        <button class="btn btn-primary btn-sm"><i data-lucide="clipboard-check"></i> นับรับ</button>
      </div>`).join('')
    : `<div class="empty-state"><i data-lucide="package-check"></i><h4>ไม่มีของรอรับโอน</h4><p>เมื่อสาขาอื่นโอนของมาและบัญชีอนุมัติแล้ว จะขึ้นที่นี่</p></div>`}`;
  lucide.createIcons();
}

function trfOpenCount(requestId) {
  const t = trfIncoming.find(x => x.request_id === requestId);
  if (!t) return;
  trfOpen = t; trfCounts = {}; trfPhotos = [];
  const body = document.getElementById('trf-body');
  body.innerHTML = `
    <button class="btn btn-ghost btn-sm" style="margin-bottom:10px;" onclick="trfRenderList()"><i data-lucide="arrow-left"></i> กลับไปรายการ</button>
    <div class="opd-section">
      <div class="opd-section-head always-open"><h3><i data-lucide="truck"></i>รับโอนจากสาขา${trfEsc(t.from_branch)} · วันที่โอน ${formatDate(t.log_date)}</h3></div>
      <div class="opd-section-body">
        <p class="opd-hint">นับของที่ได้รับจริงทุกรายการ — ไม่ได้รับรายการไหนใส่ 0</p>
        <div class="trf-count-list">
          ${t.items.map((i, n) => `<div class="count-row">
            <div class="count-row-info"><div class="count-row-name">${trfEsc(i.product_name)}</div></div>
            <input type="number" class="count-input" id="trf-q-${n}" min="0" step="any" inputmode="decimal" placeholder="นับได้"
              oninput="trfSetCount('${trfEsc(i.product_code)}', this.value)" />
            <span class="count-unit">${trfEsc(i.unit || '')}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="opd-section">
      <div class="opd-section-head always-open"><h3><i data-lucide="camera"></i>รูปของที่รับ <span class="required">*</span></h3><span class="opd-section-count" id="trf-photo-count">0</span></div>
      <div class="opd-section-body">
        <div class="photo-upload-area" id="trf-photo-area" onclick="document.getElementById('trf-photo-input').click()"><i data-lucide="camera"></i><p>ถ่ายหรือแนบรูปของที่ได้รับ<br><span style="font-size:.75rem;">อย่างน้อย 1 รูป · รูปที่แนบต้องมีวันที่กำกับ</span></p></div>
        <input id="trf-photo-input" type="file" accept="image/*" multiple style="display:none;" onchange="trfHandlePhotos(event)" />
        <div class="photo-thumbnails" id="trf-thumbs"></div>
        <div class="form-group" style="margin-top:12px;"><label class="form-label">หมายเหตุ (ถ้ามี)</label><textarea id="trf-note" class="form-input" rows="2" placeholder="เช่น กล่องบุบ 1 กล่อง"></textarea></div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding-bottom:20px;">
      <button class="btn btn-primary" id="trf-save" onclick="trfSubmit()"><i data-lucide="save"></i> บันทึกการรับโอน</button>
    </div>`;
  lucide.createIcons();
}

function trfSetCount(code, val) {
  const raw = String(val ?? '').trim(), n = Number(raw);
  if (raw !== '' && Number.isFinite(n) && n >= 0) trfCounts[code] = Math.round(n * 1000) / 1000; else delete trfCounts[code];
}
async function trfHandlePhotos(e) {
  for (const f of Array.from(e.target.files || [])) trfPhotos.push({ id: 'tp_' + Date.now() + Math.random(), data: await fileToBase64(f) });
  e.target.value = '';
  trfRenderPhotos();
}
function trfRenderPhotos() {
  const wrap = document.getElementById('trf-thumbs');
  document.getElementById('trf-photo-area')?.classList.toggle('has-files', trfPhotos.length > 0);
  const c = document.getElementById('trf-photo-count'); if (c) c.textContent = trfPhotos.length;
  if (wrap) wrap.innerHTML = trfPhotos.map(p => `<div class="photo-thumb-wrap"><img src="${p.data}" class="photo-thumb" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-md);border:2px solid var(--gray-200);" /><button class="photo-thumb-del" onclick="trfPhotos=trfPhotos.filter(x=>x.id!=='${p.id}');trfRenderPhotos()">×</button></div>`).join('');
}
async function trfSubmit() {
  const t = trfOpen; if (!t) return;
  const missing = t.items.filter(i => trfCounts[i.product_code] === undefined);
  if (missing.length) { Toast.show(`กรุณากรอกจำนวนที่นับได้ให้ครบ (ยังขาด ${missing.length} รายการ — ไม่ได้รับใส่ 0)`, 'error', 5000); return; }
  if (!trfPhotos.length) { Toast.show('กรุณาถ่ายรูปของที่รับอย่างน้อย 1 รูป', 'error'); return; }
  const btn = document.getElementById('trf-save'); if (btn) btn.disabled = true;
  try {
    await DB.receiveTransferSupabase(t.request_id, t.items.map(i => ({ product_code: i.product_code, qty: trfCounts[i.product_code] })),
      trfPhotos.map(p => p.data), document.getElementById('trf-note')?.value || '');
  } catch (e) {
    if (btn) btn.disabled = false;
    Toast.show('บันทึกไม่สำเร็จ: ' + trfErr(e), 'error', 6000); return;
  }
  Toast.show('บันทึกการรับโอนแล้ว ✓ รอบัญชีตรวจ', 'success', 4000);
  await renderTransferReceive(getPage());
  // แชร์เข้ากลุ่ม LINE รับเข้า/รับโอน ของสาขา
  if (typeof stockShareOffer === 'function') stockShareOffer({ kind: 'receive', count: t.items.length, date: todayISO(), branch: currentBranch,
    fromBranch: t.from_branch, markers: (typeof Photos !== 'undefined' && Photos.lastStored) || [], requestId: t.request_id });
}

// ── ต้นทาง: ใบโอนที่บัญชีส่งกลับให้แก้ (แสดงบนหน้า "เบิกโอนข้ามสาขา") ──
let trfFixes = [];
async function trfLoadFixes() {
  const body = document.getElementById('inv-body');
  if (!body) return;
  try { trfFixes = await DB.listTransfersToFixSupabase(currentBranch); } catch (e) { trfFixes = []; }
  document.getElementById('trf-fix-box')?.remove();
  if (!trfFixes.length || invTab !== 'transfer') return;
  const box = document.createElement('div');
  box.id = 'trf-fix-box';
  box.className = 'alert-box alert-warning';
  box.style.marginBottom = '14px';
  box.innerHTML = `<i data-lucide="alert-triangle"></i><span style="flex:1;"><b>มีใบโอน ${trfFixes.length} ใบที่ปลายทางนับได้ไม่ตรง — บัญชีให้ต้นทางตรวจและแก้</b><br>
    ${trfFixes.map(f => `ไปสาขา${trfEsc(f.to_branch)} วันที่ ${formatDate(f.log_date)}${f.decision_note ? ' · บัญชี: ' + trfEsc(f.decision_note) : ''}
      <button class="btn btn-primary btn-sm" style="margin:4px 0 0 6px;" onclick="trfOpenFix('${f.request_id}')">ตรวจและแก้</button>`).join('<br>')}</span>`;
  body.prepend(box);
  lucide.createIcons();
}
function trfOpenFix(requestId) {
  const f = trfFixes.find(x => x.request_id === requestId);
  if (!f) return;
  openModal(`<div class="modal" style="max-width:640px;width:95%;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="pencil"></i>แก้ใบโอนไปสาขา${trfEsc(f.to_branch)}</h3>
    <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <p style="margin:0 0 10px;font-size:.85rem;color:var(--gray-600);">ตรวจของที่เหลือในสาขาแล้วกรอก <b>จำนวนที่ส่งไปจริง</b> — ระบบจะยกเลิกใบโอนเดิม (คืนสต็อกต้นทาง และยกเลิกใน ERP ถ้าส่งไปแล้ว) แล้วสร้างใบใหม่ตามจำนวนนี้ให้บัญชีตรวจอีกครั้ง</p>
      <div class="table-wrap"><table><thead><tr><th>รายการ</th><th class="num">เบิกส่งไว้</th><th class="num">ปลายทางนับได้</th><th class="num">ส่งไปจริง</th></tr></thead><tbody>
        ${f.lines.map((l, n) => `<tr><td class="col-text">${trfEsc(l.product_name)} <small>${trfEsc(l.unit || '')}</small></td><td class="num">${trfQty(l.sent)}</td>
          <td class="num" style="${Number(l.sent) !== Number(l.received) ? 'color:var(--red-600);font-weight:700;' : ''}">${trfQty(l.received)}</td>
          <td><input type="number" class="form-input trf-fix-qty" data-code="${trfEsc(l.product_code)}" min="0" step="any" value="${trfQty(l.received)}" style="width:90px;" /></td></tr>`).join('')}
      </tbody></table></div>
      <div class="form-group" style="margin-top:12px;"><label class="form-label">เหตุผล <span class="required">*</span></label>
        <input id="trf-fix-reason" class="form-input" value="เบิกผิด" /></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-primary" id="trf-fix-save" onclick="trfSendFix('${f.request_id}')"><i data-lucide="save"></i> บันทึกการแก้</button></div></div>`, { width: '680px' });
}
async function trfSendFix(requestId) {
  const lines = [...document.querySelectorAll('.trf-fix-qty')].map(el => ({ product_code: el.dataset.code, qty: el.value === '' ? null : Number(el.value) }));
  if (lines.some(l => l.qty == null || !Number.isFinite(l.qty) || l.qty < 0)) { Toast.show('กรุณากรอกจำนวนที่ส่งไปจริงทุกรายการ (ไม่ได้ส่งใส่ 0)', 'error'); return; }
  const reason = (document.getElementById('trf-fix-reason')?.value || '').trim();
  if (!reason) { Toast.show('กรุณาระบุเหตุผล', 'error'); return; }
  const btn = document.getElementById('trf-fix-save'); if (btn) btn.disabled = true;
  try { await DB.fixTransferDispatchSupabase(requestId, lines, reason); }
  catch (e) { if (btn) btn.disabled = false; Toast.show('บันทึกไม่สำเร็จ: ' + trfErr(e), 'error', 6000); return; }
  closeModalDirect();
  Toast.show('แก้ใบโอนแล้ว ✓ ส่งให้บัญชีตรวจอีกครั้ง', 'success', 4000);
  trfLoadFixes();
}
if (typeof invRender === 'function') {
  const trfInvRender = invRender;
  invRender = function () { trfInvRender(); if (invTab === 'transfer') trfLoadFixes(); };
}

// ── บัญชี: ตรวจรับโอน (ในแท็บ "ตรวจโอนออก-รับเข้าข้ามสาขา") ──────────
let audReceipts = [];
async function audLoadReceipts() {
  const box = document.getElementById('aud-receipts');
  if (!box) return;
  try { audReceipts = await DB.listTransferReceiptsSupabase('รอตรวจรับ'); }
  catch (e) { box.innerHTML = trfMissing(e) ? '' : `<div class="glass-card" style="margin-bottom:12px;padding:12px 16px;color:var(--red-600);">โหลดใบรับโอนไม่สำเร็จ: ${trfErr(e)}</div>`; return; }
  const diff = r => r.lines.some(l => Number(l.sent) !== Number(l.received ?? 0));
  box.innerHTML = `<div class="glass-card" style="margin-bottom:12px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <span style="font-weight:700;color:var(--gray-700);">ตรวจรับโอน — ปลายทางนับแล้ว</span>
      <span class="badge badge-pending">${audReceipts.length} ใบ</span>
      <span style="font-size:.8rem;color:var(--gray-500);flex-basis:100%;">เทียบจำนวนที่ส่งกับที่ปลายทางนับได้ · ตรงกัน = อนุมัติแล้วเพิ่มสต็อกปลายทาง · ไม่ตรง = เลือก ต้นทางแก้ / ให้นับใหม่ / ของหายจริง</span>
    </div>
    ${audReceipts.length ? `<div class="table-wrap"><table><thead><tr><th>วันที่โอน</th><th>สาขา</th><th>ผู้ส่ง → ผู้รับ</th><th>รายการ</th><th>ผลเทียบ</th><th></th></tr></thead><tbody>
      ${audReceipts.map(r => `<tr><td class="nowrap">${formatDate(r.log_date)}</td><td>${trfEsc(r.from_branch)} → ${trfEsc(r.to_branch)}</td>
        <td>${trfEsc(r.sent_by || '-')} → ${trfEsc(r.received_by || '-')}</td><td>${r.lines.length} รายการ${r.fixed_from ? '<br><small>ต้นทางแก้แล้ว</small>' : ''}</td>
        <td>${diff(r) ? '<span class="badge badge-rejected">ไม่ตรง</span>' : '<span class="badge badge-approved">ตรงกัน</span>'}</td>
        <td class="nowrap"><button class="btn btn-primary btn-sm" onclick="audShowReceipt('${r.request_id}')"><i data-lucide="git-compare"></i> เทียบและตัดสิน</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div style="font-size:.85rem;color:var(--gray-400);padding:6px 0;">ไม่มีใบรับโอนรอตรวจ</div>'}</div>`;
  lucide.createIcons();
}
function audShowReceipt(requestId) {
  const r = audReceipts.find(x => x.request_id === requestId);
  if (!r) return;
  const mismatch = r.lines.some(l => Number(l.sent) !== Number(l.received ?? 0));
  const over = r.lines.some(l => Number(l.received ?? 0) > Number(l.sent));
  openModal(`<div class="modal" style="max-width:760px;width:95%;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="git-compare"></i>ตรวจรับโอน ${trfEsc(r.from_branch)} → ${trfEsc(r.to_branch)}</h3>
    <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <p style="margin:0 0 10px;font-size:.85rem;">วันที่โอน ${formatDate(r.log_date)} · ผู้ส่ง <b>${trfEsc(r.sent_by || '-')}</b> · ผู้รับ <b>${trfEsc(r.received_by || '-')}</b>${r.recount_count ? ` · นับใหม่แล้ว ${r.recount_count} ครั้ง` : ''}${r.note ? `<br>หมายเหตุผู้รับ: ${trfEsc(r.note)}` : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>รายการ</th><th class="num">ส่ง</th><th class="num">รับ</th><th class="num">ต่าง</th></tr></thead><tbody>
        ${r.lines.map(l => { const d = Math.round((Number(l.received ?? 0) - Number(l.sent)) * 1000) / 1000;
          return `<tr${d ? ' class="aud-diff-changed"' : ''}><td class="col-text">${trfEsc(l.product_name)} <small>${trfEsc(l.unit || '')}</small></td><td class="num">${trfQty(l.sent)}</td><td class="num">${trfQty(l.received)}</td><td class="num" style="font-weight:700;${d ? 'color:var(--red-600);' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${(r.images || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${r.images.map(src => `<img src="${src}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="Photos.isMarker(this.dataset.photo||'') ? Photos.open(this.dataset.photo) : window.open(this.src)" />`).join('')}</div>` : ''}
      ${mismatch ? `<div class="form-group" style="margin-top:12px;"><label class="form-label">เหตุผล / สิ่งที่ตรวจพบ <span class="required">*</span></label><textarea id="aud-rcv-note" class="form-input" rows="2"></textarea></div>` : ''}
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:6px;"><button class="btn btn-ghost" onclick="closeModalDirect()">ปิด</button>
      ${mismatch ? `<button class="btn btn-secondary" onclick="audDecideReceipt('${r.request_id}','recount')"><i data-lucide="rotate-ccw"></i> ให้ปลายทางนับใหม่</button>
        <button class="btn btn-warning" onclick="audDecideReceipt('${r.request_id}','origin_fix')"><i data-lucide="undo-2"></i> ส่งกลับให้ต้นทางแก้</button>
        ${over ? '' : `<button class="btn btn-danger" onclick="audDecideReceipt('${r.request_id}','loss')"><i data-lucide="package-x"></i> ของหายจริง (อนุมัติตามที่นับได้)</button>`}`
      : `<button class="btn btn-success" onclick="audDecideReceipt('${r.request_id}','approve')"><i data-lucide="check"></i> อนุมัติรับโอน</button>`}</div></div>`, { width: '780px' });
}
async function audDecideReceipt(requestId, decision) {
  const note = (document.getElementById('aud-rcv-note')?.value || '').trim();
  if (decision !== 'approve' && !note) { Toast.show('กรุณาระบุเหตุผล', 'error'); document.getElementById('aud-rcv-note')?.focus(); return; }
  try { await DB.decideTransferReceiptSupabase(requestId, decision, note); }
  catch (e) { Toast.show('ทำรายการไม่สำเร็จ: ' + trfErr(e), 'error', 6000); return; }
  closeModalDirect();
  Toast.show({ approve: 'อนุมัติรับโอนแล้ว ✓ เพิ่มสต็อกปลายทางแล้ว', loss: 'อนุมัติตามที่นับได้ + บันทึกของหายแล้ว', recount: 'ส่งกลับให้ปลายทางนับใหม่แล้ว', origin_fix: 'ส่งกลับให้ต้นทางแก้แล้ว' }[decision], 'success', 4000);
  audLoadReceipts();
  if (typeof audLoadApprovedStock === 'function') audLoadApprovedStock('transfer');
}
