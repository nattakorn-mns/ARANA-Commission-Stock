/**
 * ARANA Staff — เมนูตั้งค่า (ผู้ดูแลระบบ + บัญชี) — ข้อ 11, 12, 30 และปิดรอบค่าคอม (ข้อ 29)
 * ค่าที่ตั้งไว้โหลดครั้งเดียวตอนเข้าระบบ แล้วฟอร์ม OPD / มัดจำ อ่านจาก appSettings
 */

const APP_SETTINGS_DEFAULT = {
  commission_pcts: { frontdesk: [0, 0.5, 0.65, 0.75, 1, 1.3, 1.5, 2, 2.5, 3, 5], admin: [0, 0.5, 0.65, 0.75, 1, 1.3, 1.5, 2, 2.5, 3, 5], product_pct: 5, product_pcts: [5] },
  channels: ['หน้าร้าน', 'LINE', 'Facebook', 'Instagram', 'TikTok', 'Live สด', 'โทรศัพท์', 'อื่นๆ'],
  // ข้อ 32: กติกาค่าคอมปิดจากแชท
  chat_commission: { tiers: [{ max: 500, amount: 199 }, { max: 999.99, amount: 499 }, { max: null, amount: 1000 }], surgery_amount: 1999,
    admin_pct: 3, admin_live_pct: 1, admin_appt_pct: 1, store_deposit_pct: 1, store_rest_pct: 1, store_appt_pct: 0.5 },
  notify_admin_tag: ''
};
let appSettings = JSON.parse(JSON.stringify(APP_SETTINGS_DEFAULT));

async function loadAppSettings() {
  const s = await DB.getAppSettingsSupabase();
  appSettings = JSON.parse(JSON.stringify(APP_SETTINGS_DEFAULT));
  if (s && typeof s === 'object') {
    if (s.commission_pcts) appSettings.commission_pcts = { ...appSettings.commission_pcts, ...s.commission_pcts };
    if (!Array.isArray(appSettings.commission_pcts.product_pcts) || !appSettings.commission_pcts.product_pcts.length)
      appSettings.commission_pcts.product_pcts = [Number(appSettings.commission_pcts.product_pct) || 5];
    if (Array.isArray(s.channels) && s.channels.length) appSettings.channels = s.channels;
    if (s.chat_commission && typeof s.chat_commission === 'object') appSettings.chat_commission = { ...appSettings.chat_commission, ...s.chat_commission };
    if (typeof s.notify_admin_tag === 'string') appSettings.notify_admin_tag = s.notify_admin_tag;
  }
}

// ค่าคอมปิดจากแชท (เหมือนที่ฐานข้อมูลคิด — ฐานข้อมูลคิดซ้ำอีกครั้งตอนบันทึก)
function chatDepositTier(price, surgery) {
  const r = appSettings.chat_commission;
  if (surgery) return Number(r.surgery_amount) || 1999;
  if (!(Number(price) > 0)) return null;
  const tiers = [...(r.tiers || [])].sort((a, b) => (a.max == null ? 1e15 : a.max) - (b.max == null ? 1e15 : b.max));
  const t = tiers.find(x => x.max == null || Number(price) <= Number(x.max));
  return t ? Number(t.amount) : null;
}
function chatDepositCommission({ role, channel, price, amount, surgery }) {
  const r = appSettings.chat_commission;
  if (role === 'OnlineSales') {
    const pct = channel === 'Live สด' ? Number(r.admin_live_pct) : Number(r.admin_pct);
    const tier = chatDepositTier(price, surgery);
    const base = tier == null ? Number(amount) || 0 : Math.min(Number(amount) || 0, tier);
    return { pct, base, amt: roundCommission(base, pct), tier, closer: 'แอดมิน' };
  }
  const pct = Number(r.store_deposit_pct);
  return { pct, base: Number(amount) || 0, amt: roundCommission(Number(amount) || 0, pct), tier: null, closer: 'หน้าร้าน' };
}

