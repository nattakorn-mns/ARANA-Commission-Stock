/**
 * ARANA Staff — บันทึกร่าง (คุณออม 28/10, SQL ไฟล์ 25)
 * OPD / มัดจำ-นัดหมาย / เบิกใช้ / โอนออก / รับเข้า / รับโอน: กด "บันทึกร่าง" เก็บข้อมูลบางส่วน + รูปไว้ก่อน แล้วกลับมาทำต่อ
 * ร่างยังไม่ใช่รายการจริง (ไม่ตัดสต๊อก ไม่เข้าห้องตรวจสอบ) · อยู่ได้ถึงเที่ยงคืนวันนั้น · แถวร่างไฮไลต์สีเหลืองทุกที่
 * ส่งรายการจริงสำเร็จ → ร่างที่เปิดอยู่ถูกลบให้อัตโนมัติ
 * ต่อเข้ากับหน้าฟอร์มเดิมโดยครอบฟังก์ชันวาดหน้า (แบบเดียวกับ opd-layout.js) — ไม่แก้ตรรกะการบันทึกเดิม
 */
const DRAFT_KINDS = {
  opd: { label: 'OPD', route: 'opd', icon: 'clipboard-plus' },
  deposit: { label: 'มัดจำ / นัดหมาย', route: 'deposit', icon: 'wallet-cards' },
  stock_out: { label: 'เบิกใช้', route: 'inventory-out', icon: 'package-minus' },
  stock_in: { label: 'รับเข้า', route: 'inventory-in', icon: 'package-plus' },
  stock_transfer: { label: 'โอนออก', route: 'inventory-transfer', icon: 'truck' },
  stock_receive: { label: 'รับโอน', route: 'inventory-receive', icon: 'package-check' }
};
const INV_DRAFT_KIND = { out: 'stock_out', in: 'stock_in', transfer: 'stock_transfer' };

