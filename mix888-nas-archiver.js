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
     <NAS_ROOT>\ข้อมูลลูกค้า\BAM00006\                ← ลูกค้าเครดิตที่ admin อนุมัติแล้ว (โฟลเดอร์ตามรหัสลูกค้า)
        ข้อมูลลูกค้า_BAM00006.txt                        ← ชื่อ/ที่อยู่/เงื่อนไขเครดิต/ผู้อนุมัติ (เขียนทับให้เป็นปัจจุบัน)
        BAM00006_สำเนาบัตรประชาชน_20261001-1030.jpg       ← เอกสารขอใช้เครดิต (ไฟล์ใหม่เมื่อมีการเปลี่ยนเอกสาร)
        (เปลี่ยนรหัสลูกค้าในหลังบ้าน → โฟลเดอร์ถูกเปลี่ยนชื่อตามให้เอง ดูจากไฟล์ .customer_id ข้างใน)
     <NAS_ROOT>\ใบวางบิล\BAM00006\ใบวางบิล_2026-11-01.png  ← รูปใบวางบิลที่ระบบส่งให้ลูกค้า

   วิธีใช้ (เลือกอย่างใดอย่างหนึ่ง):
   ① บน Synology NAS: ลงแพ็กเกจ Node.js จาก Package Center แล้วตั้ง
      Task Scheduler รันทุกชั่วโมง:  node /volume1/.../mix888-nas-archiver.js --once
      (--once = ซิงก์ครั้งเดียวแล้วจบ ให้ Task Scheduler เป็นคนเรียกซ้ำ)
   ② บนคอม Windows: ติดตั้ง Node.js แล้วดับเบิลคลิก mix888-nas-archiver.bat
      เปิดทิ้งไว้ โปรแกรมจะซิงก์ทุก ๆ 30 นาทีอัตโนมัติ
   ============================================================ */
'use strict';

/* ================= ตั้งค่า ================= */
const NAS_ROOT   = '';                // เว้นว่าง = หาโฟลเดอร์ Mix888 บน NAS อัตโนมัติ (volume1-6) / หรือระบุเอง เช่น '/volume2/Mix888' หรือ 'Z:\\Mix888'
const DAYS_BACK  = 45;                // ซิงก์บิลย้อนหลังกี่วัน (รอบแรกแนะนำตั้งเยอะ ๆ เช่น 400 แล้วค่อยลดลง)
const EVERY_MIN  = 30;                // ซิงก์ซ้ำทุกกี่นาที
const SUPABASE_URL = 'https://eqbzpgynzgdwvouuzfwt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-';
const NAS_EXPORT_KEY = 'PASTE_NAS_EXPORT_KEY_HERE';   // รหัสลับให้ตรงกับที่รันในไฟล์ mix888-nas-export.sql
const KEEP_A4_PAGES  = false;         // true = เก็บไฟล์บิลแบบแบ่งหน้า A4 ด้วย (เนื้อหาซ้ำกับใบเต็ม ปกติไม่จำเป็น)
/* =========================================== */

