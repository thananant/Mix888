// ============================================================
//  Supabase Edge Function: line-group-name
//  ดึง "ชื่อกลุ่มไลน์" จาก Group ID (LINE API: group summary) แล้วเก็บลงตาราง line_groups
//  ให้หลังบ้านแสดงชื่อกลุ่มแทนรหัส Cxxxx…
//
//  วิธีติดตั้ง (ครั้งเดียว):
//  1. รัน mix888-line-groups.sql ใน SQL Editor (ตาราง line_groups)
//  2. Supabase → Edge Functions → Deploy new function  ชื่อ: line-group-name  วางโค้ดไฟล์นี้ทั้งไฟล์ · ปิด Verify JWT
//     ใช้โทเคน LINE ตัวเดียวกับ line-push (อ่านจาก secret ชื่อใดชื่อหนึ่งด้านล่าง) — ถ้าชื่อ secret ไม่ตรง
//     ฟังก์ชันจะตอบกลับมาว่าลองชื่อไหนไปบ้าง ให้เพิ่ม secret ชื่อ LINE_CHANNEL_ACCESS_TOKEN ค่าเดียวกับของ line-push
//
//  เรียก: POST { ids: ["C…","C…"] }  →  { ok:true, groups:{ "C…":{name,picture_url} }, missing:[…] }
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const TOKEN_NAMES = ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_TOKEN", "LINE_ACCESS_TOKEN", "CHANNEL_ACCESS_TOKEN", "LINE_BOT_TOKEN", "LINE_CHANNEL_TOKEN"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let token = "";
  for (const n of TOKEN_NAMES) { const v = Deno.env.get(n); if (v) { token = v; break; } }
  if (!token) return json({ ok: false, error: "ไม่พบโทเคน LINE ใน secrets — ลองชื่อ: " + TOKEN_NAMES.join(", ") + " · เพิ่ม secret ชื่อ LINE_CHANNEL_ACCESS_TOKEN (ค่าเดียวกับที่ line-push ใช้)" }, 500);
  let ids: string[] = [];
  try { const b = await req.json(); ids = Array.isArray(b.ids) ? b.ids : []; } catch (_) { /* no body */ }
  ids = [...new Set(ids.map((x) => String(x || "").trim()).filter((x) => /^[CR][0-9a-f]{32}$/i.test(x)))].slice(0, 200);
  if (!ids.length) return json({ ok: false, error: "ส่ง ids มาด้วย (รหัสกลุ่ม C…)" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const groups: Record<string, { name: string; picture_url: string | null }> = {};
  const missing: string[] = []; const rows: any[] = [];
  for (const id of ids) {
    try {
      const r = await fetch("https://api.line.me/v2/bot/" + (id[0] === "R" ? "room" : "group") + "/" + id + "/summary", { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) { missing.push(id + " (" + r.status + ")"); rows.push({ group_id: id, name: null, picture_url: null, error: "HTTP " + r.status, updated_at: new Date().toISOString() }); continue; }
      const d = await r.json();
      groups[id] = { name: d.groupName || d.roomName || "", picture_url: d.pictureUrl || null };
      rows.push({ group_id: id, name: groups[id].name, picture_url: groups[id].picture_url, error: null, updated_at: new Date().toISOString() });
    } catch (e) { missing.push(id + " (" + String((e as Error).message || e) + ")"); }
    await new Promise((x) => setTimeout(x, 120));
  }
  if (rows.length) { const { error } = await db.from("line_groups").upsert(rows, { onConflict: "group_id" }); if (error) return json({ ok: false, error: "บันทึกตาราง line_groups ไม่ได้: " + error.message + " (รัน mix888-line-groups.sql หรือยัง?)", groups, missing }, 500); }
  return json({ ok: true, groups, missing });
});
