/**
 * ARANA Staff — ใบของฉัน + แก้ไข/ยกเลิก + ติดตามการแชร์ (คุณออม 29/10, SQL ไฟล์ 26)
 *  - สรุปยอดของฉัน → แท็บคลังสินค้า: ใบของฉัน → ⋯ ดู · แชร์อีกครั้ง · แก้ไข · ยกเลิก (แก้/ยกเลิกเฉพาะใบที่บัญชียังไม่ตรวจ)
 *    แก้ไข = เปิดใบเดิมในฟอร์ม (รายการ + รูปครบ) → บันทึกใบใหม่สำเร็จ ใบเดิมถูกยกเลิกให้อัตโนมัติ
 *  - สรุปยอดของฉัน: มัดจำที่บัญชียังไม่ยืนยัน → แก้ไข · ยกเลิก
 *  - ห้องตรวจสอบ → "การแชร์เข้ากลุ่ม": ใบไหนกดแชร์แล้ว / ใครยังไม่แชร์
 *  - OPD: ปุ่มเหตุผลสำเร็จรูปตอนแก้ฐานค่าคอม · เตือนเมื่อลูกค้ามีบิลวันนี้แล้ว (ลืมพ่วง)
 */
const MINE_KIND_ROUTE = { out: 'inventory-out', in: 'inventory-in', transfer: 'inventory-transfer', receive: 'inventory-receive' };
const MINE_WORD = { out: 'เบิกใช้', in: 'รับเข้า', transfer: 'โอนออก', receive: 'รับโอน' };
const mineEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mineMissing = e => /list_my_stock_requests|cancel_my|get_my_deposit|list_share_report|mark_stock_shared|Could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '');
let mineRows = [];
let mineKind = null;
let mineCancel = null;

// ---------- ใบของฉัน ----------
function mineShare(id) {
  const r = mineRows.find(x => x.request_id === id);
  if (!r) return;
  const items = r.kind === 'in' ? (r.lines || []).filter(l => Number(l.qty) > 0).length + (r.others || []).length : (r.lines || []).length;
  stockShareOffer({ kind: r.kind, count: items, date: r.log_date, branch: r.branch, toBranch: r.to_branch, fromBranch: r.from_branch, poNo: r.po_no,
    markers: r.images || [], requestId: id });
}

// แก้ไข = เปิดใบเดิมในฟอร์ม (แบบเดียวกับเปิดแบบร่าง) → บันทึกสำเร็จแล้วยกเลิกใบเดิม
function mineEdit(id) {
  const r = mineRows.find(x => x.request_id === id);
  if (!r) return;
  const uid = () => 'r_' + Date.now() + Math.random().toString(36).slice(2, 6);
  const payload = {
    branch: r.branch, tab: r.kind, fields: { 'inv-date': r.log_date, 'inv-to-branch': r.to_branch || '', 'inv-source': r.source || '' },
    rows: r.kind === 'in' ? [] : (r.lines || []).map(l => ({ id: uid(), productCode: l.product_code, productName: l.product_name, unit: l.unit, qty: Number(l.qty), note: l.note || '' })),
    poNo: r.kind === 'in' ? (r.po_no || '') : '',
    poRows: r.kind === 'in' ? (r.lines || []).map(l => ({ sku: l.product_code, name: l.product_name, unit: l.unit, expiry: !!l.expire_date, qty: String(l.qty), expireDate: l.expire_date || '', note: l.note === 'รับเข้าสต๊อก' ? '' : (l.note || '') })) : [],
    others: (r.others || []).map(o => ({ name: o.name, qty: String(o.qty), unit: o.unit || '', note: o.note || '' })),
    photos: (r.images || []).map((m, i) => ({ id: 'ip_' + i + Date.now(), name: 'รูปเดิม', data: m }))
  };
  const kind = INV_DRAFT_KIND[r.kind];
  Drafts.current = { id: null, kind, replaceRequest: id };
  Drafts.pending = { kind, payload };
  navigate(MINE_KIND_ROUTE[r.kind]);
  setTimeout(() => Toast.show('เปิดใบเดิมมาแก้แล้ว — แก้แล้วกดบันทึก ใบเดิมจะถูกยกเลิกให้อัตโนมัติ', 'info', 6000), 600);
}

