// ============================================================
//  Supabase Edge Function: promo-runner — Mix Fresh 168
//  ส่งข้อความโปรลดราคาตามเวลาที่ตั้งไว้ (โปรที่เลือก "ตั้งเวลาส่ง")
//
//  • pg_cron เรียกทุก 5 นาที (ตั้งโดย mix888-promotions.sql)
//  • หาโปรที่ถึงเวลาส่ง (announce_at ≤ ตอนนี้ ยังไม่เคยส่ง และโปรยังไม่หมดเขต)
//  • ส่งข้อความรายร้าน — แต่ละร้านเห็นราคาปกติของตัวเอง เทียบราคาโปร
//  • สรุปผลเข้ากลุ่มไลน์กลาง · ส่วนการแก้/คืนราคาจริง ฝั่งฐานข้อมูลทำเอง (promo_tick)
//
//  วิธีติดตั้ง:
//  1. Edge Functions → Deploy new function → ชื่อ  promo-runner
//     วางโค้ดไฟล์นี้ทั้งไฟล์ → ปิด "Verify JWT" ในตั้งค่าฟังก์ชัน → Deploy
//  2. รันไฟล์ mix888-promotions.sql ใน SQL Editor (สร้างตาราง+ตั้งเวลา)
//
//  ทดสอบ (เปิดใน browser):
//    GET  <URL ฟังก์ชัน>          → ดูว่ามีโปรรอส่งไหม (ไม่ส่งจริง)
//    GET  <URL>?run=1             → ส่งจริงเดี๋ยวนี้ (เฉพาะโปรที่ถึงเวลา)
// ============================================================

const LINE_TOKEN =
  Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ??
  Deno.env.get('LINE_TOKEN') ??
  Deno.env.get('CHANNEL_ACCESS_TOKEN') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const J = (obj: unknown, code = 200) =>
  new Response(JSON.stringify(obj, null, 1), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });

const sbHead = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
async function sbGet(qs: string): Promise<any[]> {
  const r = await fetch(SB_URL + '/rest/v1/' + qs, { headers: sbHead });
  if (!r.ok) throw new Error('db get: ' + (await r.text()));
  return await r.json();
}
async function sbPatch(qs: string, body: unknown) {
  const r = await fetch(SB_URL + '/rest/v1/' + qs, { method: 'PATCH', headers: sbHead, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('db patch: ' + (await r.text()));
}
async function linePush(to: string, text: string) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) throw new Error('LINE ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
const fmtB = (n: number) => '฿' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function buildMsg(p: any, c: any): string {
  const normal = Number(c.normal) || 0;
  const promo = Number(p.promo_price) || 0;
  return (c.tag || '') + '🔥 โปรพิเศษเฉพาะร้านคุณ\n' + (p.product_name || '')
    + '\nจากราคาปกติ ' + fmtB(normal) + ' → เหลือ ' + fmtB(promo) + ' (ลด ' + fmtB(normal - promo) + ')'
    + '\n⏰ ' + (p.win_label || '') + (p.note ? '\n' + p.note : '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = new URL(req.url);
    let doRun = url.searchParams.get('run') === '1';
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body && body.run) doRun = true;
    }
    const nowIso = new Date().toISOString();
    // โปรที่ถึงเวลาส่ง ยังไม่เคยส่ง และยังไม่หมดเขต/ไม่ถูกยกเลิก
    const due = await sbGet('promotions?select=*'
      + '&announce_at=not.is.null&announced_at=is.null'
      + '&announce_at=lte.' + encodeURIComponent(nowIso)
      + '&ends_at=gt.' + encodeURIComponent(nowIso)
      + '&status=in.(scheduled,active)&order=id');
    if (!doRun) {
      return J({ mode: 'dry-run', due: due.map((p) => ({ id: p.id, product: p.product_name, promo: p.promo_price, announce_at: p.announce_at, shops: (p.customers || []).length })) });
    }
    const results: any[] = [];
    let central = '';
    try { const s = await sbGet('settings?key=eq.line_central_group&select=value'); central = s[0]?.value || ''; } catch (_e) { /* ไม่มีก็ข้าม */ }
    for (const p of due) {
      const list = Array.isArray(p.customers) ? p.customers : [];
      let ok = 0, fail = 0;
      const out: any[] = [];
      for (const c of list) {
        if (!c.gid || c.sent === true) { out.push(c); continue; }
        try {
          await linePush(c.gid, buildMsg(p, c));
          out.push({ ...c, sent: true }); ok++;
        } catch (e) {
          out.push({ ...c, sent: false, send_error: String((e as Error).message || e).slice(0, 120) }); fail++;
        }
        await new Promise((x) => setTimeout(x, 120));
      }
      // บันทึกว่า "ส่งรอบนี้แล้ว" เสมอ — กันวนส่งซ้ำทุก 5 นาทีถ้าบางร้านพลาด
      await sbPatch('promotions?id=eq.' + p.id, { announced_at: new Date().toISOString(), customers: out });
      results.push({ id: p.id, product: p.product_name, ok, fail });
      if (central) {
        try {
          await linePush(central,
            '🔥 ส่งโปรตามเวลาที่ตั้งไว้ "' + (p.product_name || '') + '" ' + fmtB(Number(p.promo_price)) + '\n'
            + '⏰ ' + (p.win_label || '') + '\nส่งแล้ว ' + ok + '/' + (ok + fail) + ' ร้าน'
            + (fail ? '\n⚠️ ไม่สำเร็จ ' + fail + ' ร้าน (ดูในหน้าโปรโมชั่น)' : ''));
        } catch (_e) { /* แจ้งกลางพลาด ไม่กระทบการส่งหลัก */ }
      }
    }
    return J({ mode: 'run', announced: results });
  } catch (e) {
    return J({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
