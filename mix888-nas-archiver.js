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
     <NAS_ROOT>\สำรองข้อมูล\2026-10-06\<ตาราง>.csv/.json       ← สำรองตารางข้อมูลทุก 7 วัน (แยกจากโฟลเดอร์ สำรองข้อมูล เดิมของคุณ) (กู้คืนได้ถ้า Supabase มีปัญหา)

   ประหยัดพื้นที่ Supabase: บิลที่จ่ายครบแล้วเกิน 30 วัน และไฟล์อยู่บน NAS แล้ว → ลบรูปบิล/สลิปออกจาก Supabase
   (ต้องรัน mix888-nas-archiver-v2.sql ก่อน · หลังบ้านยังกด "สร้างรูปบิลใหม่" ได้ ระบบจะเก็บสำเนาแล้วลบให้อีกรอบ)

   วิธีใช้ (เลือกอย่างใดอย่างหนึ่ง):
   ① บน Synology NAS: ลงแพ็กเกจ Node.js จาก Package Center แล้วตั้ง
      Task Scheduler รันทุกชั่วโมง:  node /volume1/.../mix888-nas-archiver.js --once
      (--once = ซิงก์ครั้งเดียวแล้วจบ ให้ Task Scheduler เป็นคนเรียกซ้ำ)
      ลองก่อน:  node archiver.js --once --dry-run   = เก็บลง NAS จริง แต่ "ไม่ลบ/ไม่แก้อะไรใน Supabase" แล้วสรุปท้ายรอบว่าเก็บอะไรบ้าง
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
const SUPABASE_URL = 'https://eqbzpgynzgdwvouuzfwt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-';
const NAS_EXPORT_KEY = 'PASTE_NAS_EXPORT_KEY_HERE';   // รหัสลับให้ตรงกับที่รันในไฟล์ mix888-nas-export.sql
const KEEP_A4_PAGES  = false;         // true = เก็บไฟล์บิลแบบแบ่งหน้า A4 ด้วย (เนื้อหาซ้ำกับใบเต็ม ปกติไม่จำเป็น)
/* ---- ประหยัดพื้นที่ Supabase (ต้องรัน mix888-nas-archiver-v2.sql ก่อน) ---- */
const PRUNE_PAID_BILLS       = true;  // ลบรูปบิล+สลิปออกจาก Supabase เมื่อบิล "จ่ายครบแล้ว" และไฟล์อยู่บน NAS แล้ว (ต้นฉบับอยู่ NAS · หลังบ้านกดสร้างรูปใหม่ได้ ระบบจะเก็บแล้วลบซ้ำให้)
const PRUNE_PAID_AFTER_DAYS  = 30;    // ลบหลังจ่ายครบมาแล้วกี่วัน
const PRUNE_DAYS_BACK        = 400;   // มองหาบิลที่ควรลบย้อนหลังกี่วัน
const PRUNE_BROADCAST_DAYS   = 7;     // สื่อบรอดแคสต์ (รูป/วิดีโอที่ส่งไลน์แล้ว) ลบออกจาก Supabase หลังเก็บลง NAS และเก่ากว่ากี่วัน (รูปสินค้าไม่ลบ — หน้าสั่งของยังใช้)
const BACKUP_EVERY_DAYS      = 7;     // สำรองตารางข้อมูล (ลูกค้า สินค้า ออเดอร์ บิล การชำระ รายจ่าย …) เป็น CSV+JSON ทุกกี่วัน
const ORDER_HISTORY_DAYS     = 730;   // ประวัติสั่งซื้อรายลูกค้า (ใน ข้อมูลลูกค้า/<รหัส>/) ย้อนหลังกี่วัน
/* =========================================== */