// ---------- ยกเลิก (เลือกเหตุผล) ----------
function mineAskCancel(type, id) {
  mineCancel = { type, id };
  const reasons = type === 'deposit' ? ['ส่งซ้ำ', 'ใส่ข้อมูลผิด', 'ลูกค้ายกเลิก'] : ['บันทึกซ้ำ', 'ใส่ผิด', 'ไม่ได้ใช้/ไม่ได้รับจริง'];
  openModal(`<div class="modal" style="max-width:440px;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="x-circle"></i>ยกเลิก${type === 'deposit' ? 'มัดจำ' : 'ใบนี้'}</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body"><p style="margin:0 0 8px;">เลือกเหตุผล (บัญชีเห็นในประวัติ)</p>
      <div class="ntf-chips" style="margin-bottom:10px;">${reasons.map(x => `<button type="button" class="ntf-chip" onclick="document.getElementById('mine-reason').value='${x}'">${x}</button>`).join('')}</div>
      <input class="form-input" id="mine-reason" placeholder="หรือพิมพ์เหตุผลเอง"></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ไม่ยกเลิก</button>
      <button class="btn btn-danger" onclick="mineDoCancel()">ยืนยันยกเลิก</button></div></div>`);
  lucide.createIcons();
}
async function mineDoCancel() {
  const reason = (document.getElementById('mine-reason')?.value || '').trim();
  if (!reason) { Toast.show('กรุณาเลือกหรือพิมพ์เหตุผล', 'error'); return; }
  const c = mineCancel;
  try {
    if (c.type === 'deposit') await DB.cancelMyDepositSupabase(c.id, reason);
    else await DB.cancelMyStockRequestSupabase(c.id, reason);
    closeModalDirect();
    Toast.show('ยกเลิกแล้ว ✓', 'success');
    if (c.type === 'deposit') { summaryDeposits = await DB.getMyDepositsSupabase(); sumRender(); }
    else mineSumStockRender();
  } catch (e) { Toast.show('ยกเลิกไม่สำเร็จ: ' + ((e && e.hint) || DB.stockErrorText(e)), 'error', 6000); }
}

// ---------- ต่อเข้ากับหน้าเดิม ----------
// ส่งใบใหม่สำเร็จ → ยกเลิกใบเดิมที่เปิดมาแก้ / มัดจำเดิม
if (typeof Drafts !== 'undefined') {
  const mineOrigSubmitted = Drafts.submitted.bind(Drafts);
  Drafts.submitted = async function (kinds) {
    const cur = this.current;
    if (cur && kinds.includes(cur.kind) && (cur.replaceRequest || cur.replaceDeposit)) {
      this.current = null;
      try {
        if (cur.replaceRequest) await DB.cancelMyStockRequestSupabase(cur.replaceRequest, 'แก้ไขแล้วส่งใหม่');
        else await DB.cancelMyDepositSupabase(cur.replaceDeposit, 'แก้ไขแล้วส่งใหม่');
      } catch (e) { Toast.show('ส่งใบใหม่แล้ว แต่ยกเลิกใบเดิมไม่สำเร็จ — กรุณากดยกเลิกใบเดิมเอง', 'warning', 8000); }
      if (cur.id) { try { await DB.deleteStaffDraftSupabase(cur.id); } catch (e) { /* หมดอายุเองเที่ยงคืน */ } }
      this.refresh();
      return;
    }
    return mineOrigSubmitted(kinds);
  };
}

// ---------- มัดจำในสรุปยอดของฉัน: แก้ไข / ยกเลิก ----------
function mineDepositActions(id) {
  const d = (summaryDeposits || []).find(x => x.id === id);
  if (!d || d.payment_status !== 'รอตรวจสอบ' || d.linked_bill_id || d.commission_status === 'ยกเลิก') return '';
  return rowMenu([['pencil', 'ขอแก้ไข', `mineEditDeposit('${id}')`], ['x-circle', 'ยกเลิก', `mineAskCancel('deposit','${id}')`, 'danger']]);
}

