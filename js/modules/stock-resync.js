/**
 * ARANA Staff — ตั้งยอดสต๊อกตาม ERP ใหม่ รายสาขา (คุณออม 28/10, SQL ไฟล์ 24)
 * อยู่ในห้องตรวจสอบ → แท็บ "ตั้งยอดตาม ERP" (บัญชี / บัญชีสต๊อก / ผู้ดูแลระบบ กดเองได้)
 */
// ยอดใหม่ = ยอด ERP ล่าสุด + รายการในเว็บพนักงานที่ยังไม่อยู่ใน ERP · ดูก่อน แล้วค่อยยืนยัน
let rsyBranch = 'นครสวรรค์';
let rsyData = null;
let rsyHost = null;
const RSY_BRANCHES = ['พิษณุโลก', 'กำแพงเพชร', 'แม่สอด', 'นครสวรรค์'];
const rsyEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rsyNum = v => Number(v || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });

function rsyRender(body) {
  rsyHost = body; rsyData = null;
  body.innerHTML = `<div class="alert-box alert-info" style="margin-bottom:14px;"><i data-lucide="info"></i>
    <span>ใช้ตั้งยอดสต๊อกในเว็บพนักงานให้ตรงกับ ERP เช่น สาขาเปิดใหม่ หรือหลังบัญชีแก้รายการย้อนหลังใน ERP เสร็จ
    <br><b>ยอดใหม่ = ยอดคงเหลือ ERP ล่าสุด + รายการที่บันทึกในเว็บพนักงาน (อนุมัติแล้ว) ที่ยังไม่ได้ส่งเข้า ERP</b> — รายการที่น้องบันทึกไว้ไม่หาย ไม่นับซ้ำ
    <br>เบิกจาก OPD ไม่นับเพิ่ม (ERP บันทึกการจ่ายยา/อุปกรณ์ของบิลเอง) · ยอด ERP ดึงอัตโนมัติทุกเช้า 05:00 หรือกด "ดึงจาก ERP ตอนนี้" ที่แท็บสถานะซิงก์ ERP</span></div>
  <div class="glass-card" style="padding:14px 16px;margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-weight:700;color:var(--gray-700);">สาขา</span>
    <select class="form-select" id="rsy-branch" style="max-width:200px;" onchange="rsyBranch=this.value;rsyLoad()">
      ${RSY_BRANCHES.map(b => `<option value="${b}"${b === rsyBranch ? ' selected' : ''}>${b}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" data-view-ok onclick="rsyLoad()"><i data-lucide="search"></i> ดูยอดใหม่</button>
  </div>
  <div id="rsy-body"></div>`;
  lucide.createIcons();
  rsyLoad();
}

async function rsyLoad() {
  const el = document.getElementById('rsy-body');
  if (!el) return;
  el.innerHTML = '<div class="glass-card" style="padding:24px;text-align:center;color:var(--gray-400);">กำลังคำนวณ...</div>';
  try { rsyData = await DB.adminStockResyncPreviewSupabase(rsyBranch); }
  catch (e) {
    const missing = /admin_stock_resync_preview|Could not find the function|does not exist/i.test((e && e.message) || '');
    el.innerHTML = `<div class="glass-card" style="padding:18px;color:var(--ink-2);">${missing ? 'หน้านี้ต้องรัน SQL ไฟล์ 24 (ตั้งยอดสต๊อกตาม ERP ใหม่) ใน Supabase ก่อน' : rsyEsc((e && e.hint) || DB.stockErrorText(e))}</div>`;
    return;
  }
  const d = rsyData, rows = d.rows || [];
  const when = v => v ? formatDateTime(v) : '-';
  el.innerHTML = `<div class="glass-card" style="padding:14px 16px;margin-bottom:14px;line-height:1.8;">
      <div>ยอด ERP ณ <b>${when(d.erp_as_of)}</b> <span style="color:var(--gray-500);">(ดึงมาเมื่อ ${when(d.pulled_at)})</span></div>
      <div>สาขา<b>${rsyEsc(d.branch)}</b> · สินค้าทั้งหมด ${d.items_total} รายการ · มียอดหลังตั้งใหม่ ${d.items_with_stock_after} รายการ · <b>ยอดจะเปลี่ยน ${rows.length} รายการ</b></div>
      ${d.last ? `<div style="color:var(--gray-500);font-size:.85rem;">ตั้งครั้งล่าสุด ${when(d.last.done_at)} โดย ${rsyEsc(d.last.by || '-')} (${d.last.changed} รายการ)</div>` : ''}
    </div>
    ${rows.length ? `<div class="glass-card" style="padding:0;overflow:hidden;margin-bottom:14px;"><div class="table-wrap" style="border:none;border-radius:0;max-height:60vh;"><table>
      <thead><tr><th>สินค้า</th><th class="num">ยอดตอนนี้</th><th class="num">ยอด ERP</th><th class="num">ในเว็บ ยังไม่เข้า ERP</th><th class="num">ยอดใหม่</th><th class="num">ต่าง</th></tr></thead>
      <tbody>${rows.map(r => { const diff = Number(r.new) - Number(r.cur); return `<tr>
        <td>${rsyEsc(r.name)}<div style="font-size:.72rem;color:var(--gray-500);">${rsyEsc(r.code)} · ${rsyEsc(r.unit || '')}</div></td>
        <td class="num">${rsyNum(r.cur)}</td><td class="num">${rsyNum(r.erp)}</td>
        <td class="num">${Number(r.ext_not_in_erp) ? (Number(r.ext_not_in_erp) > 0 ? '+' : '') + rsyNum(r.ext_not_in_erp) : ''}</td>
        <td class="num"><b>${rsyNum(r.new)}</b></td>
        <td class="num" style="color:${diff < 0 ? 'var(--red-500,#dc2626)' : 'var(--green-600)'};">${diff > 0 ? '+' : ''}${rsyNum(diff)}</td></tr>`; }).join('')}</tbody></table></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost" data-view-ok onclick="rsyRender(rsyHost)">ยกเลิก</button>
        <button class="btn btn-primary" data-write id="rsy-apply" onclick="rsyConfirm()"><i data-lucide="check"></i> ยืนยันตั้งยอด ${rows.length} รายการ</button></div>`
    : '<div class="glass-card" style="padding:24px;text-align:center;color:var(--green-600);">ยอดในเว็บพนักงานตรงกับ ERP แล้ว ไม่มีรายการที่ต้องเปลี่ยน ✓</div>'}`;
  lucide.createIcons();
}

function rsyConfirm() {
  if (!rsyData || !(rsyData.rows || []).length) return;
  confirmDialog(`ตั้งยอดสต๊อกสาขา<b>${rsyEsc(rsyData.branch)}</b> ตาม ERP ${rsyData.rows.length} รายการ?<br><small>ยอดคงเหลือในเว็บพนักงานจะเปลี่ยนเป็นช่อง "ยอดใหม่" · เก็บประวัติไว้ทุกครั้ง</small>`, () => rsyApply());
}
async function rsyApply() {
  try {
    const n = await DB.adminStockResyncApplySupabase(rsyData.branch, rsyData.snapshot);
    Toast.show(`ตั้งยอดสาขา${rsyData.branch}แล้ว ${n} รายการ ✓`, 'success', 5000);
  } catch (e) { Toast.show('ตั้งยอดไม่สำเร็จ: ' + ((e && e.hint) || DB.stockErrorText(e)), 'error', 7000); }
  rsyLoad();
}
