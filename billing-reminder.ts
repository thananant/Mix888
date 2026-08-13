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
//    GET  <URL>?force=first&send=1         → บังคับส่งจริงเดี๋ยวนี้ (ไว้ทดสอบ)
//    (force=second = รอบสิ้นเดือน · เพิ่ม &resend=1 ถ้าจะส่งซ้ำรอบที่เคยส่งแล้ว)
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
  return { which, start, end, key: 'br-' + which + '-' + y + '-' + String(mo + 1).padStart(2, '0') };
}

// ---------- รวบรวมบิลค้าง ----------
async function collect(cycle: { start: number; end: number }) {
  const rows = await sbGet(
    'bills?select=id,bill_no,total,paid_amount,payment_status,ship_status,created_at,' +
    'customers!inner(code,name,branch_name,line_group_id)' +
    '&payment_status=neq.paid' +
    '&created_at=lte.' + encodeURIComponent(new Date(cycle.end).toISOString()) +
    '&order=created_at.asc&limit=5000');
  const due = rows.filter((b: any) =>
    b.ship_status !== 'cancelled' && outOf(b) > EPS);
  // จัดกลุ่มตามกลุ่มไลน์ → ตามร้าน
  const byGid: Record<string, Record<string, { c: any; inCycle: any[]; older: any[] }>> = {};
  const noLine: any[] = [];
  for (const b of due) {
    const c = b.customers;
    if (!c?.line_group_id) { noLine.push(b); continue; }
    const shop = ((byGid[c.line_group_id] ??= {})[c.code] ??= { c, inCycle: [], older: [] });
    if (new Date(b.created_at).getTime() > cycle.start) shop.inCycle.push(b);
    else shop.older.push(b);
  }
  return { byGid, noLine };
}

function buildMessage(shops: Record<string, { c: any; inCycle: any[]; older: any[] }>, endMs: number): { text: string; total: number; count: number } {
  const parts: string[] = ['📋 แจ้งยอดบิลค้างชำระ (ตัดยอด ' + thaiDateLabel(endMs) + ' เวลา 18:00 น.)'];
  let grand = 0, cnt = 0;
  const line = (b: any) => {
    const paid = Number(b.paid_amount || 0);
    return '• ' + b.bill_no + ' ค้าง ' + fmtB(outOf(b)) + (paid > EPS ? ' (จ่ายบางส่วนแล้ว ' + fmtB(paid) + ')' : '');
  };
  const cap = 15;
  for (const code of Object.keys(shops).sort()) {
    const s = shops[code];
    const all = [...s.inCycle, ...s.older];
    if (!all.length) continue;
    const sum = all.reduce((t, b) => t + outOf(b), 0);
    grand += sum; cnt += all.length;
    let block = '【' + code + ' ' + (s.c.name || '') + (s.c.branch_name ? ' • ' + s.c.branch_name : '') + '】';
    if (s.inCycle.length) block += '\n' + s.inCycle.slice(0, cap).map(line).join('\n')
      + (s.inCycle.length > cap ? '\n…อีก ' + (s.inCycle.length - cap) + ' ใบ' : '');
    if (s.older.length) block += '\nค้างยกมาจากรอบก่อน:\n' + s.older.slice(0, cap).map(line).join('\n')
      + (s.older.length > cap ? '\n…อีก ' + (s.older.length - cap) + ' ใบ' : '');
    block += '\nรวม ' + all.length + ' บิล ค้าง ' + fmtB(sum);
    parts.push(block);
  }
  if (Object.keys(shops).length > 1) parts.push('รวมทุกร้านในกลุ่ม ' + cnt + ' บิล ค้าง ' + fmtB(grand));
  parts.push(CLOSING);
  return { text: parts.join('\n\n'), total: grand, count: cnt };
}

async function centralNotify(text: string) {
  try {
    const st = await sbGet('settings?key=eq.line_central_group&select=value');
    const gid = st?.[0]?.value; if (!gid) return;
    await linePush(gid, text);
  } catch (e) { console.error('central notify:', e); }
}

// ---------- ทำงานจริง ----------
async function run(force: string | null, resend: boolean, dryRun: boolean) {
  const cycle = cycleFor(force);
  if (!cycle) return { sent: false, reason: 'วันนี้ไม่ใช่วันแจ้ง (แจ้งเฉพาะวันที่ 16 และวันสุดท้ายของเดือน)' };
  const last = await sbGet('settings?key=eq.billing_reminder_last&select=value');
  if (!dryRun && !resend && last?.[0]?.value === cycle.key)
    return { sent: false, reason: 'รอบนี้ (' + cycle.key + ') ส่งไปแล้ว — เพิ่ม &resend=1 ถ้าต้องการส่งซ้ำ' };

  const { byGid, noLine } = await collect(cycle);
  const preview: any[] = [];
  let groups = 0, bills = 0, total = 0, failed = 0;

  for (const gid of Object.keys(byGid)) {
    const m = buildMessage(byGid[gid], cycle.end);
    if (!m.count) continue;
    groups++; bills += m.count; total += m.total;
    if (dryRun) { preview.push({ group: gid.slice(0, 8) + '…', bills: m.count, total: m.total }); continue; }
    try { await linePush(gid, m.text); }
    catch (e) { failed++; console.error('push fail', gid, e); }
  }

  if (!dryRun) {
    await sbUpsertSetting('billing_reminder_last', cycle.key);
    let sum = '📢 แจ้งยอดบิลค้างรอบ ' + thaiDateLabel(cycle.end) + ' แล้ว\nส่ง ' + groups + ' กลุ่ม · ' + bills + ' บิล · รวมค้าง ' + fmtB(total)
      + (failed ? '\n⚠️ ส่งไม่สำเร็จ ' + failed + ' กลุ่ม' : '');
    if (noLine.length) {
      const codes = [...new Set(noLine.map((b: any) => b.customers?.code || '?'))];
      sum += '\n⚠️ ลูกค้าไม่มีกลุ่มไลน์ ' + codes.length + ' ราย (ตามเองด้วย): ' + codes.slice(0, 20).join(', ');
    }
    await centralNotify(sum);
  }
  return {
    sent: !dryRun, cycle: cycle.key,
    window: { from: new Date(cycle.start).toISOString(), to: new Date(cycle.end).toISOString() },
    groups, bills, totalOutstanding: +total.toFixed(2), failed,
    customersWithoutLine: [...new Set(noLine.map((b: any) => b.customers?.code || '?'))],
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
      return J(await run(force, resend, !send));
    }
    let body: any = {};
    try { body = await req.json(); } catch { /* cron ส่ง {} */ }
    return J(await run(body.force ?? null, !!body.resend, false));
  } catch (e) {
    console.error(e);
    return J({ ok: false, error: String((e as Error)?.message || e) });
  }
});
