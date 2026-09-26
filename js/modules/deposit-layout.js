// Approved deposit presentation adapter. The real Supabase save and calculation handlers remain active.
const depositOriginalCreate=DB.createDepositSupabase;
const DEPOSIT_AUTO_REF_TEXT='ระบบจะสร้างเลขอ้างอิงเมื่อบันทึก';
DB.createDepositSupabase=async function(payload){
  payload.channel_account_name=document.getElementById('dep-account-name')?.value.trim()||'';
  // The on-screen reference is a read-only hint; the server issues deposit_no. Sending the hint
  // text would make every deposit in a branch collide on the unique payment_reference index.
  if(document.getElementById('dep-reference')?.readOnly||payload.payment_reference===DEPOSIT_AUTO_REF_TEXT)payload.payment_reference=null;
  return depositOriginalCreate.call(DB,payload);
};
// ── บัญชีรับเงินมัดจำ (ตั้งค่าได้จากหน้านี้เลย) ─────────────────
let depAccounts=[], depCanManage=false;
const depAccountLabel=a=>`${a.bank_name} ${a.account_no} (${a.account_name})`;
const depEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function depLoadAccounts(){
  const select=document.getElementById('dep-payment-method');if(!select)return;
  let res;
  try{res=await DB.listDepositAccountsSupabase();}
  catch(e){console.error(e);select.innerHTML='<option value="">โหลดบัญชีไม่สำเร็จ — ลองรีเฟรชหน้า</option>';return;}
  if(res===null){
    // Account settings not installed yet (SQL file 03): keep the previous sample choices so the form still works.
    select.innerHTML='<option value="">-- เลือกบัญชีรับเงิน --</option><option value="bank-demo-1">บัญชีรับเงิน A (ตัวอย่าง)</option><option value="bank-demo-2">บัญชีรับเงิน B (ตัวอย่าง)</option>';
    return;
  }
  depAccounts=res.accounts||[];depCanManage=!!res.can_manage;
  const active=depAccounts.filter(a=>a.is_active);
  // The chosen account's full label is stored in the deposit's payment_method, so old deposits keep their account name.
  select.innerHTML=(active.length?'<option value="">-- เลือกบัญชีรับเงิน --</option>':'<option value="">ยังไม่มีบัญชี — แจ้งแอดมิน/บัญชีให้เพิ่ม</option>')
    +active.map(a=>`<option value="${depEsc(depAccountLabel(a))}">${depEsc(depAccountLabel(a))}</option>`).join('');
  const btn=document.getElementById('dep-account-manage');if(btn)btn.style.display=depCanManage?'inline-flex':'none';
  lucide.createIcons();
}
function depManageAccounts(){
  const row=a=>`<tr><td>${depEsc(a.bank_name)}</td><td>${depEsc(a.account_no)}</td><td>${depEsc(a.account_name)}</td><td>${a.is_active?'<span class="badge badge-approved">ใช้งาน</span>':'<span class="badge badge-waiting">ปิดใช้</span>'}</td><td class="nowrap"><button class="btn btn-ghost btn-sm" data-write onclick="depEditAccount('${a.id}')">แก้ไข</button> <button class="btn btn-ghost btn-sm" data-write onclick="depToggleAccount('${a.id}')">${a.is_active?'ปิดใช้':'เปิดใช้'}</button></td></tr>`;
  openModal(`<div class="modal" style="max-width:760px;width:95%;"><div class="modal-header"><h3 class="modal-title"><i data-lucide="landmark"></i>บัญชีรับเงินมัดจำ</h3><button class="modal-close btn btn-ghost btn-icon btn-sm" onclick="closeModalDirect()"><i data-lucide="x"></i></button></div>
  <div class="modal-body"><p style="font-size:.82rem;color:var(--gray-500);margin:0 0 10px;">บัญชีที่ "ปิดใช้" จะไม่ขึ้นให้พนักงานเลือก แต่ยอดมัดจำเก่ายังแสดงชื่อบัญชีเดิมอยู่</p>
  <div class="table-wrap"><table><thead><tr><th>ธนาคาร</th><th>เลขบัญชี</th><th>ชื่อบัญชี</th><th>สถานะ</th><th></th></tr></thead><tbody>${depAccounts.length?depAccounts.map(row).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:16px;">ยังไม่มีบัญชี</td></tr>'}</tbody></table></div>
  <div id="dep-account-form" style="margin-top:14px;"></div></div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModalDirect()">ปิด</button><button class="btn btn-primary" onclick="depEditAccount(null)"><i data-lucide="plus"></i> เพิ่มบัญชี</button></div></div>`,{width:'780px'});
}
function depEditAccount(id){
  const a=depAccounts.find(x=>x.id===id)||{bank_name:'',account_no:'',account_name:'',note:'',sort_order:0,is_active:true};
  const box=document.getElementById('dep-account-form');if(!box)return;
  box.innerHTML=`<div class="glass-card" style="padding:14px;"><div style="font-weight:700;margin-bottom:10px;">${id?'แก้ไขบัญชี':'เพิ่มบัญชีใหม่'}</div>
  <div class="form-row"><div class="form-group"><label class="form-label">ธนาคาร <span class="required">*</span></label><input id="dep-acc-bank" class="form-input" value="${depEsc(a.bank_name)}" placeholder="เช่น กสิกรไทย / PromptPay"></div>
  <div class="form-group"><label class="form-label">เลขบัญชี <span class="required">*</span></label><input id="dep-acc-no" class="form-input" value="${depEsc(a.account_no)}" placeholder="xxx-x-xxxxx-x"></div></div>
  <div class="form-row"><div class="form-group"><label class="form-label">ชื่อบัญชี <span class="required">*</span></label><input id="dep-acc-name" class="form-input" value="${depEsc(a.account_name)}"></div>
  <div class="form-group"><label class="form-label">ลำดับที่แสดง</label><input id="dep-acc-sort" type="number" class="form-input" value="${Number(a.sort_order||0)}"></div></div>
  <div class="form-group"><label class="form-label">หมายเหตุ</label><input id="dep-acc-note" class="form-input" value="${depEsc(a.note||'')}" placeholder="เช่น ใช้สำหรับสาขาพิษณุโลก"></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-ghost" onclick="document.getElementById('dep-account-form').innerHTML=''">ยกเลิก</button><button class="btn btn-primary" id="dep-acc-save" onclick="depSaveAccount(${id?`'${id}'`:'null'})">บันทึก</button></div></div>`;
  document.getElementById('dep-acc-bank')?.focus();
}
async function depSaveAccount(id,override){
  const a=override||{id,bank_name:document.getElementById('dep-acc-bank')?.value.trim(),account_no:document.getElementById('dep-acc-no')?.value.trim(),
    account_name:document.getElementById('dep-acc-name')?.value.trim(),note:document.getElementById('dep-acc-note')?.value.trim(),
    sort_order:document.getElementById('dep-acc-sort')?.value,is_active:(depAccounts.find(x=>x.id===id)||{is_active:true}).is_active};
  if(!a.bank_name||!a.account_no||!a.account_name){Toast.show('กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบ','error');return;}
  try{await DB.saveDepositAccountSupabase(a);}
  catch(e){Toast.show('บันทึกไม่สำเร็จ: '+(/ACCOUNT_DUPLICATE/.test(e.message||'')?'มีบัญชีเลขนี้อยู่แล้ว':(e.message||e)),'error',5000);return;}
  Toast.show('บันทึกบัญชีแล้ว ✓','success');
  await depLoadAccounts();depManageAccounts();
}
function depToggleAccount(id){const a=depAccounts.find(x=>x.id===id);if(a)depSaveAccount(id,{...a,is_active:!a.is_active});}

