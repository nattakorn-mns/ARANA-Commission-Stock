// Approved OPD presentation adapter. Business handlers remain unchanged.
const layoutOriginalRender = renderOPD;
renderOPD = async function(container) {
  await layoutOriginalRender(container);
  const modeCard=document.querySelector('#opd-form > .glass-card');
  const modeSwitch=modeCard?.firstElementChild;
  const sharedSearch=document.getElementById('shared-search-wrap');
  const headerActions=document.getElementById('apsx-header-actions');
  if(modeSwitch&&sharedSearch&&headerActions){
    modeSwitch.classList.add('opd-mode-switch');
    modeSwitch.querySelector('label:nth-child(2) span').textContent='พ่วง OPD';
    headerActions.append(modeSwitch);
    sharedSearch.classList.add('shared-search-panel');
    sharedSearch.style.marginTop='0';
    document.getElementById('customer-section').before(sharedSearch);
    modeCard.remove();
  }
  for (const id of ['customer','photos']) {
    const head=document.querySelector(`#${id}-section .opd-section-head`);
    head.removeAttribute('onclick'); head.classList.add('always-open');
    head.querySelector(':scope > svg:last-child')?.remove();
  }
  for(const id of ['services','sales','supplies']) {
    const head=document.querySelector(`#${id}-section .opd-section-head`);
    head.tabIndex=0; head.setAttribute('role','button'); head.setAttribute('aria-expanded','false');
    head.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();head.click();}};
    document.getElementById(id+'-body').classList.add('collapsed');
  }
  document.querySelector('#services-body > button')?.classList.add('standalone-add');
  document.querySelector('#supplies-body > button')?.classList.add('standalone-add');
  document.getElementById('sale-add-btn-wrap')?.classList.add('standalone-add');
  const cancelSale=document.querySelector('#sale-type-picker > button');
  if(cancelSale)cancelSale.remove();
  document.querySelector('#opd-submit-btn').parentElement.classList.add('opd-actions');
  const area=document.getElementById('photo-upload-area');
  area.onclick=openOPDCamera;area.tabIndex=0;area.setAttribute('role','button');area.setAttribute('aria-label','เปิดกล้องถ่าย OPD');
  area.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openOPDCamera();}};
  area.querySelector('p').innerHTML='เปิดกล้องถ่ายภาพ OPD<br><span>ถ่ายใหม่เท่านั้น · แนบได้หลายภาพ</span>';
  document.getElementById('photo-input').remove();
};
opdToggleSection=function(id){
 if(['customer-body','photos-body'].includes(id))return;
 const el=document.getElementById(id),opening=el.classList.contains('collapsed');
 el.classList.toggle('collapsed');el.previousElementSibling.setAttribute('aria-expanded',String(opening));
 if(opening&&id==='services-body'&&!opdState.services.length)opdAddService();
 if(opening&&id==='sales-body'&&!opdState.sales.length)opdShowTypePicker();
 if(opening&&id==='supplies-body'&&!opdState.supplies.length)opdAddSupply();
};
function addInlineControls(card,addAction){
 const remove=card.querySelector('button[onclick^="opdRemove"]');
 if(!remove||card.querySelector('.inline-add'))return;
 remove.classList.add('inline-remove');remove.removeAttribute('title');remove.setAttribute('aria-label','ลบรายการ');
 const add=document.createElement('button');add.type='button';add.className='btn btn-ghost btn-sm inline-add';add.textContent='+เพิ่ม';add.setAttribute('aria-label','เพิ่มรายการ');add.onclick=addAction;
 remove.before(add);
}
const layoutRenderServices=opdRenderServices;
opdRenderServices=function(){layoutRenderServices();document.querySelectorAll('.service-row').forEach(card=>addInlineControls(card,()=>opdAddService()));};
const layoutRenderSales=opdRenderSales;
opdRenderSales=function(){layoutRenderSales();document.querySelectorAll('.sale-card').forEach(card=>{
 addInlineControls(card,()=>opdShowTypePicker());
 const base=card.querySelector('[id^="sale-base-"]')?.closest('.form-group');
 const pay=card.querySelector('select[onchange^="opdSalePayType"]')?.closest('.form-group');
 if(!base||!pay)return;
 const baseRow=base.parentElement,pct=base.nextElementSibling,payRow=pay.parentElement;
 const amount=payRow.children[1];
 if(amount?.querySelector('input')){const row=document.createElement('div');row.className='form-row extra-payment';row.append(amount);payRow.after(row);}else amount?.remove();
 payRow.append(base);payRow.classList.add('paired-fields');
 const result=card.querySelector('[id^="sale-result-"]').parentElement;
 result.classList.add('commission-result');baseRow.append(result);baseRow.classList.add('paired-fields');
 });};
