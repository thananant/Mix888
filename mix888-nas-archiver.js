#!/usr/bin/env node
/* ============================================================
   Mix Fresh 168 — โปรแกรมเก็บบิล + สลิปเข้า NAS อัตโนมัติ

   ดึงรูปบิลและสลิปของทุกบิลจากระบบหลังบ้าน (Supabase)
   มาจัดเก็บลง NAS ตามโครงสร้าง:

     <NAS_ROOT>\2026\07\09072026\IV2607090001\
        IV2607090001_บิล_v1.png       ← รูปบิล (ทุกเวอร์ชันที่เคยออก)
        IV2607090001_บิลหน้า1_v1.png  ← หน้า A4 (ถ้าบิลยาวหลายหน้า)
        IV2607090001_สลิป1.jpg        ← สลิปโอนที่ใช้ตัดบิลนี้
     <NAS_ROOT>\2026\07\09072026\สรุปบิล_09072026.csv  ← สรุปรายวัน (เปิดด้วย Excel)

   วิธีใช้: ติดตั้ง Node.js แล้วดับเบิลคลิก mix888-nas-archiver.bat
            เปิดทิ้งไว้ โปรแกรมจะซิงก์ทุก ๆ 30 นาทีอัตโนมัติ
   ============================================================ */
'use strict';

/* ================= ตั้งค่า ================= */
const NAS_ROOT   = 'Z:\\Mix888';      // โฟลเดอร์ปลายทางบน NAS (แมพไดรฟ์ไว้ เช่น Z:) หรือใช้ '\\\\ชื่อNAS\\share\\Mix888'
const DAYS_BACK  = 45;                // ซิงก์บิลย้อนหลังกี่วัน (รอบแรกแนะนำตั้งเยอะ ๆ เช่น 400 แล้วค่อยลดลง)
const EVERY_MIN  = 30;                // ซิงก์ซ้ำทุกกี่นาที
const SUPABASE_URL = 'https://eqbzpgynzgdwvouuzfwt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-';
/* =========================================== */

const fs   = require('fs');
const path = require('path');

const log = (...a) => console.log(new Date().toLocaleTimeString('th-TH'), ...a);

