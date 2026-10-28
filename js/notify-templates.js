/**
 * ARANA Staff — รูปแบบข้อความที่ส่งเข้ากลุ่ม (คุณออม 28/10, SQL ไฟล์ 23)
 * {ชื่อข้อมูล} = ช่องที่ระบบเติมให้ · บรรทัดแบบ "หัวข้อ: {ข้อมูล}" ที่ไม่มีข้อมูล จะไม่แสดง
 * ข้อความบอท: ฐานข้อมูลเป็นคนเติม (private.tpl_fill) · ปุ่มแชร์: เติมในเครื่องด้วย notifyFill (กติกาเดียวกัน)
 */
const NOTIFY_SHARE_DEFAULTS = {
  share_out: 'วันที่ {วันที่} สาขา{สาขา}\n{ชื่อ} - ส่งเบิก {จำนวน} รายการ\n{ลิงก์รูป}',
  share_transfer: 'วันที่ {วันที่} สาขา{สาขา}\n{ชื่อ} - โอนออก {จำนวน} รายการ ไปสาขา{ไปสาขา}\n{ลิงก์รูป}',
  share_in: 'วันที่ {วันที่} สาขา{สาขา}\n{ชื่อ} - รับเข้า {จำนวน} รายการ\nเลขที่ PO: {เลขPO}\n{ลิงก์รูป}',
  share_receive: 'วันที่ {วันที่} สาขา{สาขา}\n{ชื่อ} - รับโอน {จำนวน} รายการ จากสาขา{จากสาขา}\n{ลิงก์รูป}'
};

const NTF_SAMPLE_SALE = { วันที่: '28/10/2569', สาขา: 'พิษณุโลก', พนักงาน: 'สมใจ (ใจ)', ช่องทาง: 'หน้าร้าน', ลูกค้า: 'คุณลูกค้า ตัวอย่าง',
  จองมาโปร: 'ปรึกษาโปรแกรมรักษาสิว', จองราคา: '', อัพเพิ่ม: '', อัพเพิ่มราคา: '', ขายเพิ่ม: 'เลเซอร์ คอร์ส 10 ครั้ง', ขายเพิ่มราคา: '8,999',
  แบ่งจ่าย: 'มัดจำ', ยอดแบ่งจ่าย: '1,000', ขายสินค้า: '', สินค้าราคา: '', ยอดรวม: '1,000', หมายเหตุ: '-', เปอร์เซ็นต์: '1.5' };
const NTF_SAMPLE_EDIT = { แท็ก: '@admin', วันที่: '28/10/2569', สาขา: 'พิษณุโลก', พนักงาน: 'สมใจ (ใจ)', ลูกค้า: 'คุณลูกค้า ตัวอย่าง', รายการ: 'ค่ามือ/ค่าคอม', เหตุผล: 'ใส่ยอดผิด' };
const NTF_SAMPLE_DAILY = { วันที่: '28/10/2569', พนักงาน: 'สมใจ (ใจ)', สาขา: 'พิษณุโลก', ค่ามือ: '1,200', อัพเซล: '9,999', ขายเพิ่ม: '0', ขายของ: '590' };
const NTF_SAMPLE_STOCK = { วันที่: '28/10/2026', จำนวน: '2', ตีกลับ: '↩️ ตีกลับ ยังค้างแก้ไข\n▪ พิษณุโลก: สมใจ (ใจ) 1 รายการ', รายการ: '▪ พิษณุโลก\n  เบิก ยา A 2 ซีซี (ทั่วไป) · ใจ · รอตรวจสอบ\n  โอนไป แม่สอด วัสดุ B 5 ชิ้น · ใจ · รอตรวจสอบ' };
const NTF_SAMPLE_SHARE = { วันที่: '28/10/2569', สาขา: 'พิษณุโลก', ชื่อ: 'สมใจ (ใจ)', จำนวน: '2', ไปสาขา: 'แม่สอด', จากสาขา: 'กำแพงเพชร', เลขPO: 'PO2569-0012', ลิงก์รูป: 'ดูรูป: https://…(ลิงก์รูป)' };