const fs   = require('fs');
const path = require('path');

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
  if(NAS_ROOT) return fs.existsSync(NAS_ROOT) ? NAS_ROOT : null;
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
        log('  📂 ' + base + s + ' → ' + wantName);
      }catch(e){ log('  ⚠️ เปลี่ยนชื่อโฟลเดอร์ ' + base + ' ไม่ได้ — ' + e.message); }
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
        log('  🗑️ ลบโฟลเดอร์บิลยกเลิก ' + base + s);
      }catch(e){ log('  ⚠️ ลบโฟลเดอร์ ' + base + s + ' ไม่ได้ — ' + e.message); }
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
      body: JSON.stringify({p_key: NAS_EXPORT_KEY, p_since: sinceISO})});
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
const DOC_LABEL = {id_card:'สำเนาบัตรประชาชน', house_reg:'สำเนาทะเบียนบ้าน', pp20:'ใบภพ20', dir_id_card:'สำเนาบัตรประชาชนกรรมการ', dir_house_reg:'สำเนาทะเบียนบ้านกรรมการ'};
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
function readIdFile(dir){ try{ return fs.readFileSync(path.join(dir, ID_FILE), 'utf8').trim(); }catch(e){ return null; } }
// โฟลเดอร์ลูกค้าตามรหัสปัจจุบัน — ถ้ารหัสเปลี่ยน (โฟลเดอร์เก่ามี .customer_id ตรงกัน) ให้เปลี่ยนชื่อโฟลเดอร์ตาม
// โฟลเดอร์ตามรหัสลูกค้า (จำตัวตนด้วยไฟล์ .customer_id) — รหัสเปลี่ยน → เปลี่ยนชื่อโฟลเดอร์ + ไฟล์ข้างในที่ขึ้นต้นด้วยรหัสเดิม
function ensureDirById(base, id, code, idToDir){
  const want = path.join(base, safeName(code));
  const old = idToDir[String(id)];
  if(old && old !== want && fs.existsSync(old)){
    if(fs.existsSync(want)){
      log('  ⚠️ โฟลเดอร์ ' + safeName(code) + ' มีอยู่แล้ว — โฟลเดอร์เดิม ' + path.basename(old) + ' ไม่ได้ย้าย (รวมเองด้วยมือ)');
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
      log('  📂 เปลี่ยนชื่อโฟลเดอร์ ' + oldCode + ' → ' + newCode + ' (ไฟล์ข้างในเปลี่ยนชื่อตาม)');
    }catch(e){ log('  ⚠️ เปลี่ยนชื่อโฟลเดอร์ ' + path.basename(old) + ' ไม่ได้ — ' + e.message); return old; }
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
  L.push('ประเภทการชำระ: เครดิต (' + (c.credit_entity === 'company' ? 'บริษัท/นิติบุคคล' : 'บุคคลธรรมดา') + ')');
  L.push('เงื่อนไข: ' + (c.credit_mode === 'schedule' ? 'ตามรอบวางบิล' : 'เครดิต ' + (c.credit_days || 0) + ' วัน'));
  if(sched.length){
    L.push('ตารางรอบวางบิล:');
    sched.forEach((p, i) => L.push('  งวด ' + (i+1) + ': ยอด ' + p.from + ' ถึง ' + p.to + ' · วางบิล ' + p.bill + ' · ชำระ ' + p.due));
  }
  L.push('สถานะเครดิต: ' + (c.credit_status === 'approved' ? 'อนุมัติแล้ว' : c.credit_status) + ' โดย ' + (c.credit_reviewed_by || '-') + ' เมื่อ ' + (c.credit_reviewed_at ? thDateTimeStr(c.credit_reviewed_at) : '-'));
  L.push('กลุ่ม LINE: ' + (c.line_group_id || '-'));
  return '\uFEFF' + L.join('\r\n') + '\r\n';
}
async function syncCustomers(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const base = path.join(ROOT, CUST_DIR);
  fs.mkdirSync(base, {recursive: true});
  const custs = await api('/rest/v1/customers?select=id,code,name,branch_name,contact_name,phone,tax_id,billing_address,ship_address,sale_name,pay_type,credit_mode,credit_days,credit_schedule,credit_entity,credit_status,credit_reviewed_by,credit_reviewed_at,line_group_id&pay_type=eq.credit&credit_status=eq.approved&order=code.asc&limit=5000');
  const docs  = await api('/rest/v1/credit_docs?select=customer_id,doc_type,file_path,file_name,uploaded_at&limit=20000');
  log('ลูกค้าเครดิตที่อนุมัติแล้ว ' + custs.length + ' ราย · เอกสาร ' + docs.length + ' ไฟล์');
  const idToDir = readIdMap(base);
  for(const c of custs){
    const dir = ensureDirById(base, c.id, c.code, idToDir);
    try{ fs.writeFileSync(path.join(dir, 'ข้อมูลลูกค้า_' + safeName(c.code) + '.txt'), custInfoText(c)); }catch(e){}
    for(const d of docs.filter(x => x.customer_id === c.id)){
      const name = safeName(c.code) + '_' + (DOC_LABEL[d.doc_type] || d.doc_type) + '_' + stampOf(d.uploaded_at) + extOf(d.file_name || d.file_path);
      const dest = path.join(dir, name);
      if(fs.existsSync(dest)){ skipped++; continue; }
      try{ await downloadPrivate('credit-docs', d.file_path, dest); saved++; log('  💾 ' + path.join(CUST_DIR, safeName(c.code), name)); }
      catch(e){ failed++; log('  ⚠️ โหลดเอกสาร ' + c.code + ' ' + name + ' ไม่ได้ — ' + e.message); }
    }
  }
  return {saved, skipped, failed};
}
async function syncStatements(ROOT){
  let saved = 0, skipped = 0, failed = 0;
  const rows = await api('/rest/v1/credit_statements?select=customer_id,bill_date,image_url,customers(code)&kind=eq.statement&image_url=not.is.null&order=created_at.desc&limit=3000');
  if(!rows.length) return {saved, skipped, failed};
  const base = path.join(ROOT, STMT_DIR);
  fs.mkdirSync(base, {recursive: true});
  const idToDir = readIdMap(base);
  for(const r of rows){
    const code = r.customers && r.customers.code; if(!code) continue;
    const dir = ensureDirById(base, r.customer_id, code, idToDir);
    const dest = path.join(dir, 'ใบวางบิล_' + r.bill_date + extOf(r.image_url));
    if(fs.existsSync(dest)){ skipped++; continue; }
    try{ await download(r.image_url, dest); saved++; log('  💾 ' + path.join(STMT_DIR, safeName(code), path.basename(dest))); }
    catch(e){ failed++; log('  ⚠️ โหลดใบวางบิล ' + code + ' ' + r.bill_date + ' ไม่ได้ — ' + e.message); }
  }
  return {saved, skipped, failed};
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
      log('❌ หาโฟลเดอร์ปลายทางไม่เจอ: ' + (NAS_ROOT || 'ลองแล้ว /volume1-6/Mix888'));
      log('   แก้ค่า NAS_ROOT หัวไฟล์นี้ให้ตรงกับที่อยู่จริงของโฟลเดอร์ Mix888');
      running = false; flushLog();
      return false;
    }
    log('ปลายทาง: ' + ROOT);
    const since = new Date(Date.now() - DAYS_BACK * 24 * 3600 * 1000).toISOString();
    const bills = await fetchBills(since);
    log('พบบิล ' + bills.length + ' ใบ (ย้อนหลัง ' + DAYS_BACK + ' วัน)');

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
      if(KEEP_A4_PAGES)
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
    catch(e){ log('⚠️ เก็บข้อมูลลูกค้าเครดิตไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-credit-docs.sql หรือยัง?)'); }
    try{ const r = await syncStatements(ROOT); saved += r.saved; skipped += r.skipped; failed += r.failed; }
    catch(e){ log('⚠️ เก็บใบวางบิลไม่สำเร็จ: ' + (e.message || e) + ' (รัน mix888-credit-statement.sql หรือยัง?)'); }

    log('✅ ซิงก์เสร็จใน ' + Math.round((Date.now()-t0)/1000) + ' วิ — ไฟล์ใหม่ ' + saved
        + ' · มีอยู่แล้ว ' + skipped + (failed ? ' · โหลดพลาด ' + failed + ' (จะลองใหม่รอบหน้า)' : ''));
  }catch(e){
    log('❌ ซิงก์ไม่สำเร็จ: ' + (e.message || e));
    ok = false;
  }
  running = false;
  flushLog();
  return ok;
}

console.log('==========================================================');
console.log('  Mix Fresh 168 — เก็บบิล + สลิปเข้า NAS อัตโนมัติ');
console.log('  ปลายทาง: ' + NAS_ROOT);
console.log('  ซิงก์ย้อนหลัง ' + DAYS_BACK + ' วัน · ทำซ้ำทุก ' + EVERY_MIN + ' นาที');
console.log('  เปิดหน้าต่างนี้ทิ้งไว้ (ย่อได้ อย่าปิด) — ปิดแล้วเปิดใหม่ก็ซิงก์ต่อจากเดิมได้');
console.log('==========================================================');
if(process.argv.includes('--once')){
  syncOnce().then(ok => process.exit(ok ? 0 : 1));   // โหมด Task Scheduler: ทำรอบเดียวแล้วจบ (ล้ม = สถานะผิดปกติ)
}else{
  syncOnce();
  setInterval(syncOnce, EVERY_MIN * 60 * 1000); // โหมดเปิดค้าง: ทำซ้ำเองเรื่อย ๆ
}