// แอดมินออนไลน์ใช้ชุด % ของแอดมิน คนอื่นใช้ชุดหน้าร้าน
function commissionPctList(role) {
  const p = appSettings.commission_pcts || {};
  const list = (role || currentUser?.role) === 'OnlineSales' ? p.admin : p.frontdesk;
  return Array.isArray(list) && list.length ? list : APP_SETTINGS_DEFAULT.commission_pcts.frontdesk;
}
// ขายสินค้า: มีได้หลาย % (คุณออม 22/10) — ตัวแรกเป็นค่าเริ่มต้น
function productCommissionPcts() {
  const p = appSettings.commission_pcts || {};
  const list = Array.isArray(p.product_pcts) && p.product_pcts.length ? p.product_pcts : [Number.isFinite(Number(p.product_pct)) ? Number(p.product_pct) : 5];
  return list.map(Number).filter(v => Number.isFinite(v) && v >= 0);
}
function productCommissionPct() {
  const list = productCommissionPcts(), def = Number(appSettings.commission_pcts?.product_pct);
  return list.includes(def) ? def : (list[0] ?? 5);
}
function salesChannels() { return appSettings.channels || APP_SETTINGS_DEFAULT.channels; }

// ── หน้าตั้งค่า ─────────────────────────────────────────────
let setTab = 'pct';
let setDraft = null;
const setEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function renderSettings(container) {
  container.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
  await loadAppSettings();
  setDraft = JSON.parse(JSON.stringify(appSettings));
  const tabs = [['pct', 'percent', '% ค่าคอม'], ['channels', 'megaphone', 'ช่องทาง'], ['chat', 'message-circle', 'ค่าคอมปิดแชท + แจ้งเตือน'], ['accounts', 'landmark', 'บัญชีรับเงินโอน']];
  if (currentUser.role === 'Admin') tabs.push(['period', 'lock', 'ปิดรอบค่าคอม']);
  if (!tabs.some(t => t[0] === setTab)) setTab = 'pct';
  container.innerHTML = `
    <div class="tab-bar">
      ${tabs.map(([k, icon, label]) => `<button class="tab-btn ${setTab === k ? 'active' : ''}" id="set-tab-${k}" onclick="setSwitch('${k}')"><i data-lucide="${icon}"></i>${label}</button>`).join('')}
    </div>
    <div id="set-body"></div>`;
  setRender();
}

function setSwitch(tab) {
  setTab = tab;
  document.querySelectorAll('[id^="set-tab-"]').forEach(b => b.classList.toggle('active', b.id === 'set-tab-' + tab));
  setRender();
}

function setRender() {
  const body = document.getElementById('set-body');
  if (!body) return;
  if (setTab === 'pct') body.innerHTML = setPctHtml();
  else if (setTab === 'channels') body.innerHTML = setChannelsHtml();
  else if (setTab === 'chat') body.innerHTML = setChatHtml();
  else if (setTab === 'accounts') { body.innerHTML = '<div class="glass-card"><div id="set-accounts"><div class="loading-placeholder"><div class="spinner"></div></div></div></div>'; setLoadAccounts(); }
  else if (setTab === 'period') { body.innerHTML = '<div class="glass-card" id="set-period"><div class="loading-placeholder"><div class="spinner"></div></div></div>'; setLoadPeriod(); }
  lucide.createIcons();
}