// group: bot = ส่งอัตโนมัติ / share = ปุ่มแชร์ที่พนักงานกดเอง
const NOTIFY_TPL_META = [
  { kind: 'upsell_item', group: 'bot', title: 'อัพเซล / ขายเพิ่ม / ขายสินค้า (รายรายการ)', topic: 'tg_upsell_items', when: 'ส่งทันทีเมื่อบันทึก OPD ที่มีรายการขาย', sample: NTF_SAMPLE_SALE },
  { kind: 'edit_request', group: 'bot', title: 'ขอแก้ไขรายการ', topic: 'tg_upsell_items', when: 'ส่งทันทีเมื่อพนักงานกดขอแก้ไข', sample: NTF_SAMPLE_EDIT },
  { kind: 'edit_approved_sale', group: 'bot', title: 'อนุมัติการแก้ไข (ส่งรายการที่แก้แล้ว)', topic: 'tg_upsell_items', when: 'ส่งเมื่อบัญชีอนุมัติ — 1 ข้อความต่อรายการขาย', sample: NTF_SAMPLE_SALE },
  { kind: 'edit_approved', group: 'bot', title: 'อนุมัติการแก้ไข (ไม่มีรายการขาย)', topic: 'tg_upsell_items', when: 'ส่งเมื่อบัญชีอนุมัติ แต่แก้แค่ค่ามือ/รายการเบิก/รูป', sample: NTF_SAMPLE_EDIT },
  { kind: 'edit_rejected', group: 'bot', title: 'ไม่อนุมัติการแก้ไข', topic: 'tg_upsell_items', when: 'ส่งเมื่อบัญชีไม่อนุมัติ', sample: { ...NTF_SAMPLE_EDIT, เหตุผล: 'ไม่มีหลักฐาน' } },
  { kind: 'staff_daily', group: 'bot', title: 'สรุปรายวัน (น้องกดยืนยันยอด)', topic: 'tg_daily_summary', when: 'น้องกด "ยืนยันยอด ส่งสรุปรายวัน" ในสรุปยอดของฉัน', sample: NTF_SAMPLE_DAILY },
  { kind: 'staff_addendum', group: 'bot', title: 'สรุปรายวัน ฉบับแก้ไข', topic: 'tg_daily_summary', when: 'กดยืนยันอีกครั้งหลังยอดเปลี่ยน / ผู้ตรวจอนุมัติการแก้ไขแล้ว — วงเล็บ = เปลี่ยนจากครั้งก่อน', sample: { ...NTF_SAMPLE_DAILY, ค่ามือ: '1,350 (+150)', ขายของ: '590' } },
  { kind: 'staff_daily_request', group: 'bot', title: 'ขอแก้ไขสรุปรายวัน', topic: 'tg_daily_summary', when: 'ยืนยันยอดอีกครั้งขณะมีคำขอแก้ไขรออนุมัติ (ยังไม่แสดงตัวเลข)', sample: { แท็ก: '@admin', วันที่: '29/10/2569', พนักงาน: 'สมใจ (ใจ)', สาขา: 'พิษณุโลก' } },
  { kind: 'day_end', group: 'bot', title: 'สรุปสิ้นวัน 23:30', topic: 'tg_daily_summary', when: 'ทุกวัน 23:30 — รายชื่อคนที่ยังไม่กดยืนยันยอด', sample: { วันที่: '29/10/2569', ยังไม่ยืนยัน: '▪ กำแพงเพชร: บีบี (บี)\n▪ แม่สอด: ฟ้าใส (ฟ้า)' } },
  { kind: 'deposit', group: 'bot', title: 'มัดจำ', topic: 'line_deposit_pl', when: 'ส่งทันทีเมื่อบันทึกมัดจำ (ห้องมัดจำของสาขานั้น)', sample: { เลขที่: 'DEP-PL-0001', วันที่รับเงิน: '28/10/2569', สาขา: 'พิษณุโลก', พนักงาน: 'สมใจ (ใจ)', ช่องทาง: 'LINE', ลูกค้า: 'คุณลูกค้า ตัวอย่าง', โปรแกรม: 'ฟิลเลอร์', ราคาเต็ม: '8,999', ยอดมัดจำ: '1,000', บัญชี: 'กสิกร 123-4-56789-0', วันที่นัด: '02/11/2569', หมายเหตุ: '-' } },
  { kind: 'chat_visit', group: 'bot', title: 'ลูกค้าจากแชทมาใช้บริการ', topic: 'line_deposit_pl', when: 'เมื่อระบบจับคู่ลูกค้าจากแชทกับบิล OPD ได้', sample: { แท็กผู้ปิด: '@ฟ้า', วันที่มา: '02/11/2569', สาขา: 'พิษณุโลก', ลูกค้า: 'คุณลูกค้า ตัวอย่าง', เลขที่: 'DEP-PL-0001', โปรแกรม: 'ฟิลเลอร์', ปิดโดย: 'ฟ้าใส (ฟ้า) (แอดมิน)', ยอดที่จ่าย: '4,000', ค่าคอมเพิ่ม: '40', สถานะ: 'ยืนยันแล้ว' } },
  { kind: 'stock_out_daily', group: 'bot', title: 'สรุปเบิก/โอนออก ประจำวัน', topic: 'line_stock_out', when: 'ทุกวัน 23:30 (ไม่รวมเบิกจาก OPD) + ตีกลับค้างแก้', sample: NTF_SAMPLE_STOCK },
  { kind: 'stock_in_daily', group: 'bot', title: 'สรุปรับเข้า ประจำวัน', topic: 'line_stock_in', when: 'ทุกวัน 23:30 + ตีกลับค้างแก้', sample: { ...NTF_SAMPLE_STOCK, รายการ: '▪ พิษณุโลก\n  รับเข้า วัสดุ B 5 ชิ้น · ใจ · รอตรวจสอบ' } },
  { kind: 'test', group: 'bot', title: 'ข้อความทดสอบ', topic: null, when: 'ปุ่ม "ทดสอบส่ง"', sample: { ห้อง: 'กลุ่มเทส', เวลา: '28/10/2026 10:30' } },
  { kind: 'share_out', group: 'share', title: 'แชร์หลังบันทึก เบิกใช้', when: 'หน้าเบิกใช้ → กด "แชร์เข้า LINE"', sample: NTF_SAMPLE_SHARE },
  { kind: 'share_transfer', group: 'share', title: 'แชร์หลังบันทึก โอนออก', when: 'หน้าโอนออก → กด "แชร์เข้า LINE"', sample: NTF_SAMPLE_SHARE },
  { kind: 'share_in', group: 'share', title: 'แชร์หลังบันทึก รับเข้า', when: 'หน้ารับเข้า → กด "แชร์เข้า LINE"', sample: NTF_SAMPLE_SHARE },
  { kind: 'share_receive', group: 'share', title: 'แชร์หลังบันทึก รับโอน', when: 'หน้ารับโอน → กด "แชร์เข้า LINE"', sample: NTF_SAMPLE_SHARE }
];