const fs   = require('fs');
const path = require('path');
// ---- อ่านค่าตั้งค่าจาก archiver.config.json (ถ้ามี) ทับค่าคงที่ด้านบน ----
const CFG = (() => {
  const c = {NAS_ROOT, DAYS_BACK, EVERY_MIN, NAS_EXPORT_KEY, KEEP_A4_PAGES, PRUNE_PAID_BILLS, PRUNE_PAID_AFTER_DAYS, PRUNE_DAYS_BACK, PRUNE_BROADCAST_DAYS, BACKUP_EVERY_DAYS, ORDER_HISTORY_DAYS};
  try{
    const f = path.join(__dirname, 'archiver.config.json');
    if(fs.existsSync(f)){
      const raw = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
      const j = JSON.parse(raw);
      for(const k of Object.keys(c)) if(j[k] !== undefined && j[k] !== null && j[k] !== '') c[k] = j[k];
      c._from = f;
    }
  }catch(e){ console.log('[!] อ่าน archiver.config.json ไม่ได้: ' + e.message + ' — ใช้ค่าในไฟล์สคริปต์แทน'); }
  return c;
})();
const DRY_RUN = process.argv.includes('--dry-run');   // เก็บลง NAS ตามปกติ แต่ไม่ลบไฟล์/ไม่แก้ข้อมูลใน Supabase
const REPORT = {};                                    // สรุปท้ายรอบ: หมวด → {new, have, fail, pruned}
function tally(section, key, n = 1){ const r = REPORT[section] || (REPORT[section] = {new: 0, have: 0, fail: 0, pruned: 0}); r[key] += n; }

