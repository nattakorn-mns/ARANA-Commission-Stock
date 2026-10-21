/**
 * ARANA Staff — ลูกค้าจากแชท (ข้อ 32, 33, SQL ไฟล์ 21)
 *  - Audit Room แท็บ "ลูกค้าจากแชท": มัดจำ/นัดหมายที่ปิดจากแชท + ลูกค้ามาใช้บริการแล้วหรือยัง
 *    แน่นอน (HN ตรง / เชื่อมมัดจำ) ยืนยันให้อัตโนมัติ · "อาจจะใช่" (ชื่อตรง) ให้บัญชียืนยัน แก้ยอดที่จ่ายได้
 *  - สรุปยอดของฉัน: ค่าคอมปิดจากแชทของตัวเอง
 */
const chatEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chatMoney = v => v == null || v === '' ? '-' : '฿' + formatCurrency(Number(v) || 0);
let chatRows = [];
let chatFilter = 'รอยืนยัน';

async function audRenderChatVisits(body, runMatch) {
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลด...</div>';
  try { chatRows = await DB.listChatVisitsSupabase(chatFilter || null, runMatch); }
  catch (e) {
    body.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><h4>โหลดไม่สำเร็จ</h4><p>${/Could not find the function|PGRST202/.test(e.message || '') ? 'ยังไม่ได้ติดตั้งฐานข้อมูลรอบ 5 (SQL ไฟล์ 21)' : chatEsc(e.hint || e.message)}</p></div>`;
    lucide.createIcons(); return;
  }
  const badge = s => `<span class="badge ${s === 'ยืนยันแล้ว' ? 'badge-approved' : s === 'รอยืนยัน' ? 'badge-pending' : 'badge-waiting'}">${s === 'รอยืนยัน' ? 'อาจจะใช่ — รอยืนยัน' : chatEsc(s)}</span>`;
  body.innerHTML = `<div class="glass-card" style="margin-bottom:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-weight:700;color:var(--gray-700);">ลูกค้าจากแชท</span>
      <span style="font-size:.8rem;color:var(--gray-500);flex-basis:100%;">ระบบจับคู่กับบิล OPD ทุกคืน 22:50 — HN ตรงหรือเชื่อมมัดจำ = ยืนยันให้เอง · ชื่อตรงอย่างเดียว = "อาจจะใช่" ให้บัญชีกดยืนยัน · ยอดที่จ่ายวันมา = ยอดชำระในรายการขายของบิลนั้น (แก้ได้ตอนยืนยัน)</span>
      <select class="filter-select" style="width:auto;" onchange="chatFilter=this.value;audRenderChatVisits(document.getElementById('aud-body'))">
        ${[['รอยืนยัน', 'อาจจะใช่ — รอยืนยัน'], ['รอลูกค้ามา', 'รอลูกค้ามา'], ['ยืนยันแล้ว', 'ยืนยันแล้ว'], ['', 'ทั้งหมด']].map(([v, n]) => `<option value="${v}" ${v === chatFilter ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto;" data-write onclick="audRenderChatVisits(document.getElementById('aud-body'), true)"><i data-lucide="refresh-cw"></i> จับคู่ตอนนี้</button></div>
    <div class="glass-card" style="padding:0;overflow:hidden;"><div class="table-wrap"><table><thead><tr>
      <th>เลขที่</th><th>สาขา</th><th>ลูกค้า</th><th>ปิดโดย</th><th>มัดจำ / ค่าคอม</th><th>บิลที่มา</th><th>ยอดที่จ่ายวันมา</th><th>ค่าคอมตอนมา</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${chatRows.length ? chatRows.map((r, i) => `<tr>
      <td class="nowrap">${chatEsc(r.doc)}<br><small>${r.kind === 'appt' ? 'นัดไม่วางมัดจำ' : 'มัดจำ'}${r.is_surgery ? ' · ศัลยกรรม' : ''}</small></td>
      <td>${chatEsc(r.branch)}</td>
      <td class="col-text">${chatEsc(r.customer_name)}${r.hn ? `<br><small>${chatEsc(r.hn)}</small>` : ''}<br><small>${chatEsc(r.program_name || '')} · ${chatEsc(r.channel || '')}</small></td>
      <td>${chatEsc(r.closer)}<br><small>${chatEsc(r.closer_role || '')}</small></td>
      <td class="num">${r.kind === 'appt' ? '-' : `${chatMoney(r.amount)}<br><small>${Number(r.commission_pct) || 0}% ของ ${chatMoney(r.rule_base)} = ${chatMoney(r.commission_amt)}</small>`}</td>
      <td>${r.visit_bill ? `${formatDate(r.visit_bill.date)}<br><small>${chatEsc(r.visit_bill.hn || '')} ${chatEsc(r.visit_bill.customer_name || '')}</small><br><small>${chatEsc(r.visit_match || '')}</small>` : '-'}</td>
      <td class="num">${r.visit_bill && r.visit_status === 'รอยืนยัน' ? `<input type="number" class="form-input" id="chat-paid-${i}" min="0" step="0.01" value="${Number(r.visit_paid) || 0}" style="width:110px;" />` : chatMoney(r.visit_paid)}</td>
      <td class="num">${r.visit_bill ? `${chatMoney(r.visit_commission)}<br><small>${Number(r.visit_commission_pct) || 0}%</small>` : '-'}</td>
      <td>${badge(r.visit_status)}</td>
      <td class="nowrap">${r.visit_bill && r.visit_status === 'รอยืนยัน'
        ? `<button class="btn btn-success btn-sm" onclick="chatDecide(${i}, 'confirm')">ใช่ ยืนยัน</button> <button class="btn btn-danger btn-sm" onclick="chatDecide(${i}, 'reject')">ไม่ใช่</button>`
        : r.visit_bill && r.visit_status === 'ยืนยันแล้ว' ? `<button class="btn btn-ghost btn-sm" onclick="chatDecide(${i}, 'reject')">ไม่ใช่คนเดียวกัน</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="10"><div class="empty-state">ไม่มีรายการ</div></td></tr>'}
    </tbody></table></div></div>`;
  lucide.createIcons();
}

async function chatDecide(i, decision) {
  const r = chatRows[i]; if (!r) return;
  const paid = document.getElementById('chat-paid-' + i)?.value;
  try { await DB.decideChatVisitSupabase(r.kind, r.id, decision, decision === 'confirm' ? paid : null); }
  catch (e) { Toast.show('ทำรายการไม่สำเร็จ: ' + (e.hint || e.message || e), 'error', 5000); return; }
  Toast.show(decision === 'confirm' ? 'ยืนยันแล้ว ✓ คิดค่าคอมให้แล้ว' : 'บันทึกว่าไม่ใช่ลูกค้าคนเดียวกัน — กลับไปรอจับคู่ใหม่', 'success', 4000);
  audRenderChatVisits(document.getElementById('aud-body'));
}

// สรุปยอดของฉัน: การ์ดค่าคอมปิดจากแชท (เฉพาะคนที่มีรายการ)
async function chatRenderMine() {
  const page = document.getElementById('page-content');
  if (!page || document.getElementById('chat-mine')) return;
  const rows = await DB.listMyChatCommissionsSupabase();
  if (!rows.length || currentRoute !== 'history') return;
  const total = rows.reduce((s, r) => s + (r.payment_status === 'ตีกลับ' ? 0 : Number(r.commission_amt) || 0) + (r.visit_status === 'ยืนยันแล้ว' ? Number(r.visit_commission) || 0 : 0), 0);
  const box = document.createElement('div');
  box.id = 'chat-mine';
  box.className = 'glass-card';
  box.style.cssText = 'margin-top:16px;padding:0;overflow:hidden;';
  box.innerHTML = `<div style="padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><b>ค่าคอมปิดจากแชท</b>
      <span style="font-size:.8rem;color:var(--gray-500);">รวม ${chatMoney(total)} (ค่าคอมตอนลูกค้ามา นับเมื่อยืนยันแล้ว)</span></div>
    <div class="table-wrap"><table><thead><tr><th>วันที่</th><th>เลขที่</th><th>ลูกค้า</th><th>มัดจำ</th><th>ค่าคอมมัดจำ</th><th>สถานะลูกค้า</th><th>ค่าคอมตอนมา</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="nowrap">${formatDate(r.created_at)}</td><td>${chatEsc(r.doc)}</td><td class="col-text">${chatEsc(r.customer_name)}<br><small>${chatEsc(r.program_name || '')}</small></td>
        <td class="num">${r.kind === 'appt' ? 'นัดไม่วางมัดจำ' : chatMoney(r.amount)}</td><td class="num">${r.kind === 'appt' ? '-' : chatMoney(r.commission_amt)}</td>
        <td>${chatEsc(r.visit_status === 'รอยืนยัน' ? 'มาแล้ว (รอบัญชียืนยัน)' : r.visit_status)}</td><td class="num">${r.visit_status === 'ยืนยันแล้ว' ? chatMoney(r.visit_commission) : '-'}</td></tr>`).join('')}
    </tbody></table></div>`;
  page.appendChild(box);
}
if (typeof renderHistory === 'function') {
  const chatHistRender = renderHistory;
  renderHistory = function (...args) { const out = chatHistRender.apply(this, args); setTimeout(chatRenderMine, 1500); return out; };
}
