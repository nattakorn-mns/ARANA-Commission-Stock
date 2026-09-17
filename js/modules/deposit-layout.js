// Approved deposit presentation adapter. The real Supabase save and calculation handlers remain active.
const depositOriginalCreate=DB.createDepositSupabase;
DB.createDepositSupabase=async payload=>{ payload.channel_account_name=document.getElementById('dep-account-name')?.value.trim()||''; return depositOriginalCreate(payload); };
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
    payment.closest('.form-group').querySelector('.form-label').innerHTML='บัญชีที่รับโอน <span class="required">*</span>';
    payment.innerHTML='<option value="">-- เลือกบัญชีรับเงิน --</option><option value="bank-demo-1">บัญชีรับเงิน A (ตัวอย่าง)</option><option value="bank-demo-2">บัญชีรับเงิน B (ตัวอย่าง)</option>';
  }
  const reference=document.getElementById('dep-reference');
  if(reference){
    reference.closest('.form-group').querySelector('.form-label').textContent='เลขอ้างอิงอัตโนมัติ';
    reference.readOnly=true;reference.value='ระบบจะสร้างเลขอ้างอิงเมื่อบันทึก';
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