const depositOriginalRender=renderDeposits;
renderDeposits=async function(container){
  await depositOriginalRender(container);
  const form=container.querySelector('.opd-form');form.id='deposit-preview-form';
  const hn=document.getElementById('dep-hn');
  const channel=document.getElementById('dep-channel');
  const channelRow=hn?.closest('.form-row');
  const channelGroup=channel?.closest('.form-group');
  if(hn&&channelRow&&channelGroup){
    hn.closest('.form-group').remove();
    const hidden=document.createElement('input');hidden.type='hidden';hidden.id='dep-hn';hidden.value='';form.append(hidden);
    const account=document.createElement('div');account.className='form-group';
    account.innerHTML='<label class="form-label" for="dep-account-name">ชื่อ Account ตามช่องทาง</label><input id="dep-account-name" class="form-input" placeholder="ชื่อ Facebook / LINE / Instagram" autocomplete="off">';
    channelRow.append(account);
  }
  const payment=document.getElementById('dep-payment-method');
  if(payment){
    const label=payment.closest('.form-group').querySelector('.form-label');
    label.innerHTML='บัญชีที่รับโอน <span class="required">*</span><button type="button" data-write id="dep-account-manage" class="btn btn-ghost btn-sm" style="display:none;margin-left:6px;padding:0 8px;font-size:.75rem;" onclick="depManageAccounts()"><i data-lucide="settings-2" style="width:13px;height:13px;"></i> จัดการบัญชี</button>';
    payment.innerHTML='<option value="">กำลังโหลดบัญชี...</option>';
    depLoadAccounts();
  }
  const reference=document.getElementById('dep-reference');
  if(reference){
    reference.closest('.form-group').querySelector('.form-label').textContent='เลขอ้างอิงอัตโนมัติ';
    reference.readOnly=true;reference.value=DEPOSIT_AUTO_REF_TEXT;
    reference.placeholder='ระบบสร้างให้อัตโนมัติ';reference.classList.add('deposit-auto-reference');
    
  }
  // Deposit evidence is usually an existing chat screenshot or transfer slip.
  // Keep multi-select, but do not force the camera as the OPD form does.
  document.getElementById('dep-evidence-input')?.removeAttribute('capture');
  form.querySelector('.alert-box')?.classList.add('deposit-guidance');
  const sections=form.querySelectorAll('.opd-section');
  sections[0]?.classList.add('deposit-data-section');sections[1]?.classList.add('deposit-evidence-section');
  form.querySelector('#dep-submit-btn')?.parentElement.classList.add('deposit-actions');
  form.querySelectorAll('.opd-section-head').forEach(head=>head.classList.add('deposit-always-open'));
};