const Drafts = {
  list: [],
  current: null,   // { id, kind } — ร่างที่เปิดทำต่ออยู่ (บันทึกร่างซ้ำ = อัปเดตใบเดิม, ส่งจริงสำเร็จ = ลบ)
  pending: null,   // { kind, payload } — รอเติมลงฟอร์มหลังวาดหน้าเสร็จ
  disabled: false, // ยังไม่ได้รัน SQL ไฟล์ 25
  _warnedAt: 0,

  esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  time(v) { try { return new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }); } catch (e) { return ''; } },
  missing(e) { return /save_staff_draft|list_my_drafts|Could not find the function|PGRST202/i.test((e && (e.message || e.code)) || ''); },

  async refresh() {
    if (this.disabled || typeof currentUser === 'undefined' || !currentUser) return;
    try { this.list = await DB.listMyDraftsSupabase(); }
    catch (e) { if (this.missing(e)) this.disabled = true; this.list = []; }
    this.paint();
  },

  // ปุ่มลอย "แบบร่างค้าง N" + การ์ดสีเหลืองในหน้าที่เปิดอยู่ + เตือนหลัง 22:00
  paint() {
    let pill = document.getElementById('draft-pill');
    if (!pill && document.body) {
      pill = document.createElement('button');
      pill.id = 'draft-pill'; pill.type = 'button'; pill.className = 'draft-pill';
      pill.onclick = () => Drafts.showAll();
      document.body.appendChild(pill);
    }
    if (pill) {
      pill.style.display = this.list.length ? '' : 'none';
      pill.innerHTML = `<i data-lucide="file-clock"></i> แบบร่างค้าง ${this.list.length}`;
      pill.classList.toggle('draft-pill-late', this.isLate());
    }
    document.querySelectorAll('[data-draft-card]').forEach(el => { el.outerHTML = this.cardHtml(el.dataset.draftCard); });
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (this.list.length && this.isLate() && Date.now() - this._warnedAt > 30 * 60e3) {
      this._warnedAt = Date.now();
      Toast.show(`มีแบบร่างค้าง ${this.list.length} ใบ — ร่างจะถูกลบตอนเที่ยงคืน กรุณาส่งให้เรียบร้อย`, 'warning', 8000);
    }
  },
  isLate() { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Bangkok' })); return h >= 22; },

  rowsHtml(rows, opts = {}) {
    return rows.map(d => `<tr class="draft-row">
      <td><span class="draft-tag">แบบร่าง</span> ${this.esc((DRAFT_KINDS[d.kind] || {}).label || d.kind)}</td>
      ${opts.staff ? `<td>${this.esc(d.staff || '-')}</td><td>${this.esc(d.branch || '-')}</td>` : ''}
      <td>${this.esc(d.title || '-')}${d.photo_count ? ` · รูป ${d.photo_count}` : ''}</td>
      <td class="nowrap">${this.time(d.updated_at)}</td>
      ${opts.staff ? '' : `<td class="nowrap"><button class="btn btn-primary btn-sm" onclick="Drafts.open('${d.id}')"><i data-lucide="pencil"></i> ทำต่อ</button>
        <button class="btn btn-ghost btn-sm" onclick="Drafts.askDelete('${d.id}')"><i data-lucide="trash-2"></i></button></td>`}
    </tr>`).join('');
  },
  // การ์ดร่างของหน้านั้น (kind = ชนิดเดียว หรือ 'all')
  cardHtml(kind) {
    const rows = this.list.filter(d => kind === 'all' || d.kind === kind);
    if (!rows.length) return `<div data-draft-card="${kind}"></div>`;
    return `<div data-draft-card="${kind}" class="glass-card draft-card">
      <div class="draft-card-head"><i data-lucide="file-clock"></i> แบบร่างที่ยังไม่ได้ส่ง ${rows.length} ใบ <span>— ส่งได้ถึง 23:59 วันนี้ เที่ยงคืนร่างจะถูกลบ</span></div>
      <div class="table-wrap" style="border:none;"><table><tbody>${this.rowsHtml(rows)}</tbody></table></div></div>`;
  },
  showAll() {
    openModal(`<div class="modal" style="max-width:640px;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="file-clock"></i>แบบร่างค้าง</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
      <div class="modal-body"><p style="margin:0 0 8px;font-size:.85rem;color:var(--gray-600);">ร่างยังไม่ใช่รายการจริง (ยังไม่ตัดสต๊อก บัญชียังไม่เห็น) — ส่งได้ถึง 23:59 วันนี้</p>
      <div class="table-wrap"><table><tbody>${this.rowsHtml(this.list) || '<tr><td>ไม่มีแบบร่างค้าง</td></tr>'}</tbody></table></div></div></div>`);
    lucide.createIcons();
  },

  async save(kind, title, payload) {
    if (this.disabled) { Toast.show('ยังเปิดใช้บันทึกร่างไม่ได้ (รอผู้ดูแลระบบอัปเดตฐานข้อมูล ไฟล์ 25)', 'warning', 5000); return false; }
    try {
      const id = this.current && this.current.kind === kind ? this.current.id : null;
      const r = await DB.saveStaffDraftSupabase({ p_id: id, p_kind: kind, p_branch_name: payload.branch || currentBranch, p_title: title, p_payload: payload });
      this.current = { id: r.id, kind };
      Toast.show('บันทึกร่างแล้ว ✓ กลับมาทำต่อได้ถึง 23:59 วันนี้ (ยังไม่ส่งให้บัญชี)', 'success', 5000);
      await this.refresh();
      return true;
    } catch (e) {
      if (this.missing(e)) { this.disabled = true; Toast.show('ยังเปิดใช้บันทึกร่างไม่ได้ (รอผู้ดูแลระบบอัปเดตฐานข้อมูล ไฟล์ 25)', 'warning', 5000); }
      else Toast.show('บันทึกร่างไม่สำเร็จ: ' + ((e && e.hint) || DB.stockErrorText(e)), 'error', 6000);
      return false;
    }
  },
  async open(id) {
    try {
      const d = await DB.getStaffDraftSupabase(id);
      if (document.getElementById('modal-overlay')?.classList.contains('modal-in')) closeModalDirect();
      this.current = { id: d.id, kind: d.kind };
      this.pending = { kind: d.kind, payload: d.payload || {} };
      navigate(DRAFT_KINDS[d.kind].route);
    } catch (e) { Toast.show((e && e.hint) || 'เปิดร่างไม่สำเร็จ', 'error', 5000); this.refresh(); }
  },
  take(kind) {
    if (!this.pending || this.pending.kind !== kind) return null;
    const p = this.pending.payload; this.pending = null; return p;
  },
  // หน้าฟอร์มเปิดใหม่ (ไม่ใช่จากร่าง) → ไม่ผูกกับร่างเดิม
  detach(kind) { if (this.current && this.current.kind === kind && !this.pending) this.current = null; },
  askDelete(id) { this._delId = id; confirmDialog('ลบแบบร่างนี้? รูปในร่างจะหายไปด้วย', () => Drafts.removeNow()); },
  async removeNow() {
    try { await DB.deleteStaffDraftSupabase(this._delId); } catch (e) { Toast.show('ลบไม่สำเร็จ', 'error'); }
    if (this.current && this.current.id === this._delId) this.current = null;
    this.refresh();
  },
  // ส่งรายการจริงสำเร็จ → ลบร่างที่เปิดอยู่
  async submitted(kinds) {
    if (!this.current || !kinds.includes(this.current.kind)) return;
    const id = this.current.id; this.current = null;
    try { await DB.deleteStaffDraftSupabase(id); } catch (e) { /* หมดอายุเองตอนเที่ยงคืน */ }
    this.refresh();
  },

  // รูปในร่าง: ย่อก่อนเก็บ (เหมือนตอนส่งจริง) — ไม่เข้า Storage/คลังรูป
  async packPhotos(list) {
    const out = [];
    for (const p of list || []) {
      const data = typeof p === 'string' ? p : p.data;
      out.push({ ...(typeof p === 'string' ? {} : p), data: typeof Photos !== 'undefined' ? await Photos.compress(data, Photos.FULL_SIDE, Photos.FULL_Q) : data });
    }
    return out;
  },
  fields(ids) {
    const o = {};
    ids.forEach(id => { const el = document.getElementById(id); if (el) o[id] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  },
  // ช่องที่ตัวเลือกยังโหลดไม่เสร็จ (เช่น บัญชีรับโอน) ลองใส่ซ้ำอีกสักพัก
  applyFields(map, tries = 6) {
    const left = {};
    Object.entries(map || {}).forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (!el) { left[id] = v; return; }
      if (el.type === 'checkbox') el.checked = !!v;
      else {
        el.value = v ?? '';
        if (el.tagName === 'SELECT' && v && el.value !== v) left[id] = v;
      }
    });
    if (typeof SelectSearch !== 'undefined') SelectSearch.scan();
    if (Object.keys(left).length && tries > 0) setTimeout(() => this.applyFields(left, tries - 1), 600);
  },
  button(onclick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost draft-btn';
    b.innerHTML = '<i data-lucide="file-clock"></i> บันทึกร่าง';
    b.setAttribute('onclick', onclick);
    return b;
  },
  addButton(submitBtn, onclick) {
    if (!submitBtn || submitBtn.parentElement.querySelector('.draft-btn')) return;
    submitBtn.before(this.button(onclick));
  },
  addCard(host, kind, where = 'prepend') {
    if (!host || host.querySelector(`[data-draft-card="${kind}"]`)) return;
    const t = document.createElement('div'); t.innerHTML = this.cardHtml(kind);
    host[where](t.firstElementChild);
  }
};