function thDate(iso){                              // วันที่ตามเวลาไทย
  const s = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok',
    year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(iso));
  const [y, m, d] = s.split('-');
  return {y, m, d, ddmmyyyy: d + m + y};
}
function extOf(url){
  const m = String(url||'').split('?')[0].match(/\.(png|jpe?g|webp|pdf)$/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}
function csvCell(v){ return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }
function safeName(s){ return String(s||'').replace(/[\\/:*?"<>|]/g, '_'); }

async function api(pathAndQuery){
  const r = await fetch(SUPABASE_URL + pathAndQuery, {
    headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY}});
  if(!r.ok) throw new Error('API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function fetchBills(sinceISO){
  const base = '/rest/v1/bills?select=';
  const cols = 'id,bill_no,total,shipping_fee,discount,revision,created_at,payment_status,paid_at,pay_method,ship_status,image_url,page_urls,slip_url,customers(code,name,branch_name),orders(order_no)';
  const tail = '&created_at=gte.' + encodeURIComponent(sinceISO) + '&order=created_at.asc&limit=10000';
  try{   // แบบมีประวัติการชำระ (สลิปหลายใบต่อบิล)
    return await api(base + encodeURIComponent(cols + ',payments(amount,created_at,slips)') + tail);
  }catch(e){   // ถ้ายังไม่มีตาราง payments ก็เอาเฉพาะสลิปหลักบนบิล
    log('อ่านประวัติชำระ (payments) ไม่ได้ — ใช้สลิปหลักบนบิลแทน:', e.message);
    return await api(base + encodeURIComponent(cols) + tail);
  }
}

async function download(url, dest){
  const r = await fetch(url);
  if(!r.ok) throw new Error('โหลดไฟล์ไม่ได้ (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if(!buf.length) throw new Error('ไฟล์ว่างเปล่า');
  fs.writeFileSync(dest, buf);
}

let running = false;
async function syncOnce(){
  if(running) return;
  running = true;
  const t0 = Date.now();
  let saved = 0, skipped = 0, failed = 0;
  try{
    if(!fs.existsSync(NAS_ROOT)){
      log('❌ เปิดโฟลเดอร์ NAS ไม่ได้: ' + NAS_ROOT);
      log('   ตรวจว่าแมพไดรฟ์/ต่อ NAS แล้ว หรือแก้ค่า NAS_ROOT หัวไฟล์นี้');
      running = false;
      return;
    }
    const since = new Date(Date.now() - DAYS_BACK * 24 * 3600 * 1000).toISOString();
    const bills = await fetchBills(since);
    log('พบบิล ' + bills.length + ' ใบ (ย้อนหลัง ' + DAYS_BACK + ' วัน)');

    const byDay = {};   // โฟลเดอร์รายวัน → รายการบิล (ไว้ทำไฟล์สรุป)
    for(const b of bills){
      const {y, m, ddmmyyyy} = thDate(b.created_at);
      const dayDir  = path.join(NAS_ROOT, y, m, ddmmyyyy);
      const billDir = path.join(dayDir, safeName(b.bill_no));
      (byDay[dayDir] = byDay[dayDir] || {ddmmyyyy, rows: []}).rows.push(b);

      // รายการไฟล์ของบิลนี้: [url, ชื่อไฟล์ปลายทาง]
      const files = [];
      const rev = b.revision || 1;
      if(b.image_url) files.push([b.image_url, safeName(b.bill_no) + '_บิล_v' + rev + extOf(b.image_url)]);
      (Array.isArray(b.page_urls) ? b.page_urls : []).forEach((u, i) =>
        files.push([u, safeName(b.bill_no) + '_บิลหน้า' + (i+1) + '_v' + rev + extOf(u)]));
      const slipSet = [];
      (Array.isArray(b.payments) ? b.payments : []).forEach(p =>
        (Array.isArray(p.slips) ? p.slips : []).forEach(u => { if(u && !slipSet.includes(u)) slipSet.push(u); }));
      if(b.slip_url && !slipSet.includes(b.slip_url)) slipSet.push(b.slip_url);
      slipSet.forEach((u, i) => files.push([u, safeName(b.bill_no) + '_สลิป' + (i+1) + extOf(u)]));

      if(!files.length) continue;
      fs.mkdirSync(billDir, {recursive: true});
      for(const [url, name] of files){
        const dest = path.join(billDir, name);
        if(fs.existsSync(dest)){ skipped++; continue; }
        try{ await download(url, dest); saved++; log('  💾 ' + path.join(ddmmyyyy, safeName(b.bill_no), name)); }
        catch(e){ failed++; log('  ⚠️ โหลดไม่ได้ ' + b.bill_no + ' ' + name + ' — ' + e.message); }
      }
    }

    // ไฟล์สรุปรายวัน (เขียนทับทุกครั้ง ให้สถานะจ่าย/ส่งเป็นปัจจุบันเสมอ)
    for(const [dayDir, info] of Object.entries(byDay)){
      fs.mkdirSync(dayDir, {recursive: true});
      const head = ['ลำดับ','เลขบิล','เลขออเดอร์','รหัสลูกค้า','ชื่อลูกค้า','ยอดบิล','ค่าส่ง','ส่วนลด',
                    'สถานะชำระ','วิธีชำระ','สถานะจัดส่ง','เวอร์ชัน','วันเวลาออกบิล','จำนวนสลิป'];
      const lines = [head.map(csvCell).join(',')];
      let total = 0, paid = 0;
      info.rows.forEach((b, i) => {
        const c = b.customers || {};
        const cancelled = (b.ship_status || 'pending') === 'cancelled';
        if(!cancelled) total += Number(b.total || 0);
        if(!cancelled && b.payment_status === 'paid') paid += Number(b.total || 0);
        const nslip = ((Array.isArray(b.payments) ? b.payments : [])
                        .reduce((s, p) => s + ((Array.isArray(p.slips) ? p.slips.length : 0)), 0)) || (b.slip_url ? 1 : 0);
        lines.push([i+1, b.bill_no, (b.orders || {}).order_no || '', c.code || '',
          (c.name || '') + (c.branch_name ? ' ' + c.branch_name : ''),
          Number(b.total || 0), Number(b.shipping_fee || 0), Number(b.discount || 0),
          cancelled ? 'ยกเลิกบิล' : (b.payment_status === 'paid' ? 'จ่ายแล้ว' : 'ค้างจ่าย'),
          b.pay_method === 'cash' ? 'เงินสด' : (b.pay_method === 'transfer' ? 'โอน' : ''),
          cancelled ? 'ยกเลิก' : (b.ship_status === 'shipped' ? 'ส่งแล้ว' : 'รอส่ง'),
          'v' + (b.revision || 1),
          new Date(b.created_at).toLocaleString('th-TH', {timeZone:'Asia/Bangkok'}),
          nslip].map(csvCell).join(','));
      });
      lines.push('');
      lines.push(['', 'รวมยอดขาย (ไม่รวมบิลยกเลิก)', total, 'รับชำระแล้ว', paid, 'ค้างรับ', total - paid].map(csvCell).join(','));
      // BOM นำหน้าให้ Excel เปิดภาษาไทยไม่เพี้ยน
      fs.writeFileSync(path.join(dayDir, 'สรุปบิล_' + info.ddmmyyyy + '.csv'), '\uFEFF' + lines.join('\r\n'));
    }

    log('✅ ซิงก์เสร็จใน ' + Math.round((Date.now()-t0)/1000) + ' วิ — ไฟล์ใหม่ ' + saved
        + ' · มีอยู่แล้ว ' + skipped + (failed ? ' · โหลดพลาด ' + failed + ' (จะลองใหม่รอบหน้า)' : ''));
  }catch(e){
    log('❌ ซิงก์ไม่สำเร็จ: ' + (e.message || e));
  }
  running = false;
}

console.log('==========================================================');
console.log('  Mix Fresh 168 — เก็บบิล + สลิปเข้า NAS อัตโนมัติ');
console.log('  ปลายทาง: ' + NAS_ROOT);
console.log('  ซิงก์ย้อนหลัง ' + DAYS_BACK + ' วัน · ทำซ้ำทุก ' + EVERY_MIN + ' นาที');
console.log('  เปิดหน้าต่างนี้ทิ้งไว้ (ย่อได้ อย่าปิด) — ปิดแล้วเปิดใหม่ก็ซิงก์ต่อจากเดิมได้');
console.log('==========================================================');
syncOnce();
setInterval(syncOnce, EVERY_MIN * 60 * 1000);