// ── % ค่าคอม ──
function setChips(list, onRemove) {
  return `<div class="set-chips">${list.map((v, i) => `<span class="set-chip">${setEsc(v)}<button type="button" title="ลบ" onclick="${onRemove}(${i})">×</button></span>`).join('') || '<span style="color:var(--gray-400);font-size:.85rem;">ยังไม่มีรายการ</span>'}</div>`;
}
function setPctHtml() {
  const p = setDraft.commission_pcts;
  const group = (key, title, hint) => `
    <div class="glass-card" style="margin-bottom:14px;">
      <div class="section-title" style="margin-bottom:4px;">${title}</div>
      <p style="font-size:.8rem;color:var(--gray-500);margin:0 0 10px;">${hint}</p>
      ${setChips(p[key].map(x => x + '%'), `setPctRemove_${key}`)}
      <div class="set-add-row"><input type="number" class="form-input" id="set-pct-new-${key}" min="0" max="100" step="0.01" placeholder="เช่น 1.5" onkeydown="if(event.key==='Enter')setPctAdd('${key}')" />
        <button class="btn btn-ghost btn-sm" onclick="setPctAdd('${key}')"><i data-lucide="plus"></i> เพิ่ม</button></div>
    </div>`;
  return group('frontdesk', 'ตัวเลือก % ค่าคอม — พนักงานหน้าร้าน', 'ใช้ในฟอร์ม OPD (อัพเซล/ขายเพิ่ม) และฟอร์มมัดจำของพนักงานหน้าร้าน')
    + group('admin', 'ตัวเลือก % ค่าคอม — แอดมินออนไลน์', 'ใช้ในฟอร์มมัดจำของแอดมินออนไลน์')
    + group('product_pcts', 'ตัวเลือก % ค่าคอม — ขายสินค้า', 'ใช้กับรายการ "ขายสินค้า" ในฟอร์ม OPD — ถ้ามีตัวเลือกเดียว ระบบใส่ให้เอง พนักงานเปลี่ยนไม่ได้')
    + `<div class="set-save-row"><button class="btn btn-primary" id="set-save-btn" onclick="setSave('commission_pcts')"><i data-lucide="save"></i> บันทึก % ค่าคอม</button></div>`;
}
function setPctAdd(key) {
  const el = document.getElementById('set-pct-new-' + key);
  const v = Math.round(Number(el?.value) * 100) / 100;
  if (el?.value === '' || !Number.isFinite(v) || v < 0 || v > 100) { Toast.show('กรุณากรอกตัวเลข 0–100', 'error'); return; }
  const list = setDraft.commission_pcts[key];
  if (!list.includes(v)) list.push(v);
  list.sort((a, b) => a - b);
  setRender();
}
function setPctRemove_frontdesk(i) { setDraft.commission_pcts.frontdesk.splice(i, 1); setRender(); }
function setPctRemove_admin(i) { setDraft.commission_pcts.admin.splice(i, 1); setRender(); }
function setPctRemove_product_pcts(i) { setDraft.commission_pcts.product_pcts.splice(i, 1); setRender(); }

// ── ช่องทาง ──
function setChannelsHtml() {
  return `<div class="glass-card" style="margin-bottom:14px;">
      <div class="section-title" style="margin-bottom:4px;">ช่องทางที่ลูกค้าเข้ามา / ปิดยอด</div>
      <p style="font-size:.8rem;color:var(--gray-500);margin:0 0 10px;">ใช้ในฟอร์มมัดจำ (ช่องทางที่ปิดยอด) — ลบออกแล้ว ยอดเก่ายังแสดงชื่อช่องทางเดิม</p>
      ${setChips(setDraft.channels, 'setChannelRemove')}
      <div class="set-add-row"><input type="text" class="form-input" id="set-channel-new" maxlength="40" placeholder="เช่น Live สด" onkeydown="if(event.key==='Enter')setChannelAdd()" />
        <button class="btn btn-ghost btn-sm" onclick="setChannelAdd()"><i data-lucide="plus"></i> เพิ่ม</button></div>
    </div>
    <div class="set-save-row"><button class="btn btn-primary" id="set-save-btn" onclick="setSave('channels')"><i data-lucide="save"></i> บันทึกช่องทาง</button></div>`;
}
function setChannelAdd() {
  const v = (document.getElementById('set-channel-new')?.value || '').trim();
  if (!v) return;
  if (!setDraft.channels.includes(v)) setDraft.channels.push(v);
  setRender();
  document.getElementById('set-channel-new')?.focus();
}
function setChannelRemove(i) { setDraft.channels.splice(i, 1); setRender(); }

