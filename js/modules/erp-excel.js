/**
 * ARANA CLINIC — Excel for importing เบิกใช้ / โอนสาขา into the main ERP (backup path when auto-sync is down)
 * js/modules/erp-excel.js
 *
 * Row 1 holds the exact field names of the confirmed ERP sync spec (2026-09-20), so the file can be imported
 * as-is. Thai explanations live on a separate sheet and never change the import columns.
 */
(function (root) {
  const ERP_COLUMNS = [
    { key: 'source_ref_id', th: 'รหัสอ้างอิงระบบส่วนขยาย', hint: 'ระบบใส่ให้เอง ถ้ากรอกมือให้เว้นว่าง (ERP ใช้กันรับรายการซ้ำ)', width: 38 },
    { key: 'move_type', th: 'ประเภท', hint: 'OUT = เบิกใช้, TRANSFER = โอนสาขา (เลือกจากรายการ)', width: 12 },
    { key: 'move_date', th: 'วันที่เบิก', hint: 'รูปแบบ ปี-เดือน-วัน ค.ศ. เช่น 2026-09-26', width: 13 },
    { key: 'from_branch_name', th: 'สาขาที่เบิก', hint: 'เลือกจากรายการ', width: 14 },
    { key: 'to_branch_name', th: 'สาขาปลายทาง', hint: 'กรอกเฉพาะโอนสาขา ถ้าเบิกใช้ให้เว้นว่าง', width: 14 },
    { key: 'product_code', th: 'รหัสสินค้า', hint: 'ต้องตรงกับรหัสใน ERP (ดูชีต "รายการสินค้า")', width: 16 },
    { key: 'qty', th: 'จำนวน', hint: 'ตัวเลขมากกว่า 0 ทศนิยมได้', width: 10 },
    { key: 'note', th: 'หมายเหตุ', hint: 'ไม่บังคับ', width: 28 },
    { key: 'source_department', th: 'ใช้ที่ส่วนไหน', hint: 'เฉพาะเบิกใช้: ห้องตรวจ / ห้องทรีทเมนท์ / ทั่วไป', width: 16 },
    { key: 'approved_by_name', th: 'ผู้อนุมัติ', hint: 'ชื่อบัญชีที่อนุมัติ', width: 18 },
    { key: 'approved_at', th: 'เวลาอนุมัติ', hint: 'เช่น 2026-09-26 14:30', width: 20 },
    { key: 'photo_urls', th: 'ลิงก์รูปหลักฐาน', hint: 'ไม่บังคับ ถ้ามีหลายลิงก์ให้คั่นด้วยเครื่องหมาย ,', width: 30 }
  ];
  const DEPARTMENTS = ['ห้องตรวจ', 'ห้องทรีทเมนท์', 'ทั่วไป'];
  const BLANK_ROWS = 300;

  function toRow(r) {
    const approvedAt = r.approved_at ? String(r.approved_at).replace('T', ' ').slice(0, 16) : '';
    return {
      source_ref_id: r.id || '', move_type: r.move_type || '', move_date: r.log_date || '',
      from_branch_name: r.branch_name || '', to_branch_name: r.move_type === 'TRANSFER' ? (r.to_branch_name || '') : '',
      product_code: r.product_code || '', qty: r.qty == null ? '' : Number(r.qty), note: r.note || '',
      source_department: r.move_type === 'OUT' ? (r.source || '') : '', approved_by_name: r.approved_by_name || '',
      approved_at: approvedAt, photo_urls: ''
    };
  }

  // ExcelJS is passed in so the same builder runs in the browser and in Node.
  function build(ExcelJS, { rows = [], products = [], branches = [] } = {}) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ARANA ระบบส่วนขยาย';
    const ws = wb.addWorksheet('นำเข้า ERP', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = ERP_COLUMNS.map(c => ({ header: c.key, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A2842' } };
    ERP_COLUMNS.forEach((c, i) => { ws.getRow(1).getCell(i + 1).note = c.th + ' — ' + c.hint; });
    // Dates and IDs stay as text so Excel does not turn them into serial numbers or scientific notation.
    ['source_ref_id', 'move_date', 'product_code', 'approved_at'].forEach(k => { ws.getColumn(k).numFmt = '@'; });
    rows.map(toRow).forEach(r => ws.addRow(r));

    const pl = wb.addWorksheet('รายการสินค้า');
    pl.columns = [{ header: 'product_code', key: 'code', width: 16 }, { header: 'ชื่อสินค้า', key: 'name', width: 44 }, { header: 'หน่วย', key: 'unit', width: 10 }];
    pl.getRow(1).font = { bold: true };
    products.forEach(p => pl.addRow({ code: p.code, name: p.name, unit: p.unit || '' }));

    const lists = wb.addWorksheet('ตัวเลือก', { state: 'hidden' });
    lists.getColumn(1).values = ['สาขา', ...branches];
    lists.getColumn(2).values = ['ส่วนที่ใช้', ...DEPARTMENTS];

    const last = Math.max(rows.length + 1, BLANK_ROWS);
    const listRef = (col, n) => `'ตัวเลือก'!$${col}$2:$${col}$${n + 1}`;
    for (let i = 2; i <= last; i++) {
      const row = ws.getRow(i);
      row.getCell('move_type').dataValidation = { type: 'list', allowBlank: true, formulae: ['"OUT,TRANSFER"'], showErrorMessage: true, errorTitle: 'ประเภทไม่ถูกต้อง', error: 'เลือก OUT (เบิกใช้) หรือ TRANSFER (โอนสาขา)' };
      if (branches.length) {
        const v = { type: 'list', allowBlank: true, formulae: [listRef('A', branches.length)], showErrorMessage: true, error: 'เลือกสาขาจากรายการ' };
        row.getCell('from_branch_name').dataValidation = v;
        row.getCell('to_branch_name').dataValidation = { ...v };
      }
      if (products.length) row.getCell('product_code').dataValidation = { type: 'list', allowBlank: true, formulae: [`'รายการสินค้า'!$A$2:$A$${products.length + 1}`], showErrorMessage: true, error: 'รหัสสินค้าต้องมีในชีต "รายการสินค้า"' };
      row.getCell('qty').dataValidation = { type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'จำนวนต้องมากกว่า 0' };
      row.getCell('source_department').dataValidation = { type: 'list', allowBlank: true, formulae: [listRef('B', DEPARTMENTS.length)], showErrorMessage: true, error: 'เลือกจากรายการ' };
    }

    const help = wb.addWorksheet('วิธีกรอก');
    help.columns = [{ header: 'คอลัมน์ (ห้ามแก้ชื่อหัวคอลัมน์)', key: 'key', width: 24 }, { header: 'ความหมาย', key: 'th', width: 26 }, { header: 'วิธีกรอก', key: 'hint', width: 70 }];
    help.getRow(1).font = { bold: true };
    ERP_COLUMNS.forEach(c => help.addRow(c));
    help.addRow({});
    help.addRow({ key: 'หมายเหตุ', hint: 'กรอก 1 แถว ต่อ 1 สินค้า — ใบเดียวที่มีหลายสินค้า ให้กรอกหลายแถว' });
    help.addRow({ key: '', hint: 'ใช้ไฟล์นี้เฉพาะตอนที่ระบบส่งข้อมูลอัตโนมัติใช้งานไม่ได้ แล้วนำไปกด Import ที่ ERP หลัก' });
    return wb;
  }

  const api = { ERP_COLUMNS, build, toRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ErpExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ── Browser buttons (เบิกใช้ / โอนสาขา pages) ──────────────────
const ERP_EXCEL_BRANCHES = ['พิษณุโลก', 'กำแพงเพชร', 'แม่สอด', 'นครสวรรค์'];
let erpExcelLib = null;

function erpExcelLoadLib() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (erpExcelLib) return erpExcelLib;
  erpExcelLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { erpExcelLib = null; reject(new Error('โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วลองใหม่')); };
    document.head.appendChild(s);
  });
  return erpExcelLib;
}

async function erpExcelDownload(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function erpExcelProducts() {
  const list = (typeof invProductsCache !== 'undefined' && invProductsCache.length) ? invProductsCache : await DB.getProductsSupabase();
  return (list || []).map(p => ({ code: p.code, name: p.name, unit: p.unit }));
}

async function erpExcelTemplate() {
  try {
    const [ExcelJS, products] = await Promise.all([erpExcelLoadLib(), erpExcelProducts()]);
    await erpExcelDownload(ErpExcel.build(ExcelJS, { products, branches: ERP_EXCEL_BRANCHES }), 'แบบฟอร์มเบิกใช้-โอนสาขา-นำเข้าERP.xlsx');
  } catch (e) { Toast.show(e.message || String(e), 'error', 5000); }
}

// Approved เบิกใช้/โอนสาขา that ERP has not received yet (ERP skips any source_ref_id it already has).
async function erpExcelExport(moveType) {
  try {
    const [ExcelJS, products, all] = await Promise.all([erpExcelLoadLib(), erpExcelProducts(), DB.listStockLogsErpSyncSupabase(null)]);
    const rows = (all || []).filter(r => r.audit_status === 'อนุมัติแล้ว' && r.move_type === moveType && !r.is_opd
      && ['รอส่ง', 'ส่งไม่สำเร็จ'].includes(r.erp_sync_status));
    if (!rows.length) { Toast.show('ไม่มีรายการที่อนุมัติแล้วและยังไม่ได้ส่งเข้า ERP', 'warning'); return; }
    const name = (moveType === 'TRANSFER' ? 'โอนสาขา' : 'เบิกใช้') + '-อนุมัติแล้ว-รอเข้าERP-' + todayISO() + '.xlsx';
    await erpExcelDownload(ErpExcel.build(ExcelJS, { rows, products, branches: ERP_EXCEL_BRANCHES }), name);
    Toast.show(`ออกไฟล์ ${rows.length} รายการแล้ว`, 'success');
  } catch (e) { Toast.show(e.message || String(e), 'error', 5000); }
}
