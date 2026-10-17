// ARANA Staff — เชื่อมกับ ERP
// 1) ดึงข้อมูล (อ่านอย่างเดียว) ผ่าน ext_read_pull → บันทึกในฐานข้อมูลส่วนขยาย
//    เรียกโดย pg_cron (05:00 ทุกชุด, 11:00/17:00 เฉพาะ PO) หรือปุ่ม "ดึงจาก ERP ตอนนี้"
// 2) นำส่งเข้า ERP (action "push") ผ่าน ext_write_post / ext_write_reverse — ปุ่มในห้องตรวจของบัญชี
// Secrets: ERP_ANON_KEY, ERP_EXT_READ_KEY, ERP_EXT_WRITE_KEY, ERP_PULL_TOKEN — ไม่เคยถูกส่งออกไปที่เบราว์เซอร์
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const local = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ERP_URL = Deno.env.get("ERP_URL") || "https://xlhlyususzomwtlotbaf.supabase.co";
const ERP_ANON = Deno.env.get("ERP_ANON_KEY") || "";
const ERP_KEY = Deno.env.get("ERP_EXT_READ_KEY") || "";
const ERP_WRITE_KEY = Deno.env.get("ERP_EXT_WRITE_KEY") || "";

// ชุดที่ ERP ส่งมาทั้งหมดทุกครั้ง vs ชุดที่ดึงเฉพาะที่เปลี่ยน
const FULL = new Set(["stock_balance", "open_purchase_orders"]);
const DATASETS = ["employees", "stock_items", "stock_balance", "open_purchase_orders", "service_commissions", "deposits",
  "dispense_items", "ext_write_status"];
// ชุดใหม่ (SQL ไฟล์ 12) บันทึกด้วยฟังก์ชันแยก
const EXT = new Set(["dispense_items", "ext_write_status"]);
const PAGE = 1000;
const MAX_PAGES = 50; // กันวนไม่จบ

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function erpRpc(fn: string, body: Record<string, unknown>) {
  const r = await fetch(`${ERP_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ERP_ANON, Authorization: `Bearer ${ERP_ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.hint || `ERP ตอบกลับ ${r.status}`);
  return j;
}

async function erpPage(dataset: string, since: string | null, afterId: string | null) {
  return await erpRpc("ext_read_pull", { p_key: ERP_KEY, p_dataset: dataset, p_since: since, p_after_id: afterId, p_limit: PAGE }) as
    { rows: unknown[]; count: number; next_cursor: { since: string; after_id: string } | null };
}

async function pullDataset(dataset: string) {
  let since: string | null = null, afterId: string | null = null;
  if (!FULL.has(dataset)) {
    const { data } = await local.rpc("erp_sync_cursor", { p_dataset: dataset });
    since = data?.since ?? null; afterId = data?.after_id ?? null;
  }
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await erpPage(dataset, since, afterId);
    const done = !res.next_cursor;
    const args = { p_dataset: dataset, p_rows: res.rows || [], p_full_first: page === 0, p_done: done };
    const { data, error } = EXT.has(dataset)
      ? await local.rpc("erp_apply_page_ext", args)
      : await local.rpc("erp_apply_page", { ...args, p_error: null });
    if (error) throw new Error(`บันทึก ${dataset} ไม่สำเร็จ: ${error.message}`);
    total += Number(data) || 0;
    if (done) break;
    since = res.next_cursor!.since; afterId = res.next_cursor!.after_id;
  }
  return total;
}

// นำส่ง/ยกเลิกใบเดียว: ฐานข้อมูลตรวจสิทธิ์จาก session ของคนกดปุ่มและสร้างข้อมูลที่จะส่ง แล้วบันทึกผลกลับ
async function push(sessionToken: string, requestId: string, op: string) {
  if (!ERP_ANON || !ERP_WRITE_KEY) return json({ ok: false, error: "ยังไม่ได้ตั้ง Secret ERP_EXT_WRITE_KEY" }, 500);
  const { data: prep, error } = await local.rpc("erp_push_prepare", { p_session_token: sessionToken, p_request_id: requestId, p_op: op });
  if (error) return json({ ok: false, error: error.message }, 400);

  if (op === "reverse") {
    try {
      await erpRpc("ext_write_reverse", { p_key: ERP_WRITE_KEY, p_ext_ref: prep.ext_ref, p_reason: prep.reason, p_by_emp_code: prep.by_emp_code });
      await local.rpc("erp_push_finish", { p_request_id: requestId, p_op: op, p_ok: true, p_doc_no: null, p_error: null });
      return json({ ok: true });
    } catch (e) {
      const msg = String((e as Error).message || e);
      await local.rpc("erp_push_finish", { p_request_id: requestId, p_op: op, p_ok: false, p_doc_no: null, p_error: msg });
      return json({ ok: false, error: msg });
    }
  }

  let docNo: string | null = null;
  try {
    for (const d of prep.docs as { kind: string; ext_ref: string; payload: unknown }[]) {
      const res = await erpRpc("ext_write_post", { p_key: ERP_WRITE_KEY, p_kind: d.kind, p_ext_ref: d.ext_ref, p_payload: d.payload });
      docNo = res.erp_doc_no || docNo;
    }
    await local.rpc("erp_push_finish", { p_request_id: requestId, p_op: op, p_ok: true, p_doc_no: docNo, p_error: null });
    return json({ ok: true, erp_doc_no: docNo });
  } catch (e) {
    // โอน: ถ้าส่งออกผ่านแต่รับไม่ผ่าน เก็บเลขใบโอนไว้ กดส่งซ้ำได้ (ERP ไม่ลงซ้ำ)
    const msg = String((e as Error).message || e);
    await local.rpc("erp_push_finish", { p_request_id: requestId, p_op: op, p_ok: false, p_doc_no: docNo, p_error: msg });
    return json({ ok: false, error: msg, erp_doc_no: docNo });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  // ปุ่มในห้องตรวจ: ยืนยันตัวตนด้วย session ของผู้ใช้ (ตรวจในฐานข้อมูล)
  if (body.action === "push") {
    const token = String(body.session_token || ""), requestId = String(body.request_id || ""), op = String(body.op || "send");
    if (!token || !requestId || !["send", "reverse"].includes(op)) return json({ ok: false, error: "ข้อมูลไม่ครบ" }, 400);
    return await push(token, requestId, op);
  }

  // ดึงข้อมูล: รหัสลับร่วมระหว่างฐานข้อมูล (private.app_config erp_pull_key) กับฟังก์ชันนี้ (Secret ERP_PULL_TOKEN)
  const token = Deno.env.get("ERP_PULL_TOKEN") || "";
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("forbidden", { status: 403, headers: CORS });
  }
  if (!ERP_ANON || !ERP_KEY) return json({ error: "ยังไม่ได้ตั้ง Secrets ERP_ANON_KEY / ERP_EXT_READ_KEY" }, 500);
  const wanted = Array.isArray(body.datasets) ? DATASETS.filter((d) => (body.datasets as string[]).includes(d)) : DATASETS;
  const result: Record<string, number | string> = {};
  for (const ds of wanted) {
    try { result[ds] = await pullDataset(ds); }
    catch (e) {
      const msg = String((e as Error).message || e);
      result[ds] = "error: " + msg;
      await local.rpc("erp_apply_page", { p_dataset: ds, p_rows: [], p_full_first: false, p_done: true, p_error: msg });
    }
  }
  return json(result);
});
