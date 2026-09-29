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
     <NAS_ROOT>\ข้อมูลลูกค้า\รายชื่อลูกค้า.csv            ← ลูกค้าทุกราย (รหัส ชื่อ เซลล์ ประเภทจ่าย เครดิต ติดต่อ ยอดซื้อ ฯลฯ)
     <NAS_ROOT>\ข้อมูลลูกค้า\BAM00006\                ← ทุกลูกค้า 1 โฟลเดอร์ (ตามรหัสลูกค้า)
        ข้อมูลลูกค้า_BAM00006.txt                        ← ชื่อ/ที่อยู่/เงื่อนไขเครดิต/ผู้อนุมัติ (เขียนทับให้เป็นปัจจุบัน)
        จัดสินค้า_BAM00006.csv                          ← สินค้าที่จัดให้ + ราคาที่ตั้งให้ลูกค้ารายนี้ (ปัจจุบัน)
        ประวัติราคา_BAM00006.csv                        ← ทุกครั้งที่แก้ราคาให้ลูกค้ารายนี้ (เก่า → ใหม่ ใครแก้ เมื่อไหร่)
        ประวัติสั่งซื้อ_BAM00006.csv                    ← ลูกค้าเคยสั่งอะไร ราคาเท่าไร เมื่อไหร่ (ย้อนหลัง 2 ปี)
        BAM00006_สำเนาบัตรประชาชน_20261001-1030.jpg       ← เอกสารขอใช้เครดิต (เฉพาะเครดิตที่อนุมัติแล้ว · ไฟล์ใหม่เมื่อเปลี่ยนเอกสาร)
        (เปลี่ยนรหัสลูกค้าในหลังบ้าน → โฟลเดอร์ถูกเปลี่ยนชื่อตามให้เอง ดูจากไฟล์ .customer_id ข้างใน)
     <NAS_ROOT>\ใบวางบิล\BAM00006\ใบวางบิล_2026-11-01.png  ← รูปใบวางบิลที่ระบบส่งให้ลูกค้า
     <NAS_ROOT>\สื่อสินค้า\สินค้า\<SKU>_<ชื่อ>_<รหัสไฟล์>.jpg   ← รูปสินค้า (เปลี่ยนรูป = ไฟล์ใหม่ ของเก่าไม่ลบ)
     <NAS_ROOT>\สื่อสินค้า\บรอดแคสต์\2026-10\…                ← รูป/วิดีโอที่ส่งบรอดแคสต์ (ลบออกจาก Supabase หลัง 7 วัน)
     <NAS_ROOT>\รายจ่าย\2026\2026-10\รายจ่าย_2026-10.csv     ← Petty Cash รายเดือน + รูปใบเสร็จในโฟลเดอร์เดียวกัน
     <NAS_ROOT>\สำรองตาราง\2026-10-06\<ตาราง>.csv/.json       ← สำรองตารางข้อมูลทุก 7 วัน (แยกจากโฟลเดอร์ สำรองข้อมูล เดิมของคุณ) (กู้คืนได้ถ้า Supabase มีปัญหา)

   ประหยัดพื้นที่ Supabase: บิลที่จ่ายครบแล้วเกิน 30 วัน และไฟล์อยู่บน NAS แล้ว → ลบรูปบิล/สลิปออกจาก Supabase
   (ต้องรัน mix888-nas-key-fix.sql ก่อน · หลังบ้านยังกด "สร้างรูปบิลใหม่" ได้ ระบบจะเก็บสำเนาแล้วลบให้อีกรอบ)

   วิธีใช้ (เลือกอย่างใดอย่างหนึ่ง):
   ① บน Synology NAS: ลงแพ็กเกจ Node.js จาก Package Center แล้วตั้ง
      Task Scheduler รันทุกชั่วโมง:  node /volume1/.../mix888-nas-archiver.js --once
      (--once = ซิงก์ครั้งเดียวแล้วจบ ให้ Task Scheduler เป็นคนเรียกซ้ำ)
      [!] --restore-media / --restore-bill = คำสั่งกู้คืน (เอาไฟล์จาก NAS ขึ้น Supabase) ใช้ครั้งเดียวตอนจำเป็น ไม่ได้สำรองอะไร — อย่าตั้งใน Task Scheduler
      ลองก่อน:  node archiver.js --once --dry-run   = เก็บลง NAS จริง แต่ "ไม่ลบ/ไม่แก้อะไรใน Supabase" แล้วสรุปท้ายรอบว่าเก็บอะไรบ้าง
      กู้บิล:   node archiver.js --restore-bill IV2609250013   = เอารูปบิล+สลิปของบิลนี้จาก NAS อัปโหลดกลับ Supabase (หลังบ้านเปิดดูได้อีก)
      ตรวจ:    node archiver.js --check   = ตรวจสำรองเต็มรอบเดี๋ยวนี้ (ปกติทำเองวันละครั้ง): เก็บไฟล์ที่ตกหล่น · ไฟล์ในระบบหายแต่ NAS มี = กู้กลับให้เอง
               (บิลส่งแล้ว+จ่ายครบเกิน 30 วัน = เก็บเข้าคลัง NAS แทน ไม่อัปขึ้นใหม่ · สำเนาเก่าที่เก็บก่อนมีแผนผังต้องตรวจผ่านก่อน ไม่ผ่าน = "ตรวจเอง")
               · ไฟล์ที่หายทั้งสองที่ = แจ้งกลุ่มรีพอร์ต และไม่ลบบิลนั้นออกจาก Supabase
               · หาไม่เจอแล้ว → กด "ช่างมัน" ในหลังบ้าน (บัญชี → ตรวจสลิป/ไฟล์หาย) = ไม่แจ้ง/ไม่ตามอีก บิลนั้นเก็บเข้าคลัง NAS ได้ตามปกติ
      ลองดูก่อน: node archiver.js --check --dry-run = ตรวจเต็มรอบ บอกว่าจะกู้/จะเก็บเข้าคลังกี่ไฟล์ โดยไม่แก้อะไรใน Supabase
   ② บนคอม Windows: ติดตั้ง Node.js แล้วดับเบิลคลิก mix888-nas-archiver.bat
      เปิดทิ้งไว้ โปรแกรมจะซิงก์ทุก ๆ 30 นาทีอัตโนมัติ
   ============================================================ */
'use strict';

/* ================= ตั้งค่า =================
   [!] ไม่ต้องแก้ไฟล์นี้ — สร้างไฟล์ archiver.config.json ไว้ข้าง ๆ แล้วใส่ค่าที่ต้องการ (ตัวอย่างอยู่ในไฟล์ archiver.config.example.json)
      {"NAS_ROOT":"/volume1/Mix888","NAS_EXPORT_KEY":"รหัสลับ"}
   ค่าในไฟล์นั้นจะทับค่าด้านล่างทั้งหมด (แก้ไฟล์ .js ด้วยโปรแกรมที่ไม่ใช่ UTF-8 จะทำอีโมจิ/ภาษาไทยพัง แล้วรันไม่ได้)
   =========================================== */
const NAS_ROOT   = '';                // เว้นว่าง = หาโฟลเดอร์ Mix888 บน NAS อัตโนมัติ (volume1-6) / หรือระบุเอง เช่น '/volume2/Mix888' หรือ 'Z:\\Mix888'
const DAYS_BACK  = 45;                // ซิงก์บิลย้อนหลังกี่วัน (รอบแรกแนะนำตั้งเยอะ ๆ เช่น 400 แล้วค่อยลดลง)
const EVERY_MIN  = 30;                // ซิงก์ซ้ำทุกกี่นาที
let   SUPABASE_URL = 'https://eqbzpgynzgdwvouuzfwt.supabase.co';   // (ทับได้ใน archiver.config.json — ใช้ตอนทดสอบเท่านั้น)
const SUPABASE_KEY = 'sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-';
const NAS_EXPORT_KEY = 'PASTE_NAS_EXPORT_KEY_HERE';   // รหัสลับ = ค่าในตาราง nas_config (select export_key from nas_config) — ใส่ใน archiver.config.json
const KEEP_A4_PAGES  = false;         // true = เก็บไฟล์บิลแบบแบ่งหน้า A4 ด้วย (เนื้อหาซ้ำกับใบเต็ม ปกติไม่จำเป็น)
/* ---- ประหยัดพื้นที่ Supabase (ต้องรัน mix888-nas-key-fix.sql ก่อน) ---- */
const PRUNE_PAID_BILLS       = true;  // ลบรูปบิล+สลิปออกจาก Supabase เมื่อบิล "จ่ายครบแล้ว" และไฟล์อยู่บน NAS แล้ว (ต้นฉบับอยู่ NAS · หลังบ้านกดสร้างรูปใหม่ได้ ระบบจะเก็บแล้วลบซ้ำให้)
const PRUNE_PAID_AFTER_DAYS  = 30;    // ลบหลังจ่ายครบมาแล้วกี่วัน
const PRUNE_DAYS_BACK        = 400;   // มองหาบิลที่ควรลบย้อนหลังกี่วัน
const PRUNE_BROADCAST_DAYS   = 7;     // สื่อบรอดแคสต์ (รูป/วิดีโอที่ส่งไลน์แล้ว) ลบออกจาก Supabase หลังเก็บลง NAS และเก่ากว่ากี่วัน (รูปสินค้าไม่ลบ — หน้าสั่งของยังใช้)
const BACKUP_EVERY_DAYS      = 7;     // สำรองตารางข้อมูล (ลูกค้า สินค้า ออเดอร์ บิล การชำระ รายจ่าย …) เป็น CSV+JSON ทุกกี่วัน
const ORDER_HISTORY_DAYS     = 730;   // ประวัติสั่งซื้อรายลูกค้า (ใน ข้อมูลลูกค้า/<รหัส>/) ย้อนหลังกี่วัน
/* =========================================== */