// เมนู ⋯ ท้ายแถว (คุณออม 29/10): กดแล้วเลือก ดู / แชร์ / แก้ไข / ยกเลิก — ตารางไม่รก
const ROW_MENUS = [];
function rowMenu(items) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  ROW_MENUS.push(list);
  return `<button type="button" class="row-menu-btn" title="จัดการ" aria-label="จัดการ" onclick="rowMenuOpen(event, ${ROW_MENUS.length - 1})">⋯</button>`;
}
function rowMenuClose() { document.getElementById('row-menu-pop')?.remove(); }
function rowMenuOpen(e, i) {
  e.stopPropagation();
  rowMenuClose();
  const pop = document.createElement('div');
  pop.id = 'row-menu-pop'; pop.className = 'row-menu-pop';
  pop.innerHTML = ROW_MENUS[i].map(([icon, label, act, cls]) => `<button type="button" class="${cls === 'danger' ? 'danger' : ''}" onclick="rowMenuClose();${act}"><i data-lucide="${icon}"></i> ${label}</button>`).join('');
  document.body.appendChild(pop);
  const r = e.currentTarget.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  pop.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  lucide.createIcons();
}
document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('#row-menu-pop')) rowMenuClose(); });
window.addEventListener('scroll', rowMenuClose, true);
async function mineEditDeposit(id) {
  let d;
  try { d = await DB.getMyDepositSupabase(id); } catch (e) { Toast.show('เปิดมัดจำไม่สำเร็จ: ' + ((e && e.hint) || DB.stockErrorText(e)), 'error'); return; }
  Drafts.current = { id: null, kind: 'deposit', replaceDeposit: id };
  Drafts.pending = { kind: 'deposit', payload: {
    branch: d.branch_name, kind: 'deposit', programName: d.program_name,
    fields: { 'dep-date': d.deposit_date, 'dep-branch': d.branch_name, 'dep-customer': d.customer_name, 'dep-phone': d.customer_phone || '', 'dep-hn': d.hn || '',
      'dep-channel': d.channel || '', 'dep-surgery': !!d.is_surgery, 'dep-package-price': d.package_price || '', 'dep-amount': d.deposit_amount || '',
      'dep-payment-method': d.payment_method || '', 'dep-appointment-date': d.appointment_date || '', 'dep-note': d.note || '' },
    photos: (d.images || []).map((p, i) => ({ id: 'dep_' + i + Date.now(), name: p.name || 'รูปเดิม', data: p.data }))
  } };
  navigate('deposit');
  // โปรแกรมเก็บเป็นชื่อ → เลือกตัวเลือกที่ชื่อตรงกัน
  setTimeout(() => {
    const sel = document.getElementById('dep-program');
    if (sel && !sel.value && d.program_name) {
      const o = [...sel.options].find(x => x.text.trim() === String(d.program_name).trim());
      if (o) { sel.value = o.value; if (typeof SelectSearch !== 'undefined') SelectSearch.scan(); }
    }
    Toast.show('เปิดมัดจำเดิมมาแก้แล้ว — แก้แล้วกดส่ง มัดจำเดิมจะถูกยกเลิกให้อัตโนมัติ', 'info', 6000);
  }, 2500);
}

