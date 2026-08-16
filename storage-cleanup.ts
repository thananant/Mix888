// ============================================================
//  Supabase Edge Function: storage-cleanup — Mix Fresh 168
//  ลบรูปบิล + สลิป ออกจาก Supabase Storage หลังเก็บเข้า NAS แล้ว
//  (กู้พื้นที่ Storage — สำเนาจริงอยู่ใน NAS · รูปบิลวาดใหม่ได้เสมอ)
//
//  เงื่อนไขการลบ (ปลอดภัยสองชั้น):
//  • บิลจ่ายครบ (paid) + โปรแกรม NAS ยืนยันว่าเก็บครบแล้ว (ลบได้ทันที)
//  • บิลที่ยกเลิก (ลบได้ทันที — โฟลเดอร์บน NAS ถูกลบอยู่แล้ว ไม่มีอะไรต้องเก็บ)
//  ลบแล้วประทับ storage_cleaned_at กันประมวลผลซ้ำ + ตั้ง image_url ว่าง
//  (ระบบหลังบ้านวาดรูปบิลใหม่อัตโนมัติเมื่อจำเป็น)
//
//  วิธีติดตั้ง:
//  1. รัน mix888-storage-cleanup.sql ใน SQL Editor ก่อน (คอลัมน์ + ตัวตั้งเวลา)
//  2. Edge Functions → Deploy new function ชื่อ storage-cleanup
//     วางโค้ดไฟล์นี้ทั้งไฟล์ → ปิด Verify JWT → Deploy
//  3. อัปเดตโปรแกรม archiver.js บน NAS เป็นเวอร์ชันที่ยืนยันการเก็บ (ส่งให้พร้อมกัน)
//
//  ทดสอบ (เปิดใน browser):
//    GET  <URL ฟังก์ชัน>            → ดูตัวอย่างว่าจะลบบิลไหนบ้าง (ไม่ลบจริง)
//    GET  <URL>?run=1               → ลบจริงเดี๋ยวนี้ (สูงสุด 40 บิล/รอบ)
//    GET  <URL>?run=1&max=200       → เร่งลบรอบละ 200 บิล (ไว้เคลียร์ของเก่าครั้งแรก)
// ============================================================

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LINE_TOKEN =
  Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? Deno.env.get('LINE_TOKEN') ??
  Deno.env.get('CHANNEL_ACCESS_TOKEN') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const J = (obj: unknown, code = 200) =>
  new Response(JSON.stringify(obj, null, 1), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });
const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

async function sbGet(qs: string): Promise<any[]> {
  const r = await fetch(SB_URL + '/rest/v1/' + qs, { headers: H });
  if (!r.ok) throw new Error('db: ' + (await r.text()).slice(0, 200));
  return await r.json();
}
async function sbPatch(qs: string, body: unknown) {
  const r = await fetch(SB_URL + '/rest/v1/' + qs, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('db patch: ' + (await r.text()).slice(0, 200));
}

/** ชื่อไฟล์ในถังจาก public URL เช่น .../object/public/slips/abc/x.jpg → abc/x.jpg */
function pathInBucket(url: string, bucket: string): string | null {
  const m = String(url || '').match(new RegExp('/object/public/' + bucket + '/(.+)$'));
  return m ? decodeURIComponent(m[1].split('?')[0]) : null;
}

/** ไฟล์ทั้งหมดในถัง bills ของเลขบิลนี้ (กันชนกับเลขบิลที่ขึ้นต้นเหมือนกัน เช่น IV12 กับ IV123) */
async function listBillFiles(billNo: string): Promise<string[]> {
  const r = await fetch(SB_URL + '/storage/v1/object/list/bills', {
    method: 'POST', headers: H,
    body: JSON.stringify({ prefix: '', search: billNo, limit: 1000 }),
  });
  if (!r.ok) throw new Error('list: ' + (await r.text()).slice(0, 200));
  const rows = await r.json();
  return (rows || [])
    .map((x: any) => x.name as string)
    .filter((n: string) => n === billNo || (n.startsWith(billNo) && /^[^0-9A-Za-z]/.test(n.slice(billNo.length))));
}
async function deleteObjects(bucket: string, names: string[]): Promise<number> {
  if (!names.length) return 0;
  const r = await fetch(SB_URL + '/storage/v1/object/' + bucket, {
    method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: names }),
  });
  if (r.ok) return names.length;
  const firstErr = (await r.text()).slice(0, 200);
  // ลบแบบยกชุดไม่ผ่าน (เช่นบางไฟล์ถูกลบไปก่อนแล้ว) → ไล่ลบทีละไฟล์ ไฟล์ที่หายแล้ว (404) ถือว่าจบ
  let done = 0;
  for (const n of names) {
    const r1 = await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + n.split('/').map(encodeURIComponent).join('/'),
      { method: 'DELETE', headers: H });
    if (r1.ok || r1.status === 404 || r1.status === 400) done++;
    else throw new Error('delete ' + bucket + '/' + n + ': ' + (await r1.text()).slice(0, 150) + ' | bulk: ' + firstErr);
  }
  return done;
}
async function lineCentral(text: string) {
  try {
    if (!LINE_TOKEN) return;
    const st = await sbGet('settings?key=eq.line_central_group&select=value');
    const gid = st?.[0]?.value; if (!gid) return;
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
      body: JSON.stringify({ to: gid, messages: [{ type: 'text', text }] }),
    });
  } catch (e) { console.error('line:', e); }
}