const logLines = [];
const log = (...a) => {
  const line = new Date().toLocaleString('th-TH', {timeZone:'Asia/Bangkok'}) + ' ' + a.join(' ');
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
      try{
        fs.rmSync(p, {recursive: true, force: true});
        log('   ลบโฟลเดอร์บิลยกเลิก ' + base + s);
      }catch(e){ log('  [!] ลบโฟลเดอร์ ' + base + s + ' ไม่ได้ — ' + e.message); }
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
    log('  ↳ ถ้ายังได้บิล 0 ใบตลอด: รันไฟล์ mix888-nas-export.sql ใน Supabase ก่อน');
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

async function download(url, dest){
  const r = await fetch(url);
  if(!r.ok) throw new Error('โหลดไฟล์ไม่ได้ (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if(!buf.length) throw new Error('ไฟล์ว่างเปล่า');
  fs.writeFileSync(dest, buf);
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
  if(!r.ok) throw new Error('ขอลิงก์ไฟล์ไม่ได้ (' + r.status + ')');
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
function writeIfChanged(file, content){   // ไม่เขียนทับถ้าเนื้อหาเหมือนเดิม (ลดการเขียน NAS ทุก 30 นาที)
  try{ if(fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false; }catch(e){}
  fs.writeFileSync(file, content); return true;
}
const PAY_TH = {prepay: 'จ่ายก่อนส่ง', postpay: 'จ่ายหลังส่ง', credit: 'เครดิต'};
const CR_TH  = {pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ตีกลับ'};
// ข้อมูลตารางที่โปรแกรมใช้ (ลูกค้า สินค้า ราคา ออเดอร์ รายจ่าย …) — ผ่าน RPC nas_export_data (ตารางเหล่านี้อ่านตรงไม่ได้)
let DATA = null;
async function loadData(){
  if(DATA) return DATA;
  const since = new Date(Date.now() - CFG.ORDER_HISTORY_DAYS * 24 * 3600 * 1000).toISOString();
  try{ DATA = await rpc('nas_export_data', {p_since: since}); DATA._via = 'rpc'; return DATA; }
  catch(e){ log('[!] เรียก nas_export_data ไม่สำเร็จ (' + e.message + ') — ลองอ่านตารางตรง (ถ้าได้ 0 แถว = รัน mix888-nas-archiver-v2.sql แล้วใส่รหัสลับใน nas_check_key)'); }
  DATA = {_via: 'rest'};
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
  const custs = [...(D.customers || [])].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
  const docs  = D.credit_docs || [], prods = D.products || [], cps = D.customer_prices || [];
  const plog  = [...(D.price_log || [])].sort((a, b) => a.id - b.id);
  const lgroups = {}; (D.line_groups || []).forEach(g => lgroups[g.group_id] = g.name);
  const orders = [...(D.orders || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  log('ลูกค้า ' + custs.length + ' ราย · จัดสินค้า ' + cps.length + ' แถว · ประวัติราคา ' + plog.length + ' · ออเดอร์ ' + orders.length + (D._via === 'rpc' ? '' : ' (อ่านตรง — ถ้าเป็น 0 ให้รัน SQL v2)'));
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
    c.line_group_name = lgroups[c.line_group_id] || ''; c.parent_code = c.parent_id ? codeOf[c.parent_id] : ''; c._stats = stats[c.id] || null;
    const dir = ensureDirById(base, c.id, c.code, idToDir);
    if(writeIfChanged(path.join(dir, 'ข้อมูลลูกค้า_' + safeName(c.code) + '.txt'), custInfoText(c))) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have');
    // จัดสินค้า (ปัจจุบัน)
    const rows = (cpBy[c.id] || []).map(r => ({r, p: P[r.product_id]})).filter(x => x.p).sort((a, b) => String(a.p.sku || '').localeCompare(String(b.p.sku || '')));
    const L1 = [['SKU','สินค้า','หน่วย','ราคาที่ตั้งให้ลูกค้า','ราคาตามกลุ่ม (' + priceName(c.price_group) + ')','ราคากลาง','ต่างจากราคากลาง','ราคาที่ใช้จริง'].map(csvCell).join(',')];
    rows.forEach(({r, p}) => { const grp = effPrice(p, c.price_group); const use = (r.price != null && r.price !== '') ? Number(r.price) : grp;
      L1.push([p.sku || '', p.name || '', p.unit || '', r.price != null ? Number(r.price) : '', grp, Number(p.base_price || 0), (use - Number(p.base_price || 0)).toFixed(2), use].map(csvCell).join(',')); });
    L1.push('', ['', 'สินค้าที่จัดให้ ' + rows.length + ' รายการ · อัปเดต ' + thDateTimeStr(new Date().toISOString())].map(csvCell).join(','));
    if(rows.length){ if(writeIfChanged(path.join(dir, 'จัดสินค้า_' + safeName(c.code) + '.csv'), '\uFEFF' + L1.join('\r\n'))) tally('ไฟล์สรุปลูกค้า (txt/csv)', 'new'); else tally('ไฟล์สรุปลูกค้า (txt/csv)', 'have'); }
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
        if(fs.existsSync(dest)){ skipped++; tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'have'); continue; }
        try{ await downloadPrivate('credit-docs', d.file_path, dest); saved++; tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'new'); log('  [เก็บ] ' + path.join(CUST_DIR, safeName(c.code), name)); }
        catch(e){ failed++; tally('เอกสารเครดิต (ข้อมูลลูกค้า)', 'fail'); log('  [!] โหลดเอกสาร ' + c.code + ' ' + name + ' ไม่ได้ — ' + e.message); }
      }
    }
  }
  return {saved, skipped, failed};
}
async function syncStatements(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const D = await loadData();
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
    try{ await download(r.image_url, dest); saved++; tally('ใบวางบิล', 'new'); log('  [เก็บ] ' + path.join(STMT_DIR, safeName(code), path.basename(dest))); }
    catch(e){ failed++; tally('ใบวางบิล', 'fail'); log('  [!] โหลดใบวางบิล ' + code + ' ' + r.bill_date + ' ไม่ได้ — ' + e.message); }
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
  return r.json();
}
async function deleteObject(bucket, objPath){
  if(DRY_RUN){ log('  (ทดลอง) จะลบใน Supabase: ' + bucket + '/' + objPath); return; }
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + objPath.split('/').map(encodeURIComponent).join('/'), {
    method: 'DELETE', headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY}});
  if(r.status === 404 || r.status === 400) return;   // ไม่มีไฟล์แล้ว (เช่น สลิปใบเดียวกันผูกหลายบิล ลบไปตอนบิลก่อนหน้า)
  if(!r.ok) throw new Error('ลบไฟล์ ' + bucket + '/' + objPath + ' ไม่ได้ (' + r.status + ') — รัน mix888-nas-archiver-v2.sql หรือยัง?');
}
const onNas = p => { try{ return fs.statSync(p).size > 0; }catch(e){ return false; } };