// ── เบิกใช้ / โอนออก / รับเข้า ─────────────────────────────
if (typeof renderInventory === 'function') {
  const draftOrigRenderInventory = renderInventory;
  renderInventory = async function (container, defaultTab) {
    const kind = INV_DRAFT_KIND[defaultTab || 'out'];
    Drafts.detach(kind);
    const d = Drafts.take(kind);
    await draftOrigRenderInventory(container, defaultTab);
    if (d) invDraftRestore(d);
  };
  const draftOrigInvRender = invRender;
  invRender = function () {
    draftOrigInvRender();
    const body = document.getElementById('inv-body');
    const submit = body && body.querySelector('button[onclick="invSubmit()"]');
    Drafts.addButton(submit, 'invSaveDraft()');
    Drafts.addCard(body, INV_DRAFT_KIND[invTab]);
    lucide.createIcons();
  };
}
async function invSaveDraft() {
  const rows = invTab === 'in' ? [] : invRows.filter(r => r.productCode);
  const n = invTab === 'in' ? invPoRows.filter(r => String(r.qty).trim() !== '').length + invOthers.filter(o => o.name).length : rows.length;
  if (!n && !invPhotos.length) { Toast.show('ใส่รายการหรือแนบรูปอย่างน้อย 1 อย่างก่อนบันทึกร่าง', 'error'); return; }
  const title = invTab === 'in'
    ? [invPoNo || 'ไม่มี PO', n ? `${n} รายการ` : ''].filter(Boolean).join(' · ')
    : [rows[0] && rows[0].productName, rows.length > 1 ? `+${rows.length - 1} รายการ` : '', invTab === 'transfer' ? 'ไป ' + (document.getElementById('inv-to-branch')?.value || '?') : ''].filter(Boolean).join(' ') || 'ยังไม่ได้เลือกสินค้า';
  await Drafts.save(INV_DRAFT_KIND[invTab], title, {
    branch: currentBranch, tab: invTab, fields: Drafts.fields(['inv-date', 'inv-to-branch', 'inv-source']),
    rows: invRows, poNo: invPoNo, poRows: invPoRows, others: invOthers, photos: await Drafts.packPhotos(invPhotos)
  });
}
function invDraftRestore(d) {
  invRows = Array.isArray(d.rows) && d.rows.length ? d.rows : invRows;
  invPhotos = d.photos || [];
  invPoNo = d.poNo || ''; invPoRows = d.poRows || []; invOthers = d.others || [];
  invRender();
  Drafts.applyFields(d.fields);
  invRenderPhotos();
  Toast.show('เปิดแบบร่างแล้ว — ตรวจให้ครบแล้วกดบันทึก', 'info', 4000);
}