const fs   = require('fs');
const crypto = require('crypto');
const path = require('path');
// ---- อ่านค่าตั้งค่าจาก archiver.config.json (ถ้ามี) ทับค่าคงที่ด้านบน ----
const CFG = (() => {
  const c = {NAS_ROOT, DAYS_BACK, EVERY_MIN, NAS_EXPORT_KEY, KEEP_A4_PAGES, PRUNE_PAID_BILLS, PRUNE_PAID_AFTER_DAYS, PRUNE_DAYS_BACK, PRUNE_BROADCAST_DAYS, BACKUP_EVERY_DAYS, ORDER_HISTORY_DAYS, SUPABASE_URL};
  try{
    const f = path.join(__dirname, 'archiver.config.json');
    if(fs.existsSync(f)){
      const raw = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
      const j = JSON.parse(raw);
      for(const k of Object.keys(c)) if(j[k] !== undefined && j[k] !== null && j[k] !== '') c[k] = typeof j[k] === 'string' ? j[k].trim() : j[k];   // ตัดช่องว่าง/ขึ้นบรรทัดที่ติดมาตอนก๊อป
      c._from = f;
    }
  }catch(e){ console.log('[!] อ่าน archiver.config.json ไม่ได้: ' + e.message + ' — ใช้ค่าในไฟล์สคริปต์แทน'); }
  return c;
})();
if(CFG.SUPABASE_URL && /^https?:\/\//.test(CFG.SUPABASE_URL)) SUPABASE_URL = CFG.SUPABASE_URL.replace(/\/+$/, '');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_CHECK = process.argv.includes('--check');   // ตรวจสำรองเต็มรอบเดี๋ยวนี้ (ปกติทำเองวันละครั้ง)   // เก็บลง NAS ตามปกติ แต่ไม่ลบไฟล์/ไม่แก้ข้อมูลใน Supabase
const REPORT = {};                                    // สรุปท้ายรอบ: หมวด → {new, have, fail, pruned}
function tally(section, key, n = 1){ const r = REPORT[section] || (REPORT[section] = {new: 0, have: 0, fail: 0, pruned: 0}); r[key] += n; }

const logLines = [];
const log = (...a) => {
  // ตัดอีโมจิ (อักขระ 4 ไบต์) ออกจาก log — หน้าจอ/ไฟล์ log บน NAS แสดงผิดแล้วลามทำให้ภาษาไทยช่วงถัดไปเพี้ยน (ข้อความที่ส่งไลน์ยังมีอีโมจิครบ)
  const line = new Date().toLocaleString('th-TH', {timeZone:'Asia/Bangkok'}) + ' ' + a.join(' ').replace(/[\u{10000}-\u{10FFFF}]\uFE0F?/gu, '');
  console.log(line);
  logLines.push(line);
};
function flushLog(){   // เขียนผลรอบล่าสุดไว้ให้เปิดดูใน File Station ได้เลย
  try{ fs.writeFileSync(path.join(__dirname, 'archiver-log.txt'), logLines.slice(-500).join('\r\n')); }catch(e){}
}
function resolveNasRoot(){
  if(CFG.NAS_ROOT) return fs.existsSync(CFG.NAS_ROOT) ? CFG.NAS_ROOT : null;
  for(let i=1; i<=6; i++){
    const p = '/volume' + i + '/Mix888';
    if(fs.existsSync(p)) return p;
  }
  return null;
}

// เวลาไทย = UTC+7 คงที่ — คำนวณเองตรง ๆ (Node บน NAS บางรุ่นไม่มีข้อมูล locale ไทย)
function thDate(iso){
  const d = new Date(new Date(iso).getTime() + 7*3600*1000);
  const y  = String(d.getUTCFullYear());
  const mo = String(d.getUTCMonth()+1).padStart(2,'0');
  const dy = String(d.getUTCDate()).padStart(2,'0');
  return {y, m: mo, d: dy, ddmmyyyy: dy + mo + y};
}
function thDateTimeStr(iso){
  const d = new Date(new Date(iso).getTime() + 7*3600*1000);
  return String(d.getUTCDate()).padStart(2,'0') + '/' + String(d.getUTCMonth()+1).padStart(2,'0') + '/'
       + d.getUTCFullYear() + ' ' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
}
function extOf(url){
  const m = String(url||'').split('?')[0].match(/\.(png|jpe?g|webp|pdf)$/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}
function csvCell(v){ return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }
// ป้ายสถานะจ่ายต่อท้ายชื่อโฟลเดอร์บิล (Windows ห้ามใช้ * ในชื่อ จึงใช้ ## แทน)
const PAY_SUFFIXES = ['_จ่ายครบแล้ว', '_##จ่ายขาด##'];
function paySuffix(b){
  if((b.ship_status || 'pending') === 'cancelled') return '';
  if(b.payment_status === 'paid') return '_จ่ายครบแล้ว';
  if(Number(b.paid_amount || 0) > 0) return '_##จ่ายขาด##';
  return '';
}
// หา/เปลี่ยนชื่อโฟลเดอร์บิลให้ตรงสถานะปัจจุบัน (ไฟล์ข้างในตามไปด้วย ไม่โหลดซ้ำ)
function ensureBillDir(dayDir, b){
  const base = safeName(b.bill_no);
  const wantName = base + paySuffix(b);
  const wantPath = path.join(dayDir, wantName);
  for(const s of ['', ...PAY_SUFFIXES]){
    const p = path.join(dayDir, base + s);
    if(p !== wantPath && fs.existsSync(p) && !fs.existsSync(wantPath)){
      try{
        fs.renameSync(p, wantPath);
        log('  [โฟลเดอร์] ' + base + s + ' → ' + wantName);
      }catch(e){ log('  [!] เปลี่ยนชื่อโฟลเดอร์ ' + base + ' ไม่ได้ — ' + e.message); }
    }
  }
  return wantPath;
}
function safeName(s){ return String(s||'').replace(/[\\/:*?"<>|]/g, '_'); }
// บิลถูกยกเลิก: ไม่เก็บ และลบโฟลเดอร์ที่เคยเก็บไว้ทิ้ง (ต้นฉบับยังอยู่ใน Supabase เสมอ)
function removeBillDir(dayDir, b){
  const base = safeName(b.bill_no);
  for(const s of ['', ...PAY_SUFFIXES]){
    const p = path.join(dayDir, base + s);
    if(fs.existsSync(p)){
      // มีสลิป หรือเคยถูกเก็บแทน Supabase แล้ว (ต้นฉบับอาจไม่มีในระบบแล้ว) = สำเนาเดียวที่เหลือ → ห้ามลบ เก็บไว้เป็น _ยกเลิก
      let keepIt = false;
      try{ keepIt = fs.readdirSync(p).some(f => f.includes('_สลิป')) || !!readManifest(p).__pruned__; }catch(e){ keepIt = true; }
      try{
        if(keepIt){
          const dst = path.join(dayDir, base + '_ยกเลิก');
          if(!fs.existsSync(dst)){ fs.renameSync(p, dst); log('   บิลยกเลิก ' + base + ' มีสลิป/เป็นสำเนาเดียว — ไม่ลบ ย้ายเป็น ' + base + '_ยกเลิก'); }
        }else{
          fs.rmSync(p, {recursive: true, force: true});
          log('   ลบโฟลเดอร์บิลยกเลิก ' + base + s);
        }
      }catch(e){ log('  [!] จัดการโฟลเดอร์บิลยกเลิก ' + base + s + ' ไม่ได้ — ' + e.message); }
    }
  }
}

async function api(pathAndQuery){
  const r = await fetch(SUPABASE_URL + pathAndQuery, {
    headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY}});
  if(!r.ok) throw new Error('API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function fetchBills(sinceISO){
  // ทางหลัก: ฟังก์ชัน nas_export_bills (ตาราง bills ถูกล็อก RLS — อ่านตรงจะได้ 0 แถว)
  try{
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/nas_export_bills', {
      method: 'POST',
      headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY,
                'Content-Type': 'application/json'},
      body: JSON.stringify({p_key: CFG.NAS_EXPORT_KEY, p_since: sinceISO})});
    if(!r.ok) throw new Error('RPC ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const data = await r.json();
    return Array.isArray(data) ? data : (data || []);
  }catch(e){
    log('เรียก nas_export_bills ไม่สำเร็จ (' + e.message + ') — ลองอ่านตารางตรงแทน');
    log('  ↳ ถ้ายังได้บิล 0 ใบตลอด: รันไฟล์ mix888-nas-key-fix.sql ใน Supabase ก่อน');
  }
  const base = '/rest/v1/bills?select=';
  const cols = 'id,bill_no,total,shipping_fee,discount,revision,created_at,payment_status,paid_amount,paid_at,pay_method,ship_status,image_url,page_urls,slip_url,customers(code,name,branch_name),orders(order_no)';
  const tail = '&created_at=gte.' + encodeURIComponent(sinceISO) + '&order=created_at.asc&limit=10000';
  try{   // แบบมีประวัติการชำระ (สลิปหลายใบต่อบิล)
    return await api(base + encodeURIComponent(cols + ',payments(amount,created_at,slips)') + tail);
  }catch(e){   // ถ้ายังไม่มีตาราง payments ก็เอาเฉพาะสลิปหลักบนบิล
    log('อ่านประวัติชำระ (payments) ไม่ได้ — ใช้สลิปหลักบนบิลแทน:', e.message);
    return await api(base + encodeURIComponent(cols) + tail);
  }
}

async function fetchBuf(url){
  const r = await fetch(url);
  if(!r.ok){ const e = new Error('โหลดไฟล์ไม่ได้ (' + r.status + ')'); e.status = r.status; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if(!buf.length){ const e = new Error('ไฟล์ว่างเปล่า'); e.status = 0; throw e; }
  return buf;
}
async function download(url, dest){
  const buf = await fetchBuf(url);
  const tmp = dest + '.part';                      // เขียนไฟล์ชั่วคราวก่อน แล้วค่อยเปลี่ยนชื่อ — ไฟล์ขาดครึ่งจะไม่ถูกนับว่า "มีบน NAS แล้ว"
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

/* ================= ตรวจการสำรอง: ไฟล์ที่สำรองไม่ได้ → รายงาน Supabase + แจ้งกลุ่มรีพอร์ต ================= */
// gone  = ไฟล์ไม่มีใน Supabase แล้ว (400/404) และไม่มีบน NAS → หายถาวร ต้องหาจากที่อื่น (แชทไลน์ร้าน)
// error = โหลดไม่ได้ด้วยเหตุอื่น (เน็ต/เซิร์ฟเวอร์) → แจ้งเมื่อพลาดติดกัน 3 รอบ
const ISSUES = new Map();      // url → {kind, ref, url, reason, detail}
const OK_URLS = new Set();     // ไฟล์ที่รอบนี้สำรองได้ (ปิดเรื่องเก่าที่เคยพลาด)
const RESTORED = [];           // กู้จาก NAS กลับขึ้น Supabase อัตโนมัติรอบนี้
const FULL_KINDS = new Set();  // ประเภทไฟล์ที่รอบนี้ไล่ตรวจครบทุกรายการ (เรื่องเก่าที่ไม่เจอแล้ว = ปิด เช่น เปลี่ยนรูปใหม่แทนแล้ว)
const isGone = e => !!e && (e.status === 400 || e.status === 404);
// ไฟล์ที่กด "ช่างมัน" ในหลังบ้าน (ยอมรับว่าหายถาวร — nas_accepted_urls) → ไม่นับเป็นปัญหา: ไม่รายงาน · ไม่กันการเก็บบิลเข้าคลัง
//   โหลดไม่ได้ชั่วคราว (error) ยังนับตามเดิม · ถ้าหาสำเนาที่ยืนยันได้เจอ ยังกู้คืนให้ตามปกติ
const ACCEPTED = new Set();
const ACCEPTED_SEEN = new Set();   // ไฟล์ที่ช่างมันแล้วที่เจอว่ายังหายรอบนี้ (ไว้บอกใน log)
const isAccepted = url => { if(!ACCEPTED.has(url)) return false; ACCEPTED_SEEN.add(url); return true; };
function setIssue(url, it){
  if(!url) return;
  if(it.reason !== 'error' && isAccepted(url)){ ISSUES.delete(url); return; }
  ISSUES.set(url, it);
}
function noteIssue(kind, ref, url, err){
  setIssue(url, {kind, ref: String(ref || ''), url, reason: isGone(err) ? 'gone' : 'error', detail: String((err && err.message) || err || '').slice(0, 200)});
}
function noteOk(url){ if(url){ OK_URLS.add(url); ISSUES.delete(url); } }
/* ไฟล์ที่ถูก "ย้ายไปชื่อสุ่ม" ด้วยปุ่ม "ย้ายไฟล์เก่าไปชื่อสุ่ม" ในหลังบ้าน (ชื่อเดิม-xxxxxxxxxx.นามสกุล โฟลเดอร์เดียวกัน)
   ปุ่มรุ่นแรกแก้ลิงก์แค่ช่องหลักของบิล → ลิงก์ในประวัติการชำระยังชี้ชื่อเดิม: เปิดไม่ได้ แต่ไฟล์ยังอยู่ครบ
   เจอแบบนี้ = แก้ลิงก์ทุกจุดให้ชี้ไฟล์ที่ย้าย (ไฟล์เดียวกันเป๊ะ ไม่ต้องอัปโหลด ไม่มีทางได้สลิปผิดใบ) — ต้องเจอไฟล์ที่ย้าย "ไฟล์เดียว" เท่านั้น */
const OBJ_INDEX = new Map();   // bucket → Promise<Map(ชื่อเดิม → [ชื่อที่ย้ายไป])>
const MOVED = new Map();       // ลิงก์เดิม → Promise<ลิงก์ใหม่ | null> (แก้ครั้งเดียวต่อรอบ — สลิปโอนรวมหลายบิล)
const RELINKED = [];           // แก้ลิงก์ไฟล์ที่ถูกย้ายชื่อรอบนี้ (แจ้งกลุ่มรีพอร์ตว่าเรื่องที่เคยแจ้งไว้ไม่ได้หายจริง)
function objIndex(bucket){
  if(!OBJ_INDEX.has(bucket)) OBJ_INDEX.set(bucket, (async () => {
    const idx = new Map();
    const objs = await rpc('nas_list_objects', {p_bucket: bucket});
    if(!Array.isArray(objs)) throw new Error('nas_list_objects ตอบผิดรูปแบบ');
    for(const o of objs){
      const m = String((o && o.name) || '').match(/^(.*)-[a-z0-9]{10}(\.[^./]+)?$/);
      if(!m) continue;
      const k = m[1] + (m[2] || '');
      if(!idx.has(k)) idx.set(k, []);
      idx.get(k).push(o.name);
    }
    return idx;
  })().catch(e => { OBJ_INDEX.delete(bucket); throw e; }));
  return OBJ_INDEX.get(bucket);
}
function relinkMoved(url, ref){
  if(!MOVED.has(url)) MOVED.set(url, (async () => {
    const bucket = bucketOf(url); if(!bucket) return null;
    const p = objPathOf(url, bucket); if(!p) return null;
    let idx; try{ idx = await objIndex(bucket); }catch(e){ log('  [!] อ่านรายชื่อไฟล์ใน ' + bucket + ' ไม่ได้ (หาไฟล์ที่ถูกย้ายชื่อไม่ได้): ' + e.message); return null; }
    const c = idx.get(p) || [];
    if(c.length !== 1) return null;                                  // ไม่เจอ / เจอหลายไฟล์ (ไม่เดา)
    const nu = SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + c[0].split('/').map(encodeURIComponent).join('/');
    try{ const h = await fetch(nu, {method: 'HEAD'}); if(!h.ok) return null; }catch(e){ return null; }
    const what = ref + ' ' + path.basename(p) + ' → ' + path.basename(c[0]);
    if(DRY_RUN){ tally('แก้ลิงก์ไฟล์ที่ถูกย้ายชื่อ', 'new'); log('  (ทดลอง) พบไฟล์ที่ถูกย้ายชื่อ จะแก้ลิงก์: ' + what); return nu; }
    let n;
    try{ n = await rpc('nas_relink', {p_old: url, p_new: nu}); }
    catch(e){ log('  [!] แก้ลิงก์ไฟล์ที่ถูกย้ายชื่อไม่ได้ ' + what + ': ' + e.message); return null; }
    tally('แก้ลิงก์ไฟล์ที่ถูกย้ายชื่อ', 'new'); RELINKED.push(ref);
    log('  [แก้ลิงก์] ' + what + ' — ไฟล์ถูกย้ายไปชื่อสุ่ม แต่ลิงก์ในระบบยังชี้ชื่อเดิม (แก้ ' + (Number(n) || 0) + ' จุด)');
    return nu;
  })());
  return MOVED.get(url);
}
/* ไฟล์ในระบบหาย แต่ NAS มีไฟล์ชื่อตรงที่เก็บก่อนมีแผนผัง (.files.json) — ใช้สำเนานี้แทนได้ไหม
   ที่มา: โปรแกรม NAS รุ่นก่อน (27 ก.ย. 2569) ลบสลิปของบิลจ่ายครบออกจาก Supabase หลังเช็คว่ามีไฟล์บน NAS แล้ว
   แต่บันทึกสถานะในฐานข้อมูลไม่สำเร็จ → ไฟล์หาย ลิงก์ค้าง · สำเนาบน NAS คือไฟล์ที่โหลดจากลิงก์นั้นเองก่อนถูกลบ
   ใช้แทนได้เมื่อพิสูจน์ได้ว่าเป็นไฟล์ของลิงก์นี้ ไม่ใช่สลิปใบอื่นของบิลเดียวกัน:
   - เป็นไฟล์รูปจริง (ไม่ใช่ไฟล์เสีย/โหลดค้าง)
   - สลิป: บิลนี้ไม่เคยเปลี่ยนสลิป · จำนวนสลิปบน NAS = จำนวนสลิปในระบบ (ไม่มีใบที่ถูกถอด/เพิ่ม ทำให้ลำดับ _สลิป1 _สลิป2 เลื่อน)
           และไฟล์บน NAS ถูกเก็บ "หลัง" สลิปนี้ถูกแนบ (เก็บก่อน = เป็นสลิปใบเดิมก่อนถูกเปลี่ยน)
   - รูปบิล: ชื่อไฟล์ผูกกับเวอร์ชันบิล (_บิล_v2) = บิลเวอร์ชันเดียวกัน
   ไม่ผ่านข้อใดข้อหนึ่ง = ไม่ใช้ รายงาน "ตรวจเอง" ให้คนเปิดดูภาพ */
const ADOPTED = new Set();        // ลิงก์ที่รอบนี้ใช้สำเนาเก่าบน NAS แทน (ตรวจผ่านแล้ว)
const ADOPTED_AT = new Set();     // "โฟลเดอร์บิล\0ลิงก์" ที่สำเนาในโฟลเดอร์นั้นยืนยันแล้วและรอเก็บเข้าคลัง (ต่อโฟลเดอร์ — สำเนาของบิลอื่นใช้แทนไม่ได้)
const ARCHIVE_BILLS = new Set();  // บิลจ่ายครบเกินกำหนดที่ไฟล์ในระบบหาย → ขั้นตอนลบไฟล์บิลจ่ายครบจะเก็บเข้าคลัง NAS + ล้างลิงก์ที่เสีย
const ARCHIVED_LOST = new Set();  // บิลที่เก็บเข้าคลังแล้วจริงรอบนี้ โดยมีไฟล์ที่หายจากระบบไปก่อน (ใช้สำเนาบน NAS)
const RESTORE_FAILED = [];        // บิลที่กู้ไฟล์กลับไม่ได้รอบนี้ (ลองใหม่รอบตรวจถัดไป)
const LEGACY_SKEW = 2 * 60 * 1000;   // เผื่อนาฬิกาเครื่องพนักงาน/NAS ต่างกัน
// ไฟล์รูปจริงและ "ครบทั้งไฟล์" (หัวไฟล์ถูก + มีจุดจบของไฟล์) — ไฟล์ที่โหลดค้างครึ่งทางไม่ผ่าน
function isImageFile(file){
  let fd = null;
  try{
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size; if(size < 8) return false;
    const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
    const tl = Math.min(size, 65536), t = Buffer.alloc(tl); fs.readSync(fd, t, 0, tl, size - tl);
    const at = needle => { const i = t.lastIndexOf(needle); return i < 0 ? -1 : size - tl + i; };   // ตำแหน่งจริงในไฟล์ของตัวที่พบท้ายสุด
    const s = h.toString('latin1');
    if(h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return at(Buffer.from([0xFF, 0xD9])) >= size / 2;   // JPEG: จุดจบ (EOI) ต้องอยู่ช่วงท้าย (ไม่ใช่ของรูปย่อหัวไฟล์)
    if(s.startsWith('\x89PNG\r\n\x1a\n')){ const i = at('IEND'); return i >= 0 && i >= size - 1024; }
    if(s.startsWith('GIF8')) return t.subarray(Math.max(0, tl - 16)).includes(0x3B);
    if(s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return h.readUInt32LE(4) + 8 <= size;
    if(s.startsWith('%PDF')){ const i = at('%%EOF'); return i >= 0 && i >= size - 1024; }
    return false;
  }catch(e){ return false; }
  finally{ if(fd !== null) try{ fs.closeSync(fd); }catch(e){} }
}
// เวลาที่ลิงก์นี้ถูกแนบกับบิล: เวลาในชื่อไฟล์ (slip_<บิล>_<เวลา>…) → เวลาบันทึกการชำระ → เวลาจ่ายครบ
function linkTimeOf(b, url){
  let nm = ''; try{ nm = decodeURIComponent(String(url || '').split('?')[0].split('/').pop()); }catch(e){}
  const m = nm.match(/^(?:slip|bill|receipt)_.*_(\d{13})(?=[-_.]|$)/);
  if(m){ const t = Number(m[1]); if(t > Date.UTC(2024, 0, 1) && t < Date.now() + 86400000) return t; }
  let t = null;
  for(const p of (Array.isArray(b.payments) ? b.payments : []))
    if(Array.isArray(p.slips) && p.slips.includes(url)){ const x = Date.parse(p.created_at); if(!isNaN(x) && (t === null || x < t)) t = x; }
  if(t === null && url === b.slip_url && b.paid_at){ const x = Date.parse(b.paid_at); if(!isNaN(x)) t = x; }
  return t;
}
// '' = ใช้แทนได้ · อื่น ๆ = เหตุผลที่ใช้ไม่ได้ (cache = ต่อบิล)
function legacyCheck(b, files, billDir, man, url, kind, name, cache){
  const file = path.join(billDir, name);
  if(!isImageFile(file)) return 'ไฟล์บน NAS ไม่ใช่รูปภาพ/ไฟล์เสีย';
  if(kind !== 'slip') return '';
  if(Object.keys(man).some(k => k.startsWith('legacy:'))) return 'บิลนี้เคยเปลี่ยนสลิป';
  if(cache.nasSlips === undefined){
    const re = new RegExp('^' + safeName(b.bill_no).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_สลิป\\d+\\.[A-Za-z0-9]+$');
    let ls = []; try{ ls = fs.readdirSync(billDir); }catch(e){}
    cache.nasSlips = ls.filter(n => re.test(n) && onNas(path.join(billDir, n))).length;
  }
  const nSys = files.filter(x => x[2] === 'slip').length;
  if(cache.nasSlips !== nSys) return 'จำนวนสลิปบน NAS (' + cache.nasSlips + ') ไม่เท่ากับในระบบ (' + nSys + ')';
  const t = linkTimeOf(b, url);
  if(t === null) return 'ไม่รู้เวลาที่แนบสลิปนี้';
  let mt = 0; try{ mt = fs.statSync(file).mtimeMs; }catch(e){}
  if(mt < t - LEGACY_SKEW) return 'ไฟล์บน NAS เก็บไว้ก่อนสลิปนี้ถูกแนบ — อาจเป็นสลิปใบเดิมก่อนเปลี่ยน';
  return '';
}
// บิลที่ขั้นตอน "ลบไฟล์บิลจ่ายครบ" จะเก็บเข้าคลัง NAS (ส่งของแล้ว + จ่ายครบเกินกำหนด)
function prunableBill(b){
  if(!CFG.PRUNE_PAID_BILLS || b.ship_status !== 'shipped' || b.payment_status !== 'paid' || !b.paid_at) return false;
  return new Date(b.paid_at).getTime() <= Date.now() - CFG.PRUNE_PAID_AFTER_DAYS * 24 * 3600 * 1000;
}
let ARCHIVE_OK = null;   // ฐานข้อมูลพร้อมเก็บเข้าคลังไหม (nas_mark_pruned รุ่นใหม่) — ถามครั้งเดียวต่อรอบ
function archiveReady(){
  if(!CFG.PRUNE_PAID_BILLS) return Promise.resolve(false);
  if(DRY_RUN) return Promise.resolve(true);
  if(!ARCHIVE_OK) ARCHIVE_OK = rpc('nas_mark_pruned', {p_bill_id: -1, p_nas_path: ''}).then(p => !!(p && Array.isArray(p.safe)), () => false);
  return ARCHIVE_OK;
}
const KIND_TH = {slip: 'สลิป', bill: 'รูปบิล', receipt: 'ใบเสร็จรายจ่าย', doc: 'เอกสารเครดิต', statement: 'ใบวางบิล', product: 'รูปสินค้า'};
function issueText(list, open){
  const L = ['⚠️ NAS สำรองไฟล์ไม่ได้ ' + list.length + ' ไฟล์ (ไฟล์พวกนี้ระบบจะยังไม่ลบออกจาก Supabase)'];
  list.slice(0, 15).forEach(x => {
    const what = (KIND_TH[x.kind] || x.kind) + (x.ref ? ' ' + x.ref : '');
    L.push('• ' + what + ' — ' + (x.reason === 'gone'
      ? 'ไฟล์ไม่มีแล้วทั้งใน Supabase และ NAS' + (x.kind === 'slip' ? ' → ขอสลิปจากแชทไลน์ร้าน แล้วกด \u{1F4CE} แนบสลิปแทน ในประวัติการชำระ · หาไม่เจอ กด \u{1F648} ช่างมัน ในหลังบ้าน (ไม่แจ้งอีก)' : x.kind === 'bill' ? ' → กดสร้างรูปบิลใหม่ในหลังบ้าน' : '')
      : x.reason === 'nas_unverified'
      ? 'ไฟล์ในระบบหาย · ' + (x.detail || 'NAS มีสำเนา') + ' (ยืนยันไม่ได้ว่าใบเดียวกัน) → เปิดดูภาพ ถ้าใช่ กด \u{1F4CE} แนบสลิปแทน · ไม่ใช่/ไม่ต้องการ กด \u{1F648} ช่างมัน'
      : 'โหลดไม่ได้ติดกัน ' + x.fail_count + ' รอบ (' + (x.detail || '') + ')'));
  });
  if(list.length > 15) L.push('…และอีก ' + (list.length - 15) + ' ไฟล์');
  if(open) L.push('ยังค้างทั้งหมด ' + open + ' ไฟล์ — ดูในหลังบ้าน: บัญชี → \u{1F50D} ตรวจสลิป/ไฟล์หาย');
  return L.join('\n');
}
async function linePush(to, text){
  try{
    const r = await fetch(SUPABASE_URL + '/functions/v1/line-push', {method: 'POST',
      headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({to, messages: [{type: 'text', text: String(text).slice(0, 4900)}]})});
    let d = null; try{ d = await r.json(); }catch(e){}
    if(r.ok && d && (d.status === 200 || d.ok === true)) return true;
    log('  [!] line-push ตอบกลับ HTTP ' + r.status + ': ' + String(JSON.stringify(d) || '(ไม่มีเนื้อหา)').slice(0, 300));   // บอกสาเหตุ (กลุ่มไลน์ผิด/บอทไม่อยู่ในกลุ่ม/สิทธิ์)
    return false;
  }catch(e){ log('  [!] ติดต่อ line-push ไม่ได้: ' + (e.message || e)); return false; }
}
// ส่งรายการที่สำรองไม่ได้ขึ้น Supabase (nas_issues) → ได้รายการที่ต้องแจ้งตอนนี้ → ส่งกลุ่มรีพอร์ต (ส่งเองไม่ได้ = หลังบ้านส่งแทน)
async function reportIssues(fullKinds){
  const items = [...ISSUES.values()];
  if(DRY_RUN){
    if(items.length) log('(ทดลอง) สำรองไม่ได้ ' + items.length + ' ไฟล์: ' + items.slice(0, 5).map(x => (KIND_TH[x.kind] || x.kind) + ' ' + x.ref + ' [' + x.reason + ']').join(', ') + (items.length > 5 ? ' …' : ''));
    return;
  }
  const stp = readState();
  if(Array.isArray(stp.pendingConfirm) && stp.pendingConfirm.length){        // รอบก่อนส่งไลน์ได้แต่ยืนยันไม่ทัน → ยืนยันก่อน
    try{ await rpc('nas_notify_result', {p_ids: stp.pendingConfirm, p_ok: true}); delete stp.pendingConfirm; writeState(stp); }catch(e){}
  }
  let res;
  try{ res = await rpc('nas_report_issues', {p_items: items, p_ok_urls: [...OK_URLS].filter(u => !ISSUES.has(u)), p_full_kinds: fullKinds || []}); }
  catch(e){
    log('[!] ส่งรายการไฟล์ที่สำรองไม่ได้เข้า Supabase ไม่ได้: ' + e.message + (/404|PGRST202/.test(e.message) ? ' (รัน mix888-nas-key-fix.sql ฉบับล่าสุด)' : ''));
    items.forEach(x => log('  [สำรองไม่ได้] ' + (KIND_TH[x.kind] || x.kind) + ' ' + x.ref + ' — ' + x.reason + ' ' + x.detail));
    return;
  }
  if(items.length) log('[!] สำรองไม่ได้รอบนี้ ' + items.length + ' ไฟล์ · ค้างรวม ' + (res.open || 0) + ' ไฟล์ (ไม่ลบออกจาก Supabase)');
  const list = Array.isArray(res.notify) ? res.notify : [];
  let text = list.length ? issueText(list, res.open) : '';
  if(RESTORED.length) text = '♻️ กู้ไฟล์จาก NAS กลับขึ้นระบบอัตโนมัติ ' + RESTORED.length + ' ไฟล์ (ไฟล์ในระบบหาย แต่ NAS มีสำเนา): '
    + RESTORED.slice(0, 20).join(', ') + (RESTORED.length > 20 ? ' …' : '') + (text ? '\n\n' + text : '');
  if(RELINKED.length) text = '\u{1F527} แก้ลิงก์ไฟล์ที่ถูกย้ายชื่อให้แล้ว ' + RELINKED.length + ' ไฟล์ (ไฟล์ยังอยู่ครบ ไม่ได้หาย · เรื่องของไฟล์เหล่านี้ที่เคยแจ้งไว้ ปิดให้แล้ว): '
    + [...new Set(RELINKED)].slice(0, 20).join(', ') + (new Set(RELINKED).size > 20 ? ' …' : '') + (text ? '\n\n' + text : '');
  const adoptedOk = [...ADOPTED].filter(u => !ISSUES.has(u)).length;   // นับเฉพาะที่จัดการสำเร็จ (กู้/เก็บเข้าคลังไม่ได้ = ยังค้าง)
  if(adoptedOk || ARCHIVED_LOST.size || RESTORE_FAILED.length) text = '\u{1F5C4} ไฟล์ที่หายจาก Supabase แต่ NAS มีสำเนา — ใช้สำเนาบน NAS แทน'
    + (adoptedOk ? ' (สำเนาที่เก็บไว้ก่อนมีแผนผัง ตรวจแล้วว่าเป็นไฟล์เดียวกัน ' + adoptedOk + ' ไฟล์ · เรื่อง "ตรวจเอง" ของไฟล์เหล่านี้ปิดให้แล้ว)' : '')
    + (ARCHIVED_LOST.size ? '\n• บิลจ่ายครบเกิน ' + CFG.PRUNE_PAID_AFTER_DAYS + ' วัน ' + ARCHIVED_LOST.size + ' ใบ → เก็บเข้าคลัง NAS แล้ว (หลังบ้านจะขึ้นว่าเก็บที่ NAS พร้อมชื่อโฟลเดอร์ · อยากดูในระบบอีก ใช้ --restore-bill)' : '')
    + (RESTORED.length ? '\n• บิลอื่น → อัปโหลดกลับขึ้นระบบแล้ว (รายการด้านล่าง)' : '')
    + (RESTORE_FAILED.length ? '\n• กู้กลับไม่ได้ ' + RESTORE_FAILED.length + ' ไฟล์ (' + [...new Set(RESTORE_FAILED)].slice(0, 10).join(', ') + ') — สำเนายังอยู่บน NAS จะลองใหม่รอบตรวจถัดไป' : '')
    + (text ? '\n\n' + text : '');
  if(!text) return;
  const gid = res.report_group;
  const ok = gid ? await linePush(gid, text) : false;
  if(list.length){
    let confirmed = false;
    for(let k = 0; k < 3 && !confirmed; k++){
      try{ await rpc('nas_notify_result', {p_ids: list.map(x => x.id), p_ok: ok}); confirmed = true; }
      catch(e){ await new Promise(z => setTimeout(z, 2000 * (k + 1))); }
    }
    if(!confirmed && ok){ const st2 = readState(); st2.pendingConfirm = [...new Set([...(st2.pendingConfirm || []), ...list.map(x => x.id)])]; writeState(st2); log('[!] ส่งไลน์แล้วแต่บันทึกยืนยันไม่ได้ — จดไว้ยืนยันรอบหน้า (กันแจ้งซ้ำ)'); }
  }
  log(ok ? '[แจ้งไลน์] ส่งเข้ากลุ่มรีพอร์ตแล้ว'
     : !gid ? '[!] ยังไม่ได้ตั้งกลุ่มรีพอร์ตในหลังบ้าน (ผู้ใช้ระบบ → ตั้งค่า) — ไม่ได้แจ้งไลน์ · ดูรายการได้ที่หลังบ้าน บัญชี → ตรวจสลิป/ไฟล์หาย · ข้อความ:\n' + text
     : '[!] ส่งไลน์จาก NAS ไม่ได้' + (list.length ? ' — หลังบ้านที่เปิดอยู่จะส่งรายการไฟล์ที่สำรองไม่ได้แทน' : '') + (RESTORED.length ? ' (แจ้งกู้คืนอัตโนมัติไม่ได้ส่ง ดูใน log นี้)' : '') + ' · ข้อความ:\n' + text);
}

/* ================= ข้อมูลลูกค้าเครดิต + ใบวางบิล ================= */
const CUST_DIR = 'ข้อมูลลูกค้า', STMT_DIR = 'ใบวางบิล', ID_FILE = '.customer_id';
const DOC_LABEL = {id_card:'สำเนาบัตรประชาชน', house_reg:'สำเนาทะเบียนบ้าน', pp20:'ใบภพ20', company_cert:'หนังสือรับรองบริษัท', dir_id_card:'สำเนาบัตรประชาชนกรรมการ', dir_house_reg:'สำเนาทะเบียนบ้านกรรมการ'};
function stampOf(iso){ const d = new Date(new Date(iso || Date.now()).getTime() + 7*3600*1000); return d.toISOString().slice(0,16).replace('T','-').replace(':',''); }
// ไฟล์ใน bucket ส่วนตัว (credit-docs): ขอลิงก์ชั่วคราวก่อนแล้วค่อยโหลด
async function downloadPrivate(bucket, objPath, dest){
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/sign/' + bucket + '/' + objPath.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({expiresIn: 600})});
  if(!r.ok){ const e = new Error('ขอลิงก์ไฟล์ไม่ได้ (' + r.status + ')'); e.status = r.status; throw e; }
  const d = await r.json();
  if(!d || !d.signedURL) throw new Error('ไม่ได้ลิงก์ไฟล์');
  await download(SUPABASE_URL + '/storage/v1' + d.signedURL, dest);
}
async function apiAll(pathAndQuery, pageSize = 1000){   // อ่านทีละหน้า (PostgREST) จนหมด
  const out = [];
  for(let off = 0; ; off += pageSize){
    const page = await api(pathAndQuery + '&limit=' + pageSize + '&offset=' + off);
    out.push(...page); if(page.length < pageSize) break;
  }
  return out;
}
// ไม่เขียนทับถ้าเนื้อหาเหมือนเดิม (ลดการเขียน NAS ทุกรอบ) · ignore = ส่วนที่เปลี่ยนทุกรอบแต่ไม่ใช่ข้อมูล (เวลา "อัปเดต") ไม่นับว่าเปลี่ยน
function writeIfChanged(file, content, ignore){
  const norm = s => ignore ? s.replace(ignore, '') : s;
  try{ if(fs.existsSync(file) && norm(fs.readFileSync(file, 'utf8')) === norm(content)) return false; }catch(e){}
  fs.writeFileSync(file, content); return true;
}
const STAMP_RE = /อัปเดต(?:ล่าสุด:)? \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/g;   // เวลาที่เขียนไฟล์ (thDateTimeStr) — เวลาในไฟล์ = ครั้งล่าสุดที่ข้อมูลเปลี่ยนจริง
const PAY_TH = {prepay: 'จ่ายก่อนส่ง', postpay: 'จ่ายหลังส่ง', credit: 'เครดิต'};
const CR_TH  = {pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ตีกลับ'};
// ข้อมูลตารางที่โปรแกรมใช้ (ลูกค้า สินค้า ราคา ออเดอร์ รายจ่าย …) — อ่านทีละตาราง ทีละ 2,000 แถว ผ่าน RPC nas_export_table (ตารางเหล่านี้อ่านตรงไม่ได้)
// (เดิมดึงรวดเดียวด้วย nas_export_data — ข้อมูลเยอะขึ้นจนเกินเวลาที่ Supabase ให้ต่อคำสั่ง ถูกยกเลิก (statement timeout) → ข้อมูลลูกค้า/รูปสินค้าไม่ถูกเก็บ)
let DATA = null;
const TABLE_CACHE = new Map();   // ตาราง → Promise<แถวทั้งหมด> (รอบเดียวกันอ่านครั้งเดียว ใช้ร่วมกับสำรองตาราง)
function exportTable(table){
  if(!TABLE_CACHE.has(table)) TABLE_CACHE.set(table, (async () => {
    const rows = [];
    for(let off = 0; ; off += 2000){                  // ทีละ 2,000 แถว กัน statement timeout ของ Supabase
      const page = await rpc('nas_export_table', {p_table: table, p_offset: off, p_limit: 2000});
      if(!Array.isArray(page)) throw new Error('nas_export_table ' + table + ' ตอบผิดรูปแบบ');
      rows.push(...page); if(page.length < 2000) break;
    }
    return rows;
  })().catch(e => { TABLE_CACHE.delete(table); throw e; }));
  return TABLE_CACHE.get(table);
}
const DATA_TABLES = ['customers','products','customer_prices','price_log','line_groups','credit_docs','petty_cash','expense_categories','credit_statements','orders','order_items'];
const dataOk = (D, ...ts) => !!(D && D._ok) && ts.every(t => D._ok.has(t));   // อ่านตารางเหล่านี้ได้ครบจริง (ไม่ใช่ 0 แถวเพราะอ่านไม่ได้)
async function loadData(){
  if(DATA) return DATA;
  const since = new Date(Date.now() - CFG.ORDER_HISTORY_DAYS * 24 * 3600 * 1000).toISOString();
  const D = {_ok: new Set()}, bad = [];
  for(const t of DATA_TABLES){
    try{ D[t] = (await exportTable(t)).map(r => Object.assign({}, r)); D._ok.add(t); }   // สำเนา — ส่วนเก็บลูกค้าเติมช่องเสริม ไม่ให้ปนไปในไฟล์สำรองตาราง
    catch(e){ D[t] = []; bad.push(t + ' (' + String(e.message || e).slice(0, 120) + ')'); }
  }
  if(bad.length < DATA_TABLES.length){
    if(bad.length) log('[!] อ่านตารางไม่ได้รอบนี้: ' + bad.join(' · ') + ' — ส่วนที่เกี่ยวข้องจะเก็บเท่าที่ได้ และไม่ลบ/ไม่ปิดเรื่องอะไรจากข้อมูลที่ไม่ครบ');
    const sinceMs = new Date(since).getTime(), itemsOf = {};
    for(const it of D.order_items) (itemsOf[it.order_id] = itemsOf[it.order_id] || []).push({product_id: it.product_id, qty: it.qty, price: it.price, amount: it.amount});
    D.orders = D.orders.filter(o => new Date(o.created_at).getTime() >= sinceMs)
      .map(o => ({id: o.id, order_no: o.order_no, customer_id: o.customer_id, created_at: o.created_at, status: o.status, total: o.total, created_by: o.created_by, order_items: itemsOf[o.id] || []}));
    if(!dataOk(D, 'order_items')) D._ok.delete('orders');
    delete D.order_items;
    D._via = 'rpc';
    DATA = D; return DATA;
  }
  log('[!] อ่านตารางผ่าน nas_export_table ไม่ได้เลย (' + bad[0] + ') — ลองแบบเดิม');
  try{ DATA = await rpc('nas_export_data', {p_since: since}); DATA._via = 'rpc'; DATA._ok = new Set(DATA_TABLES); return DATA; }
  catch(e){ log('[!] เรียก nas_export_data ไม่สำเร็จ (' + e.message + ') — ลองอ่านตารางตรง (ถ้าได้ 0 แถว = รัน mix888-nas-key-fix.sql ใน Supabase)'); }
  DATA = {_via: 'rest', _ok: new Set()};
  const get = async (t, q) => { try{ return await apiAll('/rest/v1/' + t + '?select=*' + (q || '')); }catch(e){ return []; } };
  DATA.customers = await get('customers', '&order=code.asc');
  DATA.products = await get('products'); DATA.customer_prices = await get('customer_prices'); DATA.price_log = await get('price_log', '&order=id.asc');
  DATA.line_groups = await get('line_groups'); DATA.credit_docs = await get('credit_docs'); DATA.petty_cash = await get('petty_cash', '&order=spent_at.asc');
  DATA.expense_categories = await get('expense_categories'); DATA.credit_statements = await get('credit_statements');
  try{ DATA.orders = await apiAll('/rest/v1/orders?select=id,order_no,customer_id,created_at,status,total,created_by,order_items(product_id,qty,price,amount)&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.asc'); }catch(e){ DATA.orders = []; }
  return DATA;
}
function readIdFile(dir){ try{ return fs.readFileSync(path.join(dir, ID_FILE), 'utf8').trim(); }catch(e){ return null; } }
// โฟลเดอร์ลูกค้าตามรหัสปัจจุบัน — ถ้ารหัสเปลี่ยน (โฟลเดอร์เก่ามี .customer_id ตรงกัน) ให้เปลี่ยนชื่อโฟลเดอร์ตาม
// โฟลเดอร์ตามรหัสลูกค้า (จำตัวตนด้วยไฟล์ .customer_id) — รหัสเปลี่ยน → เปลี่ยนชื่อโฟลเดอร์ + ไฟล์ข้างในที่ขึ้นต้นด้วยรหัสเดิม
function ensureDirById(base, id, code, idToDir){
  const want = path.join(base, safeName(code));
  const old = idToDir[String(id)];
  if(old && old !== want && fs.existsSync(old)){
    if(fs.existsSync(want)){
      log('  [!] โฟลเดอร์ ' + safeName(code) + ' มีอยู่แล้ว — โฟลเดอร์เดิม ' + path.basename(old) + ' ไม่ได้ย้าย (รวมเองด้วยมือ)');
      return old;
    }
    try{
      fs.renameSync(old, want);
      const oldCode = path.basename(old), newCode = safeName(code);
      for(const f of fs.readdirSync(want)){
        let nf = null;
        if(f.startsWith(oldCode + '_')) nf = newCode + f.slice(oldCode.length);
        else if(f.endsWith('_' + oldCode + '.txt')) nf = f.slice(0, -(oldCode.length + 4)) + newCode + '.txt';
        if(nf && !fs.existsSync(path.join(want, nf))){ try{ fs.renameSync(path.join(want, f), path.join(want, nf)); }catch(e){} }
      }
      log('  [โฟลเดอร์] เปลี่ยนชื่อโฟลเดอร์ ' + oldCode + ' → ' + newCode + ' (ไฟล์ข้างในเปลี่ยนชื่อตาม)');
    }catch(e){ log('  [!] เปลี่ยนชื่อโฟลเดอร์ ' + path.basename(old) + ' ไม่ได้ — ' + e.message); return old; }
  }
  fs.mkdirSync(want, {recursive: true});
  try{ fs.writeFileSync(path.join(want, ID_FILE), String(id)); }catch(e){}
  return want;
}
function readIdMap(base){
  const m = {};
  if(!fs.existsSync(base)) return m;
  for(const name of fs.readdirSync(base, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name)){
    const id = readIdFile(path.join(base, name)); if(id) m[id] = path.join(base, name);
  }
  return m;
}
function custInfoText(c){
  const sched = Array.isArray(c.credit_schedule) ? c.credit_schedule : [];
  const L = [];
  L.push('ข้อมูลลูกค้า ' + c.code + ' — ' + (c.name || '') + (c.branch_name ? ' • ' + c.branch_name : ''));
  L.push('อัปเดตล่าสุด: ' + thDateTimeStr(new Date().toISOString()));
  L.push('');
  L.push('ผู้ติดต่อ: ' + (c.contact_name || '-') + '   โทร: ' + (c.phone || '-'));
  L.push('ที่อยู่ออกบิล: ' + (c.billing_address || '-'));
  L.push('ที่อยู่จัดส่ง: ' + (c.ship_address || '-'));
  L.push('เลขผู้เสียภาษี: ' + (c.tax_id || '-') + '   เซลล์: ' + (c.sale_name || '-'));
  L.push('');
  const pt = c.pay_type || 'prepay';
  if(pt === 'credit'){
    L.push('ประเภทการชำระ: เครดิต (' + (c.credit_entity === 'company' ? 'บริษัท/นิติบุคคล' : 'บุคคลธรรมดา') + ')');
    L.push('เงื่อนไข: ' + (c.credit_mode === 'schedule' ? 'ตามรอบวางบิล' : 'เครดิต ' + (c.credit_days || 0) + ' วัน'));
    if(sched.length){
      L.push('ตารางรอบวางบิล:');
      sched.forEach((p, i) => L.push('  งวด ' + (i+1) + ': ยอด ' + p.from + ' ถึง ' + p.to + ' · วางบิล ' + p.bill + ' · ชำระ ' + p.due));
    }
    L.push('สถานะเครดิต: ' + (CR_TH[c.credit_status] || c.credit_status || '-') + ' โดย ' + (c.credit_reviewed_by || '-') + ' เมื่อ ' + (c.credit_reviewed_at ? thDateTimeStr(c.credit_reviewed_at) : '-'));
  }else L.push('ประเภทการชำระ: ' + (PAY_TH[pt] || pt));
  L.push('กลุ่มราคา: ' + ({base:'ราคากลาง', r20:'เรท 20 ลัง', r50:'เรท 50 ลัง', upc:'รวมส่งตจว'}[c.price_group] || c.price_group || 'ราคากลาง') + '   วิธีส่ง: ' + (c.delivery_method || '-') + '   เวลารับของ: ' + (c.receive_time || '-'));
  L.push('ประเภทบิล: ' + (c.doc_type || '-') + (c.hide_prices ? '   (ซ่อนราคาจากหน้าสั่งของ)' : ''));
  L.push('Google Map: ' + (c.map_link || '-'));
  L.push('กลุ่ม LINE: ' + (c.line_group_name ? c.line_group_name + ' (' + c.line_group_id + ')' : (c.line_group_id || '-')));
  if(c.parent_code) L.push('เป็นสาขาของ: ' + c.parent_code + (c.branch_name ? ' (' + c.branch_name + ')' : ''));
  if(c.note) L.push('หมายเหตุ: ' + c.note);
  if(c.crm_note) L.push('โน้ต CRM: ' + c.crm_note);
  L.push('สถานะ: ' + (c.active === false ? 'ปิดใช้งาน' : 'ใช้งาน') + '   เพิ่มเมื่อ: ' + (c.created_at ? thDateTimeStr(c.created_at) : '-'));
  if(c._stats) L.push('ยอดซื้อ (ย้อนหลัง ' + CFG.ORDER_HISTORY_DAYS + ' วัน): ' + c._stats.orders + ' ออเดอร์ · ' + Number(c._stats.total).toLocaleString('th-TH') + ' บาท · ล่าสุด ' + (c._stats.last ? thDateTimeStr(c._stats.last) : '-'));
  return '\uFEFF' + L.join('\r\n') + '\r\n';
}
async function syncCustomers(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const base = path.join(ROOT, CUST_DIR);
  fs.mkdirSync(base, {recursive: true});
  const D = await loadData();
  if(dataOk(D, 'customers', 'credit_docs')) FULL_KINDS.add('doc');
  const custs = [...(D.customers || [])].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
  const docs  = D.credit_docs || [], prods = D.products || [], cps = D.customer_prices || [];
  const plog  = [...(D.price_log || [])].sort((a, b) => a.id - b.id);
  const lgroups = {}; (D.line_groups || []).forEach(g => lgroups[g.group_id] = g.name);
  const orders = [...(D.orders || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  log('ลูกค้า ' + custs.length + ' ราย · จัดสินค้า ' + cps.length + ' แถว · ประวัติราคา ' + plog.length + ' · ออเดอร์ ' + orders.length + (dataOk(D, 'customers') ? '' : ' (อ่านข้อมูลลูกค้าไม่ได้ — ดูข้อความ [!] ด้านบน)'));
  const P = {}; prods.forEach(p => P[p.id] = p);
  const codeOf = {}; custs.forEach(c => codeOf[c.id] = c.code);
  const effPrice = (p, grp) => { const v = grp === 'r20' ? p.price_r20 : grp === 'r50' ? p.price_r50 : grp === 'upc' ? p.price_upc : null; return (v != null && v !== '') ? Number(v) : Number(p.base_price || 0); };
  const priceName = grp => ({base:'ราคากลาง', r20:'เรท 20 ลัง', r50:'เรท 50 ลัง', upc:'รวมส่งตจว'}[grp] || 'ราคากลาง');
  const fieldTh = f => ({price:'ราคาลูกค้า', base_price:'ราคากลาง', price_r20:'เรท 20 ลัง', price_r50:'เรท 50 ลัง', price_upc:'รวมส่งตจว'}[f] || f || '');
  // สถิติซื้อต่อลูกค้า
  const stats = {};
  orders.forEach(o => { if((o.status || '') === 'cancelled') return; const st = stats[o.customer_id] || (stats[o.customer_id] = {orders: 0, total: 0, last: null}); st.orders++; st.total += Number(o.total || 0); if(!st.last || o.created_at > st.last) st.last = o.created_at; });
  // รายชื่อลูกค้ารวม
  const head = ['รหัส','ชื่อร้าน','สาขา','สาขาของ','เซลล์','ประเภทจ่าย','เครดิต','สถานะเครดิต','ผู้ติดต่อ','โทร','ที่อยู่ออกบิล','ผู้รับของ','โทรผู้รับ','ที่อยู่จัดส่ง','วิธีส่ง','เวลารับของ','กลุ่มราคา','ประเภทบิล','ซ่อนราคา','กลุ่ม LINE','ชื่อกลุ่ม LINE','โน้ต CRM','หมายเหตุ','สถานะ','เพิ่มเมื่อ','ออเดอร์ (' + CFG.ORDER_HISTORY_DAYS + ' วัน)','ยอดซื้อ','สั่งล่าสุด'];
  const lines = [head.map(csvCell).join(',')];
  for(const c of custs){
    const st = stats[c.id] || {orders: 0, total: 0, last: null};
    lines.push([c.code, c.name, c.branch_name || '', c.parent_id ? (codeOf[c.parent_id] || '') : '', c.sale_name || '', PAY_TH[c.pay_type || 'prepay'] || c.pay_type,
      c.pay_type === 'credit' ? (c.credit_mode === 'schedule' ? 'ตามรอบวางบิล' : (c.credit_days || 0) + ' วัน') : '', c.pay_type === 'credit' ? (CR_TH[c.credit_status] || '') : '',
      c.contact_name || '', c.phone || '', c.billing_address || '', c.ship_receiver || '', c.ship_phone || '', c.ship_address || '', c.delivery_method || '', c.receive_time || '',
      priceName(c.price_group), c.doc_type || '', c.hide_prices ? 'ใช่' : '', c.line_group_id || '', lgroups[c.line_group_id] || '', c.crm_note || '', c.note || '',
      c.active === false ? 'ปิดใช้งาน' : 'ใช้งาน', c.created_at ? thDateTimeStr(c.created_at) : '', st.orders, st.total, st.last ? thDateTimeStr(st.last) : ''].map(csvCell).join(','));
  }
  writeIfChanged(path.join(base, 'รายชื่อลูกค้า.csv'), '\uFEFF' + lines.join('\r\n'));
  // รายลูกค้า
  const idToDir = readIdMap(base);
  const cpBy = {}; cps.forEach(r => (cpBy[r.customer_id] = cpBy[r.customer_id] || []).push(r));
  const plBy = {}; plog.forEach(r => { if(r.customer_id != null) (plBy[r.customer_id] = plBy[r.customer_id] || []).push(r); });
  const plCentral = plog.filter(r => r.customer_id == null);
  const oBy = {}; orders.forEach(o => (oBy[o.customer_id] = oBy[o.customer_id] || []).push(o));
  for(const c of custs){
    if(!String(c.code || '').trim()) continue;                       // ไม่มีรหัสลูกค้า = ไม่มีชื่อโฟลเดอร์ (อยู่ในรายชื่อลูกค้า.csv แล้ว)
    c.line_group_name = lgroups[c.line_group_id] || ''; c.parent_code = c.parent_id ? codeOf[c.parent_id] : ''; c._stats = stats[c.id] || null;
    const dir = ensureDirById(base, c.id, c.code, idToDir);
    if(writeIfChanged(path.join(dir, 'ข้อมูลลูกค้า_' + safeName(c.code) + '.txt'), custInfoText(c), STAMP_RE)) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have');
    // จัดสินค้า (ปัจจุบัน)
    const rows = (cpBy[c.id] || []).map(r => ({r, p: P[r.product_id]})).filter(x => x.p).sort((a, b) => String(a.p.sku || '').localeCompare(String(b.p.sku || '')));
    const L1 = [['SKU','สินค้า','หน่วย','ราคาที่ตั้งให้ลูกค้า','ราคาตามกลุ่ม (' + priceName(c.price_group) + ')','ราคากลาง','ต่างจากราคากลาง','ราคาที่ใช้จริง'].map(csvCell).join(',')];
    rows.forEach(({r, p}) => { const grp = effPrice(p, c.price_group); const use = (r.price != null && r.price !== '') ? Number(r.price) : grp;
      L1.push([p.sku || '', p.name || '', p.unit || '', r.price != null ? Number(r.price) : '', grp, Number(p.base_price || 0), (use - Number(p.base_price || 0)).toFixed(2), use].map(csvCell).join(',')); });
    L1.push('', ['', 'สินค้าที่จัดให้ ' + rows.length + ' รายการ · อัปเดต ' + thDateTimeStr(new Date().toISOString())].map(csvCell).join(','));
    if(rows.length){ if(writeIfChanged(path.join(dir, 'จัดสินค้า_' + safeName(c.code) + '.csv'), '\uFEFF' + L1.join('\r\n'), STAMP_RE)) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have'); }
    // ประวัติราคา (ของลูกค้ารายนี้ + ราคากลางเฉพาะสินค้าที่จัดให้)
    const assignedIds = new Set(rows.map(x => x.p.id));
    const hist = [...(plBy[c.id] || []), ...plCentral.filter(r => assignedIds.has(r.product_id))].sort((a, b) => a.id - b.id);
    if(hist.length){
      const L2 = [['วันเวลา','SKU','สินค้า','รายการ','ราคาเก่า','ราคาใหม่','เปลี่ยน','โดย','ที่มา'].map(csvCell).join(',')];
      hist.forEach(r => { const p = P[r.product_id] || {}; L2.push([thDateTimeStr(r.changed_at), p.sku || '', p.name || '', (r.customer_id == null ? 'ราคากลาง: ' : '') + fieldTh(r.field) + (r.action ? ' (' + r.action + ')' : ''),
        r.old_price ?? '', r.new_price ?? '', (r.old_price != null && r.new_price != null) ? (Number(r.new_price) - Number(r.old_price)).toFixed(2) : '', r.changed_by || '', r.source || ''].map(csvCell).join(',')); });
      if(writeIfChanged(path.join(dir, 'ประวัติราคา_' + safeName(c.code) + '.csv'), '\uFEFF' + L2.join('\r\n'))) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have');
    }
    // ประวัติสั่งซื้อ (รายบรรทัดสินค้า)
    const os = oBy[c.id] || [];
    if(os.length){
      const L3 = [['วันเวลา','เลขออเดอร์','สถานะ','ผู้สั่ง','SKU','สินค้า','จำนวน','หน่วย','ราคา/หน่วย','จำนวนเงิน','ยอดออเดอร์'].map(csvCell).join(',')];
      os.forEach(o => (Array.isArray(o.order_items) ? o.order_items : []).forEach(it => { const p = P[it.product_id] || {};
        L3.push([thDateTimeStr(o.created_at), o.order_no || '', o.status === 'cancelled' ? 'ยกเลิก' : (o.status || ''), o.created_by || 'ลูกค้าสั่งเอง', p.sku || '', p.name || '', Number(it.qty || 0), p.unit || '', Number(it.price || 0), Number(it.amount || 0), Number(o.total || 0)].map(csvCell).join(',')); }));
      if(writeIfChanged(path.join(dir, 'ประวัติสั่งซื้อ_' + safeName(c.code) + '.csv'), '\uFEFF' + L3.join('\r\n'))) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have');
    }
    // เอกสารเครดิต (เฉพาะอนุมัติแล้ว)
    if(c.pay_type === 'credit' && c.credit_status === 'approved'){
      for(const d of docs.filter(x => x.customer_id === c.id)){
        const name = safeName(c.code) + '_' + (DOC_LABEL[d.doc_type] || d.doc_type) + '_' + stampOf(d.uploaded_at) + extOf(d.file_name || d.file_path);
        const dest = path.join(dir, name);
        const key = 'credit-docs/' + d.file_path;
        if(fs.existsSync(dest)){ skipped++; tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'have'); continue; }
        try{ await downloadPrivate('credit-docs', d.file_path, dest); saved++; noteOk(key); tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'new'); log('  [เก็บ] ' + path.join(CUST_DIR, safeName(c.code), name)); }
        catch(e){ if(isGone(e) && isAccepted(key)) continue; failed++; noteIssue('doc', c.code + ' ' + (DOC_LABEL[d.doc_type] || d.doc_type), key, e); tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'fail'); log('  [!] โหลดเอกสาร ' + c.code + ' ' + name + ' ไม่ได้ — ' + e.message); }
      }
    }
  }
  return {saved, skipped, failed};
}
async function syncStatements(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const D = await loadData();
  if(dataOk(D, 'credit_statements', 'customers')) FULL_KINDS.add('statement');
  const codeOf = {}; (D.customers || []).forEach(c => codeOf[c.id] = c.code);
  const rows = (D.credit_statements || []).filter(r => r.kind === 'statement' && r.image_url).map(r => Object.assign({}, r, {customers: {code: codeOf[r.customer_id]}}));
  if(!rows.length) return {saved, skipped, failed};
  const base = path.join(ROOT, STMT_DIR);
  fs.mkdirSync(base, {recursive: true});
  const idToDir = readIdMap(base);
  for(const r of rows){
    const code = r.customers && r.customers.code; if(!code) continue;
    const dir = ensureDirById(base, r.customer_id, code, idToDir);
    const dest = path.join(dir, 'ใบวางบิล_' + r.bill_date + extOf(r.image_url));
    if(fs.existsSync(dest)){ skipped++; tally('ใบวางบิล', 'have'); continue; }
    try{ await download(r.image_url, dest); saved++; noteOk(r.image_url); tally('ใบวางบิล', 'new'); log('  [เก็บ] ' + path.join(STMT_DIR, safeName(code), path.basename(dest))); }
    catch(e){ if(isGone(e) && isAccepted(r.image_url)) continue; failed++; noteIssue('statement', code + ' ' + r.bill_date, r.image_url, e); tally('ใบวางบิล', 'fail'); log('  [!] โหลดใบวางบิล ' + code + ' ' + r.bill_date + ' ไม่ได้ — ' + e.message); }
  }
  return {saved, skipped, failed};
}

/* ================= ประหยัดพื้นที่ Supabase + สื่อสินค้า + รายจ่าย + สำรองข้อมูล ================= */
const MEDIA_DIR = 'สื่อสินค้า', EXP_DIR = 'รายจ่าย', BACKUP_DIR = 'สำรองตาราง';
function objPathOf(url, bucket){   // public URL → path ใน bucket
  const m = String(url || '').split('?')[0].match(new RegExp('/storage/v1/object/(?:public|sign|authenticated)/' + bucket + '/(.+)$'));
  return m ? decodeURIComponent(m[1]) : null;
}
function shortHash(s){ let h = 0; for(const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); }
async function rpc(name, body){
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {method: 'POST',
    headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify(Object.assign({p_key: CFG.NAS_EXPORT_KEY}, body || {}))});
  if(!r.ok) throw new Error('RPC ' + name + ' ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const t = await r.text();                        // ฟังก์ชันที่คืน void → Supabase ตอบ 204 ไม่มีเนื้อหา = สำเร็จ
  return t ? JSON.parse(t) : null;
}
async function deleteObject(bucket, objPath){
  if(DRY_RUN){ log('  (ทดลอง) จะลบใน Supabase: ' + bucket + '/' + objPath); return; }
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + objPath.split('/').map(encodeURIComponent).join('/'), {
    method: 'DELETE', headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY}});
  if(r.status === 404 || r.status === 400) return false;   // ไม่มีไฟล์แล้ว (เช่น สลิปใบเดียวกันผูกหลายบิล ลบไปตอนบิลก่อนหน้า)
  if(!r.ok) throw new Error('ลบไฟล์ ' + bucket + '/' + objPath + ' ไม่ได้ (' + r.status + ') — รัน mix888-nas-key-fix.sql หรือยัง?');
  return true;
}
const onNas = p => { try{ return fs.statSync(p).size > 0; }catch(e){ return false; } };
const maskKey = k => !k ? '(ว่าง)' : (k.length <= 6 ? k[0] + '***' : k.slice(0, 4) + '***' + k.slice(-2) + ' (' + k.length + ' ตัวอักษร)');
// ---- ตรวจรหัสลับ + การเชื่อมต่อก่อนเริ่มทุกรอบ (RPC nas_ping) — ไม่ผ่าน = หยุดทันที ไม่แตะอะไรทั้งสิ้น ----
async function preflight(){
  log('ตั้งค่าจาก: ' + (CFG._from || 'ค่าในไฟล์สคริปต์ (ไม่พบ archiver.config.json)') + ' · NAS_EXPORT_KEY = ' + maskKey(CFG.NAS_EXPORT_KEY));
  if(!CFG.NAS_EXPORT_KEY || CFG.NAS_EXPORT_KEY === 'PASTE_NAS_EXPORT_KEY_HERE'){
    log('[X] ยังไม่ได้ใส่ NAS_EXPORT_KEY ใน archiver.config.json — เปิด Supabase SQL Editor รัน: select export_key from nas_config;  แล้วก๊อปมาใส่');
    return false;
  }
  try{
    const r = await rpc('nas_ping');
    log('[OK] เชื่อมต่อ Supabase ได้ รหัสตรง — ลูกค้า ' + r.customers + ' ราย · สินค้า ' + r.products + ' รายการ · บิล ' + r.bills + ' ใบ');
    return true;
  }catch(e){
    const m = String(e.message || e);
    if(/ 404/.test(m) || /PGRST202|Could not find the function/i.test(m)) log('[X] Supabase ยังไม่มีฟังก์ชัน nas_ping — ยังไม่ได้รันไฟล์ mix888-nas-key-fix.sql ใน SQL Editor');
    else if(/BAD_KEY/.test(m)) log('[X] รหัสไม่ตรง — NAS_EXPORT_KEY ใน archiver.config.json (' + maskKey(CFG.NAS_EXPORT_KEY) + ') ไม่เท่ากับค่าในตาราง nas_config · รัน: select export_key from nas_config;  ใน SQL Editor แล้วก๊อปมาใส่ให้ตรงทุกตัว');
    else log('[X] เชื่อมต่อ Supabase ไม่ได้: ' + m + ' — เช็คอินเทอร์เน็ตของ NAS / ไฟร์วอลล์');
    log('    รอบนี้ไม่ทำอะไรต่อ (ไม่เก็บ ไม่ลบ) จนกว่าจะแก้ให้ผ่านก่อน');
    return false;
  }
}

// ไฟล์ของบิล 1 ใบ: [ลิงก์, ชื่อไฟล์บน NAS, ประเภท] — ใช้ชุดเดียวกันทั้งตอนเก็บ ตอนตรวจ และตอนลบ
function billFiles(b){
  const files = [];
  const rev = b.revision || 1;
  if(b.image_url) files.push([b.image_url, safeName(b.bill_no) + '_บิล_v' + rev + extOf(b.image_url), 'bill']);
  if(CFG.KEEP_A4_PAGES)
    (Array.isArray(b.page_urls) ? b.page_urls : []).forEach((u, i) =>
      files.push([u, safeName(b.bill_no) + '_บิลหน้า' + (i+1) + '_v' + rev + extOf(u), 'bill']));
  const slipSet = [];
  (Array.isArray(b.payments) ? b.payments : []).forEach(p =>
    (Array.isArray(p.slips) ? p.slips : []).forEach(u => { if(u && !slipSet.includes(u)) slipSet.push(u); }));
  if(b.slip_url && !slipSet.includes(b.slip_url)) slipSet.push(b.slip_url);
  slipSet.forEach((u, i) => files.push([u, safeName(b.bill_no) + '_สลิป' + (i+1) + extOf(u), 'slip']));
  return files;
}
function existingBillDir(dayDir, b){
  for(const sfx of ['', ...PAY_SUFFIXES]){ const p = path.join(dayDir, safeName(b.bill_no) + sfx); if(fs.existsSync(p)) return p; }
  return null;
}
function bucketOf(u){ const m = String(u || '').match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\//); return m ? m[1] : null; }

/* แผนผังไฟล์ในโฟลเดอร์บิล (.files.json): ลิงก์ต้นฉบับ → ชื่อไฟล์บน NAS
   ชื่อไฟล์ตั้งตามลำดับ (_สลิป1, _สลิป2) ถ้าสลิปของบิลถูกเปลี่ยน ลำดับอาจเลื่อน — แผนผังกันไม่ให้
   (1) เขียนทับสำเนาของสลิปใบอื่น และ (2) กู้ภาพผิดใบกลับขึ้นระบบ
   "legacy:<ชื่อไฟล์>" = ไฟล์ที่เก็บก่อนมีแผนผัง และพิสูจน์แล้วว่าไม่ใช่ของลิงก์ปัจจุบัน (กันชื่อไว้ ไม่ให้ใครทับ)
   "__pruned__" = รายชื่อไฟล์ของบิลตอนที่ลบออกจาก Supabase (ใช้ตอน --restore-bill) */
const MANIFEST = '.files.json';
function readManifest(dir){ try{ const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }catch(e){ return {}; } }
function writeManifest(dir, m){ try{ fs.mkdirSync(dir, {recursive: true}); const tmp = path.join(dir, MANIFEST + '.part'); fs.writeFileSync(tmp, JSON.stringify(m)); fs.renameSync(tmp, path.join(dir, MANIFEST)); }catch(e){} }
function ownerOf(m, name){ for(const [u, n] of Object.entries(m)) if(n === name) return u; return null; }
// ไฟล์ของลิงก์นี้อยู่ชื่ออะไรบน NAS · known = ยืนยันแล้วว่าเป็นของลิงก์นี้ · legacy = ไฟล์ชื่อตรงที่เก็บก่อนมีแผนผัง (ยังไม่ยืนยัน)
function nasFileFor(dir, m, url, name){
  if(typeof m[url] === 'string') return {name: m[url], known: true, legacy: false};
  const owner = ownerOf(m, name);
  if(!owner) return {name, known: false, legacy: fs.existsSync(path.join(dir, name))};
  const ext = path.extname(name), base = ext ? name.slice(0, -ext.length) : name;
  for(let k = 2; k < 200; k++){ const alt = base + '_' + k + ext; if(!ownerOf(m, alt) && !fs.existsSync(path.join(dir, alt))) return {name: alt, known: false, legacy: false}; }
  return {name: base + '_' + Date.now() + ext, known: false, legacy: false};
}
function writeFileAtomic(dest, buf){ const tmp = dest + '.part'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest); }
// ไฟล์บน NAS เป็น "ต้นฉบับที่โหลดค้างครึ่งทาง" (ไบต์ต้นตรงกันทั้งหมด) ไหม — ถ้าใช่ เขียนทับได้ ถ้าไม่ใช่ = สลิปอีกใบ ห้ามทับ
function md5Of(file){ try{ return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex'); }catch(e){ return ''; } }
function isTruncatedOf(nasBuf, remote){ return nasBuf.length < remote.length && remote.subarray(0, nasBuf.length).equals(nasBuf); }
// ชื่อตรงแต่เนื้อหาไม่ตรง: ใช่ไฟล์ของลิงก์นี้ (ยืนยันแล้ว/โหลดค้าง) → เขียนทับ · เป็นสลิปอีกใบ → เก็บเป็นชื่อใหม่ ไม่ทับ
function storeMismatch(dir, man, url, name0, f, remote){
  const dest = path.join(dir, f.name);
  let nasBuf = Buffer.alloc(0); try{ nasBuf = fs.readFileSync(dest); }catch(e){}
  if(f.known || isTruncatedOf(nasBuf, remote)){ writeFileAtomic(dest, remote); man[url] = f.name; return {name: f.name, overwrote: true}; }
  man['legacy:' + f.name] = f.name;
  const g = nasFileFor(dir, man, url, name0);
  writeFileAtomic(path.join(dir, g.name), remote); man[url] = g.name;
  return {name: g.name, overwrote: false};
}

// (1) บิลจ่ายครบแล้ว: ไฟล์อยู่บน NAS ครบ "และตรงกับต้นฉบับทุกไบต์" → บันทึกในฐานข้อมูลก่อน แล้วค่อยลบรูปบิล/สลิปออกจาก Supabase
//     มีไฟล์ไหนไม่อยู่บน NAS / ไม่ตรง / โหลดต้นฉบับมาเทียบไม่ได้ = ไม่ลบบิลนั้นเลย (ไฟล์ที่หายถาวรถูกรายงานแยก)
async function pruneBills(ROOT){
  if(!CFG.PRUNE_PAID_BILLS) return {pruned: 0};
  let pruned = 0, kept = 0;
  const why = {};
  const keep = reason => { kept++; why[reason] = (why[reason] || 0) + 1; };
  const since = new Date(Date.now() - CFG.PRUNE_DAYS_BACK * 24 * 3600 * 1000).toISOString();
  const cutoff = Date.now() - CFG.PRUNE_PAID_AFTER_DAYS * 24 * 3600 * 1000;
  if(!DRY_RUN) try{                                                  // (โหมดทดลองไม่เรียกฟังก์ชันที่เขียนข้อมูลเลย)
    const probe = await rpc('nas_mark_pruned', {p_bill_id: -1, p_nas_path: ''});   // บิล -1 ไม่มีจริง — ไม่แตะข้อมูล แค่ดูรูปแบบคำตอบ
    if(!probe || !Array.isArray(probe.safe)){ log('[!] ฐานข้อมูลยังเป็น nas_mark_pruned รุ่นเก่า — รอบนี้ไม่ลบอะไรใน Supabase (รัน mix888-nas-key-fix.sql ฉบับล่าสุด)'); return {pruned}; }
  }catch(e){ log('[!] ตรวจฟังก์ชัน nas_mark_pruned ไม่ได้ — รอบนี้ไม่ลบอะไร: ' + e.message); return {pruned}; }
  let bills = [];
  try{ bills = await rpc('nas_export_bills', {p_since: since}); }catch(e){ log('[!] อ่านบิลเพื่อลบไฟล์ไม่ได้: ' + e.message); return {pruned}; }
  for(const b of (Array.isArray(bills) ? bills : [])){
    if(b.ship_status !== 'shipped' || b.payment_status !== 'paid') continue;   // ส่งของแล้ว + จ่ายครบเท่านั้น (ยังรอส่ง = อาจถูกยกเลิก/แก้)
    if(!b.paid_at || new Date(b.paid_at).getTime() > cutoff) continue;
    const files = CFG.KEEP_A4_PAGES ? billFiles(b) : billFiles(b).concat((Array.isArray(b.page_urls) ? b.page_urls : []).map(u => [u, null, 'page']));
    if(!files.length) continue;                                     // ไม่มีไฟล์ค้างใน Supabase แล้ว
    if(files.some(([u]) => ISSUES.has(u))){ keep('มีไฟล์ที่สำรองไม่ได้'); continue; }
    const {y, m, ddmmyyyy} = thDate(b.created_at);
    const billDir = existingBillDir(path.join(ROOT, y, m, ddmmyyyy), b);
    if(!billDir){ keep('ยังไม่มีโฟลเดอร์บน NAS'); continue; }
    // ทุกไฟล์ (ยกเว้นหน้า A4 ที่ไม่ได้เก็บ — เนื้อหาเดียวกับรูปบิลเต็ม) ต้องมีบน NAS และตรงกับต้นฉบับทุกไบต์
    const man = readManifest(billDir); let dirty = false;
    // (ไฟล์ที่กด "ช่างมัน" แล้ว ไม่ต้องมีบน NAS — ตัดสินตอนโหลดต้นฉบับด้านล่าง)
    if(files.some(([u, n]) => n && !ACCEPTED.has(u) && !onNas(path.join(billDir, nasFileFor(billDir, man, u, n).name)))){ keep('ไฟล์ยังไม่อยู่บน NAS ครบ'); continue; }
    const names = [];
    let okAll = true, reason = '', nLost = 0, nAcc = 0;
    for(const [u, name0] of files){
      if(!name0) continue;
      const f = nasFileFor(billDir, man, u, name0);
      const dest = path.join(billDir, f.name);
      if(!onNas(dest) && !ACCEPTED.has(u)){ okAll = false; reason = 'ไฟล์ยังไม่อยู่บน NAS ครบ'; break; }
      let remote;
      try{ remote = await fetchBuf(u); }
      catch(e){
        // ไฟล์ในระบบหายไปแล้ว → เก็บเข้าคลังได้เฉพาะเมื่อรอบตรวจเต็มรอบนี้ (resolveGone) อนุมัติทั้งกลุ่มแล้ว (ทุกบิลที่ใช้ลิงก์นี้มีสำเนาที่ถูกต้อง)
        // รอบรายชั่วโมง/กู้กลับไม่สำเร็จ = ยังไม่เก็บ รอตรวจเต็มรอบถัดไป (ไม่งั้นบิลอื่นที่ใช้สลิปเดียวกันจะเสียโอกาสได้สำเนาที่ถูกต้อง)
        if(isGone(e) && ADOPTED_AT.has(billDir + '\0' + u)){ nLost++; names.push(f.name); continue; }
        // กด "ช่างมัน" แล้ว = ยอมรับว่าหายถาวร → เก็บเข้าคลังได้เลย · ไม่จดไฟล์บน NAS ที่ยืนยันไม่ได้ว่าเป็นของลิงก์นี้ (--restore-bill จะไม่เอาไปใช้ผิดใบ)
        if(isGone(e) && isAccepted(u)){
          if(f.known && onNas(dest)){ nLost++; names.push(f.name); } else nAcc++;
          continue;
        }
        okAll = false; reason = isGone(e) ? 'ต้นฉบับหายไปแล้ว และสำเนาบน NAS ยังยืนยันไม่ได้' : 'โหลดต้นฉบับมาเทียบไม่ได้'; break;
      }
      if(!onNas(dest)){ okAll = false; reason = 'ไฟล์ยังไม่อยู่บน NAS ครบ'; break; }   // ช่างมันไว้แต่ไฟล์กลับมาเปิดได้ = สำรองก่อนตามปกติ
      if(!remote.equals(fs.readFileSync(dest))){
        try{
          const w = storeMismatch(billDir, man, u, name0, f, remote); dirty = true;
          log('  [ซ่อม] สำเนาบน NAS ไม่ตรงต้นฉบับ ' + (w.overwrote ? 'เขียนใหม่: ' : 'ชื่อเดิมเป็นสลิปอีกใบ เก็บใบนี้เป็น ') + b.bill_no + ' ' + w.name);
        }catch(e){}
        okAll = false; reason = 'สำเนาบน NAS ไม่ตรง (เก็บใหม่แล้ว ลบรอบหน้า)'; break;
      }
      if(!f.known){ man[u] = f.name; dirty = true; }                    // เทียบแล้วตรงทุกไบต์ = ยืนยันในแผนผัง
      names.push(f.name);
    }
    if(dirty) writeManifest(billDir, man);
    if(!okAll){ keep(reason); continue; }
    const rel = path.relative(ROOT, billDir);
    const accTxt = nAcc ? ' · ' + nAcc + ' ไฟล์หายถาวร (ช่างมันแล้ว)' : '';
    if(DRY_RUN){ pruned++; tally('ลบไฟล์บิลจ่ายครบออกจาก Supabase', 'pruned'); log('  (ทดลอง) จะลบไฟล์ใน Supabase ของบิล ' + b.bill_no + ' (' + files.length + ' ไฟล์ ตรงกับสำเนาบน NAS ทุกไบต์' + (nLost ? ' · ' + nLost + ' ไฟล์หายจากระบบแล้ว ใช้สำเนาบน NAS' : '') + accTxt + ' · ' + rel + ')'); continue; }
    const nameOf = u => (u && typeof man[u] === 'string') ? man[u] : null;
    man.__pruned__ = names;                                           // จำว่าตอนลบ บิลนี้มีไฟล์ไหนบ้าง และสลิปไหนเป็นของการชำระครั้งไหน (ใช้ตอน --restore-bill)
    man.__pruned_layout__ = {image: nameOf(b.image_url), slip_url: nameOf(b.slip_url),
      payments: (Array.isArray(b.payments) ? b.payments : []).map(p => (Array.isArray(p.slips) ? p.slips : []).map(nameOf).filter(Boolean))};
    writeManifest(billDir, man);
    // ลำดับสำคัญ: บันทึกในฐานข้อมูลก่อน (ล้างลิงก์รูป + จดโฟลเดอร์ NAS) แล้วค่อยลบไฟล์
    // ถ้าบันทึกไม่ได้ (รหัสผิด/เน็ตหลุด) = ไม่ลบอะไรเลย — ไม่งั้นจะเกิด "ไฟล์หายแต่ลิงก์ยังอยู่" หลังบ้านเปิดสลิปไม่ได้ (เคยเกิดแล้ว)
    let res;
    try{ res = await rpc('nas_mark_pruned', {p_bill_id: b.id, p_nas_path: rel}); }
    catch(e){ keep('บันทึกสถานะไม่ได้'); log('  [!] บันทึกสถานะบิล ' + b.bill_no + ' ไม่ได้ — ไม่ลบไฟล์รอบนี้: ' + e.message); continue; }
    // ลบเฉพาะไฟล์ที่ฐานข้อมูลยืนยันว่าไม่มีที่อื่นอ้างแล้ว — สลิปใบเดียวใช้จ่ายหลายบิล (โอนรวม) ห้ามลบจนบิลสุดท้ายถูกเก็บ
    const safe = res && Array.isArray(res.safe) ? new Set(res.safe) : null;
    if(!safe) log('  [!] ฐานข้อมูลยังเป็นฟังก์ชัน nas_mark_pruned รุ่นเก่า (รัน mix888-nas-key-fix.sql ฉบับล่าสุด) — บิล ' + b.bill_no + ' ล้างลิงก์แล้ว แต่ไม่ลบไฟล์');
    let nDel = 0, nFail = 0, nShared = 0;
    for(const [u] of files){
      if(!safe || !safe.has(u)){ if(safe) nShared++; continue; }
      const bucket = bucketOf(u) || 'bills';
      const op = objPathOf(u, bucket); if(!op) continue;
      try{ if(await deleteObject(bucket, op)) nDel++; }catch(e){ nFail++; log('  [!] ' + e.message); }
    }
    pruned++; tally('ลบไฟล์บิลจ่ายครบออกจาก Supabase', 'pruned'); if(nLost) ARCHIVED_LOST.add(b.bill_no);
    log('  [ลบใน Supabase] บิล ' + b.bill_no + ' (จ่ายครบ · สำเนาตรงทุกไบต์อยู่ ' + rel + ') — ล้างลิงก์แล้ว ลบไฟล์ ' + nDel
        + (nLost ? ' · ' + nLost + ' ไฟล์หายจากระบบไปก่อนแล้ว (เก็บเข้าคลังด้วยสำเนาบน NAS)' : '') + accTxt
        + (nShared ? ' · ไม่ลบ ' + nShared + ' ไฟล์ที่บิลอื่นยังใช้อยู่ (สลิปโอนรวม)' : '')
        + (nFail ? ' · ลบไม่ได้ ' + nFail + ' ไฟล์ (ค้างในถัง ไม่กระทบระบบ จะไม่ถูกอ้างถึงแล้ว)' : ''));
  }
  if(pruned || kept) log('ประหยัดพื้นที่: ลบไฟล์บิลจ่ายครบแล้ว ' + pruned + ' ใบ' + (kept ? ' · ยังไม่ลบ ' + kept + ' ใบ (' + Object.entries(why).map(([k, v]) => k + ' ' + v).join(' · ') + ')' : ''));
  return {pruned};
}

// (1b) ตรวจสำรองเต็มรอบ (วันละครั้ง / สั่งเอง --check): ไล่ทุกบิลย้อนหลัง PRUNE_DAYS_BACK วัน
//   - ไฟล์ยังไม่อยู่บน NAS → โหลดเก็บ (ซ่อมช่วงที่โปรแกรมเคยหยุด) · โหลดไม่ได้ → รายงาน
//   - อยู่บน NAS แล้ว แต่ในระบบหาย (404) → อัปโหลดสำเนากลับ + เปลี่ยนลิงก์ให้เอง (กู้อัตโนมัติ)
//   - อยู่ทั้งคู่: ยืนยันในแผนผัง / ขนาดไม่ตรง → เก็บใหม่ (ไม่ทับสลิปใบอื่น)
async function pool(items, n, fn){ let i = 0; await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while(i < items.length){ const it = items[i++]; try{ await fn(it); }catch(e){ log('  [!] ตรวจ: ' + (e.message || e)); } } })); }
async function verifyBackups(ROOT){
  const since = new Date(Date.now() - CFG.PRUNE_DAYS_BACK * 24 * 3600 * 1000).toISOString();
  // ใช้ฟังก์ชัน nas_export_bills ตรง ๆ (ไม่ใช้ทางสำรองที่อ่านตาราง — ตาราง bills ล็อกไว้ อ่านตรงได้ 0 แถว จะกลายเป็น "ตรวจครบแล้วไม่มีปัญหา")
  const bills = await rpc('nas_export_bills', {p_since: since});
  if(!Array.isArray(bills)) throw new Error('nas_export_bills ตอบผิดรูปแบบ');
  const items = [];
  for(const b of bills){
    if((b.ship_status || 'pending') === 'cancelled') continue;
    const files = billFiles(b); if(!files.length) continue;
    const {y, m, ddmmyyyy} = thDate(b.created_at);
    const dayDir = path.join(ROOT, y, m, ddmmyyyy);
    const billDir = fs.existsSync(dayDir) ? ensureBillDir(dayDir, b) : path.join(dayDir, safeName(b.bill_no) + paySuffix(b));
    items.push({b, files, billDir});
  }
  const st = {files: 0, fetched: 0, restored: 0, refreshed: 0, moved: 0, adopted: 0, archive: 0, unverified: 0, why: {}, restoreFail: 0, unsure: 0, gone: 0, error: 0, accepted: 0};
  const GONE = [];                                                    // ไฟล์ที่หายจาก Supabase (ตัดสินรวมทีละลิงก์ใน resolveGone)
  // ทีละบิล (ไฟล์ในบิลเดียวกันทำตามลำดับ — แผนผังของโฟลเดอร์ไม่ชนกัน) · หลายบิลพร้อมกัน 6 งาน
  await pool(items, 6, async ({b, files, billDir}) => {
    const man = readManifest(billDir); let dirty = false;
    const lc = {};                                                    // ผลนับสลิปบน NAS ของบิลนี้ (ใช้ตรวจสำเนาเก่า)
    for(const [url, name0, kind] of files){
      st.files++;
      const f = nasFileFor(billDir, man, url, name0);
      const dest = path.join(billDir, f.name);
      if(onNas(dest)){
        let h;
        try{ h = await fetch(url, {method: 'HEAD'}); }catch(e){ continue; }   // เน็ตสะดุด — ไม่ใช่ปัญหาการสำรอง
        if(h.ok){
          noteOk(url);
          const len = Number(h.headers.get('content-length') || 0), size = fs.statSync(dest).size;
          let same;
          if(f.known) same = !(len > 0 && len !== size);                                  // ยืนยันแล้ว: เช็คแค่ขนาด (ไม่ต้องอ่านไฟล์ทุกวัน)
          else{
            const etag = String(h.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '').toLowerCase();
            same = /^[0-9a-f]{32}$/.test(etag) ? md5Of(dest) === etag : false;            // ยังไม่ยืนยัน: ลายนิ้วมือ (ETag = MD5) ต้องตรง · ไม่มี = เทียบทุกไบต์ด้านล่าง
          }
          if(same){ if(!f.known){ man[url] = f.name; dirty = true; } }
          else{
            // ลายนิ้วมือไม่ตรง / ยังไม่เคยยืนยัน → โหลดต้นฉบับมาเทียบทุกไบต์ (ไฟล์ของลิงก์นี้ที่ค้าง = เขียนทับ · สลิปอีกใบ = เก็บชื่อใหม่)
            try{
              const remote = await fetchBuf(url);
              if(remote.equals(fs.readFileSync(dest))){ if(!f.known){ man[url] = f.name; dirty = true; } }
              else{
                const w = storeMismatch(billDir, man, url, name0, f, remote); dirty = true; st.refreshed++;
                log(w.overwrote ? '  [ซ่อม] สำเนาไม่ครบ โหลดใหม่: ' + b.bill_no + ' ' + w.name
                                : '  [เก็บเพิ่ม] ' + b.bill_no + ' ' + w.name + ' (ชื่อเดิมเป็นสลิปอีกใบ ไม่เขียนทับ)');
              }
            }catch(e){}
          }
          continue;
        }
        if(h.status !== 404 && h.status !== 400) continue;
        const nu = await relinkMoved(url, b.bill_no);                  // ไฟล์ถูกย้ายชื่อ (ยังอยู่ครบ) → แก้ลิงก์ ไม่ต้องกู้
        if(nu){
          st.moved++; noteOk(url);
          if(!DRY_RUN){
            try{
              const remote = await fetchBuf(nu);
              delete man[url];
              if(remote.equals(fs.readFileSync(dest))) man[nu] = f.name;   // สำเนาบน NAS = ไฟล์เดียวกัน → จดด้วยลิงก์ใหม่
              else{ const w = storeMismatch(billDir, man, nu, name0, nasFileFor(billDir, man, nu, name0), remote); log('  [เก็บเพิ่ม] ' + b.bill_no + ' ' + w.name + ' (ไฟล์ที่ย้ายไม่ตรงกับสำเนาเดิมบน NAS — เก็บไว้ทั้งสองไฟล์)'); }
              dirty = true; noteOk(nu);
            }catch(e){}
          }
          continue;
        }
        // ในระบบหาย แต่ NAS มีไฟล์ → ยังไม่ทำอะไร ตัดสินรวมทีละ "ลิงก์" หลังตรวจครบทุกบิล (resolveGone — สลิปโอนรวมผูกหลายบิล ต้องดูทุกบิลพร้อมกัน)
        // ไฟล์เก็บก่อนมีแผนผัง → ตรวจไฟล์ "ในโฟลเดอร์นี้เอง" ว่าเป็นของลิงก์นี้จริงไหม (ผลตรวจของโฟลเดอร์อื่นใช้แทนไม่ได้)
        GONE.push({url, b, billDir, kind, name0, name: f.name, dest, known: f.known, why: f.known ? '' : legacyCheck(b, files, billDir, man, url, kind, f.name, lc)});
        continue;
      }
      try{ fs.mkdirSync(billDir, {recursive: true}); await download(url, dest); man[url] = f.name; dirty = true; st.fetched++; noteOk(url); log('  [เก็บตกหล่น] ' + b.bill_no + ' ' + f.name); }
      catch(e){
        const nu = isGone(e) ? await relinkMoved(url, b.bill_no) : null;
        if(nu){
          st.moved++; noteOk(url);
          try{ await download(nu, dest); if(!DRY_RUN){ man[nu] = f.name; dirty = true; } st.fetched++; noteOk(nu); log('  [เก็บตกหล่น] ' + b.bill_no + ' ' + f.name + ' (จากไฟล์ที่ถูกย้ายชื่อ)'); }
          catch(e2){ noteIssue(kind, b.bill_no, DRY_RUN ? url : nu, e2); if(isGone(e2)) st.gone++; else st.error++; }
          continue;
        }
        if(isGone(e)) GONE.push({url, b, billDir, kind, name0, name: f.name, dest, noCopy: true, err: e});   // บิลอื่นที่ใช้สลิปเดียวกันอาจมีสำเนาบน NAS — ตัดสินรวมทีหลัง
        else{ noteIssue(kind, b.bill_no, url, e); st.error++; }
      }
    }
    if(dirty) writeManifest(billDir, man);
  });
  const NIDX = checkNasIndex(ROOT, st);                              // แผนผังทั้ง NAS: หาสำเนาในโฟลเดอร์บิลอื่น + ตรวจสำเนาของลิงก์เดียวกันที่ไม่ตรงกัน
  await resolveGone(ROOT, GONE, st, NIDX);
  log('[ตรวจสำรอง] ไฟล์บิล+สลิป ' + st.files + ' ไฟล์ (ย้อนหลัง ' + CFG.PRUNE_DAYS_BACK + ' วัน) · เก็บตกหล่น ' + st.fetched + ' · ' + (DRY_RUN ? '(ทดลอง) จะกู้คืน ' : 'กู้คืนอัตโนมัติ ') + st.restored
      + ' · เก็บใหม่/ซ่อม ' + st.refreshed + ' · ไฟล์ถูกย้ายชื่อ (แก้ลิงก์) ' + st.moved + ' · หายถาวร ' + st.gone + ' · โหลดไม่ได้ ' + st.error
      + (st.conflict ? ' · สำเนาลิงก์เดียวกันไม่ตรงกัน ' + st.conflict + ' (ตรวจเอง)' : '')
      + (st.accepted ? ' · หายถาวรที่ช่างมันแล้ว ' + st.accepted + ' (ไม่รายงาน)' : ''));
  if(st.adopted || st.archive || st.unverified || st.restoreFail || st.unsure)
    log('[ตรวจสำรอง] ไฟล์ในระบบหายแต่ NAS มีสำเนา: สำเนาเก่าตรวจแล้วใช้แทนได้ ' + st.adopted + ' · เก็บเข้าคลัง NAS (บิลจ่ายครบเกิน ' + CFG.PRUNE_PAID_AFTER_DAYS + ' วัน) ' + st.archive + ' ไฟล์ '
        + ARCHIVE_BILLS.size + ' ใบ · ' + (DRY_RUN ? 'จะ' : '') + 'อัปโหลดกลับขึ้นระบบ ' + st.restored
        + (st.restoreFail ? ' · กู้กลับไม่ได้ ' + st.restoreFail + ' (ลองใหม่รอบตรวจถัดไป)' : '') + (st.unsure ? ' · ไม่แน่ใจว่าแก้ลิงก์สำเร็จ ' + st.unsure + ' (รอบหน้าตรวจซ้ำ)' : '')
        + ' · ยืนยันไม่ได้ (ตรวจเอง) ' + st.unverified
        + (st.unverified ? ' (' + Object.entries(st.why).map(([k, v]) => k + ' ' + v).join(' · ') + ')' : ''));
  return st;
}

// ดัชนีแผนผังทั้ง NAS: ลิงก์ → [ไฟล์บน NAS ที่จดไว้ว่าเป็นของลิงก์นั้น] จาก .files.json ของทุกโฟลเดอร์บิล (รวมบิลที่เก็บเข้าคลังแล้ว / นอกช่วงตรวจ)
//   ใช้หา "สำเนาในโฟลเดอร์บิลอื่น" ของสลิปโอนรวมที่หาย · และตรวจความถูกต้อง: ลิงก์เดียวกันจดไว้หลายโฟลเดอร์ต้องเป็นไฟล์เดียวกันทุกไบต์
//   ไม่ตรงกัน = มีโฟลเดอร์หนึ่งจดผิดใบ → รายงานให้คนเปิดดู (ไม่แก้เอง)
function checkNasIndex(ROOT, st){
  const idx = new Map();
  const ls = d => { try{ return fs.readdirSync(d); }catch(e){ return []; } };
  for(const y of ls(ROOT).filter(n => /^\d{4}$/.test(n)))
    for(const m of ls(path.join(ROOT, y)).filter(n => /^\d{2}$/.test(n)))
      for(const d of ls(path.join(ROOT, y, m)).filter(n => /^\d{8}$/.test(n)))
        for(const bd of ls(path.join(ROOT, y, m, d))){
          const dir = path.join(ROOT, y, m, d, bd);
          if(!fs.existsSync(path.join(dir, MANIFEST))) continue;
          for(const [u, n] of Object.entries(readManifest(dir))){
            if(typeof n !== 'string' || !/^https?:\/\//.test(u)) continue;
            const p = path.join(dir, n); if(!onNas(p)) continue;
            if(!idx.has(u)) idx.set(u, []);
            if(!idx.get(u).includes(p)) idx.get(u).push(p);
          }
        }
  let bad = 0;
  for(const [u, ps] of idx){
    if(ps.length < 2) continue;
    const first = fs.readFileSync(ps[0]);
    if(ps.every(p => { try{ return fs.readFileSync(p).equals(first); }catch(e){ return false; } })) continue;
    if(isAccepted(u)) continue;                                        // กด "ช่างมัน" เรื่องนี้แล้ว
    bad++; st.conflict = (st.conflict || 0) + 1;
    const rels = ps.map(p => path.relative(ROOT, p)), refs = [...new Set(ps.map(p => path.basename(path.dirname(p)).replace(/_.*$/, '')))];
    ISSUES.set(u, {kind: /_สลิป/.test(ps[0]) ? 'slip' : 'bill', ref: refs.join(','), url: u, reason: 'nas_unverified',
      detail: ('ลิงก์เดียวกันแต่สำเนาบน NAS ไม่ตรงกัน: ' + rels.join(' | ')).slice(0, 200)});
    log('  [ตรวจเอง] สลิป/รูปบิลลิงก์เดียวกัน แต่สำเนาบน NAS ไม่ตรงกัน (' + refs.join(', ') + '): ' + rels.join(' | '));
  }
  if(bad) log('[!] พบสำเนาของลิงก์เดียวกันที่ไม่ตรงกัน ' + bad + ' ลิงก์ — เปิดดูภาพทั้งสองไฟล์ว่าใบไหนถูก');
  return idx;
}

// (1c) ไฟล์ที่หายจาก Supabase — ตัดสินทีละ "ลิงก์" หลังตรวจครบทุกบิล (สลิปโอนรวม 1 ใบผูกหลายบิล ทุกบิลต้องได้ผลเดียวกัน)
//   สำเนาต้นทาง = ไฟล์บน NAS ที่ยืนยันแล้วว่าเป็นของลิงก์นี้: จดในแผนผังแล้ว หรือสำเนาเก่าที่ตรวจผ่าน "ในโฟลเดอร์ของตัวเอง"
//     สำเนาของบิลอื่นใช้ได้เฉพาะเมื่อตรงกับสำเนาต้นทางทุกไบต์ · สำเนาเก่าที่ผ่านเกณฑ์หลายโฟลเดอร์แต่เนื้อไม่ตรงกัน = ไม่รู้ใบไหนถูก → ตรวจเอง
//   - ทุกบิลที่ใช้ลิงก์นี้ ส่งแล้ว+จ่ายครบเกินกำหนด มีสำเนาที่ถูกต้องของตัวเอง และไม่มีไฟล์อื่นที่สำรองไม่ได้ (ไม่งั้นลบไฟล์บิลไม่ได้)
//     → เก็บเข้าคลัง NAS (ขั้นตอนลบไฟล์บิลจ่ายครบล้างลิงก์ที่เสียให้ ไม่ต้องอัปขึ้นใหม่)
//   - นอกนั้น → อัปโหลดสำเนาต้นทางกลับ + แก้ลิงก์ทุกจุด (บิลที่ไม่มีสำเนา/สำเนาไม่ตรง ได้ไฟล์ที่ถูกต้องไปด้วย · สำเนาที่ไม่ตรงไม่ถูกแตะ)
//   - ไม่มีสำเนาที่ยืนยันได้เลย → รายงาน (ตรวจเอง / หายทั้งสองที่)
async function resolveGone(ROOT, GONE, st, NIDX){
  if(!GONE.length) return;
  const canArchive = await archiveReady();
  const MANS = new Map();                // แผนผังของแต่ละโฟลเดอร์: แก้ในหน่วยความจำ เขียนทีเดียวตอนจบ (หลายลิงก์ในโฟลเดอร์เดียวกันไม่ทับกัน)
  const manOf = dir => { if(!MANS.has(dir)) MANS.set(dir, {man: readManifest(dir), dirty: false}); return MANS.get(dir); };
  const sameBytes = (a, b) => { try{ return fs.readFileSync(a).equals(fs.readFileSync(b)); }catch(e){ return false; } };
  const rel = g => path.relative(ROOT, g.dest);
  const unverified = (g, why) => {
    if(isAccepted(g.url)){ st.accepted++; return; }                    // กด "ช่างมัน" แล้ว — ไม่รายงาน สำเนาบน NAS คงไว้ตามเดิม
    const wk = why.replace(/\s*\([^)]*\)/g, ''); st.unverified++; st.why[wk] = (st.why[wk] || 0) + 1;
    ISSUES.set(g.url, {kind: g.kind, ref: g.b.bill_no, url: g.url, reason: 'nas_unverified', detail: ('NAS มีไฟล์ ' + rel(g) + ' · ' + why).slice(0, 200)});
    log('  [ตรวจเอง] ' + g.b.bill_no + ' ' + g.name + ' — ไฟล์ในระบบหาย · NAS มีไฟล์ชื่อตรงแต่ยืนยันไม่ได้ว่าใบเดียวกัน (' + why + '): ' + rel(g));
  };
  // บิลที่ไม่มีสำเนาของตัวเอง → เก็บสำเนาที่ยืนยันแล้วลงโฟลเดอร์บิลนั้น แล้วจดในแผนผังด้วยลิงก์ที่ให้มา (ทำแม้กู้กลับไม่สำเร็จ — รอบรายชั่วโมงจะไม่แจ้งว่าหายทั้งสองที่)
  const giveCopy = (g, src, urls) => {
    if(DRY_RUN) return true;
    try{
      const M = manOf(g.billDir), buf = fs.readFileSync(src.dest);
      let t = nasFileFor(g.billDir, M.man, urls[0], g.name0);
      const p0 = path.join(g.billDir, t.name);
      if(onNas(p0) && !fs.readFileSync(p0).equals(buf)){ M.man['legacy:' + t.name] = t.name; t = nasFileFor(g.billDir, M.man, urls[0], g.name0); }   // ชื่อนี้มีไฟล์อื่นอยู่แล้ว → ไม่ทับ ใช้ชื่อใหม่
      fs.mkdirSync(g.billDir, {recursive: true}); writeFileAtomic(path.join(g.billDir, t.name), buf);
      for(const u of urls) M.man[u] = t.name;
      M.dirty = true; st.fetched++; return true;
    }catch(e){ return false; }
  };
  // กู้กลับ: อัปโหลดสำเนาต้นทางครั้งเดียว แล้วแก้ลิงก์ทุกจุดที่อ้างลิงก์เดิม
  const restore = async ({url, src, ok, bad, noCopy, bills, tag}) => {
    if(DRY_RUN){
      st.restored++; noteOk(url);                                      // ทำเหมือนกู้สำเร็จ ให้ผลทดลองตรงกับรอบจริง
      log('  (ทดลอง) จะกู้จาก NAS กลับขึ้นระบบ: ' + src.b.bill_no + ' ' + src.name + tag);
      for(const [g, why] of bad) log('    ↳ บิล ' + g.b.bill_no + ' ใช้สลิปเดียวกัน แต่สำเนาในโฟลเดอร์นั้นไม่ตรง (' + why + ') — จะไม่แตะไฟล์นั้น ใช้สำเนาของบิล ' + src.b.bill_no + ' แทน');
      return;
    }
    const bucket = bucketOf(url) || (src.kind === 'slip' ? 'slips' : 'bills');
    const objName = (src.kind === 'slip' ? 'slip_' : 'bill_') + safeName(src.b.bill_no) + '_' + Date.now() + '-' + rndTag(10) + path.extname(src.name).toLowerCase();
    let nu = null, n = 0, unsure = false, err = null;
    try{ nu = await uploadObject(bucket, objName, src.dest); }catch(e){ err = e; }
    if(nu){
      try{ n = Number(await rpc('nas_relink', {p_old: url, p_new: nu})) || 0; }
      catch(e){
        if(/^RPC nas_relink 4\d\d/.test(String(e.message || ''))) err = e;   // ฐานข้อมูลตอบชัดว่าไม่ได้แก้
        else{
          // ไม่รู้ผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบผิดพลาด) — ลิงก์อาจชี้ไฟล์ที่อัปแล้ว: ลองซ้ำครั้งเดียว และห้ามลบไฟล์ที่อัป
          try{ n = Number(await rpc('nas_relink', {p_old: url, p_new: nu})) || 0; }catch(e2){}
          if(!n) unsure = true;
        }
      }
      if(err || (!n && !unsure)){ try{ await deleteObject(bucket, objName); }catch(x){} }
    }
    if(err){
      st.restoreFail++; RESTORE_FAILED.push(src.b.bill_no); OK_URLS.delete(url);
      for(const g of noCopy) giveCopy(g, src, [url]);
      ISSUES.set(url, {kind: src.kind, ref: src.b.bill_no, url, reason: 'error', detail: ('ไฟล์ในระบบหาย NAS มีสำเนา แต่กู้กลับไม่ได้: ' + (err.message || err)).slice(0, 200)});
      log('  [!] กู้ ' + src.b.bill_no + ' ' + src.name + ' กลับไม่ได้: ' + (err.message || err) + ' — ลองใหม่รอบตรวจถัดไป');
      return;
    }
    if(unsure){
      st.unsure++; OK_URLS.delete(url);
      for(const g of ok){ const M = manOf(g.billDir); M.man[nu] = g.name; M.dirty = true; }   // ลิงก์ใดลิงก์หนึ่งเป็นของจริง — จดไว้ทั้งคู่ รอบหน้ารู้เอง
      for(const g of noCopy) giveCopy(g, src, [url, nu]);
      ISSUES.set(url, {kind: src.kind, ref: src.b.bill_no, url, reason: 'error', detail: 'ไม่แน่ใจว่าแก้ลิงก์สำเร็จ (เก็บไฟล์ที่อัปไว้แล้ว) — รอบตรวจถัดไปจะตรวจซ้ำ'});
      log('  [!] ' + src.b.bill_no + ' ' + src.name + ' — อัปโหลดแล้วแต่ไม่แน่ใจว่าแก้ลิงก์สำเร็จ (เน็ต/เซิร์ฟเวอร์สะดุด) · เก็บไฟล์ที่อัปไว้ รอบหน้าตรวจซ้ำ');
      return;
    }
    if(!n){ noteOk(url); log('  [ข้าม] ' + src.b.bill_no + ' ' + src.name + ' — ไม่มีรายการอ้างลิงก์เดิมแล้ว (แก้ไปก่อนหน้า) ลบไฟล์ที่เพิ่งอัปทิ้ง'); return; }
    for(const g of ok){ const M = manOf(g.billDir); delete M.man[url]; M.man[nu] = g.name; M.dirty = true; }
    for(const g of noCopy) giveCopy(g, src, [nu]);
    noteOk(url); noteOk(nu); st.restored++;
    RESTORED.push((KIND_TH[src.kind] || src.kind) + ' ' + bills.join(','));
    log('  [กู้คืนอัตโนมัติ] ' + src.b.bill_no + ' ' + src.name + ' — ไฟล์ในระบบหาย ใช้สำเนาจาก NAS แทน (แก้ลิงก์ ' + n + ' จุด)' + tag);
    for(const [g, why] of bad) log('    ↳ บิล ' + g.b.bill_no + ' ใช้สลิปเดียวกัน แต่สำเนาในโฟลเดอร์นั้นไม่ตรง (' + why + ') — ไม่แตะไฟล์นั้น ใช้สำเนาของบิล ' + src.b.bill_no + ' แทน');
  };
  const byUrl = new Map();
  for(const g of GONE){ if(!byUrl.has(g.url)) byUrl.set(g.url, []); byUrl.get(g.url).push(g); }
  const ARCH = [];                       // ลิงก์ที่เข้าเกณฑ์เก็บเข้าคลัง — ตัดสินหลังรู้ผลทุกลิงก์ (บิลที่มีไฟล์อื่นสำรองไม่ได้ ลบไฟล์บิลไม่ได้ → กู้กลับแทน)
  await pool([...byUrl.values()], 6, async group => {
    const url = group[0].url, copies = group.filter(g => !g.noCopy), noCopy = group.filter(g => g.noCopy);
    const passed = copies.filter(g => !g.why);
    let src = passed.find(g => g.known) || passed[0] || null;
    if(src && !src.known && passed.some(g => g !== src && !sameBytes(g.dest, src.dest))) src = null;   // สำเนาเก่าหลายโฟลเดอร์ผ่านเกณฑ์แต่ไม่ตรงกัน
    let elsewhere = null;
    if(!src && NIDX && NIDX.has(url)){
      // ไม่มีสำเนาที่ยืนยันได้ในโฟลเดอร์ของบิลที่ใช้ลิงก์นี้ → หาในโฟลเดอร์บิลอื่นที่จดลิงก์นี้ไว้ (เช่น บิลที่เก็บเข้าคลังแล้วของสลิปโอนรวม)
      elsewhere = NIDX.get(url).filter(p => !group.some(g => g.dest === p));
      const first = elsewhere[0];
      if(first && elsewhere.every(p => sameBytes(p, first))){
        const dir = path.dirname(first);
        src = {url, b: {bill_no: path.basename(dir).replace(/_.*$/, '')}, billDir: dir, kind: group[0].kind, name0: path.basename(first), name: path.basename(first), dest: first, known: true, other: true};
      }
    }
    if(!src){
      for(const g of copies) unverified(g, g.why || 'สำเนาของบิลที่ใช้สลิปเดียวกัน (โอนรวม) ไม่ตรงกัน');
      if(!copies.length){
        if(isAccepted(url)) st.accepted += noCopy.length;              // กด "ช่างมัน" แล้ว — ไม่รายงาน
        else if(elsewhere && elsewhere.length){                         // มีสำเนาในโฟลเดอร์บิลอื่นแต่ไม่ตรงกัน → ให้คนเปิดดู ไม่ใช่ "หายทั้งสองที่"
          const g = noCopy[0], rels = elsewhere.map(p => path.relative(ROOT, p));
          const wk = 'สำเนาในโฟลเดอร์บิลอื่นไม่ตรงกัน'; st.unverified++; st.why[wk] = (st.why[wk] || 0) + 1;
          ISSUES.set(url, {kind: g.kind, ref: g.b.bill_no, url, reason: 'nas_unverified', detail: ('ไฟล์ในระบบหาย · NAS มีสำเนาในโฟลเดอร์บิลอื่นแต่ไม่ตรงกัน: ' + rels.join(' | ')).slice(0, 200)});
          log('  [ตรวจเอง] ' + g.b.bill_no + ' — ไฟล์ในระบบหาย · มีสำเนาในโฟลเดอร์บิลอื่นแต่ไม่ตรงกัน: ' + rels.join(' | '));
        }else{ noteIssue(noCopy[0].kind, noCopy[0].b.bill_no, url, noCopy[0].err); st.gone += noCopy.length; }
      }
      return;
    }
    const ok = [], bad = [];
    for(const g of copies){
      if(g === src || sameBytes(g.dest, src.dest)) ok.push(g);          // ไฟล์เดียวกันเป๊ะกับสำเนาต้นทาง = ใช้ได้ (แม้เกณฑ์ของโฟลเดอร์นั้นเองไม่ผ่าน)
      else bad.push([g, g.why || 'ไม่ตรงกับสำเนาของบิล ' + src.b.bill_no + ' ที่ใช้สลิปเดียวกัน']);
    }
    for(const g of ok) if(!g.known){                                     // สำเนาเก่าที่ยืนยันแล้ว → จดในแผนผังของโฟลเดอร์นั้น
      st.adopted++; ADOPTED.add(url);
      if(!DRY_RUN){ const M = manOf(g.billDir); M.man[url] = g.name; M.dirty = true; }
    }
    const bills = [...new Set(group.map(g => g.b.bill_no))];
    const ctx = {url, src, ok, bad, noCopy, bills, group,
      tag: (src.known ? '' : ' (สำเนาเก่า ตรวจแล้วตรงเงื่อนไข)') + (src.other ? ' · ใช้สำเนาที่เก็บไว้ในโฟลเดอร์บิล ' + src.b.bill_no + ' (สลิปเดียวกัน)' : '') + (bills.length > 1 ? ' · สลิปนี้ใช้กับบิล ' + bills.join(', ') : '')};
    if(canArchive && !bad.length && group.every(g => prunableBill(g.b))) ARCH.push(ctx);   // บิลที่ไม่มีสำเนา → เขียนสำเนาให้ตอนยืนยันเก็บเข้าคลัง
    else await restore(ctx);
  });
  // บิลที่จะเก็บเข้าคลังต้องไม่มีไฟล์อื่นที่สำรองไม่ได้ (ขั้นตอนลบไฟล์บิลจ่ายครบข้ามบิลนั้น → ลิงก์ที่เสียจะค้างไปเรื่อย ๆ) → กู้กลับแทน
  //   ถ้าลิงก์ใดของบิลต้องกู้กลับแทน ลิงก์อื่นของบิลเดียวกันก็กู้กลับด้วย (บิลนั้นเก็บเข้าคลังรอบนี้ไม่ได้อยู่ดี) — ไล่จนไม่เปลี่ยน
  const blocked = ctx => ctx.group.some(g => billFiles(g.b).some(([u]) => u !== ctx.url && ISSUES.has(u)));
  const billsOf = ctx => ctx.group.map(g => g.b.bill_no);
  const later = new Set();
  for(let changed = true; changed; ){
    changed = false;
    const badBills = new Set([...later].flatMap(billsOf));
    for(const ctx of ARCH) if(!later.has(ctx) && (blocked(ctx) || billsOf(ctx).some(n => badBills.has(n)))){ later.add(ctx); changed = true; }
  }
  for(const ctx of ARCH){
    if(later.has(ctx)) continue;
    if(!ctx.noCopy.every(g => giveCopy(g, ctx.src, [ctx.url]))){ later.add(ctx); continue; }   // เขียนสำเนาให้บิลที่ไม่มีไม่ได้ → กู้กลับแทน
    for(const g of ctx.noCopy){ st.archive++; ARCHIVE_BILLS.add(g.b.bill_no); ADOPTED_AT.add(g.billDir + '\0' + ctx.url); log('  ' + (DRY_RUN ? '(ทดลอง) ' : '') + '[เก็บเข้าคลัง NAS] ' + g.b.bill_no + ' — ไม่มีสำเนาในโฟลเดอร์ตัวเอง ใช้สำเนาของบิล ' + ctx.src.b.bill_no + ' (สลิปเดียวกัน) · บิลจ่ายครบเกิน ' + CFG.PRUNE_PAID_AFTER_DAYS + ' วัน'); }
    for(const g of ctx.ok){
      st.archive++; ARCHIVE_BILLS.add(g.b.bill_no); ADOPTED_AT.add(g.billDir + '\0' + ctx.url);
      log('  ' + (DRY_RUN ? '(ทดลอง) ' : '') + '[เก็บเข้าคลัง NAS] ' + g.b.bill_no + ' ' + g.name + ' — ไฟล์ในระบบหาย ใช้สำเนาบน NAS' + (g.known ? '' : ' (สำเนาเก่า ตรวจแล้วตรงเงื่อนไข)') + ' · บิลจ่ายครบเกิน ' + CFG.PRUNE_PAID_AFTER_DAYS + ' วัน');
    }
    noteOk(ctx.url);
  }
  await pool([...later], 6, restore);
  for(const [dir, M] of MANS) if(M.dirty) writeManifest(dir, M.man);
}
const STATE_FILE = path.join(__dirname, 'archiver-state.json');
// ทำงานทีละรอบเท่านั้น: รอบทุกชั่วโมง (--once) กับที่สั่งเอง (--check / --restore-*) ห้ามชนกัน — แผนผังไฟล์/การกู้คืนจะซ้ำซ้อน
const LOCK_FILE = path.join(__dirname, 'archiver.lock');
let lockHeld = false;
function acquireLock(tries){
  tries = tries || 0;
  try{
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, JSON.stringify({pid: process.pid, at: Date.now()})); fs.closeSync(fd);
    lockHeld = true; return true;
  }catch(e){
    if(e.code !== 'EEXIST') return true;                           // สร้างไฟล์ล็อกไม่ได้ด้วยเหตุอื่น — ไม่บล็อกการทำงาน
    let info = {}; try{ info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }catch(x){}
    let alive = false;
    if(info.pid){ try{ process.kill(info.pid, 0); alive = true; }catch(x){ alive = x.code === 'EPERM'; } }
    const stale = !info.at || Date.now() - info.at > 6 * 3600 * 1000;
    if((!alive || stale) && tries < 2){ try{ fs.unlinkSync(LOCK_FILE); }catch(x){} return acquireLock(tries + 1); }
    log('[ข้าม] มีโปรแกรมอีกรอบกำลังทำงานอยู่ (pid ' + (info.pid || '?') + ' เริ่ม ' + (info.at ? thDateTimeStr(new Date(info.at).toISOString()) : '?') + ') — รอบนี้ไม่ทำอะไร');
    return false;
  }
}
function releaseLock(){ if(!lockHeld) return; try{ const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); if(info.pid === process.pid) fs.unlinkSync(LOCK_FILE); }catch(e){} lockHeld = false; }
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });
function readState(){ try{ return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }catch(e){ return {}; } }
function writeState(s){ try{ fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); }catch(e){} }

// (2) รูปสินค้า + สื่อบรอดแคสต์ (bucket products)
const BROADCAST_RE = /^(broadcast|promo|media)-\d{10,}-/;   // ไฟล์ที่หน้า "บรอดแคสต์/โปรโมชั่น" อัปโหลด (uploadLineMedia) — ลบได้หลังส่งแล้ว · ไฟล์อื่นทั้งหมด = รูปสินค้า ห้ามลบ
async function syncMedia(ROOT){
  let saved = 0, skipped = 0, failed = 0, pruned = 0;
  const base = path.join(ROOT, MEDIA_DIR);
  const D = await loadData();
  const canPrune = dataOk(D, 'products') && Array.isArray(D.products) && D.products.length > 0;   // รู้รายการสินค้าแน่ ๆ ถึงจะลบอะไรได้
  if(canPrune) FULL_KINDS.add('product');
  if(!canPrune) log('[!] อ่านรายการสินค้าไม่ได้/ได้ 0 รายการ — รอบนี้เก็บสื่ออย่างเดียว ไม่ลบอะไรใน Supabase');
  const products = (D.products || []).filter(p => p.image_url);
  const pdir = path.join(base, 'สินค้า'); fs.mkdirSync(pdir, {recursive: true});
  const referenced = new Set();
  for(const p of products){
    const op = objPathOf(p.image_url, 'products'); if(op) referenced.add(op);
    const name = safeName((p.sku || p.id) + '_' + (p.name || '')).slice(0, 60) + '_' + shortHash(p.image_url) + extOf(p.image_url);
    const dest = path.join(pdir, name);
    if(fs.existsSync(dest)){ skipped++; tally('รูปสินค้า', 'have'); continue; }
    try{ await download(p.image_url, dest); saved++; noteOk(p.image_url); tally('รูปสินค้า', 'new'); }
    catch(e){ if(isGone(e) && isAccepted(p.image_url)) continue; failed++; noteIssue('product', (p.sku || p.id) + ' ' + (p.name || ''), p.image_url, e); tally('รูปสินค้า', 'fail'); log('  [!] โหลดรูปสินค้า ' + (p.sku || p.id) + ' ไม่ได้ — ' + e.message); }
  }
  // ไฟล์อื่นใน bucket products = สื่อบรอดแคสต์/โปรโมชั่น (ชื่อขึ้นต้น broadcast-/media-/promo-…)
  let objs = [];
  try{ objs = await rpc('nas_list_objects', {p_bucket: 'products'}); }catch(e){ log('[!] อ่านรายชื่อไฟล์ใน products ไม่ได้: ' + e.message); return {saved, skipped, failed, pruned}; }
  const cutoff = Date.now() - CFG.PRUNE_BROADCAST_DAYS * 24 * 3600 * 1000;
  for(const o of objs){
    if(referenced.has(o.name)) continue;                        // รูปสินค้าที่ยังใช้อยู่ เก็บไว้ข้างบนแล้ว ไม่ลบ
    const isBroadcast = BROADCAST_RE.test(o.name);
    const url = SUPABASE_URL + '/storage/v1/object/public/products/' + o.name.split('/').map(encodeURIComponent).join('/');
    const {y, m} = thDate(o.created_at);
    const sub = isBroadcast ? 'บรอดแคสต์' : 'รูปสินค้าอื่นๆ';           // ไฟล์ที่ไม่ใช่บรอดแคสต์ = รูปสินค้าเก่า/สำรอง เก็บไว้เฉย ๆ ไม่ลบ
    const dir = path.join(base, sub, y + '-' + m); fs.mkdirSync(dir, {recursive: true});
    const dest = path.join(dir, safeName(o.name.replace(/\//g, '_')));
    if(!fs.existsSync(dest)){
      try{ await download(url, dest); saved++; tally(isBroadcast ? 'สื่อบรอดแคสต์' : 'รูปสินค้าอื่นๆ (ไม่ลบ)', 'new'); log('  [เก็บ] ' + path.join(MEDIA_DIR, sub, y + '-' + m, path.basename(dest))); }
      catch(e){ failed++; tally(isBroadcast ? 'สื่อบรอดแคสต์' : 'รูปสินค้าอื่นๆ (ไม่ลบ)', 'fail'); log('  [!] โหลดสื่อ ' + o.name + ' ไม่ได้ — ' + e.message); continue; }
    }else{ skipped++; tally(isBroadcast ? 'สื่อบรอดแคสต์' : 'รูปสินค้าอื่นๆ (ไม่ลบ)', 'have'); }
    if(canPrune && isBroadcast && new Date(o.created_at).getTime() < cutoff && onNas(dest)){
      try{ await deleteObject('products', o.name); pruned++; tally('สื่อบรอดแคสต์', 'pruned'); log('  [ลบใน Supabase] ลบสื่อบรอดแคสต์ออกจาก Supabase: ' + o.name); }
      catch(e){ log('  [!] ' + e.message); }
    }
  }
  return {saved, skipped, failed, pruned};
}

// (3) รายจ่าย Petty Cash: CSV รายเดือน + รูปใบเสร็จ ในโฟลเดอร์ รายจ่าย/ปี/ปี-เดือน
async function syncExpenses(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const D = await loadData();
  if(dataOk(D, 'petty_cash')) FULL_KINDS.add('receipt');
  const cats = {}; (D.expense_categories || []).forEach(c => cats[c.id] = c.name);
  const rows = [...(D.petty_cash || [])].sort((a, b) => String(a.spent_at || '').localeCompare(String(b.spent_at || '')));
  if(!rows.length) return {saved, skipped, failed};
  const byMonth = {};
  rows.forEach(r => { const ym = String(r.spent_at || r.created_at || '').slice(0, 7); if(ym) (byMonth[ym] = byMonth[ym] || []).push(r); });
  const nowYm = thDate(new Date().toISOString()); const curYm = nowYm.y + '-' + nowYm.m;
  for(const [ym, list] of Object.entries(byMonth)){
    const dir = path.join(ROOT, EXP_DIR, ym.slice(0, 4), ym);
    const csvPath = path.join(dir, 'รายจ่าย_' + ym + '.csv');
    const monthsAgo = (Number(curYm.slice(0,4)) - Number(ym.slice(0,4))) * 12 + (Number(curYm.slice(5,7)) - Number(ym.slice(5,7)));
    const receiptName = r => safeName(String(r.spent_at || '').slice(0, 10) + '_' + (cats[r.category_id] || 'ไม่ระบุหมวด') + '_' + Number(r.amount || 0) + '_' + r.id) + extOf(r.receipt_url);
    if(fs.existsSync(csvPath) && monthsAgo > 1 && list.every(r => !r.receipt_url || onNas(path.join(dir, receiptName(r))))){ skipped += list.length; continue; }   // เดือนเก่าที่มี CSV และใบเสร็จครบแล้ว ไม่ต้องทำซ้ำ
    fs.mkdirSync(dir, {recursive: true});
    const head = ['วันที่','หมวด','รายละเอียด','ร้านค้า','จำนวนเงิน','วิธีจ่าย','ผู้จ่าย','เลขอ้างอิง','หมายเหตุ','บันทึกโดย','ไฟล์ใบเสร็จ'];
    const lines = [head.map(csvCell).join(',')]; let total = 0;
    for(const r of list){
      let rname = '';
      if(r.receipt_url){
        rname = receiptName(r);
        const dest = path.join(dir, rname);
        if(!fs.existsSync(dest)){
          try{ await download(r.receipt_url, dest); saved++; noteOk(r.receipt_url); tally('ใบเสร็จรายจ่าย', 'new'); }
          catch(e){ if(!(isGone(e) && isAccepted(r.receipt_url))){ failed++; noteIssue('receipt', String(r.spent_at || '').slice(0, 10) + ' ' + (r.description || '') + ' ฿' + Number(r.amount || 0), r.receipt_url, e); tally('ใบเสร็จรายจ่าย', 'fail'); } rname = '(โหลดไม่ได้)'; }
        } else tally('ใบเสร็จรายจ่าย', 'have');
      }
      total += Number(r.amount || 0);
      lines.push([String(r.spent_at || '').slice(0, 10), cats[r.category_id] || '', r.description || '', r.vendor || '', Number(r.amount || 0),
        r.pay_method === 'cash' ? 'เงินสด' : (r.pay_method === 'transfer' ? 'โอน' : (r.pay_method || '')), r.paid_by || '', r.ref_no || '', r.note || '', r.created_by || '', rname].map(csvCell).join(','));
    }
    lines.push('', ['', 'รวมรายจ่ายเดือน ' + ym, '', '', total].map(csvCell).join(','));
    fs.writeFileSync(csvPath, '\uFEFF' + lines.join('\r\n'));
  }
  return {saved, skipped, failed};
}

// (4) สำรองตารางข้อมูลเป็น CSV + JSON ทุก CFG.BACKUP_EVERY_DAYS วัน
function toCsv(rows){
  if(!rows || !rows.length) return '\uFEFF';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => csvCell(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  return '\uFEFF' + [cols.map(csvCell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}
async function backupTables(ROOT){
  const base = path.join(ROOT, BACKUP_DIR); fs.mkdirSync(base, {recursive: true});
  const marks = fs.readdirSync(base, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  const last = marks[marks.length - 1];
  const today = thDate(new Date().toISOString()); const todayStr = today.y + '-' + today.m + '-' + today.d;
  if(last && (new Date(todayStr) - new Date(last)) / 86400000 < CFG.BACKUP_EVERY_DAYS){
    const nx = new Date(new Date(last).getTime() + CFG.BACKUP_EVERY_DAYS * 86400000).toISOString().slice(0, 10);
    log('[สำรอง] สำรองตารางล่าสุด ' + path.join(BACKUP_DIR, last) + ' · ครั้งถัดไป ' + nx + ' (ทุก ' + CFG.BACKUP_EVERY_DAYS + ' วัน)');
    return {done: false};
  }
  const TABLES = ['customers','products','sales','orders','order_items','bills','payments','petty_cash','expense_categories','customer_prices','warehouses','settings',
                  'sale_comp','sale_pay_adj','credit_statements','credit_docs','credit_reviews','line_groups','price_log','price_adjust_batches','holidays'];
  const dir = path.join(base, todayStr); fs.mkdirSync(dir, {recursive: true});
  let n = 0;
  for(const table of TABLES){
    let rows;
    try{ rows = await exportTable(table); }                          // ทีละ 2,000 แถว (ตารางที่อ่านไปแล้วรอบนี้ใช้ซ้ำ)
    catch(e){ log('  [!] สำรองตาราง ' + table + ' ไม่ได้: ' + e.message); continue; }
    fs.writeFileSync(path.join(dir, table + '.json'), JSON.stringify(rows));
    fs.writeFileSync(path.join(dir, table + '.csv'), toCsv(rows));
    n++;
  }
  if(!n){ try{ fs.rmdirSync(dir); }catch(e){} return {done: false}; }
  tally('สำรองตารางข้อมูล', 'new', n);
  log('[สำรอง] สำรองข้อมูล ' + n + ' ตาราง → ' + path.join(BACKUP_DIR, todayStr));
  return {done: true, tables: n};
}

// กู้คืนไฟล์ใน bucket products จากสำเนาบน NAS (ใช้เมื่อไฟล์ถูกลบผิดพลาด): node archiver.js --restore-media
const MIME = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', mp4:'video/mp4', mov:'video/quicktime'};
async function restoreMedia(){
  if(!(await preflight())){ flushLog(); return false; }
  const ROOT = resolveNasRoot(); if(!ROOT){ log('[X] หาโฟลเดอร์ปลายทางไม่เจอ'); return false; }
  const base = path.join(ROOT, MEDIA_DIR);
  if(!fs.existsSync(base)){ log('[X] ไม่มีโฟลเดอร์ ' + base); return false; }
  const files = [];
  const walk = d => { for(const e of fs.readdirSync(d, {withFileTypes: true})){ const p = path.join(d, e.name); if(e.isDirectory()) walk(p); else if(!e.name.startsWith('.')) files.push(p); } };
  for(const sub of ['บรอดแคสต์', 'รูปสินค้าอื่นๆ']) if(fs.existsSync(path.join(base, sub))) walk(path.join(base, sub));
  log('กู้คืนสื่อสินค้า: พบไฟล์บน NAS ' + files.length + ' ไฟล์ → ตรวจว่าใน Supabase ยังมีไหม ถ้าไม่มีจะอัปโหลดกลับ');
  let up = 0, have = 0, fail = 0;
  for(const f of files){
    const name = path.basename(f);   // ชื่อไฟล์บน NAS = ชื่อ object เดิมใน bucket products
    const url = SUPABASE_URL + '/storage/v1/object/public/products/' + encodeURIComponent(name);
    try{
      const h = await fetch(url, {method: 'HEAD'});
      if(h.ok){ have++; continue; }
      const ext = name.split('.').pop().toLowerCase();
      const r = await fetch(SUPABASE_URL + '/storage/v1/object/products/' + encodeURIComponent(name), {
        method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': MIME[ext] || 'application/octet-stream', 'x-upsert': 'true'},
        body: fs.readFileSync(f)});
      if(!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
      up++; log('  [กู้คืน] ' + name);
    }catch(e){ fail++; log('  [!] กู้คืน ' + name + ' ไม่ได้ — ' + e.message + (/40[13]/.test(e.message) ? ' (รัน SQL เปิดสิทธิ์อัปโหลด nas_upload_media หรือยัง?)' : '')); }
  }
  log('[OK] กู้คืนเสร็จ — อัปโหลดกลับ ' + up + ' · มีอยู่แล้ว ' + have + (fail ? ' · พลาด ' + fail : ''));
  flushLog();
  return fail === 0;
}

// กู้บิลจาก NAS กลับเข้า Supabase (ใช้เมื่อรูปบิล/สลิปถูกลบออกจาก Supabase แล้วอยากดูในระบบอีก):
//   node archiver.js --restore-bill IV2609250013            (หลายใบคั่นด้วย , ไม่เว้นวรรค)
//   อัปโหลดรูปบิลเวอร์ชันล่าสุด + สลิปทุกใบจากโฟลเดอร์บิลบน NAS แล้วใส่ลิงก์คืนในบิล/ประวัติการชำระ (RPC nas_restore_bill)
function findBillDir(ROOT, billNo){
  const base = safeName(billNo);
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(_.*)?$');
  const ls = d => { try{ return fs.readdirSync(d); }catch(e){ return []; } };
  for(const y of ls(ROOT).filter(n => /^\d{4}$/.test(n))){
    for(const m of ls(path.join(ROOT, y)).filter(n => /^\d{2}$/.test(n))){
      for(const d of ls(path.join(ROOT, y, m)).filter(n => /^\d{8}$/.test(n))){
        const dd = path.join(ROOT, y, m, d);
        for(const name of ls(dd)){
          const p = path.join(dd, name);
          if(re.test(name) && fs.statSync(p).isDirectory()) return p;
        }
      }
    }
  }
  return null;
}
const rndTag = n => { const s = 'abcdefghijklmnopqrstuvwxyz0123456789'; let o = ''; for(let i = 0; i < n; i++) o += s[Math.floor(Math.random() * s.length)]; return o; };
async function uploadObject(bucket, objPath, file){
  const ext = path.extname(file).slice(1).toLowerCase();
  const enc = objPath.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + enc, {
    method: 'POST', headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': MIME[ext] || 'application/octet-stream', 'x-upsert': 'true'},
    body: fs.readFileSync(file)});
  if(!r.ok) throw new Error('อัปโหลด ' + bucket + '/' + objPath + ' ไม่ได้ HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + enc;
}
const verOf = (f, re) => { const m = f.match(re); return m ? parseInt(m[1], 10) : 0; };
async function restoreBills(billNos){
  if(!(await preflight())){ flushLog(); return false; }
  const ROOT = resolveNasRoot(); if(!ROOT){ log('[X] หาโฟลเดอร์ปลายทางไม่เจอ'); flushLog(); return false; }
  let okN = 0, fail = 0;
  for(const raw of billNos){
    const billNo = String(raw || '').trim(); if(!billNo) continue;
    const dir = findBillDir(ROOT, billNo);
    if(!dir){ fail++; log('[!] ' + billNo + ': ไม่พบโฟลเดอร์บิลบน NAS (ค้นใน ' + ROOT + '/ปี/เดือน/วัน)'); continue; }
    const base = safeName(billNo), files = fs.readdirSync(dir);
    const IMG = /\.(png|jpe?g|webp|gif|pdf)$/i;                     // ไฟล์รูปจริงเท่านั้น (ไม่เอา .part ที่โหลดค้าง / .files.json)
    const man = readManifest(dir);
    const pr = Array.isArray(man.__pruned__) ? man.__pruned__.filter(n => IMG.test(n) && onNas(path.join(dir, n))) : [];
    let billFiles, slipFiles;
    if(pr.length){                                                   // รู้แน่ว่าตอนลบ บิลมีไฟล์ไหน → ใช้ชุดนั้นตามลำดับเดิม
      billFiles = pr.filter(n => n.startsWith(base + '_บิล_v'));
      slipFiles = pr.filter(n => n.startsWith(base + '_สลิป'));
    }else{
      const legacy = new Set(Object.keys(man).filter(k => k.startsWith('legacy:')).map(k => man[k]));   // สลิปเก่าที่ถูกแทนแล้ว ไม่เอา
      billFiles = files.filter(f => f.startsWith(base + '_บิล_v') && IMG.test(f) && onNas(path.join(dir, f))).sort((a, b) => verOf(a, /_v(\d+)\./) - verOf(b, /_v(\d+)\./));
      slipFiles = files.filter(f => f.startsWith(base + '_สลิป') && IMG.test(f) && !legacy.has(f) && onNas(path.join(dir, f))).sort((a, b) => verOf(a, /_สลิป(\d+)/) - verOf(b, /_สลิป(\d+)/) || a.localeCompare(b));
    }
    if(!billFiles.length && !slipFiles.length){ fail++; log('[!] ' + billNo + ': โฟลเดอร์ ' + path.relative(ROOT, dir) + ' ไม่มีรูปบิล/สลิป'); continue; }
    const L = man.__pruned_layout__;
    const useLayout = L && Array.isArray(L.payments);
    if(DRY_RUN){
      okN++;
      log('(ทดลอง) ' + billNo + ': จะอัปโหลดรูปบิล ' + (useLayout ? (L.image ? 1 : 0) : billFiles.length ? 1 : 0) + ' · สลิป '
          + (useLayout ? [...new Set([].concat(...L.payments, L.slip_url ? [L.slip_url] : []))].length + ' (คืนตรงครั้งที่ชำระเดิม)' : slipFiles.length + ' (บิลเก็บก่อนมีการจด — ใส่ตามจำนวน)') + ' จาก ' + path.relative(ROOT, dir));
      continue;
    }
    try{
      const stamp = Date.now();
      const up = {};
      const upl = async n => {                                       // อัปโหลดไฟล์ละครั้ง (สลิปเดียวใช้หลายที่ได้)
        if(!n || !IMG.test(n) || !onNas(path.join(dir, n))) return null;
        if(!up[n]){
          const isSlip = n.startsWith(base + '_สลิป');
          up[n] = await uploadObject(isSlip ? 'slips' : 'bills', (isSlip ? 'slip_' : 'bill_') + base + '_' + stamp + '-' + rndTag(10) + path.extname(n).toLowerCase(), path.join(dir, n));
        }
        return up[n];
      };
      let args;
      if(useLayout){
        const pays = [];
        for(const arr of L.payments){ const us = []; for(const n of arr){ const u = await upl(n); if(u) us.push(u); } pays.push(us); }
        args = {p_bill_no: billNo, p_image_url: await upl(L.image), p_slips: pays, p_bill_slip: await upl(L.slip_url)};
      }else{
        const slips = [];
        for(const n of slipFiles) slips.push(await upl(n));
        args = {p_bill_no: billNo, p_image_url: billFiles.length ? await upl(billFiles[billFiles.length - 1]) : null, p_slips: slips.filter(Boolean)};
      }
      const r = await rpc('nas_restore_bill', args);
      okN++;
      log('[กู้คืน] ' + billNo + ' — อัปโหลด ' + Object.keys(up).length + ' ไฟล์ จาก ' + path.relative(ROOT, dir)
          + (useLayout ? ' (คืนสลิปตรงครั้งที่ชำระเดิม)' : ' (บิลเก็บก่อนมีการจด — ใส่สลิปตามจำนวน เฉพาะครั้งที่ยังว่าง)')
          + (r && r.payments_updated != null ? ' · ใส่สลิปคืนในประวัติชำระ ' + r.payments_updated + ' รายการ' : ''));
    }catch(e){
      fail++;
      log('[!] ' + billNo + ': กู้คืนไม่สำเร็จ — ' + e.message
          + (/HTTP 40[13]/.test(e.message) ? ' (รัน mix888-nas-key-fix.sql ฉบับล่าสุดเพื่อเปิดสิทธิ์อัปโหลด bills/slips หรือยัง?)' : '')
          + (/NO_BILL/.test(e.message) ? ' (ไม่มีบิลเลขนี้ในระบบ)' : '')
          + (/NOT_ARCHIVED/.test(e.message) ? ' (บิลนี้ไม่ได้ถูกเก็บแทน Supabase — สลิปที่หายให้ใช้ \u{1F4CE} แนบสลิปแทน ในหลังบ้านทีละใบ)' : '')
          + (/LAYOUT_MISMATCH/.test(e.message) ? ' (จำนวนครั้งที่ชำระเปลี่ยนไปจากตอนเก็บ — แนบสลิปเองในหลังบ้าน)' : '')
          + (/ 404/.test(e.message) && /nas_restore_bill/.test(e.message) ? ' (Supabase ยังไม่มีฟังก์ชัน nas_restore_bill — รัน mix888-nas-key-fix.sql ฉบับล่าสุด)' : ''));
    }
  }
  log('[OK] กู้คืนบิลเสร็จ — สำเร็จ ' + okN + (fail ? ' · พลาด ' + fail : ''));
  flushLog();
  return fail === 0;
}

let running = false;
async function syncOnce(){
  if(running) return true;
  running = true;
  const t0 = Date.now();
  let saved = 0, skipped = 0, failed = 0, ok = true;
  try{
    const ROOT = resolveNasRoot();
    if(!ROOT){
      log('[X] หาโฟลเดอร์ปลายทางไม่เจอ: ' + (CFG.NAS_ROOT || 'ลองแล้ว /volume1-6/Mix888'));
      log('   ใส่ NAS_ROOT ใน archiver.config.json ให้ตรงกับที่อยู่จริงของโฟลเดอร์ Mix888');
      running = false; flushLog();
      return false;
    }
    log('ปลายทาง: ' + ROOT);
    if(!(await preflight())){ running = false; flushLog(); return false; }
    DATA = null;   // โหลดข้อมูลตารางใหม่ทุกรอบ
    ISSUES.clear(); OK_URLS.clear(); RESTORED.length = 0; FULL_KINDS.clear(); MOVED.clear(); OBJ_INDEX.clear(); TABLE_CACHE.clear(); RELINKED.length = 0;
    ADOPTED.clear(); ADOPTED_AT.clear(); ARCHIVE_BILLS.clear(); ARCHIVED_LOST.clear(); RESTORE_FAILED.length = 0; ARCHIVE_OK = null;
    ACCEPTED.clear(); ACCEPTED_SEEN.clear();
    try{ const a = await rpc('nas_accepted_urls'); if(Array.isArray(a)) a.forEach(u => { if(typeof u === 'string' && u) ACCEPTED.add(u); }); }   // อ่านอย่างเดียว (โหมดทดลองก็อ่าน)
    catch(e){ if(!/ 404:|PGRST202/.test(e.message)) log('[!] อ่านรายการไฟล์ที่ "ช่างมัน" ไม่ได้: ' + e.message + ' — รอบนี้ไฟล์พวกนั้นจะขึ้นเป็นปัญหาตามเดิม (ไม่แจ้งไลน์ซ้ำ)'); }   // ยังไม่ได้รัน SQL = ยังไม่มีฟังก์ชัน → ทำงานแบบเดิม
    const since = new Date(Date.now() - CFG.DAYS_BACK * 24 * 3600 * 1000).toISOString();
    const bills = await fetchBills(since);
    log('พบบิล ' + bills.length + ' ใบ (ย้อนหลัง ' + CFG.DAYS_BACK + ' วัน)');

    const byDay = {};   // โฟลเดอร์รายวัน → รายการบิล (ไว้ทำไฟล์สรุป)
    for(const b of bills){
      const {y, m, ddmmyyyy} = thDate(b.created_at);
      const dayDir  = path.join(ROOT, y, m, ddmmyyyy);
      (byDay[dayDir] = byDay[dayDir] || {ddmmyyyy, rows: []}).rows.push(b);
      if((b.ship_status || 'pending') === 'cancelled'){
        if(fs.existsSync(dayDir)) removeBillDir(dayDir, b);   // เคยเก็บไว้ = ลบทิ้ง
        continue;                                             // ไม่เก็บบิลยกเลิก
      }
      const billDir = fs.existsSync(dayDir) ? ensureBillDir(dayDir, b)
                    : path.join(dayDir, safeName(b.bill_no) + paySuffix(b));

      // รายการไฟล์ของบิลนี้: [url, ชื่อไฟล์ปลายทาง, ประเภท]
      const files = billFiles(b);

      if(!files.length) continue;
      fs.mkdirSync(billDir, {recursive: true});
      const man = readManifest(billDir); let manDirty = false;
      for(const [url, name0, kind] of files){
        const f = nasFileFor(billDir, man, url, name0), name = f.name;
        const dest = path.join(billDir, name);
        if(onNas(dest)){ skipped++; tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'have'); continue; }
        if(isAccepted(url)) continue;                                  // กด "ช่างมัน" แล้ว (หายถาวร) — ไม่ลองโหลดทุกชั่วโมง · รอบตรวจประจำวันยังลองให้ (ถ้ากลับมาเปิดได้ก็เก็บ)
        try{ await download(url, dest); man[url] = name; manDirty = true; saved++; noteOk(url); tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'new'); log('  [เก็บ] ' + path.join(ddmmyyyy, safeName(b.bill_no), name)); }
        catch(e){
          const nu = isGone(e) ? await relinkMoved(url, b.bill_no) : null;   // ไฟล์ถูกย้ายชื่อ → แก้ลิงก์ แล้วเก็บจากไฟล์ที่ย้าย
          if(nu){
            try{
              await download(nu, dest); if(!DRY_RUN){ man[nu] = name; manDirty = true; }
              saved++; noteOk(url); noteOk(nu); tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'new');
              log('  [เก็บ] ' + path.join(ddmmyyyy, safeName(b.bill_no), name) + ' (จากไฟล์ที่ถูกย้ายชื่อ)');
              continue;
            }catch(e2){ noteOk(url); e = e2; }
          }
          failed++; noteIssue(kind, b.bill_no, (nu && !DRY_RUN) ? nu : url, e); tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'fail');
          log('  [!] โหลดไม่ได้ ' + b.bill_no + ' ' + name + ' — ' + e.message + (isGone(e) ? ' (ไฟล์ไม่มีในระบบแล้ว และ NAS ไม่เคยเก็บไว้)' : ''));
        }
      }
      if(manDirty) writeManifest(billDir, man);
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
          cancelled ? 'ยกเลิกบิล' : b.payment_status === 'paid' ? 'จ่ายครบแล้ว'
            : Number(b.paid_amount || 0) > 0 ? 'จ่ายขาด (รับแล้ว ' + Number(b.paid_amount) + ')' : 'ยังไม่จ่าย',
          b.pay_method === 'cash' ? 'เงินสด' : (b.pay_method === 'transfer' ? 'โอน' : ''),
          cancelled ? 'ยกเลิก' : (b.ship_status === 'shipped' ? 'ส่งแล้ว' : 'รอส่ง'),
          'v' + (b.revision || 1),
          thDateTimeStr(b.created_at),
          nslip].map(csvCell).join(','));
      });
      lines.push('');
      lines.push(['', 'รวมยอดขาย (ไม่รวมบิลยกเลิก)', total, 'รับชำระแล้ว', paid, 'ค้างรับ', total - paid].map(csvCell).join(','));
      // BOM นำหน้าให้ Excel เปิดภาษาไทยไม่เพี้ยน
      fs.writeFileSync(path.join(dayDir, 'สรุปบิล_' + info.ddmmyyyy + '.csv'), '\uFEFF' + lines.join('\r\n'));
    }

    // ข้อมูลลูกค้าเครดิต + ใบวางบิล (พลาดส่วนนี้ไม่กระทบการเก็บบิล)
    try{ const r = await syncCustomers(ROOT); saved += r.saved; skipped += r.skipped; failed += r.failed; }
    catch(e){ log('[!] เก็บข้อมูลลูกค้าเครดิตไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-credit-docs.sql หรือยัง?)'); }
    try{ const r = await syncStatements(ROOT); saved += r.saved; skipped += r.skipped; failed += r.failed; }
    catch(e){ log('[!] เก็บใบวางบิลไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-credit-statement.sql หรือยัง?)'); }
    try{ const r = await syncMedia(ROOT); saved += r.saved; skipped += r.skipped; failed += r.failed; }
    catch(e){ log('[!] เก็บสื่อสินค้าไม่สำเร็จ: ' + (e.message || e)); }
    try{ const r = await syncExpenses(ROOT); saved += r.saved; skipped += r.skipped; failed += r.failed; }
    catch(e){ log('[!] เก็บรายจ่ายไม่สำเร็จ: ' + (e.message || e)); }
    // ตรวจสำรองเต็มรอบ วันละครั้ง (หรือสั่งเอง --check) — ไล่ย้อนหลัง PRUNE_DAYS_BACK วัน กู้ไฟล์ที่หายจาก NAS · เก็บที่ตกหล่น
    let fullKinds = [];
    const state = readState();
    const td = thDate(new Date().toISOString()), today = td.y + '-' + td.m + '-' + td.d;
    if(FORCE_CHECK || state.lastCheck !== today){
      try{ await verifyBackups(ROOT); fullKinds = ['slip', 'bill']; if(!DRY_RUN){ state.lastCheck = today; writeState(state); } }
      catch(e){ log('[!] ตรวจสำรองเต็มรอบไม่สำเร็จ: ' + (e.message || e) + ' (จะลองใหม่รอบหน้า)'); }
    }
    // ลบไฟล์บิลจ่ายครบ (ข้ามบิลที่มีไฟล์สำรองไม่ได้) แล้วค่อยรายงาน — ข้อความไลน์บอกผล "ที่ทำไปแล้วจริง" (เช่น เก็บเข้าคลังกี่ใบ)
    try{ await pruneBills(ROOT); }
    catch(e){ log('[!] ลบไฟล์บิลจ่ายครบไม่สำเร็จ: ' + (e.message || e)); }
    // รายงานไฟล์ที่สำรองไม่ได้ → Supabase + กลุ่มรีพอร์ต (ไฟล์พวกนี้จะไม่ถูกลบออกจาก Supabase)
    try{ await reportIssues(fullKinds.concat([...FULL_KINDS])); }
    catch(e){ log('[!] รายงานไฟล์ที่สำรองไม่ได้ไม่สำเร็จ: ' + (e.message || e)); }
    if(ACCEPTED_SEEN.size) log('ไฟล์ที่หายถาวรและกด "ช่างมัน" แล้ว ' + ACCEPTED_SEEN.size + ' ไฟล์ — ข้าม ไม่รายงาน');
    try{ await backupTables(ROOT); }
    catch(e){ log('[!] สำรองข้อมูลไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-nas-key-fix.sql หรือยัง?)'); }

    log('[OK] ซิงก์เสร็จใน ' + Math.round((Date.now()-t0)/1000) + ' วิ — ไฟล์ใหม่ ' + saved
        + ' · มีอยู่แล้ว ' + skipped + (failed ? ' · โหลดพลาด ' + failed + ' (จะลองใหม่รอบหน้า)' : ''));
    log('────────── สรุปสิ่งที่เก็บลง NAS รอบนี้' + (DRY_RUN ? ' (โหมดทดลอง: ไม่ได้ลบ/แก้อะไรใน Supabase)' : '') + ' ──────────');
    for(const [sec, r] of Object.entries(REPORT))
      log('  ' + sec.padEnd(34, ' ') + ' ใหม่ ' + String(r.new).padStart(5) + ' · มีอยู่แล้ว ' + String(r.have).padStart(5) + (r.fail ? ' · พลาด ' + r.fail : '') + (r.pruned ? ' · ' + (DRY_RUN ? 'จะลบใน Supabase ' : 'ลบใน Supabase แล้ว ') + r.pruned : ''));
    log('  ปลายทาง: ' + ROOT);
    for(const k of Object.keys(REPORT)) delete REPORT[k];
  }catch(e){
    log('[X] ซิงก์ไม่สำเร็จ: ' + (e.message || e));
    ok = false;
  }
  running = false;
  flushLog();
  return ok;
}

console.log('==========================================================');
console.log('  Mix Fresh 168 — เก็บบิล + สลิปเข้า NAS อัตโนมัติ');
console.log('  ปลายทาง: ' + (CFG.NAS_ROOT || '(หาอัตโนมัติ /volume1-6/Mix888)') + (CFG._from ? '  · ตั้งค่าจาก archiver.config.json' : '  · ตั้งค่าจากในไฟล์สคริปต์'));
if(!CFG.NAS_EXPORT_KEY || CFG.NAS_EXPORT_KEY === 'PASTE_NAS_EXPORT_KEY_HERE') console.log('  [!] ยังไม่ได้ใส่ NAS_EXPORT_KEY — ใส่ใน archiver.config.json (ค่าดูได้จาก: select export_key from nas_config;)');
console.log('  ซิงก์ย้อนหลัง ' + CFG.DAYS_BACK + ' วัน · ทำซ้ำทุก ' + CFG.EVERY_MIN + ' นาที' + (DRY_RUN ? '  [โหมดทดลอง --dry-run: ไม่ลบ/ไม่แก้อะไรใน Supabase]' : ''));
console.log('  เปิดหน้าต่างนี้ทิ้งไว้ (ย่อได้ อย่าปิด) — ปิดแล้วเปิดใหม่ก็ซิงก์ต่อจากเดิมได้');
console.log('==========================================================');
const rbIdx = process.argv.indexOf('--restore-bill');
if(!acquireLock()){ flushLog(); process.exit(0); }
if(rbIdx >= 0){
  const list = String(process.argv[rbIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
  if(!list.length){ console.log('ใช้: node mix888-nas-archiver.js --restore-bill IV2609250013   (หลายใบคั่นด้วย , ไม่เว้นวรรค)'); process.exit(1); }
  restoreBills(list).then(ok => process.exit(ok ? 0 : 1));   // กู้บิลจาก NAS กลับเข้า Supabase แล้วจบ
}else if(process.argv.includes('--restore-media')){
  restoreMedia().then(ok => process.exit(ok ? 0 : 1));   // กู้คืนไฟล์ products จาก NAS แล้วจบ
}else if(process.argv.includes('--once') || FORCE_CHECK){
  syncOnce().then(ok => process.exit(ok ? 0 : 1));   // โหมด Task Scheduler: ทำรอบเดียวแล้วจบ (ล้ม = สถานะผิดปกติ)
}else{
  syncOnce();
  setInterval(syncOnce, CFG.EVERY_MIN * 60 * 1000); // โหมดเปิดค้าง: ทำซ้ำเองเรื่อย ๆ (ถือล็อกไว้ตลอด — ห้ามตั้ง Task Scheduler คู่กัน)
}