// ── ค่าคอมปิดจากแชท (ข้อ 32) + แท็กใน Telegram (ข้อ 29) ──
function setChatHtml() {
  const r = setDraft.chat_commission;
  const num = (key, label, suffix = '%') => `<div class="form-group"><label class="form-label">${label}</label>
      <div class="set-add-row"><input type="number" class="form-input" min="0" step="0.01" value="${Number(r[key])}" oninput="setDraft.chat_commission.${key}=Number(this.value)" /><span>${suffix}</span></div></div>`;
  return `<div class="glass-card" style="margin-bottom:14px;">
      <div class="section-title" style="margin-bottom:4px;">มัดจำตามกติกา (ตามราคาโปรแกรม)</div>
      <p style="font-size:.8rem;color:var(--gray-500);margin:0 0 10px;">ค่าคอมแอดมินคิดจาก "ยอดมัดจำตามกติกา" = น้อยกว่าระหว่างยอดที่โอนจริงกับยอดในตารางนี้</p>
      <div class="table-wrap"><table><thead><tr><th>ราคาโปรแกรมไม่เกิน (บาท)</th><th>มัดจำตามกติกา (บาท)</th><th></th></tr></thead><tbody>
        ${r.tiers.map((t, i) => `<tr>
          <td><input type="number" class="form-input" min="0" step="0.01" value="${t.max ?? ''}" placeholder="ขึ้นไป (ไม่จำกัด)" oninput="setDraft.chat_commission.tiers[${i}].max=this.value===''?null:Number(this.value)" /></td>
          <td><input type="number" class="form-input" min="0" step="1" value="${Number(t.amount)}" oninput="setDraft.chat_commission.tiers[${i}].amount=Number(this.value)" /></td>
          <td><button class="btn btn-ghost btn-sm" ${r.tiers.length > 1 ? '' : 'disabled'} onclick="setDraft.chat_commission.tiers.splice(${i},1);setRender()">ลบ</button></td></tr>`).join('')}
      </tbody></table></div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="setDraft.chat_commission.tiers.push({max:null,amount:0});setRender()"><i data-lucide="plus"></i> เพิ่มช่วงราคา</button>
      <div class="form-row" style="margin-top:12px;">${num('surgery_amount', 'ศัลยกรรม: มัดจำตามกติกา', 'บาท')}</div>
    </div>
    <div class="glass-card" style="margin-bottom:14px;">
      <div class="section-title" style="margin-bottom:8px;">% ค่าคอมปิดจากแชท</div>
      <div class="form-row">${num('admin_pct', 'แอดมินออนไลน์ — มัดจำปกติ')}${num('admin_live_pct', 'แอดมินออนไลน์ — มัดจำจาก Live สด')}</div>
      <div class="form-row">${num('admin_appt_pct', 'แอดมินออนไลน์ — นัดไม่วางมัดจำ (ของยอดที่จ่ายตอนมา)')}${num('store_deposit_pct', 'หน้าร้าน — ของยอดมัดจำ')}</div>
      <div class="form-row">${num('store_rest_pct', 'หน้าร้าน — ของยอดที่จ่ายตอนลูกค้ามา (มีมัดจำ)')}${num('store_appt_pct', 'หน้าร้าน — นัดไม่วางมัดจำ (ของยอดที่จ่ายตอนมา)')}</div>
      <div class="set-save-row"><button class="btn btn-primary" id="set-save-btn" onclick="setSave('chat_commission')"><i data-lucide="save"></i> บันทึกกติกา</button></div>
    </div>
    <div class="glass-card">
      <div class="section-title" style="margin-bottom:4px;">แท็กคุณออมใน Telegram</div>
      <p style="font-size:.8rem;color:var(--gray-500);margin:0 0 10px;">ใส่ชื่อผู้ใช้ Telegram (ขึ้นต้นด้วย @) — ข้อความ "[ขอแก้ไขรายการ]" จะแท็กชื่อนี้</p>
      <div class="set-add-row"><input type="text" class="form-input" id="set-tag" value="${setEsc(setDraft.notify_admin_tag || '')}" placeholder="@username" oninput="setDraft.notify_admin_tag=this.value.trim()" />
        <button class="btn btn-primary btn-sm" onclick="setSave('notify_admin_tag')">บันทึก</button></div>
    </div>`;
}