// เหมือน private.tpl_fill ในฐานข้อมูล
function notifyFill(tpl, vars) {
  const out = [];
  String(tpl || '').replace(/\r/g, '').split('\n').forEach(line => {
    let has = false, empty = true;
    const res = line.replace(/\{([^{}]+)\}/g, (all, k) => {
      if (!Object.prototype.hasOwnProperty.call(vars || {}, k)) return all;
      has = true;
      const v = String(vars[k] ?? '').replace(/^[ \n]+|[ \n]+$/g, '');
      if (v) empty = false;
      return v;
    });
    const lit = line.replace(/\{[^{}]+\}/g, '').replace(/^ +| +$/g, '');
    if (has && empty && (lit === '' || lit.endsWith(':'))) return;
    out.push(res.replace(/ +$/, ''));
  });
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

// รูปแบบที่ใช้อยู่ (ตั้งเองไว้ → ใช้ของที่ตั้ง, ไม่ได้ตั้ง → ค่าเดิม)
function notifyTemplate(kind, defaults) {
  const t = (typeof appSettings !== 'undefined' && appSettings.notify_templates) || {};
  const own = typeof t[kind] === 'string' ? t[kind].trim() : '';
  return own || (defaults && defaults[kind]) || NOTIFY_SHARE_DEFAULTS[kind] || '';
}