// (1) บิลจ่ายครบแล้ว: ไฟล์อยู่บน NAS ครบ → ลบรูปบิล/สลิปออกจาก Supabase แล้วบันทึกว่า "เก็บบน NAS แล้ว"
async function pruneBills(ROOT){
  if(!CFG.PRUNE_PAID_BILLS) return {pruned: 0};
  let pruned = 0, kept = 0;
  const since = new Date(Date.now() - CFG.PRUNE_DAYS_BACK * 24 * 3600 * 1000).toISOString();
  const cutoff = Date.now() - CFG.PRUNE_PAID_AFTER_DAYS * 24 * 3600 * 1000;
  let bills = [];
  try{ bills = await rpc('nas_export_bills', {p_since: since}); }catch(e){ log('[!] อ่านบิลเพื่อลบไฟล์ไม่ได้: ' + e.message); return {pruned}; }
  for(const b of bills){
    if((b.ship_status || 'pending') === 'cancelled' || b.payment_status !== 'paid') continue;
    if(!b.paid_at || new Date(b.paid_at).getTime() > cutoff) continue;
    const urls = [];
    if(b.image_url) urls.push(['bills', b.image_url]);
    (Array.isArray(b.page_urls) ? b.page_urls : []).forEach(u => urls.push(['bills', u]));
    const slips = [];
    (Array.isArray(b.payments) ? b.payments : []).forEach(p => (Array.isArray(p.slips) ? p.slips : []).forEach(u => { if(u && !slips.includes(u)) slips.push(u); }));
    if(b.slip_url && !slips.includes(b.slip_url)) slips.push(b.slip_url);
    slips.forEach(u => urls.push([objPathOf(u, 'slips') ? 'slips' : 'bills', u]));
    if(!urls.length) continue;                                     // ไม่มีไฟล์ค้างใน Supabase แล้ว
    // ต้องมีสำเนาบน NAS: รูปบิล (เวอร์ชันไหนก็ได้) + สลิปครบจำนวน
    const {y, m, ddmmyyyy} = thDate(b.created_at);
    const dayDir = path.join(ROOT, y, m, ddmmyyyy);
    let billDir = null;
    for(const sfx of ['', ...PAY_SUFFIXES]){ const p = path.join(dayDir, safeName(b.bill_no) + sfx); if(fs.existsSync(p)){ billDir = p; break; } }
    if(!billDir){ kept++; continue; }
    const files = fs.readdirSync(billDir);
    const hasBill = !b.image_url || files.some(f => f.includes('_บิล_v') && onNas(path.join(billDir, f)));
    const nSlipNas = files.filter(f => f.includes('_สลิป') && onNas(path.join(billDir, f))).length;
    let needSlips = slips.length;
    if(hasBill && nSlipNas < needSlips){   // สลิปบางใบอาจไม่มีในต้นทางแล้ว (โหลดได้ 400/404) → ไม่นับ
      let missingRemote = 0;
      for(const u of slips){ try{ const h = await fetch(u, {method: 'HEAD'}); if(h.status === 400 || h.status === 404) missingRemote++; }catch(e){} }
      needSlips -= missingRemote;
    }
    if(!hasBill || nSlipNas < needSlips){ kept++; continue; }   // ยังเก็บไม่ครบ รอรอบหน้า
    let okAll = true;
    for(const [bucket, u] of urls){
      const op = objPathOf(u, bucket); if(!op) continue;
      try{ await deleteObject(bucket, op); }catch(e){ okAll = false; log('  [!] ' + e.message); break; }
    }
    if(!okAll){ kept++; continue; }
    if(DRY_RUN){ pruned++; tally('ลบไฟล์บิลจ่ายครบออกจาก Supabase', 'pruned'); continue; }
    try{ await rpc('nas_mark_pruned', {p_bill_id: b.id, p_nas_path: path.relative(ROOT, billDir)}); pruned++; tally('ลบไฟล์บิลจ่ายครบออกจาก Supabase', 'pruned'); log('  [ลบใน Supabase] ลบไฟล์ใน Supabase ของบิล ' + b.bill_no + ' (จ่ายครบ · สำเนาอยู่ ' + path.relative(ROOT, billDir) + ')'); }
    catch(e){ log('  [!] บันทึกสถานะบิล ' + b.bill_no + ' ไม่ได้: ' + e.message); }
  }
  if(pruned || kept) log('ประหยัดพื้นที่: ลบไฟล์บิลจ่ายครบแล้ว ' + pruned + ' ใบ' + (kept ? ' · รอ ' + kept + ' ใบ (ยังไม่ครบ/ยังไม่ถึงเวลา)' : ''));
  return {pruned};
}

