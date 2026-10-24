/**
 * ARANA Staff — แชร์เข้ากลุ่ม LINE หลังบันทึกเบิกใช้ / โอนออก / รับเข้า / รับโอน (คุณออม 24/10)
 * ข้อความสั้นแจ้งเตือน + ลิงก์รูป (เปิดดูได้ 30 วัน ไม่ต้องเข้าระบบ) · เบิกยาจาก OPD ไม่แชร์ (ไปรวมในสรุปสิ้นวัน)
 */
const STOCK_SHARE_WORD = { out: 'ส่งเบิก', transfer: 'โอนออก', in: 'รับเข้า', receive: 'รับโอน' };
let stockShareText = '';

function stockShareDate(iso) {
  const [y, m, d] = String(iso || todayISO()).slice(0, 10).split('-');
  return `${d}/${m}/${Number(y) + 543}`;
}
function stockShareName() {
  const first = String(currentUser?.name || '').trim().split(/\s+/)[0] || '-';
  return currentUser?.nickname ? `${first} (${currentUser.nickname})` : first;
}

// เรียกหลังบันทึกสำเร็จ — markers = รูปที่เก็บใน Storage ของใบนี้ (ถ้าไม่มี ส่งเฉพาะข้อความ)
async function stockShareOffer({ kind, count, date, branch, toBranch, fromBranch, poNo, markers }) {
  const line2 = `${stockShareName()} - ${STOCK_SHARE_WORD[kind] || 'บันทึก'} ${count} รายการ`
    + (kind === 'transfer' && toBranch ? ` ไปสาขา${toBranch}` : '')
    + (kind === 'receive' && fromBranch ? ` จากสาขา${fromBranch}` : '')
    + (kind === 'in' && poNo ? ` (${poNo})` : '');
  const head = `วันที่ ${stockShareDate(date)} สาขา${branch || currentBranch}\n${line2}`;
  stockShareText = head;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  openModal(`<div class="modal" style="max-width:440px;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="check-circle"></i>บันทึกแล้ว</h3>
      <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body"><p style="margin:0 0 8px;font-size:.85rem;color:var(--gray-600);">แชร์แจ้งเข้ากลุ่ม LINE ของสาขา</p>
      <pre id="stock-share-preview" class="stock-share-preview">${esc(head)}\nกำลังเตรียมลิงก์รูป…</pre></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ไม่แชร์</button>
      <button class="btn btn-ghost" onclick="stockShareCopy()"><i data-lucide="copy"></i> คัดลอก</button>
      <button class="btn btn-primary stock-share-line" id="stock-share-btn" disabled onclick="stockShareSend()"><i data-lucide="send"></i> แชร์เข้า LINE</button></div></div>`);
  lucide.createIcons();
  // เตรียมลิงก์ก่อน เพื่อให้กดแชร์แล้วเปิด LINE ได้ทันที (มือถือบางรุ่นไม่ยอมเปิดถ้ารอโหลดหลังกด)
  let links = [];
  const list = (markers || []).filter(m => Photos.isMarker(m)).slice(0, 3);
  if (list.length) {
    try {
      const j = await Photos._call({ action: 'sign', paths: list, days: 30 });
      links = list.map(m => j.urls && j.urls[m]).filter(Boolean);
    } catch (e) { console.warn('stockShare links', e); }
  }
  stockShareText = head + (links.length ? '\n' + links.map((u, i) => links.length > 1 ? `รูป ${i + 1}: ${u}` : `ดูรูป: ${u}`).join('\n') : '');
  const pre = document.getElementById('stock-share-preview');
  if (pre) pre.textContent = head + (links.length ? '\n' + links.map((_, i) => links.length > 1 ? `รูป ${i + 1}: (ลิงก์)` : 'ดูรูป: (ลิงก์)').join('\n') : '');
  const btn = document.getElementById('stock-share-btn');
  if (btn) btn.disabled = false;
}

async function stockShareSend() {
  const text = stockShareText;
  try {
    if (navigator.share) { await navigator.share({ text }); closeModalDirect(); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank');
  closeModalDirect();
}

async function stockShareCopy() {
  try { await navigator.clipboard.writeText(stockShareText); Toast.show('คัดลอกแล้ว ✓ วางในกลุ่ม LINE ได้เลย', 'success'); }
  catch (e) { const pre = document.getElementById('stock-share-preview'); if (pre) { pre.textContent = stockShareText; const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
}
