/**
 * ARANA Staff — คลังรูปภาพ (ข้อ 25, SQL ไฟล์ 20)
 * ดูรูปตามประเภท / สาขา / เดือน · คัดลอกลิงก์ไปวางใน LINE · ดาวน์โหลด ZIP ไปเก็บ Google Drive
 */
const GAL_KINDS = [['opd', 'OPD'], ['out', 'เบิกใช้'], ['in', 'รับเข้า'], ['transfer', 'โอน/รับโอน'], ['deposit', 'มัดจำ']];
const GAL_ALL_BRANCH_ROLES = ['Admin', 'Audit', 'CommissionAudit', 'StockAudit'];
let galFilter = null;
let galRows = [];
const galEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const galThisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);

// ลิงก์ ?gallery=opd&branch=...&month=2026-10 → เปิดหน้าคลังรูปพร้อมตัวกรอง (หลังเข้าสู่ระบบ)
(function readGalleryLink() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('gallery')) {
      window._galleryLink = { kind: p.get('gallery'), branch: p.get('branch') || '', month: p.get('month') || '' };
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) { /* ignore */ }
})();

function renderGallery(container) {
  const allBranches = GAL_ALL_BRANCH_ROLES.includes(currentUser.role);
  const link = window._galleryLink; window._galleryLink = null;
  galFilter = {
    kind: (link && GAL_KINDS.some(k => k[0] === link.kind)) ? link.kind : (galFilter?.kind || 'opd'),
    branch: allBranches ? ((link && link.branch) || galFilter?.branch || currentBranch) : currentBranch,
    month: (link && /^\d{4}-\d{2}$/.test(link.month)) ? link.month : (galFilter?.month || galThisMonth())
  };
  const branches = [...document.querySelectorAll('#branch-select option')].map(o => o.value).filter(Boolean);
  container.innerHTML = `
    <div class="filter-bar">
      <div class="filter-group"><label class="filter-label">ประเภท</label>
        <select class="filter-select" id="gal-kind" onchange="galFilter.kind=this.value;galLoad()">${GAL_KINDS.map(([k, n]) => `<option value="${k}" ${k === galFilter.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="filter-group"><label class="filter-label">สาขา</label>
        <select class="filter-select" id="gal-branch" ${allBranches ? '' : 'disabled'} onchange="galFilter.branch=this.value;galLoad()">${branches.map(b => `<option ${b === galFilter.branch ? 'selected' : ''}>${galEsc(b)}</option>`).join('')}</select></div>
      <div class="filter-group"><label class="filter-label">เดือน</label>
        <input type="month" class="filter-input" id="gal-month" value="${galFilter.month}" max="${galThisMonth()}" onchange="galFilter.month=this.value||galThisMonth();galLoad()" /></div>
      <div class="filter-actions">
        <button class="btn btn-primary btn-sm" onclick="galCopyLink()"><i data-lucide="link"></i> คัดลอกลิงก์</button>
        ${allBranches ? `<button class="btn btn-ghost btn-sm" onclick="galZip()"><i data-lucide="folder-down"></i> ดาวน์โหลด ZIP</button>` : ''}
      </div>
    </div>
    <div id="gal-info" style="font-size:.82rem;color:var(--gray-500);margin:0 0 10px;"></div>
    <div id="gal-grid" class="gal-grid"></div>
    ${currentUser.role === 'Admin' ? `<div class="glass-card" style="margin-top:16px;padding:14px 16px;">
      <div class="section-title" style="margin-bottom:4px;">ดูแลพื้นที่เก็บรูป (ผู้ดูแลระบบ)</div>
      <p style="font-size:.8rem;color:var(--gray-500);margin:0 0 10px;">แพ็กเกจฟรีเก็บรูปได้ 1GB · ทุกต้นเดือน ดาวน์โหลด ZIP ของเดือนที่แล้วไปเก็บ Google Drive · รูปเต็มที่เก่ากว่า 2 เดือนลบได้ (รูปเล็กยังอยู่ให้ดูย้อนหลัง)</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="gal-migrate" onclick="galMigrate()"><i data-lucide="database-zap"></i> ย้ายรูปเก่าในฐานข้อมูลไป Storage</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red-600);" onclick="galPrunePrompt()"><i data-lucide="trash-2"></i> ลบรูปเต็มของเดือนที่สำรองแล้ว</button>
      </div><div id="gal-admin-msg" style="font-size:.8rem;margin-top:8px;"></div></div>` : ''}`;
  lucide.createIcons();
  galLoad();
}

async function galLoad() {
  const grid = document.getElementById('gal-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
  try { galRows = await DB.listPhotosSupabase(galFilter.kind, galFilter.branch, galFilter.month); }
  catch (e) {
    grid.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>โหลดรูปไม่สำเร็จ</h4><p>${/Could not find the function|PGRST202/.test(e.message || '') ? 'ยังไม่ได้ติดตั้งฐานข้อมูลคลังรูป (SQL ไฟล์ 20)' : galEsc(e.hint || e.message || e)}</p></div>`;
    lucide.createIcons(); return;
  }
  const name = GAL_KINDS.find(k => k[0] === galFilter.kind)[1];
  document.getElementById('gal-info').textContent = `${name} · สาขา${galFilter.branch} · ${galMonthText(galFilter.month)} — ${galRows.length} รูป${galRows.length >= 600 ? ' (แสดง 600 รูปแรก)' : ''}`;
  if (!galRows.length) { grid.innerHTML = '<div class="empty-state"><i data-lucide="image-off"></i><h4>ไม่มีรูปในเดือนนี้</h4></div>'; lucide.createIcons(); return; }
  grid.innerHTML = galRows.map((r, i) => `<figure class="gal-item" onclick="galOpen(${i})">
      ${Photos.isMarker(r.url) ? `<img data-photo="${galEsc(r.url)}" data-photo-thumb="1" alt="" loading="lazy" />` : `<img src="${galEsc(r.url)}" alt="" loading="lazy" />`}
      <figcaption><b>${formatDate(r.date)}</b> ${galEsc(r.title || '')}<br><small>${galEsc(r.sub || '')}</small></figcaption></figure>`).join('');
}
const galMonthText = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }); };