// ── รับโอน ───────────────────────────────────────────────
if (typeof renderTransferReceive === 'function') {
  const draftOrigRenderTrf = renderTransferReceive;
  renderTransferReceive = async function (container) {
    Drafts.detach('stock_receive');
    const d = Drafts.take('stock_receive');
    await draftOrigRenderTrf(container);
    if (d && (trfIncoming || []).some(t => t.request_id === d.requestId)) {
      trfOpenCount(d.requestId);
      trfCounts = d.counts || {}; trfPhotos = d.photos || [];
      (trfOpen.items || []).forEach((i, n) => { const el = document.getElementById('trf-q-' + n); if (el && trfCounts[i.product_code] !== undefined) el.value = trfCounts[i.product_code]; });
      Drafts.applyFields(d.fields);
      trfRenderPhotos();
      Toast.show('เปิดแบบร่างแล้ว — ตรวจให้ครบแล้วกดบันทึก', 'info', 4000);
    } else if (d) Toast.show('ใบโอนในร่างนี้ไม่ได้รอรับแล้ว (อาจมีคนรับไปแล้ว)', 'warning', 5000);
  };
  const draftOrigTrfList = trfRenderList;
  trfRenderList = function () { draftOrigTrfList(); Drafts.addCard(document.getElementById('trf-body'), 'stock_receive'); lucide.createIcons(); };
  const draftOrigTrfOpen = trfOpenCount;
  trfOpenCount = function (requestId) {
    draftOrigTrfOpen(requestId);
    Drafts.addButton(document.getElementById('trf-save'), 'trfSaveDraft()');
    lucide.createIcons();
  };
}
async function trfSaveDraft() {
  if (!trfOpen) return;
  await Drafts.save('stock_receive', `จากสาขา${trfOpen.from_branch} · นับแล้ว ${Object.keys(trfCounts).length}/${trfOpen.items.length}`, {
    branch: currentBranch, requestId: trfOpen.request_id, counts: trfCounts, fields: Drafts.fields(['trf-note']), photos: await Drafts.packPhotos(trfPhotos)
  });
}

// ── มัดจำ / นัดหมาย ──────────────────────────────────────
const DEP_DRAFT_FIELDS = ['dep-date', 'dep-branch', 'dep-customer', 'dep-phone', 'dep-hn', 'dep-account-name', 'dep-channel', 'dep-program', 'dep-surgery',
  'dep-package-price', 'dep-amount', 'dep-payment-method', 'dep-appointment-date', 'dep-note'];