async function run(doDelete: boolean, max: number) {
  const d2 = new Date().toISOString();   // ยืนยันแล้วลบได้ทันที (archiver ตรวจว่าไฟล์ลง NAS ครบจริงก่อนยืนยัน)
  const cols = 'id,bill_no,image_url,page_urls,slip_url,payment_status,ship_status,nas_saved_at,created_at';
  // ชุดที่ 1: จ่ายครบ + NAS ยืนยันแล้ว
  const paidQ = await sbGet('bills?select=' + cols
    + '&payment_status=eq.paid&storage_cleaned_at=is.null'
    + '&nas_saved_at=not.is.null&nas_saved_at=lt.' + encodeURIComponent(d2)
    + '&order=created_at.asc&limit=' + max);
  // ชุดที่ 2: บิลยกเลิก — ลบได้ทันที (ไม่ต้องรอ NAS ไม่มีอะไรต้องเก็บ)
  const cancelQ = await sbGet('bills?select=' + cols
    + '&ship_status=eq.cancelled&storage_cleaned_at=is.null'
    + '&order=created_at.asc&limit=' + Math.max(10, Math.floor(max / 2)));
  const targets = [...paidQ, ...cancelQ].slice(0, max);

  let billsDone = 0, filesDeleted = 0, failed = 0;
  const preview: any[] = [];
  const errors: string[] = [];
  for (const b of targets) {
    try {
      const billFiles = await listBillFiles(b.bill_no);
      const slipPaths: string[] = [];
      const pays = await sbGet('payments?select=slips&bill_id=eq.' + b.id).catch(() => []);
      for (const p of (pays || [])) for (const u of (Array.isArray(p.slips) ? p.slips : [])) {
        const sp = pathInBucket(u, 'slips'); if (sp && !slipPaths.includes(sp)) slipPaths.push(sp);
      }
      const mainSlip = pathInBucket(b.slip_url, 'slips');
      if (mainSlip && !slipPaths.includes(mainSlip)) slipPaths.push(mainSlip);

      if (!doDelete) { preview.push({ bill: b.bill_no, billFiles: billFiles.length, slips: slipPaths.length }); continue; }
      filesDeleted += await deleteObjects('bills', billFiles);
      filesDeleted += await deleteObjects('slips', slipPaths);
      // image_url ในตาราง bills ห้ามเป็น null — ใช้ค่าว่างแทน (หลังบ้านมอง '' = ไม่มีรูป → วาดใหม่เอง)
      await sbPatch('bills?id=eq.' + b.id,
        { storage_cleaned_at: new Date().toISOString(), image_url: '', page_urls: [] });
      billsDone++;
    } catch (e) {
      failed++;
      const msg = String((e as Error)?.message || e).slice(0, 220);
      if (errors.length < 5 && !errors.some(x => x.startsWith(msg.slice(0, 40)))) errors.push(b.bill_no + ': ' + msg);
      console.error('bill ' + b.bill_no + ':', e);
    }
  }
  if (doDelete && billsDone > 0) {
    await lineCentral('🧹 เคลียร์รูปเก่าออกจาก Supabase แล้ว ' + billsDone + ' บิล (' + filesDeleted + ' ไฟล์)'
      + (failed ? ' · พลาด ' + failed + ' บิล (จะลองใหม่คืนถัดไป)' : '') + '\nสำเนาทั้งหมดอยู่ใน NAS · รูปบิลวาดใหม่ได้เสมอ');
  }
  return {
    mode: doDelete ? 'ลบจริง' : 'ดูตัวอย่าง (เพิ่ม ?run=1 เพื่อลบจริง)',
    candidates: targets.length, billsCleaned: billsDone, filesDeleted, failed,
    ...(errors.length ? { errors } : {}),
    remainingHint: targets.length >= max ? 'ยังมีคิวเหลือ — รอบถัดไปจะลบต่อ (หรือเพิ่ม &max=200)' : 'เคลียร์หมดคิวแล้ว',
    ...(doDelete ? {} : { preview: preview.slice(0, 50) }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const u = new URL(req.url);
    let doDelete = u.searchParams.get('run') === '1';
    let max = Math.min(300, Math.max(1, Number(u.searchParams.get('max') || 40)));
    if (req.method === 'POST') {
      let body: any = {}; try { body = await req.json(); } catch { /* cron */ }
      if (body.run === true) doDelete = true;
      if (body.max) max = Math.min(300, Math.max(1, Number(body.max)));
    }
    return J(await run(doDelete, max));
  } catch (e) {
    console.error(e);
    return J({ ok: false, error: String((e as Error)?.message || e) });
  }
});
