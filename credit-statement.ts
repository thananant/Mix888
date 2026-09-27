// ============================================================
//  Supabase Edge Function: credit-statement
//  ใบวางบิลอัตโนมัติสำหรับลูกค้าเครดิตแบบ "ตามรอบวางบิล" (customers.credit_schedule)
//  — ถึงวันวางบิล 10:00 น. → วาดใบวางบิลเป็นรูป (รายการบิล / วันที่ / ยอด / จ่ายแล้ว-ยังไม่จ่าย / สรุปยอด)
//    ส่งเข้ากลุ่ม LINE ของร้าน พร้อมแนบรูปบิลที่ยังไม่ชำระ และส่งสำเนาเข้ากลุ่มรีพอร์ต
//  — เลยวันครบกำหนดชำระ 3 วันแล้วยังมีบิลค้าง → ส่งข้อความขอสลิป + แจ้งกลุ่มรีพอร์ต
//
//  วิธีติดตั้ง (ครั้งเดียว):
//  1. รัน mix888-credit-statement.sql ใน SQL Editor (ตาราง credit_statements + ตั้งเวลา cron)
//  2. Supabase → Edge Functions → Deploy new function  ชื่อ: credit-statement  วางโค้ดไฟล์นี้ทั้งไฟล์
//     ไม่ต้องตั้ง secret เพิ่ม — ใช้ line-push ที่มีอยู่แล้วส่ง LINE (โทเคนอยู่ที่นั่น)
//  3. หลังบ้าน → ผู้ใช้ระบบ → ใส่ "LINE Group ID กลุ่มรีพอร์ต"
//  (ทางเลือก) ตั้ง secret STATEMENT_KEY แล้วใส่ ?key=<ค่าเดียวกัน> ใน cron และในหลังบ้าน เพื่อกันคนนอกยิงฟังก์ชัน
//
//  พารามิเตอร์ (เรียกเองจากหลังบ้าน):
//    ?preview=1&customer=<id>&bill=YYYY-MM-DD   → คืนรูป PNG ใบวางบิลงวดนั้น ไม่ส่ง ไม่บันทึก
//    ?force=1&customer=<id>&bill=YYYY-MM-DD     → ส่งใบวางบิลงวดนั้นทันที (ส่งซ้ำได้)
//    ?force=1&kind=reminder&customer=<id>&bill=YYYY-MM-DD → ส่งข้อความทวงสลิปงวดนั้นทันที
//    ?date=YYYY-MM-DD                            → จำลองว่าวันนี้คือวันไหน (ทดสอบ)
//    ไม่มีพารามิเตอร์ = รอบอัตโนมัติ (cron เรียกทุกวัน 10:00)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") || "";
const WASM_URLS = ["https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm","https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm"];
const FONT_URLS = {
  regular: "https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf",
  bold:    "https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Bold.ttf",
};
const REMIND_AFTER_DAYS = 3;   // เลยวันครบกำหนดกี่วันแล้วยังไม่จ่าย → ทวงสลิป
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- render:begin  (ส่วนนี้เป็น JS ล้วน — ทดสอบวาดรูปนอกเซิร์ฟเวอร์ได้)
const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function thDate(iso) {                       // ISO → 'YYYY-MM-DD' ตามเวลาไทย (UTC+7)
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return String(iso).slice(0, 10);
  return new Date(t + 7 * 3600000).toISOString().slice(0, 10);
}
function todayTh() { return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); }
function addDays(ymd, n) { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fdShort(ymd) { if (!ymd) return "-"; const [y, m, d] = ymd.split("-").map(Number); return d + " " + TH_MONTHS[m - 1] + " " + String(y + 543).slice(2); }
function fdLong(ymd)  { if (!ymd) return "-"; const [y, m, d] = ymd.split("-").map(Number); return d + " " + TH_MONTHS_FULL[m - 1] + " " + (y + 543); }
function money(n) { return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function wrap(s, max) {                       // ตัดบรรทัดง่าย ๆ ตามจำนวนตัวอักษร (เว้นวรรคก่อน ถ้าไม่มีก็หั่น)
  const out = []; let cur = "";
  for (const w of String(s || "").split(/\s+/).filter(Boolean)) {
    if (w.length > max) { if (cur) { out.push(cur); cur = ""; } for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max)); continue; }
    if ((cur + " " + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}
// data = {shop:{name,address,phone,taxid}, cust:{code,name,branch,contact,phone,address},
//         period:{from,to,bill,due}, rows:[{bill_no,date,deliver,total,paid,paid_amount}]}
function buildStatementSvg(data) {
  const W = 1240, PAD = 64, RED = "#C62127", INK = "#2E2119", MUT = "#8A7A66", LINE = "#E8DFCC";
  const rows = data.rows || [];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const paid = rows.filter((r) => r.paid).reduce((s, r) => s + Number(r.total || 0), 0);
  const unpaid = total - paid;
  const nUnpaid = rows.filter((r) => !r.paid).length;
  const shopAddr = wrap(data.shop.address, 62), custAddr = wrap(data.cust.address, 58);
  let y = 0; const parts = [];
  const T = (x, yy, txt, o = {}) => parts.push(`<text x="${x}" y="${yy}" font-size="${o.size || 22}" fill="${o.fill || INK}" font-weight="${o.bold ? 700 : 400}" text-anchor="${o.anchor || "start"}">${esc(txt)}</text>`);
  // ---- หัวกระดาษ
  y = 70;
  parts.push(`<rect x="0" y="0" width="${W}" height="14" fill="${RED}"/>`);
  T(PAD, y + 8, data.shop.name || "Mix Fresh 168", { size: 36, bold: true, fill: RED });
  T(W - PAD, y - 2, "ใบวางบิล", { size: 40, bold: true, anchor: "end", fill: INK });
  T(W - PAD, y + 30, "STATEMENT OF ACCOUNT", { size: 16, anchor: "end", fill: MUT });
  y += 44;
  shopAddr.forEach((l) => { T(PAD, y, l, { size: 18, fill: MUT }); y += 26; });
  const contactBits = [data.shop.phone ? "โทร " + data.shop.phone : "", data.shop.taxid ? "เลขผู้เสียภาษี " + data.shop.taxid : ""].filter(Boolean).join("   ");
  if (contactBits) { T(PAD, y, contactBits, { size: 18, fill: MUT }); y += 26; }
  y += 14;
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${LINE}" stroke-width="2"/>`);
  y += 40;
  // ---- ลูกค้า (ซ้าย) + งวด (ขวา)
  const yTop = y;
  T(PAD, y, "ลูกค้า", { size: 16, fill: MUT }); y += 30;
  T(PAD, y, (data.cust.code ? data.cust.code + "  " : "") + (data.cust.name || "") + (data.cust.branch ? " • " + data.cust.branch : ""), { size: 26, bold: true }); y += 32;
  if (data.cust.contact || data.cust.phone) { T(PAD, y, [data.cust.contact, data.cust.phone].filter(Boolean).join("  โทร "), { size: 19 }); y += 28; }
  custAddr.forEach((l) => { T(PAD, y, l, { size: 19, fill: MUT }); y += 27; });
  const yLeftEnd = y;
  // กล่องงวด
  const bx = W - PAD - 420, bw = 420, bh = 170;
  parts.push(`<rect x="${bx}" y="${yTop - 22}" width="${bw}" height="${bh}" rx="14" fill="#FAF5F1" stroke="${LINE}"/>`);
  let by = yTop + 12;
  const KV = (k, v, bold) => { T(bx + 20, by, k, { size: 17, fill: MUT }); T(bx + bw - 20, by, v, { size: bold ? 22 : 20, bold: !!bold, anchor: "end" }); by += 36; };
  KV("รอบยอด", fdShort(data.period.from) + " – " + fdShort(data.period.to));
  KV("วันที่วางบิล", fdLong(data.period.bill));
  KV("ครบกำหนดชำระ", fdLong(data.period.due), true);
  KV("จำนวนบิล", rows.length + " ใบ" + (nUnpaid ? " (ค้าง " + nUnpaid + ")" : ""));
  y = Math.max(yLeftEnd, yTop - 22 + bh) + 40;
  // ---- ตาราง
  const cols = [{ x: PAD, w: 60, t: "#", a: "start" }, { x: PAD + 60, w: 250, t: "เลขที่บิล", a: "start" }, { x: PAD + 310, w: 200, t: "วันที่บิล", a: "start" },
                { x: PAD + 510, w: 200, t: "วันที่ส่ง", a: "start" }, { x: PAD + 710, w: 220, t: "จำนวนเงิน", a: "end" }, { x: PAD + 930, w: 182, t: "สถานะ", a: "end" }];
  parts.push(`<rect x="${PAD}" y="${y - 30}" width="${W - PAD * 2}" height="44" rx="8" fill="${RED}"/>`);
  cols.forEach((c) => T(c.a === "end" ? c.x + c.w : c.x + 14, y, c.t, { size: 18, bold: true, fill: "#fff", anchor: c.a }));
  y += 40;
  if (!rows.length) { T(W / 2, y + 10, "ไม่มีบิลในรอบนี้", { size: 20, fill: MUT, anchor: "middle" }); y += 40; }
  rows.forEach((r, i) => {
    if (i % 2 === 1) parts.push(`<rect x="${PAD}" y="${y - 28}" width="${W - PAD * 2}" height="42" fill="#FBF8F3"/>`);
    T(cols[0].x + 14, y, String(i + 1), { size: 19, fill: MUT });
    T(cols[1].x + 14, y, r.bill_no || "-", { size: 20, bold: true });
    T(cols[2].x + 14, y, fdShort(r.date), { size: 19 });
    T(cols[3].x + 14, y, r.deliver ? fdShort(r.deliver) : "-", { size: 19, fill: r.deliver ? INK : MUT });
    T(cols[4].x + cols[4].w, y, money(r.total), { size: 20, anchor: "end" });
    const st = r.paid ? "จ่ายแล้ว" : "ยังไม่จ่าย";
    const sw = r.paid ? 118 : 138, sx = cols[5].x + cols[5].w - sw;
    parts.push(`<rect x="${sx}" y="${y - 22}" width="${sw}" height="30" rx="15" fill="${r.paid ? "#E8F6EF" : "#FDECEC"}"/>`);
    T(sx + sw / 2, y, st, { size: 17, bold: true, fill: r.paid ? "#1F7A43" : RED, anchor: "middle" });
    y += 42;
  });
  parts.push(`<line x1="${PAD}" y1="${y - 20}" x2="${W - PAD}" y2="${y - 20}" stroke="${LINE}" stroke-width="2"/>`);
  y += 20;
  // ---- สรุปยอด
  const sx0 = W - PAD - 480;
  const SUM = (k, v, big, color) => { T(sx0, y, k, { size: big ? 22 : 19, fill: big ? INK : MUT, bold: !!big }); T(W - PAD, y, money(v), { size: big ? 34 : 22, bold: !!big, anchor: "end", fill: color || INK }); y += big ? 50 : 36; };
  SUM("ยอดรวมทั้งรอบ", total);
  SUM("ชำระแล้ว", paid, false, "#1F7A43");
  parts.push(`<rect x="${sx0 - 24}" y="${y - 6}" width="${W - PAD - sx0 + 24}" height="66" rx="12" fill="#FDECEC"/>`);
  y += 40; SUM("ยอดค้างชำระ", unpaid, true, RED);
  y += 16;
  // ---- ท้าย
  const notes = unpaid > 0
    ? ["กรุณาชำระยอดค้าง " + money(unpaid) + " บาท ภายในวันที่ " + fdLong(data.period.due), "บิลที่ยังไม่ชำระแนบมาพร้อมข้อความนี้ · ชำระแล้วรบกวนส่งสลิปในกลุ่มนี้ด้วยค่ะ"]
    : ["ยอดในรอบนี้ชำระครบแล้ว ขอบคุณที่ใช้บริการค่ะ"];
  parts.push(`<rect x="${PAD}" y="${y - 8}" width="${W - PAD * 2}" height="${notes.length * 30 + 28}" rx="12" fill="#FAF5F1"/>`);
  y += 24; notes.forEach((n) => { T(PAD + 20, y, n, { size: 19 }); y += 30; });
  y += 30;
  T(PAD, y, "ออกเมื่อ " + fdLong(data.issued || data.period.bill) + " · เอกสารนี้สร้างโดยระบบอัตโนมัติ", { size: 15, fill: MUT });
  T(W - PAD, y, data.shop.name || "", { size: 15, fill: MUT, anchor: "end" });
  const H = y + 50;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Sarabun"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join("")}</svg>`, total, paid, unpaid, nUnpaid };
}
// ---- render:end

let wasmReady: Promise<void> | null = null;
let fontCache: Uint8Array[] | null = null;
async function fetchBytes(url: string) { const r = await fetch(url); if (!r.ok) throw new Error("โหลดไม่ได้ " + url + " (" + r.status + ")"); return new Uint8Array(await r.arrayBuffer()); }
async function ensureRenderer() {
  if (!wasmReady) wasmReady = (async () => {
    let last: unknown = null;
    for (const u of WASM_URLS) { try { await initWasm(fetch(u)); return; } catch (e) { last = e; } }
    throw new Error("โหลด resvg wasm ไม่ได้: " + String(last));
  })();
  await wasmReady;
  if (!fontCache) fontCache = [await fetchBytes(FONT_URLS.regular), await fetchBytes(FONT_URLS.bold)];
}
async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureRenderer();
  const r = new Resvg(svg, { fitTo: { mode: "width", value: 1240 }, font: { fontBuffers: fontCache!, defaultFontFamily: "Sarabun", loadSystemFonts: false }, background: "#ffffff" });
  return r.render().asPng();
}

// ---- LINE ผ่านฟังก์ชัน line-push ที่มีอยู่แล้ว (ส่งได้สูงสุด 5 ข้อความ/ครั้ง)
async function linePush(to: string, messages: unknown[]) {
  if (!to) return { ok: false, err: "ไม่มีกลุ่มไลน์" };
  for (let i = 0; i < messages.length; i += 5) {
    const r = await fetch(SUPABASE_URL + "/functions/v1/line-push", { method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
      body: JSON.stringify({ to, messages: messages.slice(i, i + 5) }) });
    let d: any = null; try { d = await r.json(); } catch (_) { /* ignore */ }
    if (!r.ok || !d || d.status !== 200) return { ok: false, err: (d && (d.error || d.message)) || ("line-push HTTP " + r.status) };
    if (i + 5 < messages.length) await new Promise((x) => setTimeout(x, 300));
  }
  return { ok: true };
}
const imgMsg = (url: string) => ({ type: "image", originalContentUrl: url, previewImageUrl: url });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const q = new URL(req.url).searchParams;
  const gate = Deno.env.get("STATEMENT_KEY");
  if (gate && q.get("key") !== gate && req.headers.get("x-statement-key") !== gate) return json({ error: "key ไม่ถูกต้อง" }, 401);
  const preview = q.get("preview") === "1", force = q.get("force") === "1";
  const onlyCust = Number(q.get("customer")) || null, onlyBill = q.get("bill") || null, kindParam = q.get("kind") || "";
  const today = q.get("date") || todayTh();
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const out: any = { date: today, statements: [], reminders: [], errors: [] };
  try {
    const { data: stRows } = await db.from("settings").select("key,value");
    const S: Record<string, string> = {}; (stRows || []).forEach((r: any) => S[r.key] = r.value);
    const shop = { name: S.shop_name || "Mix Fresh 168", address: S.shop_address || "", phone: S.shop_phone || "", taxid: S.shop_taxid || "" };
    const reportGid = S.line_report_group || "";
    let cq = db.from("customers").select("id,code,name,branch_name,contact_name,phone,billing_address,line_group_id,credit_mode,credit_schedule,active,sale_name").eq("pay_type", "credit").eq("credit_mode", "schedule");
    if (onlyCust) cq = cq.eq("id", onlyCust);
    const { data: custs, error: ce } = await cq;
    if (ce) throw new Error("อ่านลูกค้าไม่ได้: " + ce.message);
    const { data: sentRows } = await db.from("credit_statements").select("customer_id,bill_date,kind,line_ok");
    const already = new Set((sentRows || []).filter((r: any) => r.line_ok).map((r: any) => r.customer_id + "|" + r.bill_date + "|" + r.kind));

    for (const c of (custs || [])) {
      if (c.active === false && !force) continue;
      const sched = Array.isArray(c.credit_schedule) ? c.credit_schedule : [];
      for (const p of sched) {
        if (!p || !p.from || !p.to || !p.bill || !p.due) continue;
        if (onlyBill && p.bill !== onlyBill) continue;
        const wantStatement = force ? (kindParam !== "reminder" && !!onlyBill) : (p.bill === today && !already.has(c.id + "|" + p.bill + "|statement"));
        const wantReminder  = force ? (kindParam === "reminder" && !!onlyBill) : (addDays(p.due, REMIND_AFTER_DAYS) === today && !already.has(c.id + "|" + p.bill + "|reminder"));
        if (!wantStatement && !wantReminder && !preview) continue;
        if (preview && p.bill !== onlyBill) continue;
        // บิลในรอบ (เวลาไทย) — ไม่รวมบิลยกเลิก
        const { data: bills, error: be } = await db.from("bills")
          .select("id,bill_no,total,created_at,payment_status,paid_amount,ship_status,image_url,page_urls,orders(deliver_date)")
          .eq("customer_id", c.id).gte("created_at", p.from + "T00:00:00+07:00").lte("created_at", p.to + "T23:59:59.999+07:00").order("created_at");
        if (be) { out.errors.push(c.code + ": " + be.message); continue; }
        const live = (bills || []).filter((b: any) => (b.ship_status || "pending") !== "cancelled");
        const rows = live.map((b: any) => ({ bill_no: b.bill_no, date: thDate(b.created_at), deliver: b.orders && b.orders.deliver_date ? String(b.orders.deliver_date).slice(0, 10) : "", total: Number(b.total) || 0, paid: b.payment_status === "paid", paid_amount: Number(b.paid_amount) || 0, images: (Array.isArray(b.page_urls) && b.page_urls.length) ? b.page_urls : (b.image_url ? [b.image_url] : []) }));
        const custInfo = { code: c.code, name: c.name, branch: c.branch_name, contact: c.contact_name, phone: c.phone, address: c.billing_address };
        const built = buildStatementSvg({ shop, cust: custInfo, period: p, rows, issued: today });
        const label = c.code + " " + c.name + (c.branch_name ? " • " + c.branch_name : "");

        if (preview) { const png = await svgToPng(built.svg); return new Response(png, { headers: { ...CORS, "Content-Type": "image/png" } }); }

        if (wantStatement) {
          const rec: any = { customer_id: c.id, kind: "statement", period_from: p.from, period_to: p.to, bill_date: p.bill, due_date: p.due, bills: rows.length, total: built.total, paid: built.paid, unpaid: built.unpaid, line_ok: false, report_ok: false, error: null, image_url: null };
          try {
            const png = await svgToPng(built.svg);
            const path = "statements/" + c.code + "_" + p.bill + "_" + Date.now() + ".png";
            const { error: ue } = await db.storage.from("bills").upload(path, png, { contentType: "image/png", upsert: true });
            if (ue) throw new Error("อัปโหลดรูปไม่ได้: " + ue.message);
            rec.image_url = db.storage.from("bills").getPublicUrl(path).data.publicUrl;
            const intro = "📄 ใบวางบิล " + shop.name + "\nร้าน " + label + "\nรอบยอด " + fdShort(p.from) + " – " + fdShort(p.to)
              + "\nบิลทั้งหมด " + rows.length + " ใบ · ยอดรวม " + money(built.total) + " บาท"
              + "\nชำระแล้ว " + money(built.paid) + " · ยอดค้าง " + money(built.unpaid) + " บาท"
              + "\n📅 ครบกำหนดชำระ " + fdLong(p.due)
              + (built.nUnpaid ? "\n\nแนบบิลที่ยังไม่ชำระ " + built.nUnpaid + " ใบ ด้านล่างค่ะ 🙏" : "\n\nยอดรอบนี้ชำระครบแล้ว ขอบคุณค่ะ 🙏");
            const msgs: unknown[] = [{ type: "text", text: intro }, imgMsg(rec.image_url)];
            rows.filter((r: any) => !r.paid).forEach((r: any) => r.images.forEach((u: string) => msgs.push(imgMsg(u))));
            const r1 = await linePush(c.line_group_id, msgs);
            rec.line_ok = r1.ok; if (!r1.ok) rec.error = r1.err;
            if (reportGid) {
              const r2 = await linePush(reportGid, [{ type: "text", text: "📤 ส่งใบวางบิลแล้ว" + (r1.ok ? " ✅" : " ❌ (" + r1.err + ")") + "\nร้าน " + label + (c.sale_name ? " · เซลล์ " + c.sale_name : "") + "\nรอบ " + fdShort(p.from) + " – " + fdShort(p.to) + " · " + rows.length + " บิล\nยอดรวม " + money(built.total) + " · ค้าง " + money(built.unpaid) + " บาท\nครบกำหนด " + fdLong(p.due) }, imgMsg(rec.image_url)]);
              rec.report_ok = r2.ok;
            }
          } catch (e) { rec.error = String((e as Error).message || e); }
          await db.from("credit_statements").insert(rec);
          out.statements.push({ customer: label, bill: p.bill, ok: rec.line_ok, report: rec.report_ok, unpaid: rec.unpaid, error: rec.error });
        }

        if (wantReminder) {
          const unpaidRows = rows.filter((r: any) => !r.paid);
          const rec: any = { customer_id: c.id, kind: "reminder", period_from: p.from, period_to: p.to, bill_date: p.bill, due_date: p.due, bills: unpaidRows.length, total: built.total, paid: built.paid, unpaid: built.unpaid, line_ok: false, report_ok: false, error: null };
          if (!unpaidRows.length) { rec.line_ok = true; rec.error = "ชำระครบแล้ว ไม่ต้องทวง"; }
          else {
            const txt = "สวัสดีค่ะ ร้าน " + (c.name || "") + " 🙏\nรอบยอด " + fdShort(p.from) + " – " + fdShort(p.to) + " ครบกำหนดชำระ " + fdLong(p.due) + " แล้ว\nยังมีบิลค้างชำระ " + unpaidRows.length + " ใบ รวม " + money(built.unpaid) + " บาท\n"
              + unpaidRows.map((r: any) => "• " + r.bill_no + " (" + fdShort(r.date) + ") " + money(r.total)).join("\n")
              + "\n\nรบกวนขอสลิปการโอนเงินด้วยค่ะ หากชำระสินค้าเข้ามาแล้ว ขอบคุณค่ะ 🙏";
            const r1 = await linePush(c.line_group_id, [{ type: "text", text: txt }]);
            rec.line_ok = r1.ok; if (!r1.ok) rec.error = r1.err;
            if (reportGid) { const r2 = await linePush(reportGid, [{ type: "text", text: "⏰ ทวงสลิป" + (r1.ok ? " ✅" : " ❌ (" + r1.err + ")") + "\nร้าน " + label + (c.sale_name ? " · เซลล์ " + c.sale_name : "") + "\nเลยกำหนด " + fdLong(p.due) + " มา " + REMIND_AFTER_DAYS + " วัน\nค้าง " + unpaidRows.length + " บิล รวม " + money(built.unpaid) + " บาท" }]); rec.report_ok = r2.ok; }
          }
          await db.from("credit_statements").insert(rec);
          out.reminders.push({ customer: label, bill: p.bill, ok: rec.line_ok, unpaid: rec.unpaid, note: rec.error });
        }
      }
    }
    if (preview) return json({ error: "ไม่พบงวด — ระบุ ?preview=1&customer=<id>&bill=YYYY-MM-DD ให้ตรงกับตารางรอบวางบิล" }, 404);
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error).message || e), ...out }, 500);
  }
});
