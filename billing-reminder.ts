// ============================================================
//  Supabase Edge Function: billing-reminder — Mix Fresh 168
//  แจ้งยอดบิลค้างชำระเข้ากลุ่มไลน์ลูกค้า เดือนละ 2 รอบ เวลา 18:30
//
//  • วันที่ 16              → รอบ "สิ้นเดือนก่อน 18:01 → วันที่ 15 เวลา 18:00"
//  • วันสุดท้ายของเดือน     → รอบ "วันที่ 15 18:01 → สิ้นเดือน เวลา 18:00"
//  • แนบบิลค้างยกมาจากรอบก่อนด้วย (ข้อความแจ้ง "ยอดค้างทั้งหมด")
//  • กันส่งซ้ำรอบเดิมผ่าน settings.billing_reminder_last
//  • สรุปผลการส่งเข้ากลุ่มกลาง (line_central_group)
//
//  วิธีติดตั้ง:
//  1. Edge Functions → Deploy new function → ชื่อ billing-reminder
//     วางโค้ดไฟล์นี้ทั้งไฟล์ → ปิด "Verify JWT" ในตั้งค่าฟังก์ชัน → Deploy
//  2. รันไฟล์ mix888-billing-cron.sql ใน SQL Editor (ตั้งเวลาเรียกทุกวัน 18:30
//     ตัวฟังก์ชันจะเช็คเองว่าวันนี้เป็นวันแจ้งหรือไม่)
//
//  ทดสอบ (เปิดใน browser):
//    GET  <URL ฟังก์ชัน>                    → ดูสถานะ/รอบของวันนี้ (ไม่ส่งจริง)
//    GET  <URL>?force=first                → ดูตัวอย่างรอบวันที่ 16 (ไม่ส่งจริง)
//    GET  <URL>?force=first&send=1&only=SKG00198
//         → ทดสอบส่งจริง "เฉพาะร้านเดียว" (ใส่รหัสร้านที่ต้องการ) ข้อความขึ้นหัวว่า
//           🧪 ทดสอบระบบ และไม่นับว่ารอบนี้ส่งแล้ว — รอบจริงตามเวลายังทำงานปกติ
//    GET  <URL>?force=first&send=1         → บังคับส่งจริงทุกกลุ่มเดี๋ยวนี้
//    (force=second = รอบสิ้นเดือน · เพิ่ม &resend=1 ถ้าจะส่งซ้ำรอบที่เคยส่งแล้ว)
//
//  ส่งย้อนหลังแบบเลือกช่วงวันเอง (ไม่กระทบรอบอัตโนมัติ):
//    GET  <URL>?from=2026-07-01&to=2026-07-31            → ดูตัวอย่าง (ไม่ส่ง)
//    GET  <URL>?from=2026-07-01&to=2026-07-31&send=1&only=SKG00198 → ทดสอบร้านเดียว
//    GET  <URL>?from=2026-07-01&to=2026-07-31&send=1     → ส่งจริงทุกกลุ่ม
//    นับบิลที่ออกในช่วงวันดังกล่าว (เวลาไทย ทั้งวัน) ที่ยังค้างจ่ายอยู่ตอนนี้
//    บิลค้างที่เก่ากว่าช่วง จะแนบเป็น "ค้างยกมาจากรอบก่อน" เหมือนรอบปกติ
// ============================================================

const LINE_TOKEN =
  Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ??
  Deno.env.get('LINE_TOKEN') ??
  Deno.env.get('CHANNEL_ACCESS_TOKEN') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const EPS = 0.01;
const CLOSING = 'ยอดบิลค้างจ่ายทั้งหมดนะคะ ถ้าชำระแล้ว รบกวนแจ้งสลิปด้วย 🙏';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const J = (obj: unknown, code = 200) =>
  new Response(JSON.stringify(obj, null, 1), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });

const sbHead = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function sbGet(qs: string): Promise<any[]> {
  const r = await fetch(SB_URL + '/rest/v1/' + qs, { headers: sbHead });
  if (!r.ok) throw new Error('db get: ' + (await r.text()));
  return await r.json();
}
async function sbUpsertSetting(key: string, value: string) {
  const exist = await sbGet('settings?key=eq.' + key + '&select=key');
  const method = exist.length ? 'PATCH' : 'POST';
  const url = SB_URL + '/rest/v1/settings' + (exist.length ? '?key=eq.' + key : '');
  const body = exist.length ? { value } : { key, value };
  const r = await fetch(url, { method, headers: sbHead, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('db setting: ' + (await r.text()));
}
async function linePush(to: string, text: string) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) throw new Error('LINE ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

// ---------- เวลาไทย + รอบตัด ----------
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDateLabel(ms: number): string {
  const d = new Date(ms + 7 * 3600e3);
  return d.getUTCDate() + ' ' + THAI_MONTHS[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543);
}
const fmtB = (n: number) => '฿' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/\.00$/, '');
const outOf = (b: any) => Number(b.total) - Number(b.paid_amount || 0);

/** คืนรอบตัดของ "วันนี้" (เวลาไทย) — หรือ null ถ้าวันนี้ไม่ใช่วันแจ้ง */
function cycleFor(force: string | null) {
  const t = new Date(Date.now() + 7 * 3600e3);
  const y = t.getUTCFullYear(), mo = t.getUTCMonth(), d = t.getUTCDate();
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let which: 'first' | 'second' | null = null;
  if (force === 'first' || (!force && d === 16)) which = 'first';
  else if (force === 'second' || (!force && d === lastDay)) which = 'second';
  if (!which) return null;
  // 18:00 ไทย = 11:00 UTC — ช่วงรอบคือ (start, end]  (18:01 → 18:00)
  const start = which === 'first' ? Date.UTC(y, mo, 0, 11, 0, 0) : Date.UTC(y, mo, 15, 11, 0, 0);
  const end   = which === 'first' ? Date.UTC(y, mo, 15, 11, 0, 0) : Date.UTC(y, mo, lastDay, 11, 0, 0);
  return { which, start, end, key: 'br-' + which + '-' + y + '-' + String(mo + 1).padStart(2, '0'),
    label: 'ตัดยอด ' + thaiDateLabel(end) + ' เวลา 18:00 น.' };
}

/** รอบแบบเลือกช่วงวันเอง เช่น from=2026-07-01 to=2026-07-31 (เวลาไทย ทั้งวัน) */
function cycleCustom(fromStr: string, toStr: string) {
  const p = (s: string) => {
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
  };
  const f = p(fromStr), t = p(toStr);
  if (!f || !t) return { error: 'รูปแบบวันที่ไม่ถูกต้อง — ใช้ from=YYYY-MM-DD&to=YYYY-MM-DD เช่น from=2026-07-01&to=2026-07-31' };
  const start = Date.UTC(f.y, f.mo, f.d, 0, 0, 0) - 7 * 3600e3 - 1;          // เที่ยงคืนไทยของวันแรก (ขอบเปิด)
  const end   = Date.UTC(t.y, t.mo, t.d, 23, 59, 59, 999) - 7 * 3600e3;      // สิ้นวันไทยของวันสุดท้าย
  if (end <= start) return { error: 'ช่วงวันไม่ถูกต้อง (from ต้องไม่เกิน to)' };
  return { which: 'custom' as const, start, end, key: 'br-custom-' + fromStr + '-' + toStr,
    label: 'บิลช่วง ' + thaiDateLabel(start + 1) + ' – ' + thaiDateLabel(end) };
}

// ---------- รวบรวมบิลค้าง ----------
async function collect(cycle: { start: number; end: number }) {
  const rows = await sbGet(
    'bills?select=id,bill_no,total,paid_amount,payment_status,ship_status,created_at,' +
    'customers!inner(code,name,branch_name,line_group_id,hide_prices)' +
    '&payment_status=neq.paid' +
    '&created_at=lte.' + encodeURIComponent(new Date(cycle.end).toISOString()) +
    '&order=created_at.asc&limit=5000');
  const due = rows.filter((b: any) =>
    b.ship_status !== 'cancelled' && outOf(b) > EPS);
  // จัดกลุ่มตามกลุ่มไลน์ → ตามร้าน
  const byGid: Record<string, Record<string, { c: any; inCycle: any[]; older: any[] }>> = {};
  const noLine: any[] = [];
  const hidden: any[] = [];
  for (const b of due) {
    const c = b.customers;
    if (c?.hide_prices) { hidden.push(b); continue; }   // ร้านปิดราคา — ห้ามส่งยอดเงินเข้ากลุ่ม
    if (!c?.line_group_id) { noLine.push(b); continue; }
    const shop = ((byGid[c.line_group_id] ??= {})[c.code] ??= { c, inCycle: [], older: [] });
    if (new Date(b.created_at).getTime() > cycle.start) shop.inCycle.push(b);
    else shop.older.push(b);
  }
  return { byGid, noLine, hidden };
}

function buildShopMessage(s: { c: any; inCycle: any[]; older: any[] }, label: string): { text: string; total: number; count: number } {
  const line = (b: any) => {
    const paid = Number(b.paid_amount || 0);
    return '• ' + b.bill_no + ' ค้าง ' + fmtB(outOf(b)) + (paid > EPS ? ' (จ่ายบางส่วนแล้ว ' + fmtB(paid) + ')' : '');
  };
  const cap = 15;
  const all = [...s.inCycle, ...s.older];
  const sum = all.reduce((t, b) => t + outOf(b), 0);
  let text = '📋 แจ้งยอดบิลค้างชำระ (' + label + ')\n'
    + '【' + s.c.code + ' ' + (s.c.name || '') + (s.c.branch_name ? ' • ' + s.c.branch_name : '') + '】';
  if (s.inCycle.length) text += '\n' + s.inCycle.slice(0, cap).map(line).join('\n')
    + (s.inCycle.length > cap ? '\n…อีก ' + (s.inCycle.length - cap) + ' ใบ' : '');
  if (s.older.length) text += '\nค้างยกมาจากรอบก่อน:\n' + s.older.slice(0, cap).map(line).join('\n')
    + (s.older.length > cap ? '\n…อีก ' + (s.older.length - cap) + ' ใบ' : '');
  text += '\nรวม ' + all.length + ' บิล ค้าง ' + fmtB(sum) + '\n\n' + CLOSING;
  return { text, total: sum, count: all.length };
}

async function centralNotify(text: string) {
  try {
    const st = await sbGet('settings?key=eq.line_central_group&select=value');
    const gid = st?.[0]?.value; if (!gid) return;
    await linePush(gid, text);
  } catch (e) { console.error('central notify:', e); }
}

// ---------- ทำงานจริง ----------
async function run(force: string | null, resend: boolean, dryRun: boolean, only: string | null = null,
                   fromStr: string | null = null, toStr: string | null = null) {
  let cycle: any;
  const custom = !!(fromStr || toStr);
  if (custom) {
    if (!fromStr || !toStr) return { sent: false, reason: 'ต้องใส่ทั้ง from และ to เช่น ?from=2026-07-01&to=2026-07-31' };
    cycle = cycleCustom(fromStr, toStr);
    if (cycle.error) return { sent: false, reason: cycle.error };
  } else {
    cycle = cycleFor(force);
    if (!cycle) return { sent: false, reason: 'วันนี้ไม่ใช่วันแจ้ง (แจ้งเฉพาะวันที่ 16 และวันสุดท้ายของเดือน)' };
    const last = await sbGet('settings?key=eq.billing_reminder_last&select=value');
    if (!dryRun && !resend && !only && last?.[0]?.value === cycle.key)
      return { sent: false, reason: 'รอบนี้ (' + cycle.key + ') ส่งไปแล้ว — เพิ่ม &resend=1 ถ้าต้องการส่งซ้ำ' };
  }

  const { byGid, noLine, hidden } = await collect(cycle);
  const preview: any[] = [];
  let groups = 0, shopsSent = 0, bills = 0, total = 0, failed = 0;

  for (const gid of Object.keys(byGid)) {
    const shops = byGid[gid];
    let sentInGroup = false;
    for (const code of Object.keys(shops).sort()) {   // กลุ่มที่ผูกหลายสาขา → แจ้งแยกทีละสาขา
      if (only && code.toLowerCase() !== only.toLowerCase()) continue;   // โหมดทดสอบร้านเดียว
      const m = buildShopMessage(shops[code], cycle.label);
      if (!m.count) continue;
      bills += m.count; total += m.total; shopsSent++; sentInGroup = true;
      if (dryRun) { preview.push({ group: gid.slice(0, 8) + '…', shop: code, bills: m.count, total: m.total }); continue; }
      try { await linePush(gid, (only ? '🧪 (ทดสอบระบบ — ข้อความตัวอย่าง)\n' : '') + m.text); }
      catch (e) { failed++; console.error('push fail', gid, code, e); }
    }
    if (sentInGroup) groups++;
  }

  // โหมดทดสอบร้านเดียว: ไม่บันทึกว่ารอบนี้ส่งแล้ว และไม่สรุปเข้ากลุ่มกลาง
  if (only) {
    let note = 'โหมดทดสอบร้านเดียว (' + only + ') — ไม่นับว่ารอบนี้ส่งแล้ว รอบจริงตามเวลายังทำงานปกติ';
    if (!shopsSent) {
      const low = only.toLowerCase();
      const inHidden = hidden.some((b: any) => (b.customers?.code || '').toLowerCase() === low);
      const inNoLine = noLine.some((b: any) => (b.customers?.code || '').toLowerCase() === low);
      note = inHidden ? 'ร้าน ' + only + ' ตั้งปิดราคาไว้ ระบบไม่ส่งยอดเข้ากลุ่มลูกค้า'
        : inNoLine ? 'ร้าน ' + only + ' ยังไม่ได้ผูกกลุ่มไลน์'
        : 'ไม่พบบิลค้างของร้าน ' + only + ' ในรอบนี้ (เช็ครหัสร้านอีกที)';
    }
    return {
      sent: !dryRun && shopsSent > 0, testShop: only, cycle: cycle.key,
      window: { from: new Date(cycle.start).toISOString(), to: new Date(cycle.end).toISOString() },
      groups, shops: shopsSent, bills, totalOutstanding: +total.toFixed(2), failed, note,
      ...(dryRun ? { preview } : {}),
    };
  }

  if (!dryRun) {
    if (!custom) await sbUpsertSetting('billing_reminder_last', cycle.key);   // รอบเลือกวันเองไม่แตะตัวกันซ้ำของรอบอัตโนมัติ
    let sum = '📢 แจ้งยอดบิลค้าง (' + cycle.label + ') แล้ว\nส่ง ' + groups + ' กลุ่ม · ' + shopsSent + ' สาขา · ' + bills + ' บิล · รวมค้าง ' + fmtB(total)
      + (failed ? '\n⚠️ ส่งไม่สำเร็จ ' + failed + ' กลุ่ม' : '');
    if (noLine.length) {
      const codes = [...new Set(noLine.map((b: any) => b.customers?.code || '?'))];
      sum += '\n⚠️ ลูกค้าไม่มีกลุ่มไลน์ ' + codes.length + ' ราย (ตามเองด้วย): ' + codes.slice(0, 20).join(', ');
    }
    if (hidden.length) {
      // สรุปยอดค้างรายร้านให้ทีมงานตามเก็บทางส่วนตัว (ไม่ส่งเข้ากลุ่มลูกค้าเพราะปิดราคา)
      const byShop: Record<string, number> = {};
      hidden.forEach((b: any) => { const k = b.customers?.code || '?'; byShop[k] = (byShop[k] || 0) + outOf(b); });
      sum += '\n🙈 ร้านปิดราคา ' + Object.keys(byShop).length + ' ราย ไม่ส่งแจ้งเข้ากลุ่ม (แจ้งเองทางส่วนตัว):\n'
        + Object.keys(byShop).sort().map((k) => '• ' + k + ' ค้าง ' + fmtB(byShop[k])).join('\n');
    }
    await centralNotify(sum);
  }
  return {
    sent: !dryRun, cycle: cycle.key,
    window: { from: new Date(cycle.start).toISOString(), to: new Date(cycle.end).toISOString() },
    groups, shops: shopsSent, bills, totalOutstanding: +total.toFixed(2), failed,
    customersWithoutLine: [...new Set(noLine.map((b: any) => b.customers?.code || '?'))],
    hiddenPriceCustomers: [...new Set(hidden.map((b: any) => b.customers?.code || '?'))],
    ...(custom ? { mode: 'custom', customNote: 'รอบเลือกวันเอง — ไม่บล็อก/ไม่กระทบรอบอัตโนมัติวันที่ 16 และสิ้นเดือน' } : {}),
    ...(dryRun ? { note: 'โหมดดูตัวอย่าง ยังไม่ส่งจริง — เพิ่ม &send=1 เพื่อส่งจริง', preview } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const u = new URL(req.url);
    if (req.method === 'GET') {
      const force = u.searchParams.get('force');
      const send = u.searchParams.get('send') === '1';
      const resend = u.searchParams.get('resend') === '1';
      const only = u.searchParams.get('only');
      return J(await run(force, resend, !send, only, u.searchParams.get('from'), u.searchParams.get('to')));
    }
    let body: any = {};
    try { body = await req.json(); } catch { /* cron ส่ง {} */ }
    return J(await run(body.force ?? null, !!body.resend, false, body.only ?? null, body.from ?? null, body.to ?? null));
  } catch (e) {
    console.error(e);
    return J({ ok: false, error: String((e as Error)?.message || e) });
  }
});
