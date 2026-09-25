// Read-only, isolated regression checks against the original repository code.
// Run: node outputs/data-flow-audit.test.cjs work/ARANA-Commission-Stock
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = path.resolve(process.argv[2] || 'work/ARANA-Commission-Stock');
const results = [];
function env(files = []) {
  const elements = new Map(), storage = new Map(), calls = [], notices = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {value:'',innerHTML:'',textContent:'',style:{},isConnected:true,disabled:false,classList:{add(){},remove(){}},addEventListener(){},click(){}});
    return elements.get(id);
  };
  const ctx = vm.createContext({console:{log(){},warn(){},error(){}}, Date, Map, Set, Math,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem:()=>JSON.stringify({token:'test-only'})},
    sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null};}},
    document:{getElementById:el,querySelector:()=>el('query'),querySelectorAll:()=>[],addEventListener(){},createElement:()=>el('created'),head:{appendChild(){}}},
    window:{addEventListener(){}},lucide:{createIcons(){}},Toast:{show:(...x)=>notices.push(x)},
    currentUser:{id:'test-user',role:'Admin'},currentBranch:'พิษณุโลก',
    formatCurrency:n=>String(n),formatDate:x=>x,typeBadge:x=>x,statusBadge:x=>x,
    todayISO:()=> '2026-09-25',getWeekStart:()=> '2026-09-21',openModal:()=>calls.push({modal:true}),
    setTimeout(){},clearTimeout(){},renderDeposits(){},getPage:()=>el('page')});
  const run = s => vm.runInContext(s,ctx);
  for(const file of ['js/db.js',...files]) run(fs.readFileSync(path.join(repo,file),'utf8'));
  return {ctx,run,el,calls,notices,storage};
}
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',detail:e.message});}}
function summary(e, sales=[]) {
  e.ctx.fixture={bills:[{id:'remote-bill',date:'2026-09-18',branch:'พิษณุโลก',customerName:'TEST ONLY',status:'รอแก้ไข'}],services:[{billId:'remote-bill',commission:100,programName:'Program'}],sales};
  e.run('historyRemote = fixture;');
}
async function inventory(e) {
  e.el('inv-date').value='2026-09-01'; e.el('inv-source').value='ทั่วไป';
  e.run("invRows=[{productCode:'P1',qty:1},{productCode:'P2',qty:2}]; invPhotos=[{data:'test-image'}]; invReset=()=>{};");
  await e.run('invSubmit()');
}
(async()=>{
  await check('Session token is forwarded and stock creator cannot be spoofed',async()=>{
    const e=env();await e.run("DB.saveStockLogSupabase({branch:'พิษณุโลก',productCode:'P1',qty:1,createdBy:'spoof'})");
    assert.equal(e.calls[0].args.p_session_token,'test-only');assert.equal(e.calls[0].args.p_payload.p_created_by,undefined);
  });
  await check('Deposit adapter retains DB context and reaches RPC',async()=>{
    const e=env(['js/modules/deposit-layout.js']);await e.run('DB.createDepositSupabase({deposit_amount:500})');
    assert.equal(e.calls.length,1);
  });
  await check('Service fee counted once with two sale lines',()=>{
    const e=env(['js/modules/history.js','js/modules/summary-layout.js']);
    summary(e,[{billId:'remote-bill',type:'upsell'},{billId:'remote-bill',type:'product'}]);
    assert.equal(e.run('sumRows().reduce((n,r)=>n+r.fee,0)'),100);
  });
  await check('Summary KPI follows selected branch',()=>{
    const e=env(['js/modules/history.js','js/modules/summary-layout.js']);summary(e);
    e.run("summaryLayoutBranch='แม่สอด'; sumRender()");assert.equal(e.el('sum-fee').textContent,'฿0.00');
  });
  await check('Revision tab includes status รอแก้ไข',()=>{
    const e=env(['js/modules/history.js','js/modules/summary-layout.js']);summary(e);
    e.run("summaryLayoutStatus='ตีกลับ';sumRender()");assert.ok(e.el('sum-layout-table').innerHTML.includes('TEST ONLY'),'Revision bill disappears');
  });
  await check('Remote bill detail opens without local cached bill',async()=>{
    const e=env(['js/modules/history.js']);summary(e);await e.run("histViewBill('remote-bill')");
    assert.ok(e.calls.some(c=>c.modal),'No modal and no remote detail request');
  });
  await check('Superseded service excluded after snake_case normalization',async()=>{
    const e=env(['js/modules/history.js','js/modules/summary-layout.js']);
    e.ctx.sb.rpc=async()=>({data:{bills:[{id:'B',date:'2026-09-18'}],services:[{bill_id:'B',commission:100,is_superseded:true}],sales:[]},error:null});
    await e.run('DB.getMyBillsSupabase().then(x=>historyRemote=x)');
    assert.equal(e.run('sumRows().reduce((n,r)=>n+r.fee,0)'),0);
  });
  await check('Inventory selected date reaches save RPC',async()=>{
    const e=env(['js/modules/inventory.js']);await inventory(e);
    assert.ok(e.calls.some(c=>JSON.stringify(c.args).includes('2026-09-01')),'Selected date is dropped');
  });
  // Adapted 2026-09-26 (Claude): lines are now sent in ONE atomic save_stock_request call.
  // Same intent: every line of a request carries the same non-empty request ID.
  await check('Inventory lines share a nonempty request ID',async()=>{
    const e=env(['js/modules/inventory.js']);await inventory(e);
    const req=e.calls.filter(c=>c.args?.p_action==='save_stock_request');
    assert.equal(req.length,1,'expected one atomic request call');
    assert.ok(req[0].args.p_payload.p_request_id,'request_id is null');
    assert.equal(req[0].args.p_payload.p_lines.length,2);
  });
  await check('Old server fallback: per-line saves still share one request ID',async()=>{
    const e=env(['js/modules/inventory.js']);
    e.ctx.sb.rpc=async(name,args)=>{e.calls.push({name,args});if(args.p_action==='save_stock_request')return {data:null,error:new Error('UNKNOWN_ACTION')};return {data:'log-'+e.calls.length,error:null};};
    await inventory(e);
    const rows=e.calls.filter(c=>c.args?.p_action==='save_stock_log');
    assert.equal(rows.length,2);assert.ok(rows[0].args.p_payload.p_request_id);
    assert.equal(rows[0].args.p_payload.p_request_id,rows[1].args.p_payload.p_request_id);
  });
  await check('Evidence upload failure propagates instead of claiming success',async()=>{
    const e=env();e.ctx.sb.rpc=async()=>({data:null,error:new Error('TEST_UPLOAD_FAILURE')});
    await assert.rejects(e.run("DB.saveStockLogImageSupabase('id','test')"));
  });
  // Adapted 2026-09-26 (Claude): the database now saves the whole request in one transaction
  // (verified separately against a Postgres replica). Here: when the server rejects the request,
  // the browser must not fall back to per-line saves that would commit part of it.
  await check('Failed second stock line does not leave the first committed',async()=>{
    const e=env(['js/modules/inventory.js']);let committed=0;
    e.ctx.sb.rpc=async(name,args)=>{if(args.p_action==='save_stock_request')return {data:null,error:new Error('UNKNOWN_PRODUCT')};committed++;return {data:'first-id',error:null};};
    await inventory(e);assert.equal(committed,0,'One line committed before the request failed');
    assert.ok(e.notices.some(n=>n[1]==='error'),'Failure was not shown to the user');
  });
  await check('Audit that changes nothing is reported, not shown as success',async()=>{
    const e=env();e.ctx.sb.rpc=async()=>({data:{affected:0},error:null});
    await assert.rejects(e.run("DB.auditStockRequestSupabase('R','อนุมัติแล้ว')"),/NOTHING_CHANGED/);
  });
  await check('Weekly count is written to shared persistence',()=>{
    const e=env(['js/modules/stockcard.js']);e.el('wc-week').value='2026-09-21';
    e.run("wcCounted={P1:5};DB.getStockBalance=()=>({P1:5});wcSaveAll()");
    assert.ok(e.calls.length>0,'Only localStorage written; no shared database call');
  });
  await check('Stock card displays a running balance for each movement',async()=>{
    const e=env(['js/modules/stockcard.js']);
    e.ctx.logs=[{date:'2026-09-02',productCode:'P1',qty:3,direction:'OUT'},{date:'2026-09-01',productCode:'P1',qty:10,direction:'IN'}];
    e.run('DB.getStockMovementSupabase=async()=>logs');await e.run('scRenderTable()');
    const balances=[...e.el('sc-table-wrap').innerHTML.matchAll(/stock-bal [^"]*">([^<]+)/g)].map(m=>Number(m[1]));
    assert.deepEqual(balances,[7,10]);
  });
  await check('Fractional OPD supply quantity is retained',()=>{
    const e=env(['js/modules/opd.js']);e.run("opdState.supplies=[{id:'S',qty:1}];opdSupplyQtyInput('S','0.5')");
    assert.equal(e.run('opdState.supplies[0].qty'),0.5);
  });
  await check('Normal upsell calculation uses price difference',()=>{
    const e=env(['js/modules/opd.js']);e.run("s={type:'upsell',amountPaid:9999,oldPrice:3999,commissionPct:2};opdCalcSale(s)");
    assert.equal(e.ctx.s.commissionBase,6000);assert.equal(e.ctx.s.commissionAmt,120);
  });
  await check('Additional payment after deposit uses only new payment',()=>{
    const e=env(['js/modules/opd.js']);e.run("s={type:'upsell',payType:'จ่ายเพิ่มจากมัดจำ',amountPaid:1000,oldPrice:3999,commissionPct:2};opdCalcSale(s)");
    assert.equal(e.ctx.s.commissionAmt,20);
  });
  await check('Product commission calculation uses 5 percent',()=>{
    const e=env(['js/modules/opd.js']);e.run("s={type:'product',amountPaid:590};opdCalcSale(s)");assert.equal(e.ctx.s.commissionAmt,29.5);
  });
  await check('Deposit commission calculation rounds to 2 decimals',()=>{
    const e=env(['js/modules/deposits.js']);e.el('dep-amount').value='2999';e.el('dep-commission-pct').value='1.5';
    e.run('depUpdateCommission()');assert.equal(e.el('dep-commission-amount').value,'44.99');
  });
  await check('OPD empty item rows cannot produce an empty bill',async()=>{
    const e=env(['js/modules/opd.js']);e.el('opd-hn').value='TEST';e.el('opd-customer').value='TEST ONLY';e.el('opd-date').value='2026-09-25';
    e.run("opdState.services=[{programCode:'',price:0,commission:0}];opdState.sales=[];opdState.photos=[{data:'test-image'}];opdReset=()=>{}");
    await e.run('opdSubmit()');assert.equal(e.calls.length,0,'RPC receives an OPD with no service or sale');
  });
  await check('Bangkok date at 02:00 remains the same local calendar day',()=>{
    const e=env(['js/app.js']);
    e.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-09-25T02:00:00+07:00']));}};
    assert.equal(e.run('todayISO()'),'2026-09-25');
  });
  const report={commit:'416a2f1c62eb9c91e3f1363d2cf58e6f586ad5f4',scope:'Isolated Node VM, synthetic fixtures, mocked RPC. No live writes and no real database SQL execution.',passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
  // Results go to the OS temp folder so test runs do not dirty the repository.
  fs.writeFileSync(path.join(require('node:os').tmpdir(),'data-flow-test-results.json'),JSON.stringify(report,null,2));
  for(const r of results)console.log(`${r.status} ${r.name}${r.detail?'\n  '+r.detail.replaceAll('\n','\n  '):''}`);
  console.log(`\n${report.passed} PASS / ${report.failed} FAIL`);process.exitCode=report.failed?1:0;
})();
