// ARANA Staff — คลังรูป (ข้อ 25)
// เก็บรูปใน Supabase Storage (bucket "photos" แบบส่วนตัว) แทนการเก็บรูปทั้งก้อนในฐานข้อมูล
//   upload  : รับรูปเต็ม + รูปเล็ก (ย่อจากเครื่องผู้ใช้แล้ว) → คืนที่อยู่ "storage:<path>" ให้บันทึกลงฐานข้อมูล
//   sign    : ขอลิงก์ดูรูปชั่วคราว (1 ชม.) สำหรับรูปที่อยู่ใน Storage
//   migrate : (ผู้ดูแลระบบ) ย้ายรูปเก่าที่เก็บในฐานข้อมูลไป Storage ทีละชุด
//   prune   : (ผู้ดูแลระบบ) ลบรูปเต็มของเดือนที่สำรองไป Google Drive แล้ว (เก็บรูปเล็กไว้)
// ทุกคำสั่งตรวจ session ของ ARANA Staff ในฐานข้อมูลก่อน — ไม่มีรหัสลับใดๆ ส่งไปที่เบราว์เซอร์
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "photos";
const KINDS = new Set(["opd", "out", "in", "transfer", "transfer-receive", "deposit", "other"]);
const MAX_BYTES = 1_500_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { data } = await sb.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    if (error && !/exists/i.test(error.message)) throw new Error("สร้างที่เก็บรูปไม่สำเร็จ: " + error.message);
  }
  bucketReady = true;
}

async function actor(token: string) {
  const { data, error } = await sb.rpc("photo_session_check", { p_session_token: token });
  if (error || !data) throw new Error("SESSION_INVALID");
  return data as { user_id: string; role: string; branch_name: string };
}

function decode(dataUrl: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("รูปแบบรูปไม่ถูกต้อง");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > MAX_BYTES) throw new Error("รูปใหญ่เกินไป");
  return { type: m[1], bytes };
}

const safe = (s: string) => (s || "").replace(/[^A-Za-z0-9ก-๙_-]/g, "").slice(0, 40) || "x";

async function put(path: string, dataUrl: string) {
  const { type, bytes } = decode(dataUrl);
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error("อัปโหลดรูปไม่สำเร็จ: " + error.message);
}

// รูปเต็ม <id>.jpg, รูปเล็ก <id>_t.jpg อยู่โฟลเดอร์เดียวกัน: ประเภท/สาขา/เดือน
async function upload(token: string, kind: string, branch: string, images: { full: string; thumb?: string }[]) {
  const who = await actor(token);
  if (!KINDS.has(kind)) return json({ ok: false, error: "ประเภทรูปไม่ถูกต้อง" }, 400);
  if (!Array.isArray(images) || !images.length || images.length > 10) return json({ ok: false, error: "จำนวนรูปไม่ถูกต้อง" }, 400);
  await ensureBucket();
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const out: string[] = [];
  for (const img of images) {
    const id = crypto.randomUUID();
    const dir = `${kind}/${safe(branch || who.branch_name)}/${month}`;
    await put(`${dir}/${id}.jpg`, img.full);
    if (img.thumb) await put(`${dir}/${id}_t.jpg`, img.thumb);
    out.push(`storage:${dir}/${id}.jpg`);
  }
  return json({ ok: true, paths: out });
}

async function sign(token: string, paths: string[]) {
  await actor(token);
  const list = (Array.isArray(paths) ? paths : []).map((p) => String(p).replace(/^storage:/, "")).filter((p) => p && !p.includes("..")).slice(0, 200);
  if (!list.length) return json({ ok: true, urls: {} });
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(list, 3600);
  if (error) return json({ ok: false, error: error.message }, 500);
  const urls: Record<string, string | null> = {};
  (data || []).forEach((d) => { if (d.path) urls["storage:" + d.path] = d.signedUrl || null; });
  return json({ ok: true, urls });
}

// ย้ายรูปเก่า (data:image ในฐานข้อมูล) ไป Storage ทีละชุด
const LEGACY = [
  { table: "bill_images", col: "file_url" },
  { table: "deposit_images", col: "file_url" },
  { table: "stock_log_images", col: "file_url" },
];
async function migrate(token: string, limit = 20) {
  const who = await actor(token);
  if (who.role !== "Admin") return json({ ok: false, error: "เฉพาะผู้ดูแลระบบ" }, 403);
  await ensureBucket();
  let moved = 0, left = 0;
  for (const t of LEGACY) {
    const { data, error } = await sb.from(t.table).select(`id, ${t.col}`).like(t.col, "data:image%").limit(Math.min(limit, 50));
    if (error) return json({ ok: false, error: `${t.table}: ${error.message}` }, 500);
    for (const row of (data || []) as Record<string, string>[]) {
      const path = `legacy/${t.table}/${row.id}.jpg`;
      try { await put(path, row[t.col]); } catch (e) {
        if (!/exists|Duplicate/i.test(String((e as Error).message))) continue;
      }
      const { error: upErr } = await sb.from(t.table).update({ [t.col]: "storage:" + path }).eq("id", row.id);
      if (!upErr) moved++;
    }
    const { count } = await sb.from(t.table).select("id", { count: "exact", head: true }).like(t.col, "data:image%");
    left += count || 0;
  }
  return json({ ok: true, moved, left });
}

// ลบรูปเต็มของเดือนที่สำรองแล้ว (เก็บรูปเล็ก) — เดือนต้องเก่ากว่า 2 เดือน
async function prune(token: string, month: string) {
  const who = await actor(token);
  if (who.role !== "Admin") return json({ ok: false, error: "เฉพาะผู้ดูแลระบบ" }, 403);
  if (!/^\d{4}-\d{2}$/.test(month || "")) return json({ ok: false, error: "เดือนไม่ถูกต้อง" }, 400);
  const limit = new Date(); limit.setMonth(limit.getMonth() - 2);
  if (month >= limit.toISOString().slice(0, 7)) return json({ ok: false, error: "ลบได้เฉพาะเดือนที่เก่ากว่า 2 เดือน" }, 400);
  let removed = 0;
  for (const kind of KINDS) {
    const { data: branches } = await sb.storage.from(BUCKET).list(kind, { limit: 100 });
    for (const b of branches || []) {
      const dir = `${kind}/${b.name}/${month}`;
      const { data: files } = await sb.storage.from(BUCKET).list(dir, { limit: 1000 });
      const full = (files || []).filter((f) => f.name.endsWith(".jpg") && !f.name.endsWith("_t.jpg")).map((f) => `${dir}/${f.name}`);
      for (let i = 0; i < full.length; i += 100) {
        const { data } = await sb.storage.from(BUCKET).remove(full.slice(i, i + 100));
        removed += (data || []).length;
      }
    }
  }
  return json({ ok: true, removed });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const token = String(body.session_token || "");
  if (!token) return json({ ok: false, error: "SESSION_REQUIRED" }, 401);
  try {
    if (body.action === "upload") return await upload(token, String(body.kind || ""), String(body.branch || ""), body.images);
    if (body.action === "sign") return await sign(token, body.paths);
    if (body.action === "migrate") return await migrate(token, Number(body.limit) || 20);
    if (body.action === "prune") return await prune(token, String(body.month || ""));
    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ ok: false, error: msg }, msg === "SESSION_INVALID" ? 401 : 500);
  }
});