// (2) รูปสินค้า + สื่อบรอดแคสต์ (bucket products)
const BROADCAST_RE = /^(broadcast|promo|media)-\d{10,}-/;   // ไฟล์ที่หน้า "บรอดแคสต์/โปรโมชั่น" อัปโหลด (uploadLineMedia) — ลบได้หลังส่งแล้ว · ไฟล์อื่นทั้งหมด = รูปสินค้า ห้ามลบ
async function syncMedia(ROOT){
  let saved = 0, skipped = 0, failed = 0, pruned = 0;
  const base = path.join(ROOT, MEDIA_DIR);
  const D = await loadData();
  const canPrune = D._via === 'rpc' && Array.isArray(D.products) && D.products.length > 0;   // รู้รายการสินค้าแน่ ๆ ถึงจะลบอะไรได้
  if(!canPrune) log('[!] ยังอ่านรายการสินค้าไม่ได้ (BAD_KEY/0 แถว) — รอบนี้เก็บสื่ออย่างเดียว ไม่ลบอะไรใน Supabase');
  const products = (D.products || []).filter(p => p.image_url);
  const pdir = path.join(base, 'สินค้า'); fs.mkdirSync(pdir, {recursive: true});
  const referenced = new Set();
  for(const p of products){
    const op = objPathOf(p.image_url, 'products'); if(op) referenced.add(op);
    const name = safeName((p.sku || p.id) + '_' + (p.name || '')).slice(0, 60) + '_' + shortHash(p.image_url) + extOf(p.image_url);
    const dest = path.join(pdir, name);
    if(fs.existsSync(dest)){ skipped++; tally('รูปสินค้า', 'have'); continue; }
    try{ await download(p.image_url, dest); saved++; tally('รูปสินค้า', 'new'); }catch(e){ failed++; tally('รูปสินค้า', 'fail'); log('  [!] โหลดรูปสินค้า ' + (p.sku || p.id) + ' ไม่ได้ — ' + e.message); }
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
    if(fs.existsSync(csvPath) && monthsAgo > 1){ skipped += list.length; continue; }   // เดือนเก่ากว่า 1 เดือนที่มี CSV แล้ว ไม่ต้องทำซ้ำ
    fs.mkdirSync(dir, {recursive: true});
    const head = ['วันที่','หมวด','รายละเอียด','ร้านค้า','จำนวนเงิน','วิธีจ่าย','ผู้จ่าย','เลขอ้างอิง','หมายเหตุ','บันทึกโดย','ไฟล์ใบเสร็จ'];
    const lines = [head.map(csvCell).join(',')]; let total = 0;
    for(const r of list){
      let rname = '';
      if(r.receipt_url){
        rname = safeName(String(r.spent_at || '').slice(0, 10) + '_' + (cats[r.category_id] || 'ไม่ระบุหมวด') + '_' + Number(r.amount || 0) + '_' + r.id) + extOf(r.receipt_url);
        const dest = path.join(dir, rname);
        if(!fs.existsSync(dest)){ try{ await download(r.receipt_url, dest); saved++; tally('ใบเสร็จรายจ่าย', 'new'); }catch(e){ failed++; tally('ใบเสร็จรายจ่าย', 'fail'); rname = '(โหลดไม่ได้)'; } } else tally('ใบเสร็จรายจ่าย', 'have');
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
  if(last && (new Date(todayStr) - new Date(last)) / 86400000 < CFG.BACKUP_EVERY_DAYS) return {done: false};
  const TABLES = ['customers','products','sales','orders','order_items','bills','payments','petty_cash','expense_categories','customer_prices','warehouses','settings',
                  'sale_comp','sale_pay_adj','credit_statements','credit_docs','credit_reviews','line_groups','price_log','price_adjust_batches','holidays'];
  const dir = path.join(base, todayStr); fs.mkdirSync(dir, {recursive: true});
  let n = 0;
  for(const table of TABLES){
    const rows = [];
    try{
      for(let off = 0; ; off += 2000){   // ทีละ 2,000 แถว กัน statement timeout ของ Supabase
        const page = await rpc('nas_export_table', {p_table: table, p_offset: off, p_limit: 2000});
        rows.push(...(Array.isArray(page) ? page : [])); if(!Array.isArray(page) || page.length < 2000) break;
      }
    }catch(e){ log('  [!] สำรองตาราง ' + table + ' ไม่ได้: ' + e.message); continue; }
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
    DATA = null;   // โหลดข้อมูลตารางใหม่ทุกรอบ
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

      // รายการไฟล์ของบิลนี้: [url, ชื่อไฟล์ปลายทาง]
      const files = [];
      const rev = b.revision || 1;
      if(b.image_url) files.push([b.image_url, safeName(b.bill_no) + '_บิล_v' + rev + extOf(b.image_url)]);
      if(CFG.KEEP_A4_PAGES)
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
        if(fs.existsSync(dest)){ skipped++; tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'have'); continue; }
        try{ await download(url, dest); saved++; tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'new'); log('  [เก็บ] ' + path.join(ddmmyyyy, safeName(b.bill_no), name)); }
        catch(e){ failed++; tally('บิล+สลิป (โฟลเดอร์รายวัน)', 'fail'); log('  [!] โหลดไม่ได้ ' + b.bill_no + ' ' + name + ' — ' + e.message); }
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
    try{ await pruneBills(ROOT); }
    catch(e){ log('[!] ลบไฟล์บิลจ่ายครบไม่สำเร็จ: ' + (e.message || e)); }
    try{ await backupTables(ROOT); }
    catch(e){ log('[!] สำรองข้อมูลไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-nas-archiver-v2.sql หรือยัง?)'); }

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
if(!CFG.NAS_EXPORT_KEY || CFG.NAS_EXPORT_KEY === 'PASTE_NAS_EXPORT_KEY_HERE') console.log('  [!] ยังไม่ได้ใส่ NAS_EXPORT_KEY — ใส่ใน archiver.config.json (จะอ่านบิลได้ 0 ใบ)');
console.log('  ซิงก์ย้อนหลัง ' + CFG.DAYS_BACK + ' วัน · ทำซ้ำทุก ' + CFG.EVERY_MIN + ' นาที' + (DRY_RUN ? '  [โหมดทดลอง --dry-run: ไม่ลบ/ไม่แก้อะไรใน Supabase]' : ''));
console.log('  เปิดหน้าต่างนี้ทิ้งไว้ (ย่อได้ อย่าปิด) — ปิดแล้วเปิดใหม่ก็ซิงก์ต่อจากเดิมได้');
console.log('==========================================================');
if(process.argv.includes('--restore-media')){
  restoreMedia().then(ok => process.exit(ok ? 0 : 1));   // กู้คืนไฟล์ products จาก NAS แล้วจบ
}else if(process.argv.includes('--once')){
  syncOnce().then(ok => process.exit(ok ? 0 : 1));   // โหมด Task Scheduler: ทำรอบเดียวแล้วจบ (ล้ม = สถานะผิดปกติ)
}else{
  syncOnce();
  setInterval(syncOnce, CFG.EVERY_MIN * 60 * 1000); // โหมดเปิดค้าง: ทำซ้ำเองเรื่อย ๆ
}