async function setSave(key) {
  const value = setDraft[key];
  if (key === 'channels' && !value.length) { Toast.show('ต้องมีช่องทางอย่างน้อย 1 รายการ', 'error'); return; }
  if (key === 'commission_pcts' && (!value.frontdesk.length || !value.admin.length || !value.product_pcts.length)) { Toast.show('แต่ละกลุ่มต้องมี % อย่างน้อย 1 ตัวเลือก', 'error'); return; }
  if (key === 'commission_pcts' && !value.product_pcts.includes(Number(value.product_pct))) value.product_pct = value.product_pcts[0];
  if (key === 'chat_commission' && value.tiers.some(t => !(Number(t.amount) > 0))) { Toast.show('มัดจำตามกติกาแต่ละช่วงต้องมากกว่า 0', 'error'); return; }
  if (key === 'notify_admin_tag' && value && !String(value).startsWith('@')) { Toast.show('ชื่อผู้ใช้ Telegram ต้องขึ้นต้นด้วย @', 'error'); return; }
  const btn = document.getElementById('set-save-btn');
  if (btn) btn.disabled = true;
  try {
    await DB.saveAppSettingSupabase(key, value);
    appSettings[key] = JSON.parse(JSON.stringify(value));
    Toast.show('บันทึกแล้ว ✓ ฟอร์มจะใช้ค่าใหม่ทันที', 'success');
  } catch (e) {
    Toast.show('บันทึกไม่สำเร็จ: ' + (/Could not find the function|PGRST202/.test(e.message || '') ? 'ยังไม่ได้ติดตั้งฐานข้อมูลรอบ 2 (SQL ไฟล์ 18)' : (e.hint || e.message || e)), 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── บัญชีรับเงินโอน (ใช้ตัวจัดการเดิมจาก deposit-layout.js) ──
async function setLoadAccounts() {
  await depLoadAccounts();
  const box = document.getElementById('set-accounts');
  if (!box) return;
  depManageAccounts();
}

// ── ปิดรอบค่าคอม 26–25 (ผู้ดูแลระบบ) ──
const setThaiDate = d => { if (!d) return '-'; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}/${Number(y) + 543}`; };
async function setLoadPeriod() {
  const box = document.getElementById('set-period');
  if (!box) return;
  let st;
  try { st = await DB.commissionPeriodStatusSupabase(); }
  catch (e) { box.innerHTML = `<p style="color:var(--gray-500);">ยังใช้ไม่ได้ — ต้องติดตั้งฐานข้อมูลรอบ 2 (SQL ไฟล์ 18) ก่อน</p>`; return; }
  const pending = Number(st.pending_edits) || 0;
  box.innerHTML = `
    <div class="section-title" style="margin-bottom:6px;">ปิดรอบค่าคอม (26 – 25)</div>
    <p style="font-size:.85rem;color:var(--gray-600);margin:0 0 12px;">ปิดรอบแล้ว พนักงานจะแก้ไขรายการในรอบนั้นไม่ได้อีก</p>
    <div class="set-period-grid">
      <div><small>ปิดรอบล่าสุดถึง</small><b>${st.closed_through ? setThaiDate(st.closed_through) : 'ยังไม่เคยปิด'}</b></div>
      <div><small>รอบถัดไป</small><b>${setThaiDate(st.next_period_start)} – ${setThaiDate(st.next_period_end)}</b></div>
      <div><small>คำขอแก้ไขที่ยังรออนุมัติในรอบนี้</small><b style="color:${pending ? 'var(--red-600)' : 'var(--green-600)'};">${pending} รายการ</b></div>
    </div>
    ${pending ? `<div class="alert-box alert-warning" style="margin-top:12px;"><i data-lucide="alert-triangle"></i><span>ยังมีคำขอแก้ไขรออนุมัติ ${pending} รายการ — อนุมัติ/ไม่อนุมัติให้ครบที่ Audit Room แท็บ "คำขอแก้ไขบิล" ก่อนปิดรอบ</span></div>` : ''}
    ${!st.next_period_ended ? `<p style="margin-top:12px;font-size:.85rem;color:var(--gray-500);">รอบนี้ยังไม่จบ — ปิดได้ตั้งแต่วันที่ 26</p>` : ''}
    <div class="set-save-row"><button class="btn btn-primary" ${pending || !st.next_period_ended ? 'disabled' : ''} onclick="setClosePeriod('${st.next_period_end}')">
      <i data-lucide="lock"></i> ปิดรอบ ${setThaiDate(st.next_period_start)} – ${setThaiDate(st.next_period_end)}</button></div>`;
  lucide.createIcons();
}
function setClosePeriod(end) {
  openModal(`<div class="modal" style="max-width:420px;"><div class="modal-header"><h3 class="modal-title">ยืนยันปิดรอบค่าคอม</h3></div>
    <div class="modal-body"><p style="margin:0;">ปิดรอบที่สิ้นสุด ${setThaiDate(end)} — หลังปิด พนักงานแก้ไขรายการในรอบนี้ไม่ได้อีก</p></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="closeModalDirect();setDoClosePeriod('${end}')">ปิดรอบ</button></div></div>`);
}
async function setDoClosePeriod(end) {
  try {
    await DB.closeCommissionPeriodSupabase(end);
    Toast.show('ปิดรอบค่าคอมแล้ว ✓', 'success');
  } catch (e) {
    Toast.show('ปิดรอบไม่สำเร็จ: ' + (e.hint || e.message || e), 'error', 6000);
  }
  setLoadPeriod();
}