if (typeof renderDeposits === 'function') {
  const draftOrigRenderDeposits = renderDeposits;
  renderDeposits = async function (container) {
    Drafts.detach('deposit');
    const d = Drafts.take('deposit');
    await draftOrigRenderDeposits(container);
    const form = container.querySelector('.opd-form');
    Drafts.addButton(document.getElementById('dep-submit-btn'), 'depSaveDraft()');
    Drafts.addCard(form, 'deposit');
    lucide.createIcons();
    if (!d) return;
    if (d.kind === 'appt') { const r = document.querySelector('input[name="dep-kind"][value="appt"]'); if (r) r.checked = true; depSetKind('appt'); }
    const f = d.fields || {};
    if (f['dep-branch'] && document.getElementById('dep-branch')) {
      document.getElementById('dep-branch').value = f['dep-branch'];
      if (!depositProgramsCache.some(p => p.code === f['dep-program'])) await depBranchChanged(f['dep-branch']);
    }
    Drafts.applyFields(f);
    depositEvidence = d.photos || [];
    depRenderEvidence(); depUpdateCommission();
    Toast.show('เปิดแบบร่างแล้ว — ตรวจให้ครบแล้วกดส่ง', 'info', 4000);
  };
}
async function depSaveDraft() {
  const f = Drafts.fields(DEP_DRAFT_FIELDS);
  if (!String(f['dep-customer'] || '').trim() && !depositEvidence.length) { Toast.show('ใส่ชื่อลูกค้าหรือแนบสลิปอย่างน้อย 1 อย่างก่อนบันทึกร่าง', 'error'); return; }
  const amt = Number(f['dep-amount'] || 0);
  await Drafts.save('deposit', [depKind === 'appt' ? 'นัดหมาย' : 'มัดจำ', f['dep-customer'] || 'ยังไม่ใส่ชื่อ', amt ? formatCurrency(amt) + ' บาท' : ''].filter(Boolean).join(' · '), {
    branch: f['dep-branch'] || currentBranch, kind: depKind, fields: f, photos: await Drafts.packPhotos(depositEvidence)
  });
}

// ── OPD (เฉพาะบิลใหม่ — พ่วงบิล/แก้บิลเดิมบันทึกร่างไม่ได้) ─────────────
if (typeof renderOPD === 'function') {
  const draftOrigRenderOPD = renderOPD;
  renderOPD = async function (container) {
    Drafts.detach('opd');
    const d = window._editingOpdState ? null : Drafts.take('opd');
    if (d) window._editingOpdState = { billId: null, isShared: false, sharedBillId: null, sharedBillServices: [], linkedDepositId: null,
      photos: d.photos || [], services: d.services || [], sales: d.sales || [], supplies: d.supplies || [] };
    await draftOrigRenderOPD(container);
    if (!opdState.editMode) {
      Drafts.addButton(document.getElementById('opd-submit-btn'), 'opdSaveDraftNew()');
      Drafts.addCard(document.getElementById('opd-form'), 'opd');
    }
    if (d) {
      Drafts.applyFields(d.fields);
      ['opdRenderServices', 'opdRenderSales', 'opdRenderSupplies', 'opdRenderPhotos'].forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
      ['services', 'sales', 'supplies'].forEach(k => { if ((d[k] || []).length) document.getElementById(k + '-body')?.classList.remove('collapsed'); });
      Toast.show('เปิดแบบร่างแล้ว — ตรวจให้ครบแล้วกดบันทึก' + (d.hadDeposit ? ' (ถ้าเคยเชื่อมมัดจำ กรุณาเลือกมัดจำอีกครั้ง)' : ''), 'info', 5000);
    }
    lucide.createIcons();
  };
}
async function opdSaveDraftNew() {
  if (opdState.isShared) { Toast.show('พ่วง OPD ยังบันทึกร่างไม่ได้ — ใช้ได้กับบิลใหม่', 'warning'); return; }
  const f = Drafts.fields(['opd-date', 'opd-hn', 'opd-customer', 'opd-source']);
  const hasLines = opdState.services.some(s => s.programCode) || opdState.sales.some(s => s.newProgram) || opdState.supplies.some(s => s.productCode);
  if (!String(f['opd-hn'] || '').trim() && !String(f['opd-customer'] || '').trim() && !hasLines && !opdState.photos.length) {
    Toast.show('ใส่ HN/ชื่อลูกค้า รายการ หรือรูปอย่างน้อย 1 อย่างก่อนบันทึกร่าง', 'error'); return;
  }
  await Drafts.save('opd', [f['opd-hn'], f['opd-customer']].filter(x => String(x || '').trim()).join(' ') || 'ยังไม่ใส่ HN/ชื่อ', {
    branch: currentBranch, fields: f, services: opdState.services, sales: opdState.sales, supplies: opdState.supplies,
    hadDeposit: !!opdState.linkedDepositId, photos: await Drafts.packPhotos(opdState.photos)
  });
}