function galOpen(i) {
  const r = galRows[i]; if (!r) return;
  openModal(`<div class="modal" style="width:960px;max-width:96vw;"><div class="modal-header"><h3 class="modal-title">${formatDate(r.date)} · ${galEsc(r.title || '')}</h3>
    <button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
    <div class="modal-body" style="text-align:center;">${Photos.isMarker(r.url) ? `<img data-photo="${galEsc(r.url)}" style="max-width:100%;max-height:75vh;" />` : `<img src="${galEsc(r.url)}" style="max-width:100%;max-height:75vh;" />`}
    <p style="font-size:.8rem;color:var(--gray-500);margin-top:8px;">${galEsc(r.sub || '')}</p></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="galOpen(${Math.max(0, i - 1)})" ${i ? '' : 'disabled'}>ก่อนหน้า</button>
      <button class="btn btn-ghost" onclick="galOpen(${Math.min(galRows.length - 1, i + 1)})" ${i < galRows.length - 1 ? '' : 'disabled'}>ถัดไป</button></div></div>`, { width: '980px' });
}

function galLink() {
  const base = location.hostname === 'localhost' ? location.origin + '/' : 'https://nattakorn-mns.github.io/ARANA-Commission-Stock/';
  return `${base}?gallery=${encodeURIComponent(galFilter.kind)}&branch=${encodeURIComponent(galFilter.branch)}&month=${encodeURIComponent(galFilter.month)}`;
}
async function galCopyLink() {
  const url = galLink();
  const name = GAL_KINDS.find(k => k[0] === galFilter.kind)[1];
  const text = `รูป${name} สาขา${galFilter.branch} ${galMonthText(galFilter.month)}\n${url}`;
  try { await navigator.clipboard.writeText(text); Toast.show('คัดลอกลิงก์แล้ว ✓ วางใน LINE ได้เลย (คนเปิดต้องเข้าสู่ระบบ ARANA Staff)', 'success', 4000); }
  catch (e) {
    openModal(`<div class="modal" style="max-width:520px;"><div class="modal-header"><h3 class="modal-title">คัดลอกลิงก์</h3></div>
      <div class="modal-body"><textarea class="form-input" rows="3" onclick="this.select()" readonly>${galEsc(text)}</textarea></div>
      <div class="modal-footer"><button class="btn btn-primary" onclick="closeModalDirect()">ปิด</button></div></div>`);
  }
}

