/**
 * ARANA CLINIC — Deposit / online closing module
 */

let depositProgramsCache = [];
let depositEvidence = [];

async function renderDeposits(container) {
  depositEvidence = [];
  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);">กำลังโหลดข้อมูล...</div>';
  depositProgramsCache = await DB.getProgramsSupabase();

  container.innerHTML = `
  <div class="opd-form">
    <div class="alert-box alert-info" style="margin-bottom:16px;">
      <i data-lucide="info"></i>
      <span>ใช้สำหรับลูกค้าที่ชำระมัดจำแล้วแต่ยังไม่มี OPD เมื่อเงินได้รับการยืนยัน ระบบจะรับรองสิทธิ์ค่าคอมทันที</span>
    </div>

    <div class="opd-section">
      <div class="opd-section-head"><h3><i data-lucide="wallet-cards"></i>ข้อมูลยอดมัดจำ</h3></div>
      <div class="opd-section-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">วันที่รับเงิน <span class="required">*</span></label><input id="dep-date" type="date" class="form-input" value="${todayISO()}" max="${todayISO()}" /></div>
          <div class="form-group"><label class="form-label">สาขา</label><input class="form-input" value="${currentBranch}" readonly /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ชื่อลูกค้า <span class="required">*</span></label><input id="dep-customer" class="form-input" placeholder="ชื่อ-นามสกุล" /></div>
          <div class="form-group"><label class="form-label">เบอร์โทร</label><input id="dep-phone" class="form-input" inputmode="tel" placeholder="เช่น 08x-xxx-xxxx" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">HN (ถ้ามี)</label><input id="dep-hn" class="form-input" placeholder="HN-0001" /></div>
          <div class="form-group"><label class="form-label">ช่องทางที่ปิดยอด <span class="required">*</span></label>
            <select id="dep-channel" class="form-select"><option value="">-- เลือกช่องทาง --</option><option>LINE</option><option>Facebook</option><option>Instagram</option><option>โทรศัพท์</option><option>หน้าร้าน</option><option>อื่นๆ</option></select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:16px;"><label class="form-label">โปรแกรมที่จอง <span class="required">*</span></label>
          <select id="dep-program" class="form-select"><option value="">-- เลือกโปรแกรม --</option>${depositProgramsCache.map(p => `<option value="${p.code}" data-price="${p.price}">${p.code} — ${p.name}</option>`).join('')}</select>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ราคาเต็มของโปรแกรม</label><input id="dep-package-price" type="number" min="0" step="0.01" class="form-input" placeholder="0.00" /></div>
          <div class="form-group"><label class="form-label">ยอดมัดจำที่รับจริง <span class="required">*</span></label><input id="dep-amount" type="number" min="0.01" step="0.01" class="form-input" placeholder="0.00" oninput="depUpdateCommission()" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">วิธีชำระ <span class="required">*</span></label><select id="dep-payment-method" class="form-select"><option value="">-- เลือกวิธีชำระ --</option><option>โอนเงิน</option><option>บัตรเครดิต</option><option>เงินสด</option><option>QR Payment</option><option>อื่นๆ</option></select></div>
          <div class="form-group"><label class="form-label">เลขใบเสร็จ/เลขอ้างอิง</label><input id="dep-reference" class="form-input" placeholder="ช่วยป้องกันการส่งยอดซ้ำ" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">เปอร์เซ็นต์ค่าคอม</label><select id="dep-commission-pct" class="form-select" onchange="depUpdateCommission()">${[0,0.5,0.65,0.75,1,1.3,1.5,2,2.5,3,5].map(x=>`<option value="${x}">${x}%</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">ค่าคอมที่ขอรับ</label><input id="dep-commission-amount" class="form-input" value="0.00" readonly /></div>
        </div>
        <div class="form-group"><label class="form-label">วันที่นัดหมาย (ถ้ามี)</label><input id="dep-appointment-date" type="date" class="form-input" /></div>
        <div class="form-group"><label class="form-label">หมายเหตุ</label><textarea id="dep-note" class="form-input" rows="2" placeholder="รายละเอียดเพิ่มเติม"></textarea></div>
      </div>
    </div>

    <div class="opd-section">
      <div class="opd-section-head"><h3><i data-lucide="paperclip"></i>หลักฐานการรับเงิน <span class="required">*</span></h3><span class="opd-section-count" id="dep-evidence-count">0</span></div>
      <div class="opd-section-body">
        <div class="photo-upload-area" id="dep-evidence-area" onclick="document.getElementById('dep-evidence-input').click()"><i data-lucide="upload-cloud"></i><p>แนบสลิป ใบเสร็จ หรือภาพแชท<br><span style="font-size:0.75rem;">อย่างน้อย 1 รูป</span></p></div>
        <input id="dep-evidence-input" type="file" multiple accept="image/*" capture="environment" style="display:none;" onchange="depHandleEvidence(event)" />
        <div class="photo-thumbnails" id="dep-evidence-thumbs"></div>
      </div>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;padding-bottom:20px;">
      <button class="btn btn-ghost" onclick="renderDeposits(getPage())"><i data-lucide="rotate-ccw"></i> ล้างฟอร์ม</button>
      <button class="btn btn-primary" id="dep-submit-btn" onclick="depSubmit()"><i data-lucide="send"></i> ส่งยอดมัดจำ</button>
    </div>
  </div>`;

  document.getElementById('dep-program')?.addEventListener('change', function() {
    const option = this.options[this.selectedIndex];
    const price = option?.dataset?.price;
    if (price) document.getElementById('dep-package-price').value = price;
  });
  lucide.createIcons();
}

function depUpdateCommission() {
  const amount = Number(document.getElementById('dep-amount')?.value || 0);
  const pct = Number(document.getElementById('dep-commission-pct')?.value || 0);
  const out = document.getElementById('dep-commission-amount');
  if (out) out.value = (amount * pct / 100).toFixed(2);
}

async function depHandleEvidence(event) {
  for (const file of Array.from(event.target.files || [])) {
    const data = await fileToBase64(file);
    depositEvidence.push({ id: 'dep_' + Date.now() + Math.random(), name: file.name, data });
  }
  depRenderEvidence();
  event.target.value = '';
}

function depRenderEvidence() {
  const wrap = document.getElementById('dep-evidence-thumbs');
  const area = document.getElementById('dep-evidence-area');
  if (area) area.className = 'photo-upload-area' + (depositEvidence.length ? ' has-files' : '');
  if (document.getElementById('dep-evidence-count')) document.getElementById('dep-evidence-count').textContent = depositEvidence.length;
  if (!wrap) return;
  wrap.innerHTML = depositEvidence.map(p => `<div class="photo-thumb-wrap"><img src="${p.data}" class="photo-thumb" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-md);border:2px solid var(--gray-200);" /><button class="photo-thumb-del" onclick="depRemoveEvidence('${p.id}')">×</button></div>`).join('');
}