// ส่งรายการจริงสำเร็จ → ลบร่างที่เปิดอยู่ (ครอบตัวบันทึกเดิม ต่อจาก photos.js)
(function wrapDraftSubmits() {
  if (typeof DB === 'undefined') return;
  const after = (name, kinds) => {
    const orig = DB[name];
    if (typeof orig !== 'function') return;
    DB[name] = async function (...args) {
      const r = await orig.apply(this, args);
      Drafts.submitted(typeof kinds === 'function' ? kinds(...args) : kinds);
      return r;
    };
  };
  after('createOpdBillSupabase', ['opd']);
  after('createDepositSupabase', ['deposit']);
  after('createChatAppointmentSupabase', ['deposit']);
  after('saveStockRequestSupabase', req => [{ OUT: 'stock_out', IN: 'stock_in', TRANSFER: 'stock_transfer' }[req && req.moveType]]);
  after('receiveTransferSupabase', ['stock_receive']);
})();

// สรุปยอดของฉัน: ร่างทุกชนิดอยู่บนสุด (แถวสีเหลือง)
if (typeof renderHistory === 'function') {
  const draftOrigRenderHistory = renderHistory;
  renderHistory = function (container) {
    const out = draftOrigRenderHistory.apply(this, arguments);
    Promise.resolve(out).then(() => { Drafts.addCard(container, 'all'); lucide.createIcons(); });
    return out;
  };
}

// ห้องตรวจสอบ → แท็บ "แบบร่างค้าง": ใครมีร่างที่ยังไม่ส่งวันนี้ (แถวสีเหลือง, ไม่เห็นรูป)
async function draftsRenderAudit(body) {
  body.innerHTML = '<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  let rows;
  try { rows = await DB.listOpenDraftsSupabase(); }
  catch (e) {
    body.innerHTML = `<div class="glass-card" style="padding:18px;">${Drafts.missing(e) ? 'หน้านี้ต้องรัน SQL ไฟล์ 25 (บันทึกร่าง) ใน Supabase ก่อน' : Drafts.esc((e && e.hint) || DB.stockErrorText(e))}</div>`;
    return;
  }
  body.innerHTML = `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
    <span>แบบร่าง = รายการที่พนักงานเริ่มไว้แต่ยังไม่กดส่ง (ยังไม่ตัดสต๊อก ยังไม่เข้ารอตรวจ) · ร่างส่งได้ถึง 23:59 วันนี้ เที่ยงคืนลบอัตโนมัติ</span></div>
    <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap" style="border:none;border-radius:0;"><table>
      <thead><tr><th>ประเภท</th><th>พนักงาน</th><th>สาขา</th><th>รายละเอียด</th><th>แก้ล่าสุด</th></tr></thead>
      <tbody>${rows.length ? Drafts.rowsHtml(rows, { staff: true }) : '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:18px;">ไม่มีแบบร่างค้าง ✓</td></tr>'}</tbody></table></div></div>`;
  lucide.createIcons();
}

// โหลดรายการร่างหลังเข้าสู่ระบบ + ทุก 10 นาที (เตือนหลัง 22:00)
setTimeout(() => Drafts.refresh(), 2500);
setInterval(() => Drafts.refresh(), 10 * 60e3);
