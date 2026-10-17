// ARANA ส่วนขยาย — ดึงข้อมูลจาก ERP (อ่านอย่างเดียว) ผ่าน ext_read_pull แล้วบันทึกในฐานข้อมูลส่วนขยาย
// เรียกโดย pg_cron ทุกเช้า 05:00 หรือปุ่ม "ดึงจาก ERP ตอนนี้" ในหน้าแอดมิน (ผ่านฐานข้อมูล)
// Secrets ที่ต้องตั้ง: ERP_URL, ERP_ANON_KEY, ERP_EXT_READ_KEY — ไม่เคยถูกส่งออกไปที่เบราว์เซอร์ และไม่เขียนอะไรกลับ ERP
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const local = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ERP_URL = Deno.env.get("ERP_URL") || "https://xlhlyususzomwtlotbaf.supabase.co";
const ERP_ANON = Deno.env.get("ERP_ANON_KEY") || "";
const ERP_KEY = Deno.env.get("ERP_EXT_READ_KEY") || "";

// ชุดที่ ERP ส่งมาทั้งหมดทุกครั้ง vs ชุดที่ดึงเฉพาะที่เปลี่ยน
const FULL = new Set(["stock_balance", "open_purchase_orders"]);
const DATASETS = ["employees", "stock_items", "stock_balance", "open_purchase_orders", "service_commissions", "deposits"];
const PAGE = 1000;
const MAX_PAGES = 50; // กันวนไม่จบ

async function erpPage(dataset: string, since: string | null, afterId: string | null) {
  const r = await fetch(`${ERP_URL}/rest/v1/rpc/ext_read_pull`, {
    method: "POST",
    headers: { apikey: ERP_ANON, Authorization: `Bearer ${ERP_ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: ERP_KEY, p_dataset: dataset, p_since: since, p_after_id: afterId, p_limit: PAGE }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ERP ${r.status}: ${j.message || j.hint || "อ่านข้อมูลไม่สำเร็จ"}`);
  return j as { rows: unknown[]; count: number; next_cursor: { since: string; after_id: string } | null };
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
    const { data, error } = await local.rpc("erp_apply_page", {
      p_dataset: dataset, p_rows: res.rows || [], p_full_first: page === 0, p_done: done, p_error: null,
    });
    if (error) throw new Error(`บันทึก ${dataset} ไม่สำเร็จ: ${error.message}`);
    total += Number(data) || 0;
    if (done) break;
    since = res.next_cursor!.since; afterId = res.next_cursor!.after_id;
  }
  return total;
}

Deno.serve(async (req) => {
  // Shared token between the database (private.app_config erp_pull_key) and this function (Secret ERP_PULL_TOKEN).
  const token = Deno.env.get("ERP_PULL_TOKEN") || "";
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("forbidden", { status: 403 });
  }
  if (!ERP_ANON || !ERP_KEY) return new Response(JSON.stringify({ error: "ยังไม่ได้ตั้ง Secrets ERP_ANON_KEY / ERP_EXT_READ_KEY" }), { status: 500 });
  const result: Record<string, number | string> = {};
  for (const ds of DATASETS) {
    try { result[ds] = await pullDataset(ds); }
    catch (e) {
      const msg = String((e as Error).message || e);
      result[ds] = "error: " + msg;
      await local.rpc("erp_apply_page", { p_dataset: ds, p_rows: [], p_full_first: false, p_done: true, p_error: msg });
    }
  }
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
