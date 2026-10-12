// ARANA ส่วนขยาย — ตัวส่งแจ้งเตือน Telegram / LINE
// ถูกเรียกโดย pg_cron ทุก 2 นาที (เฉพาะเมื่อมีข้อความรอส่ง) หรือกดจากหน้าแอดมิน
// คีย์ของบอททุกตัวอยู่ใน Secrets ของฟังก์ชันนี้เท่านั้น ไม่เคยถูกส่งออกไปที่เบราว์เซอร์
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Item = {
  id: string; kind: string; text: string; image_url: string | null;
  provider: "telegram" | "line"; secret_name: string; target_id: string | null; channel_key: string;
  monthly_quota: number | null; used_this_month: number;
};

async function sendTelegram(token: string, chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`telegram ${r.status}: ${j.description || "ส่งไม่สำเร็จ"}`);
}

// LINE: ข้อความ + รูปในก้อนเดียว (Flex) นับเป็น 1 ข้อความต่อโควตา
async function sendLine(token: string, groupId: string, text: string, imageUrl: string | null) {
  const message = imageUrl
    ? {
        type: "flex", altText: text.slice(0, 400),
        contents: {
          type: "bubble",
          hero: { type: "image", url: imageUrl, size: "full", aspectRatio: "4:3", aspectMode: "fit",
                  action: { type: "uri", uri: imageUrl } },
          body: { type: "box", layout: "vertical", contents: [{ type: "text", text, wrap: true, size: "sm" }] },
        },
      }
    : { type: "text", text: text.slice(0, 4900) };
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [message] }),
  });
  if (!r.ok) throw new Error(`line ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

Deno.serve(async (req) => {
  // รับเฉพาะคำขอที่ถือ service_role key (จาก pg_cron หรือหน้าแอดมินผ่านฐานข้อมูล)
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response("forbidden", { status: 403 });
  }

  const { data, error } = await supabase.rpc("notify_claim_pending", { p_limit: 20 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const items = (data || []) as Item[];
  const result = { sent: 0, failed: 0, skipped: 0 };

  for (const it of items) {
    try {
      const token = Deno.env.get(it.secret_name);
      if (!token) throw new Error(`ยังไม่ได้ตั้ง secret ${it.secret_name}`);
      if (!it.target_id) throw new Error("ยังไม่ได้ใส่ไอดีห้องในหน้าแอดมิน");
      // LINE: กันเกินโควตาฟรี (ข้อความสุดท้าย 5% เก็บไว้ให้สรุปรายวัน)
      if (it.provider === "line" && it.monthly_quota && it.used_this_month >= it.monthly_quota - 10 && it.kind !== "stock_daily") {
        await supabase.rpc("notify_mark", { p_id: it.id, p_ok: false, p_error: "QUOTA: โควตา LINE เดือนนี้ใกล้เต็ม ข้ามรายการนี้ (ดูในระบบส่วนขยายแทน)" });
        // ทำเครื่องหมายเป็น "ข้าม" ไม่ลองใหม่
        await supabase.from("notify_queue").update({ status: "ข้าม" }).eq("id", it.id);
        result.skipped++; continue;
      }
      if (it.provider === "telegram") await sendTelegram(token, it.target_id, it.text);
      else await sendLine(token, it.target_id, it.text, it.image_url);
      await supabase.rpc("notify_mark", { p_id: it.id, p_ok: true });
      result.sent++;
    } catch (e) {
      await supabase.rpc("notify_mark", { p_id: it.id, p_ok: false, p_error: String((e as Error).message || e) });
      result.failed++;
    }
  }
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