// ZIP สำหรับเก็บ Google Drive: โฟลเดอร์ ประเภท/สาขา/เดือน
function galLoadZipLib() {
  if (window.JSZip) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('โหลดตัวทำ ZIP ไม่ได้'));
    document.head.appendChild(s);
  });
}
async function galZip() {
  if (!galRows.length) { Toast.show('ไม่มีรูปให้ดาวน์โหลด', 'warning'); return; }
  Toast.show(`กำลังเตรียม ZIP ${galRows.length} รูป...`, 'info', 3000);
  try {
    await galLoadZipLib();
    const zip = new JSZip();
    const name = GAL_KINDS.find(k => k[0] === galFilter.kind)[1].replace(/\//g, '-');
    const folder = zip.folder(name).folder(galFilter.branch).folder(galFilter.month);
    const urls = await Photos.urls(galRows.map(r => r.url));
    let n = 0;
    for (const [i, r] of galRows.entries()) {
      const u = urls[r.url] || r.url;
      if (!u) continue;
      const blob = await (await fetch(u)).blob();
      const file = `${String(r.date).slice(0, 10)}_${String(r.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}_${i + 1}.jpg`;
      folder.file(file, blob); n++;
    }
    const out = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out);
    a.download = `ARANA-${name}-${galFilter.branch}-${galFilter.month}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    Toast.show(`ดาวน์โหลด ZIP แล้ว (${n} รูป)`, 'success');
  } catch (e) { Toast.show('ทำ ZIP ไม่สำเร็จ: ' + (e.message || e), 'error', 6000); }
}

async function galMigrate() {
  const btn = document.getElementById('gal-migrate'), msg = document.getElementById('gal-admin-msg');
  if (btn) btn.disabled = true;
  let total = 0;
  try {
    for (let round = 0; round < 40; round++) {
      const r = await Photos._call({ action: 'migrate', limit: 20 });
      total += r.moved;
      if (msg) msg.textContent = `ย้ายแล้ว ${total} รูป · เหลือ ${r.left} รูป`;
      if (!r.left || !r.moved) break;
    }
    Toast.show(`ย้ายรูปเก่าไป Storage แล้ว ${total} รูป`, 'success');
  } catch (e) { Toast.show('ย้ายรูปไม่สำเร็จ: ' + (e.notInstalled ? 'ยังไม่ได้ติดตั้ง Edge Function "photos"' : e.message), 'error', 6000); }
  if (btn) btn.disabled = false;
}
function galPrunePrompt() {
  const d = new Date(); d.setMonth(d.getMonth() - 3);
  const def = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  openModal(`<div class="modal" style="max-width:460px;"><div class="modal-header"><h3 class="modal-title">ลบรูปเต็มของเดือนที่สำรองแล้ว</h3></div>
    <div class="modal-body"><p style="margin:0 0 10px;font-size:.85rem;">ลบได้เฉพาะเดือนที่เก่ากว่า 2 เดือน — <b>ดาวน์โหลด ZIP ทุกประเภททุกสาขาของเดือนนั้นไปเก็บ Google Drive ก่อน</b> รูปเล็กยังอยู่ในระบบ</p>
      <input type="month" class="form-input" id="gal-prune-month" value="${def}" max="${def}" /></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
      <button class="btn btn-danger" onclick="galPrune()">ลบรูปเต็มเดือนนี้</button></div></div>`);
}
async function galPrune() {
  const month = document.getElementById('gal-prune-month')?.value;
  closeModalDirect();
  try { const r = await Photos._call({ action: 'prune', month }); Toast.show(`ลบรูปเต็มเดือน ${month} แล้ว ${r.removed} ไฟล์`, 'success', 5000); }
  catch (e) { Toast.show('ลบไม่สำเร็จ: ' + (e.message || e), 'error', 6000); }
}