// ---------- ห้องตรวจสอบ: การแชร์เข้ากลุ่ม ----------
async function mineRenderShareReport(body, from, to, branch) {
  from = from || todayISO(); to = to || from;
  body.innerHTML = `<div class="glass-card" style="padding:14px 16px;margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span style="font-weight:700;">วันที่</span><input type="date" class="filter-input" id="shr-from" value="${from}"> ถึง <input type="date" class="filter-input" id="shr-to" value="${to}">
      <select class="filter-select" id="shr-branch"><option value="">ทุกสาขา</option>${['พิษณุโลก', 'กำแพงเพชร', 'แม่สอด', 'นครสวรรค์'].map(b => `<option${b === branch ? ' selected' : ''}>${b}</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm" onclick="mineRenderShareReport(document.getElementById('aud-body'), document.getElementById('shr-from').value, document.getElementById('shr-to').value, document.getElementById('shr-branch').value)"><i data-lucide="search"></i> ดู</button></div>
    <div id="shr-body"><div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div></div>`;
  lucide.createIcons();
  const el = document.getElementById('shr-body');
  let rows;
  try { rows = await DB.listShareReportSupabase(from, to, branch || null); }
  catch (e) { el.innerHTML = `<div class="glass-card" style="padding:18px;">${mineMissing(e) ? 'หน้านี้ต้องรัน SQL ไฟล์ 26 ใน Supabase ก่อน' : mineEsc((e && e.hint) || DB.stockErrorText(e))}</div>`; return; }
  const by = {};
  rows.forEach(r => { const k = r.staff || '-'; by[k] = by[k] || { branch: r.branch, total: 0, shared: 0 }; by[k].total++; if (r.times) by[k].shared++; });
  const people = Object.entries(by).sort((a, b) => (b[1].total - b[1].shared) - (a[1].total - a[1].shared));
  el.innerHTML = `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
      <span>นับจากการกดปุ่ม "แชร์เข้า LINE" หรือ "คัดลอก" หลังบันทึก — ระบบรู้ว่าน้องกดแชร์แล้ว แต่ส่งเข้ากลุ่มจริงหรือไม่ ให้ดูในกลุ่ม LINE · ใบที่น้องยกเลิกเองไม่นับ</span></div>
    <div class="glass-card" style="padding:0;overflow:hidden;margin-bottom:14px;"><div class="table-wrap" style="border:none;border-radius:0;"><table>
      <thead><tr><th>พนักงาน</th><th>สาขา</th><th class="num">ใบทั้งหมด</th><th class="num">แชร์แล้ว</th><th class="num">ยังไม่แชร์</th></tr></thead>
      <tbody>${people.length ? people.map(([n, p]) => `<tr class="${p.total > p.shared ? 'mine-row-miss' : ''}"><td><b>${mineEsc(n)}</b></td><td>${mineEsc(p.branch)}</td><td class="num">${p.total}</td><td class="num">${p.shared}</td><td class="num"><b>${p.total - p.shared || ''}</b></td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:18px;">ไม่มีรายการในช่วงนี้</td></tr>'}</tbody></table></div></div>
    ${rows.length ? `<div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap" style="border:none;border-radius:0;"><table>
      <thead><tr><th>วันที่</th><th>สาขา</th><th>ประเภท</th><th>พนักงาน</th><th class="num">รายการ</th><th>สถานะ</th><th>แชร์เข้ากลุ่ม</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.times ? '' : 'mine-row-miss'}"><td class="nowrap">${formatDate(r.log_date)}</td><td>${mineEsc(r.branch)}</td>
        <td>${MINE_WORD[r.kind] || r.kind}${r.other_branch ? (r.kind === 'receive' ? ' จาก' : ' → ') + mineEsc(r.other_branch) : ''}</td><td>${mineEsc(r.staff || '-')}</td>
        <td class="num">${r.items}</td><td>${mineEsc(r.status || '-')}</td>
        <td>${r.times ? `<span class="mine-shared">✓ ${formatDateTime(r.shared_at)}${r.times > 1 ? ` (${r.times} ครั้ง)` : ''}</span>` : '<span class="mine-unshared">ยังไม่แชร์</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  lucide.createIcons();
}

// ---------- OPD: ปุ่มเหตุผลสำเร็จรูปตอนแก้ฐานค่าคอม ----------
const OPD_BASE_REASONS = ['แบ่งยอดกับเพื่อน 50%', 'เปลี่ยนในห้องหมอ', 'ยุบ/รวมโปรจอง', 'เปลี่ยนคอร์สหลังทำไปแล้ว'];
if (typeof opdBuildSaleCard === 'function') {
  const mineOrigSaleCard = opdBuildSaleCard;
  opdBuildSaleCard = function (s) {
    let html = mineOrigSaleCard(s);
    if (!s.commissionBaseManual) return html;
    const chips = `<div class="ntf-chips opd-reason-chips">${OPD_BASE_REASONS.map(r => `<button type="button" class="ntf-chip" onclick="opdPickBaseReason('${s.id}','${r}')">${r}</button>`).join('')}</div>`;
    const anchor = `id="sale-note-${s.id}"`;
    const at = html.indexOf(anchor);
    if (at < 0) return html;
    const end = html.indexOf('/>', at) + 2;
    return html.slice(0, end) + chips + html.slice(end);
  };
}
function opdPickBaseReason(id, reason) {
  const el = document.getElementById('sale-note-' + id);
  if (!el) return;
  const text = reason === 'แบ่งยอดกับเพื่อน 50%' ? 'แบ่งยอดกับเพื่อน 50% กับ ' : reason;
  el.value = el.value && !el.value.includes(reason) ? el.value + ' · ' + text : text;
  opdSaleTextInput(id, 'commissionNote', el.value);
  el.focus(); el.setSelectionRange(el.value.length, el.value.length);
}

// ---------- OPD: เตือนเมื่อลูกค้ามีบิลวันนี้แล้ว (ลืมพ่วง) ----------
if (typeof opdApplyHn === 'function') {
  const mineOrigApplyHn = opdApplyHn;
  opdApplyHn = function (x, chosen) {
    mineOrigApplyHn(x, chosen);
    if (x && x.hn) mineCheckSameDayBill(x.hn);
  };
}
async function mineCheckSameDayBill(hn) {
  if (opdState.isShared || opdState.editMode) return;
  const date = document.getElementById('opd-date')?.value || todayISO();
  let bills = [];
  try { bills = await DB.searchOpenOpdBillsSupabase(hn, currentBranch); } catch (e) { return; }
  const same = (bills || []).filter(b => String(b.hn || '').toUpperCase() === String(hn).toUpperCase() && String(b.date || '').slice(0, 10) === date);
  document.getElementById('opd-sameday-warn')?.remove();
  if (!same.length || document.getElementById('opd-hn')?.value.trim() !== hn) return;
  const b = same[0];
  const box = document.createElement('div');
  box.id = 'opd-sameday-warn'; box.className = 'alert-box alert-warning'; box.style.marginTop = '8px';
  box.innerHTML = `<i data-lucide="alert-triangle"></i><span style="flex:1;">ลูกค้าคนนี้มีบิลวันนี้แล้ว${b.createdByName ? ` (โดย ${mineEsc(b.createdByName)})` : ''} — ถ้ามาครั้งเดียวกัน ควร <b>พ่วงบิลเดิม</b></span>
    <button type="button" class="btn btn-primary btn-sm" onclick="mineJoinBill('${b.id}')">พ่วงบิลเดิม</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('opd-sameday-warn').remove()">สร้างบิลใหม่</button>`;
  document.getElementById('opd-hn-hint')?.after(box);
  lucide.createIcons();
}
async function mineJoinBill(id) {
  const r = document.querySelector('input[name="bill-mode"][value="shared"]');
  if (r) r.checked = true;
  opdSetMode('shared');
  await opdSelectSharedBill(id);
  document.getElementById('opd-sameday-warn')?.remove();
  Toast.show('พ่วงกับบิลเดิมแล้ว ✓', 'success');
}

// ---------- สรุปยอดของฉัน: แท็บ "ค่ามือ / ค่าคอม" กับ "คลังสินค้า" (คุณออม 29/10) ----------
let mineSumTab = 'comm';
let mineSumRows = [];
if (typeof renderHistory === 'function') {
  const mineOrigRenderHistory = renderHistory;
  renderHistory = function (container) {
    const out = mineOrigRenderHistory.apply(this, arguments);
    const page = container.querySelector('.summary-preview');
    const welcome = page && page.querySelector('.summary-welcome');
    if (welcome && !page.querySelector('.sum-main-tabs')) {
      welcome.insertAdjacentHTML('afterend', `<div class="sum-main-tabs">
          <button data-tab="comm" onclick="mineSumSwitch('comm')"><i data-lucide="badge-dollar-sign"></i> ค่ามือ / ค่าคอม</button>
          <button data-tab="stock" onclick="mineSumSwitch('stock')"><i data-lucide="package"></i> คลังสินค้า</button></div>`);
      page.insertAdjacentHTML('beforeend', '<div id="sum-stock" class="sum-stock"></div>');
      page.querySelector('.sum-main-tabs').insertAdjacentHTML('afterend', '<div id="sum-confirm" class="sum-confirm"></div>');
      mineConfirmBar();
      mineSumSwitch(mineSumTab);
    }
    return out;
  };
}
function mineSumSwitch(tab) {
  mineSumTab = tab;
  const page = document.querySelector('.summary-preview');
  if (!page) return;
  page.classList.toggle('show-stock', tab === 'stock');
  page.querySelectorAll('.sum-main-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'stock') mineSumStockRender();
  lucide.createIcons();
}
async function mineSumStockRender() {
  const el = document.getElementById('sum-stock');
  if (!el || mineSumTab !== 'stock') return;
  const days = { today: 1, week: 7, month: 31, year: 31, all: 31 }[summaryLayoutPeriod] || 7;
  el.innerHTML = '<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  let rows = [];
  try {
    const lists = await Promise.all(['out', 'in', 'transfer', 'receive'].map(k => DB.listMyStockRequestsSupabase(k, days)));
    rows = lists.flat();
  } catch (e) {
    el.innerHTML = `<div class="glass-card" style="padding:18px;">${mineMissing(e) ? 'แท็บนี้ต้องรัน SQL ไฟล์ 26 ใน Supabase ก่อน' : mineEsc((e && e.hint) || DB.stockErrorText(e))}</div>`;
    return;
  }
  const today = todayISO();
  if (summaryLayoutPeriod === 'today') rows = rows.filter(r => r.log_date === today);
  if (summaryLayoutBranch) rows = rows.filter(r => r.branch === summaryLayoutBranch);
  rows.sort((a, b) => String(b.at || b.log_date).localeCompare(String(a.at || a.log_date)));
  mineSumRows = rows; mineRows = rows; mineKind = null;
  const live = rows.filter(r => !r.cancelled);
  const count = k => live.filter(r => r.kind === k).length;
  const unshared = live.filter(r => !r.shared).length;
  el.innerHTML = `<div class="sum-stock-kpis">
      ${['out', 'in', 'transfer', 'receive'].map(k => `<div class="sum-stock-kpi kind-${k}"><span>${MINE_WORD[k]}</span><strong>${count(k)}</strong><small>ใบ</small></div>`).join('')}
      <div class="sum-stock-kpi ${unshared ? 'kpi-miss' : 'kpi-ok'}"><span>ยังไม่แชร์เข้ากลุ่ม</span><strong>${unshared}</strong><small>ใบ</small></div></div>
    ${rows.length ? `<div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap" style="border:none;border-radius:0;"><table class="sum-stock-table">
      <thead><tr><th>วันที่</th><th>ประเภท</th><th>รายการ</th><th>สาขา</th><th>สถานะ</th><th title="แชร์เข้ากลุ่ม LINE">แชร์</th><th>จัดการ</th></tr></thead>
      <tbody>${rows.map(r => {
        const items = (r.lines || []).filter(l => Number(l.qty) > 0);
        const names = items.slice(0, 2).map(l => `${mineEsc(l.product_name)} <b>${Number(l.qty)}</b>`).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '') + ((r.others || []).length ? ` · อื่นๆ ${r.others.length}` : '');
        return `<tr class="${r.cancelled ? 'mine-cancelled' : ''}">
          <td class="nowrap" data-label="วันที่">${formatDate(r.log_date)}</td>
          <td data-label="ประเภท"><span class="mine-kind kind-${r.kind}">${MINE_WORD[r.kind]}</span></td>
          <td data-label="รายการ">${names || '-'}${r.po_no ? ` <small>(${mineEsc(r.po_no)})</small>` : ''}</td>
          <td data-label="สาขา">${mineEsc(r.branch || '')}${r.to_branch ? ' → ' + mineEsc(r.to_branch) : ''}${r.from_branch ? ' ← ' + mineEsc(r.from_branch) : ''}</td>
          <td data-label="สถานะ"><span class="badge ${r.cancelled ? '' : r.status === 'อนุมัติแล้ว' || r.status === 'รับครบ' ? 'badge-approved' : r.status === 'ตีกลับ' ? 'badge-rejected' : 'badge-waiting'}">${mineEsc(r.status || '-')}</span></td>
          <td data-label="แชร์" class="sum-share-cell">${r.cancelled ? '' : r.shared ? '<span class="share-yes" title="แชร์แล้ว">✓</span>' : '<span class="share-no" title="ยังไม่แชร์">✗</span>'}</td>
          <td data-label="จัดการ">${rowMenu([
            ['eye', 'ดูรายการและรูป', `mineView('${r.request_id}','${r.kind}')`],
            !r.cancelled && ['send', 'แชร์เข้ากลุ่มอีกครั้ง', `mineShare('${r.request_id}')`],
            r.editable && ['pencil', 'ขอแก้ไข', `mineEdit('${r.request_id}')`],
            r.editable && ['x-circle', 'ยกเลิก', `mineAskCancel('stock','${r.request_id}')`, 'danger']])}</td></tr>`;
      }).join('')}</tbody></table></div></div>`
    : '<div class="empty-state"><i data-lucide="inbox"></i><h4>ยังไม่มีรายการคลังสินค้าในช่วงนี้</h4><p>แสดงย้อนหลังได้สูงสุด 31 วัน</p></div>'}`;
  lucide.createIcons();
}
function mineView(id, kind) {
  const r = (mineRows || []).find(x => x.request_id === id && x.kind === kind);
  if (!r) return;
  openModal(`<div class="modal" style="max-width:560px;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="package"></i>${MINE_WORD[r.kind]} ${formatDate(r.log_date)}</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body"><div class="table-wrap"><table><thead><tr><th>สินค้า</th><th class="num">จำนวน</th><th>หน่วย</th></tr></thead>
      <tbody>${(r.lines || []).map(l => `<tr><td>${mineEsc(l.product_name)}</td><td class="num">${Number(l.qty)}</td><td>${mineEsc(l.unit || '')}</td></tr>`).join('')}
      ${(r.others || []).map(o => `<tr><td>${mineEsc(o.name)} <small>(อื่นๆ)</small></td><td class="num">${Number(o.qty)}</td><td>${mineEsc(o.unit || '')}</td></tr>`).join('')}</tbody></table></div>
      <div class="photo-thumbnails" style="margin-top:10px;">${(r.images || []).map(m => `<img data-photo="${mineEsc(m)}" data-photo-thumb="1" class="photo-thumb" style="width:90px;height:90px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="Photos.open('${mineEsc(m)}')">`).join('')}</div></div></div>`);
  lucide.createIcons();
}

// ---------- ยืนยันยอด ส่งสรุปรายวัน (SQL ไฟล์ 27) ----------
async function mineConfirmBar() {
  const el = document.getElementById('sum-confirm');
  if (!el) return;
  let st = [];
  try { st = await DB.myDailyConfirmSupabase(); } catch (e) { if (mineMissing(e) || /my_daily_confirm/.test(e.message || '')) { el.remove(); return; } }
  const waiting = st.some(x => x.status === 'รออนุมัติแก้ไข'), sent = st.length > 0, changed = st.some(x => x.changed);
  const time = sent ? new Date(st.map(x => x.at).sort().at(-1)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '';
  el.innerHTML = `<div class="sum-confirm-text">${waiting ? '⏳ ขอแก้ไขสรุปรายวันแล้ว — รอผู้ตรวจอนุมัติ ระบบจะส่งยอดใหม่ให้เอง'
      : sent ? (changed ? `⚠️ ส่งสรุปไปแล้วเมื่อ ${time} แต่ยอดเปลี่ยน — กดยืนยันอีกครั้งเพื่อส่งฉบับแก้ไข` : `✓ ยืนยันยอดวันนี้แล้ว (${time})`)
      : 'เลิกงานแล้ว ตรวจยอดวันนี้ให้ครบ แล้วกดยืนยัน — ระบบส่งสรุปเข้ากลุ่มให้'}</div>
    <button class="btn ${sent && !changed ? 'btn-ghost' : 'btn-primary'}" onclick="mineConfirmAsk()"${waiting ? ' disabled' : ''}><i data-lucide="send-horizontal"></i> ยืนยันยอด ส่งสรุปรายวัน</button>`;
  el.classList.toggle('done', sent && !changed && !waiting);
  lucide.createIcons();
}
function mineConfirmAsk() {
  confirmDialog('ยืนยันยอดค่ามือ/ค่าคอมของวันนี้ แล้วส่งสรุปเข้ากลุ่ม?<br><small>ถ้าแก้รายการทีหลัง กดยืนยันอีกครั้งได้ — ถ้ามีคำขอแก้ไขรออนุมัติ กลุ่มจะเห็นแค่ "ขอแก้ไข" จนกว่าจะอนุมัติ</small>', () => mineConfirmSend());
}
async function mineConfirmSend() {
  try {
    const res = await DB.confirmDailySummarySupabase();
    const word = { sent: 'ส่งสรุปเข้ากลุ่มแล้ว ✓', resent: 'ส่งสรุปฉบับแก้ไขแล้ว ✓', unchanged: 'ยอดไม่เปลี่ยน — ไม่ได้ส่งซ้ำ', requested: 'ส่ง "ขอแก้ไขสรุปรายวัน" แล้ว — รออนุมัติ', waiting: 'ยังรออนุมัติการแก้ไขอยู่' };
    Toast.show(res.map(r => (res.length > 1 ? r.branch + ': ' : '') + (word[r.result] || r.result)).join(' · '), 'success', 6000);
  } catch (e) { Toast.show((e && e.hint) || ('ส่งไม่สำเร็จ: ' + DB.stockErrorText(e)), 'error', 6000); }
  mineConfirmBar();
}
