// ============================================================
//  Supabase Edge Function: slipok-verify
//  ตรวจสลิปโอนเงินกับ SlipOK (slipok.com) ก่อนรับยอดในหลังบ้าน
//  — เก็บ API key ไว้ฝั่งเซิร์ฟเวอร์ ไม่หลุดไปหน้าเว็บ
//
//  วิธีติดตั้ง (ครั้งเดียว):
//  1. สมัคร/เข้าบัญชี slipok.com → สร้างสาขา (Branch) → จะได้
//     Branch ID (เลขท้าย URL API) และ API Key
//  2. Supabase (โปรเจกต์ Mix Fresh) → Edge Functions → Deploy new function
//     ชื่อฟังก์ชัน:  slipok-verify   แล้ววางโค้ดไฟล์นี้ทั้งไฟล์
//  3. ตั้ง Secrets (Edge Functions → Manage secrets):
//       SLIPOK_BRANCH_ID = <เลขสาขาจาก SlipOK>
//       SLIPOK_API_KEY   = <API Key จาก SlipOK>
//  4. Deploy — เสร็จ หลังบ้านจะเริ่มตรวจสลิปอัตโนมัติตอนกดรับยอด
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), { headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { data, amount } = await req.json(); // data = ข้อความ QR ที่อ่านได้จากสลิป
    const branch = Deno.env.get("SLIPOK_BRANCH_ID");
    const key = Deno.env.get("SLIPOK_API_KEY");
    if (!branch || !key) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า SLIPOK_BRANCH_ID / SLIPOK_API_KEY ใน Secrets" });
    if (!data) return json({ ok: false, error: "ไม่มีข้อมูล QR จากสลิป" });

    const body: Record<string, unknown> = { data, log: true };
    if (amount) body.amount = amount;

    const r = await fetch("https://api.slipok.com/api/line/apikey/" + branch, {
      method: "POST",
      headers: { "x-authorization": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j || !j.success) {
      const msg = (j && (j.message || j.msg)) || ("SlipOK ตอบสถานะ " + r.status);
      return json({ ok: false, error: String(msg), code: j && j.code });
    }
    const d = j.data || {};
    return json({
      ok: true,
      amount: d.amount ?? null,
      transRef: d.transRef ?? null,
      transDate: d.transDate ?? null,
      transTime: d.transTime ?? null,
      sender: (d.sender && (d.sender.displayName || d.sender.name)) || null,
      receiver: (d.receiver && (d.receiver.displayName || d.receiver.name)) || null,
      sendingBank: d.sendingBank ?? null,
      receivingBank: d.receivingBank ?? null,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