function depRemoveEvidence(id) {
  depositEvidence = depositEvidence.filter(p => p.id !== id);
  depRenderEvidence();
}

async function depSubmit() {
  const customerName = document.getElementById('dep-customer')?.value.trim();
  const programCode = document.getElementById('dep-program')?.value;
  const channel = document.getElementById('dep-channel')?.value;
  const amount = Number(document.getElementById('dep-amount')?.value || 0);
  const paymentMethod = document.getElementById('dep-payment-method')?.value;
  if (!customerName || !programCode || !channel || amount <= 0 || !paymentMethod) { Toast.show('กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ', 'error'); return; }
  if (!depositEvidence.length) { Toast.show('กรุณาแนบหลักฐานการรับเงินอย่างน้อย 1 รูป', 'error'); return; }

  const btn = document.getElementById('dep-submit-btn');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const program = depositProgramsCache.find(p => p.code === programCode);
    await DB.createDepositSupabase({
      deposit_date: document.getElementById('dep-date').value,
      branch_name: currentBranch,
      customer_name: customerName,
      customer_phone: document.getElementById('dep-phone').value.trim(),
      hn: document.getElementById('dep-hn').value.trim(),
      channel,
      program_code: programCode,
      program_name: program?.name || '',
      package_price: Number(document.getElementById('dep-package-price').value || 0),
      deposit_amount: amount,
      payment_method: paymentMethod,
      payment_reference: document.getElementById('dep-reference').value.trim(),
      commission_pct: Number(document.getElementById('dep-commission-pct').value || 0),
      appointment_date: document.getElementById('dep-appointment-date').value || null,
      note: document.getElementById('dep-note').value.trim(),
      created_by: currentUser.id,
      images: depositEvidence.map(p => ({ name: p.name, data: p.data }))
    });
    Toast.show('ส่งยอดมัดจำแล้ว ✓ รอบัญชียืนยันเงินเข้า', 'success', 4000);
    renderDeposits(getPage());
  } catch (e) {
    console.error(e);
    Toast.show('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error', 5000);
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
}

