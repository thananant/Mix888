// ============================================================
//  Supabase Edge Function: promo-runner — Mix Fresh 168
//  ส่งข้อความโปรลดราคาตามเวลาที่ตั้งไว้ (โปรที่เลือก "ตั้งเวลาส่ง")
//
//  • pg_cron เรียกทุก 5 นาที (ตั้งโดย mix888-promotions.sql)
//  • หาโปรที่ถึงเวลาส่ง (announce_at ≤ ตอนนี้ ยังไม่เคยส่ง และโปรยังไม่หมดเขต)
//  • โปรหลายสินค้า (แถวที่ batch_id เดียวกัน) → ร้านละ 1 ข้อความ รวมทุกสินค้าที่ร้านนั้นได้โปร
//  • แนบรูป/วิดีโอถ้าโปรมี (media_url / media_type / media_preview_url)
//  • แต่ละร้านเห็นราคาปกติของตัวเอง เทียบราคาโปร · สรุปผลเข้ากลุ่มไลน์กลาง
//  • ⛔ ไม่แตะราคาใด ๆ ทั้งสิ้น — แจ้งข่าวอย่างเดียว
//
//  วิธีติดตั้ง:
//  1. Edge Functions → promo-runner → วางโค้ดไฟล์นี้ทั้งไฟล์ทับของเดิม → ปิด "Verify JWT" → Deploy
//  2. รันไฟล์ mix888-promotions.sql เวอร์ชันล่าสุดใน SQL Editor (เพิ่มคอลัมน์ batch_id / media_*)
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
async function linePush(to: string, messages: any[]) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
  });
  if (!r.ok) throw new Error('LINE ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
const fmtB = (n: number) => '฿' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

type Line = { name: string; normal: number; promo: number };
/** ข้อความของร้าน: เห็นเฉพาะสินค้าที่ตัวเองได้โปร ราคาปกติของตัวเอง */
function buildMsg(tag: string, lines: Line[], win: string, note: string): string {
  const multi = lines.length > 1;
  const body = lines.map((l) => (multi ? '• ' : '') + l.name + '\n' + (multi ? '   ' : '')
    + 'จากราคาปกติ ' + fmtB(l.normal) + ' → เหลือ ' + fmtB(l.promo) + ' (ลด ' + fmtB(l.normal - l.promo) + ')').join('\n');
  return (tag || '') + '🔥 โปรพิเศษเฉพาะร้านคุณ' + (multi ? ' ' + lines.length + ' รายการ' : '') + '\n' + body
    + '\n⏰ ' + (win || '') + (note ? '\n' + note : '');
}
function mediaMsg(p: any): any | null {
  if (!p || !p.media_url) return null;
  if (p.media_type === 'video') return { type: 'video', originalContentUrl: p.media_url, previewImageUrl: p.media_preview_url || p.media_url };
  return { type: 'image', originalContentUrl: p.media_url, previewImageUrl: p.media_preview_url || p.media_url };
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
    // จับกลุ่มเป็นชุด (โปรหลายสินค้า) — แถวเดี่ยวเป็นชุดของตัวเอง
    const batches: Record<string, any[]> = {};
    for (const p of due) { const k = p.batch_id || ('single-' + p.id); (batches[k] = batches[k] || []).push(p); }
    if (!doRun) {
      return J({ mode: 'dry-run', due: Object.entries(batches).map(([k, rows]) => ({
        batch: k, products: rows.map((p) => ({ id: p.id, product: p.product_name, promo: p.promo_price })),
        announce_at: rows[0].announce_at, media: rows[0].media_type || null,
        shops: new Set(rows.flatMap((p) => (p.customers || []).map((c: any) => c.customer_id))).size })) });
    }
    const results: any[] = [];
    let central = '';
    try { const s = await sbGet('settings?key=eq.line_central_group&select=value'); central = s[0]?.value || ''; } catch (_e) { /* ไม่มีก็ข้าม */ }

    for (const [key, rows] of Object.entries(batches)) {
      const first = rows[0];
      const media = mediaMsg(first);
      // รวมร้าน: ร้านเดียวอาจได้โปรหลายสินค้าในชุดนี้ → ส่งฉบับเดียว
      type Shop = { gid: string; tag: string; lines: Line[]; refs: { row: any; idx: number }[]; sent: boolean | null };
      const shops: Record<string, Shop> = {};
      for (const p of rows) {
        const list: any[] = Array.isArray(p.customers) ? p.customers : [];
        list.forEach((c, idx) => {
          if (!c.gid) return;
          const k = String(c.customer_id ?? c.gid);
          const s = (shops[k] = shops[k] || { gid: c.gid, tag: c.tag || '', lines: [], refs: [], sent: null });
          if (c.sent === true) { s.sent = true; return; }   // ร้านนี้เคยได้รับชุดนี้แล้ว (เช่นส่งทันทีไปบางส่วน) — ไม่ส่งซ้ำ
          s.lines.push({ name: p.product_name || '', normal: Number(c.normal) || 0, promo: Number(p.promo_price) || 0 });
          s.refs.push({ row: p, idx });
        });
      }
      let ok = 0, fail = 0;
      for (const s of Object.values(shops)) {
        if (s.sent === true || !s.lines.length) continue;
        const messages: any[] = [{ type: 'text', text: buildMsg(s.tag, s.lines, first.win_label || '', first.note || '').slice(0, 4900) }];
        if (media) messages.push(media);
        let sentOk = false, err = '';
        try { await linePush(s.gid, messages); sentOk = true; ok++; }
        catch (e) { err = String((e as Error).message || e).slice(0, 120); fail++; }
        for (const ref of s.refs) {
          const c = ref.row.customers[ref.idx];
          ref.row.customers[ref.idx] = sentOk ? { ...c, sent: true } : { ...c, sent: false, send_error: err };
        }
        await new Promise((x) => setTimeout(x, 120));
      }
      // บันทึกว่า "ส่งรอบนี้แล้ว" ทุกแถวในชุด — กันวนส่งซ้ำทุก 5 นาทีถ้าบางร้านพลาด
      for (const p of rows) {
        await sbPatch('promotions?id=eq.' + p.id, { announced_at: new Date().toISOString(), customers: p.customers || [] });
      }
      results.push({ batch: key, products: rows.map((p) => p.product_name), ok, fail });
      if (central) {
        try {
          const prodLbl = rows.map((p) => '"' + (p.product_name || '') + '" ' + fmtB(Number(p.promo_price))).join(', ');
          await linePush(central, [{ type: 'text', text:
            '🔥 ส่งโปรตามเวลาที่ตั้งไว้' + (rows.length > 1 ? ' (' + rows.length + ' สินค้า)' : '') + ': ' + prodLbl + '\n'
            + '⏰ ' + (first.win_label || '') + (media ? '\n' + (first.media_type === 'video' ? '🎬 แนบวิดีโอ' : '🖼️ แนบรูป') : '')
            + '\nส่งแล้ว ' + ok + '/' + (ok + fail) + ' ร้าน'
            + (fail ? '\n⚠️ ไม่สำเร็จ ' + fail + ' ร้าน (ดูในหน้าโปรโมชั่น)' : '') }]);
        } catch (_e) { /* แจ้งกลางพลาด ไม่กระทบการส่งหลัก */ }
      }
    }
    return J({ mode: 'run', announced: results });
  } catch (e) {
    return J({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