const layoutRenderSupplies=opdRenderSupplies;
opdRenderSupplies=function(){layoutRenderSupplies();document.querySelectorAll('.supply-row').forEach(card=>{
 addInlineControls(card,()=>opdAddSupply());
 const unit=card.querySelector('[id^="sup-unit-"]');if(unit){unit.classList.add('unit-display');unit.setAttribute('aria-label','หน่วยตามฐานข้อมูล');}
 });};
const layoutRemoveService=opdRemoveService;
opdRemoveService=function(id){layoutRemoveService(id);if(!document.getElementById('services-body')?.classList.contains('collapsed')&&!opdState.services.length)opdAddService();};
const layoutRemoveSale=opdRemoveSale;
opdRemoveSale=function(id){layoutRemoveSale(id);if(!document.getElementById('sales-body')?.classList.contains('collapsed')&&!opdState.sales.length)opdShowTypePicker();};
const layoutRemoveSupply=opdRemoveSupply;
opdRemoveSupply=function(id){layoutRemoveSupply(id);if(!document.getElementById('supplies-body')?.classList.contains('collapsed')&&!opdState.supplies.length)opdAddSupply();};
// Camera capture only: no album/file chooser, no persistence or production uploads.
let opdCameraStream=null,opdCameraGeneration=0;
function closeOPDCamera(){opdCameraGeneration++;opdCameraStream?.getTracks().forEach(t=>t.stop());opdCameraStream=null;document.getElementById('opd-camera')?.remove();document.getElementById('photo-upload-area')?.focus();}
async function openOPDCamera(){
 if(document.getElementById('opd-camera'))return;
 const dialog=document.createElement('dialog');dialog.id='opd-camera';
 dialog.innerHTML='<h3>ถ่ายภาพ OPD</h3><p>ตัวอย่างเท่านั้น — กรุณาใช้เอกสารทดสอบ</p><video autoplay muted playsinline></video><p id="camera-status" role="status">กำลังเปิดกล้อง…</p><div class="camera-actions"><button type="button" class="btn btn-secondary" id="camera-close">ยกเลิก</button><button type="button" class="btn btn-primary" id="camera-shot" disabled>ถ่ายภาพ</button></div>';
 document.body.append(dialog);dialog.showModal();dialog.oncancel=e=>{e.preventDefault();closeOPDCamera();};dialog.querySelector('#camera-close').onclick=closeOPDCamera;
 const generation=++opdCameraGeneration;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('unsupported');
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  if(generation!==opdCameraGeneration){stream.getTracks().forEach(t=>t.stop());return;}
  opdCameraStream=stream;const video=dialog.querySelector('video');video.srcObject=stream;await video.play();
  dialog.querySelector('#camera-status').textContent='จัดเอกสารให้ครบและชัด แล้วกดถ่ายภาพ';dialog.querySelector('#camera-shot').disabled=false;
  dialog.querySelector('#camera-shot').onclick=()=>{
   if(!video.videoWidth)return;
   const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
   canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
   opdState.photos.push({id:'camera-'+Date.now(),name:'OPD-camera.jpg',data:canvas.toDataURL('image/jpeg',0.85)});opdRenderPhotos();closeOPDCamera();
  };
 }catch(e){if(generation===opdCameraGeneration)dialog.querySelector('#camera-status').textContent='เปิดกล้องไม่ได้ กรุณาอนุญาตใช้กล้องและเปิดด้วยเบราว์เซอร์ที่รองรับ ไม่มีการเลือกจากอัลบั้ม';}
}
window.addEventListener('pagehide',closeOPDCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden)closeOPDCamera();});

