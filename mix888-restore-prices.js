#!/usr/bin/env node
/* ============================================================
   Mix Fresh 168 — กู้ "ราคาเฉพาะร้าน" คืนจากสำรองข้อมูลบน NAS

   ใช้ตอนที่ราคาที่ตั้งไว้ให้ลูกค้าหายไป / เด้งกลับเป็นราคากลาง
   โปรแกรมจะเทียบไฟล์สำรองรายวันกับราคาปัจจุบัน แล้วบอกว่า
   หายไปกี่รายการ หายตั้งแต่วันไหน และกู้คืนให้ได้

   ⚠️ ปลอดภัย: กู้เฉพาะราคาที่ "หายไป" เท่านั้น
      ถ้าตอนนี้ร้านนั้นมีราคาเฉพาะร้านอยู่แล้ว (คนละเลข) จะไม่ไปทับ
      และไม่มีการลบอะไรทั้งสิ้น

   วิธีใช้ (รันบน NAS ที่เดียวกับ mix888-nas-archiver.js):

   ① ดูก่อนว่ามีสำรองวันไหนบ้าง และแต่ละวันมีราคาหายไปกี่รายการ
        node mix888-restore-prices.js

   ② ดูรายละเอียดว่าจะกู้อะไรบ้างจากวันนั้น (ยังไม่แก้จริง)
        node mix888-restore-prices.js --date 2026-08-20

   ③ กู้จริง
        node mix888-restore-prices.js --date 2026-08-20 --apply

   ④ เฉพาะร้านเดียว (ใส่รหัสร้าน)
        node mix888-restore-prices.js --date 2026-08-20 --shop SKG00397 --apply

   ทุกครั้งจะเขียนรายงานเปิดด้วย Excel ไว้ที่
   <NAS_ROOT>/สำรองข้อมูล/รายงานกู้ราคา.csv
   ============================================================ */
'use strict';

/* ================= ตั้งค่า (ให้ตรงกับ mix888-nas-archiver.js) ================= */
const NAS_ROOT       = '';                // เว้นว่าง = หาโฟลเดอร์ Mix888 บน NAS อัตโนมัติ
const SUPABASE_URL   = 'https://eqbzpgynzgdwvouuzfwt.supabase.co';
const SUPABASE_KEY   = 'sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-';
const NAS_EXPORT_KEY = 'PASTE_NAS_EXPORT_KEY_HERE';   // รหัสลับเดียวกับที่ใช้ในไฟล์ SQL
/* ============================================================================= */

const fs   = require('fs');
const path = require('path');

const argv  = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const DATE  = argOf('--date');
const SHOP  = (argOf('--shop') || '').trim().toUpperCase();
const APPLY = argv.includes('--apply');

function resolveNasRoot(){
  if(NAS_ROOT) return fs.existsSync(NAS_ROOT) ? NAS_ROOT : null;
  for(let i = 1; i <= 6; i++){
    const p = '/volume' + i + '/Mix888';
    if(fs.existsSync(p)) return p;
  }
  return null;
}
const num = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
const fmtB = (n) => '฿' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function csvCell(v){
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function rpc(fn, body){
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify(body)});
  if(!r.ok) throw new Error(fn + ' ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return await r.json();
}
/** ดึงตารางปัจจุบันจาก Supabase (อ่านอย่างเดียว ผ่าน nas_backup_dump) */
async function dumpTable(table){
  const rows = [];
  for(let off = 0;; off += 5000){
    const page = await rpc('nas_backup_dump', {p_key: NAS_EXPORT_KEY, p_table: table, p_limit: 5000, p_offset: off});
    if(page === null) return null;
    rows.push(...page);
    if(page.length < 5000) break;
  }
  return rows;
}
const keyOf = (r) => r.customer_id + '|' + r.product_id;

/** รายการที่ไฟล์สำรอง "ตั้งราคาเอง" ไว้ แต่ตอนนี้หายไป (ไม่มีรายการ / กลายเป็นราคากลาง) */
function findLost(backupRows, liveRows){
  const live = new Map();
  for(const r of liveRows) live.set(keyOf(r), num(r.price));
  const lost = [];
  for(const b of backupRows){
    const bp = num(b.price);
    if(bp === null) continue;                       // ตอนนั้นก็ใช้ราคากลางอยู่แล้ว ไม่ใช่ของที่หาย
    if(!live.has(keyOf(b)))      lost.push({...b, price: bp, now: 'ไม่มีรายการนี้แล้ว'});
    else if(live.get(keyOf(b)) === null) lost.push({...b, price: bp, now: 'ถูกเปลี่ยนเป็นราคากลาง'});
  }
  return lost;
}

(async () => {
  const ROOT = resolveNasRoot();
  if(!ROOT){ console.log('❌ หาโฟลเดอร์ Mix888 บน NAS ไม่เจอ — ใส่ค่า NAS_ROOT ในไฟล์นี้'); return; }
  const baseDir = path.join(ROOT, 'สำรองข้อมูล');
  if(!fs.existsSync(baseDir)){
    console.log('❌ ยังไม่มีโฟลเดอร์ "สำรองข้อมูล" บน NAS');
    console.log('   แปลว่ายังไม่เคยสำรองข้อมูลรายวัน — ต้องรัน mix888-nas-backup.sql ใน Supabase');
    console.log('   และใช้ mix888-nas-archiver.js เวอร์ชันล่าสุดบน NAS ก่อน');
    return;
  }
  const days = fs.readdirSync(baseDir).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  if(!days.length){ console.log('❌ ไม่มีโฟลเดอร์สำรองรายวันเลย'); return; }

  console.log('📥 อ่านราคาปัจจุบันจากระบบ…');
  const live = await dumpTable('customer_prices');
  if(live === null){ console.log('❌ อ่านตาราง customer_prices ไม่ได้ — รัน mix888-nas-backup.sql หรือยัง?'); return; }
  const custs = (await dumpTable('customers')) || [];
  const prods = (await dumpTable('products'))  || [];
  const cById = new Map(custs.map(c => [c.id, c]));
  const pById = new Map(prods.map(p => [p.id, p]));
  const shopOf = (cid) => cById.get(cid) || {};
  const inShop = (cid) => !SHOP || String(shopOf(cid).code || '').toUpperCase() === SHOP;

  const readBackup = (d) => {
    const f = path.join(baseDir, d, 'customer_prices.json');
    if(!fs.existsSync(f)) return null;
    try{ return JSON.parse(fs.readFileSync(f, 'utf8')); }catch(e){ return null; }
  };

  // ---------- โหมด ①: สรุปทุกวันที่มีสำรอง ----------
  if(!DATE){
    console.log('\n📅 สำรองข้อมูลที่มีอยู่ · เทียบกับราคาปัจจุบัน'
      + (SHOP ? ' (เฉพาะร้าน ' + SHOP + ')' : '') + '\n');
    console.log('วันที่สำรอง     ตั้งราคาเอง   หายไปตอนนี้');
    let firstLossDay = null, prevLost = null;
    for(const d of days){
      const rows = readBackup(d);
      if(!rows){ console.log(d + '   (ไม่มีไฟล์ราคาในโฟลเดอร์นี้)'); continue; }
      const scoped = rows.filter(r => inShop(r.customer_id));
      const own    = scoped.filter(r => num(r.price) !== null).length;
      const lost   = findLost(scoped, live).length;
      console.log(d + '        ' + String(own).padStart(6) + '        ' + String(lost).padStart(6));
      if(prevLost !== null && lost < prevLost && !firstLossDay) firstLossDay = d;
      prevLost = lost;
    }
    console.log('\nอ่านยังไง: คอลัมน์ "หายไปตอนนี้" = ราคาที่วันนั้นเคยตั้งไว้ แต่ตอนนี้ไม่มีแล้ว');
    console.log('ให้เลือกวันที่ตัวเลขนี้เยอะสุด (= ก่อนราคาหาย) แล้วสั่งกู้จากวันนั้น เช่น');
    console.log('   node mix888-restore-prices.js --date ' + days[0] + (SHOP ? ' --shop ' + SHOP : ''));
    return;
  }

  // ---------- โหมด ②/③: ดูรายละเอียด / กู้จริง ----------
  const rows = readBackup(DATE);
  if(!rows){ console.log('❌ ไม่มีไฟล์สำรองราคาของวันที่ ' + DATE); return; }
  const scoped = rows.filter(r => inShop(r.customer_id));
  const lost = findLost(scoped, live);
  if(!lost.length){
    console.log('✅ เทียบกับสำรองวันที่ ' + DATE + ' แล้ว ไม่มีราคาที่หายไป' + (SHOP ? ' (ร้าน ' + SHOP + ')' : ''));
    return;
  }
  console.log('\n📋 เทียบกับสำรองวันที่ ' + DATE + (SHOP ? ' · เฉพาะร้าน ' + SHOP : '')
    + ' — พบราคาที่หายไป ' + lost.length + ' รายการ\n');
  const show = lost.slice(0, 40);
  for(const r of show){
    const c = shopOf(r.customer_id), p = pById.get(r.product_id) || {};
    console.log('  ' + (c.code || '#' + r.customer_id) + ' ' + (c.name || '') + ' · '
      + (p.sku || '#' + r.product_id) + ' ' + (p.name || '')
      + ' → ' + r.now + ' (เคยตั้งไว้ ' + fmtB(r.price) + ')');
  }
  if(lost.length > show.length) console.log('  … และอีก ' + (lost.length - show.length) + ' รายการ (ดูครบในไฟล์ CSV)');

  // รายงาน CSV เปิดด้วย Excel
  try{
    const cols = ['รหัสร้าน','ชื่อร้าน','เซลล์','SKU','ชื่อสินค้า','สถานะตอนนี้','ราคาที่เคยตั้งไว้'];
    const csv = [cols.map(csvCell).join(',')].concat(lost.map(r => {
      const c = shopOf(r.customer_id), p = pById.get(r.product_id) || {};
      return [c.code || r.customer_id, c.name || '', c.sale_name || '', p.sku || r.product_id, p.name || '',
              r.now, r.price].map(csvCell).join(',');
    }));
    fs.writeFileSync(path.join(baseDir, 'รายงานกู้ราคา.csv'), '﻿' + csv.join('\r\n'));
    console.log('\n📄 รายงานเต็ม: ' + path.join(baseDir, 'รายงานกู้ราคา.csv'));
  }catch(e){ console.log('⚠️ เขียนไฟล์รายงานไม่ได้: ' + e.message); }

  if(!APPLY){
    console.log('\n👀 นี่คือการดูเฉย ๆ ยังไม่ได้แก้อะไร');
    console.log('   ถ้าถูกต้องแล้ว สั่งกู้จริงด้วย:');
    console.log('   node mix888-restore-prices.js --date ' + DATE + (SHOP ? ' --shop ' + SHOP : '') + ' --apply');
    return;
  }

  console.log('\n🔧 กำลังกู้คืน ' + lost.length + ' รายการ…');
  let miss = 0, cen = 0, kept = 0;
  for(let i = 0; i < lost.length; i += 500){
    const chunk = lost.slice(i, i + 500)
      .map(r => ({customer_id: r.customer_id, product_id: r.product_id, price: r.price}));
    const res = await rpc('nas_restore_prices', {p_key: NAS_EXPORT_KEY, p_rows: chunk, p_apply: true});
    miss += res.lost_missing || 0; cen += res.lost_to_central || 0; kept += res.kept_new_price || 0;
  }
  console.log('✅ กู้คืนแล้ว ' + (miss + cen) + ' รายการ'
    + ' (เพิ่มรายการที่หายไป ' + miss + ' · คืนราคาที่กลายเป็นราคากลาง ' + cen + ')');
  if(kept) console.log('ℹ️ ข้าม ' + kept + ' รายการ เพราะตอนนี้มีราคาเฉพาะร้านใหม่อยู่แล้ว — ไม่ไปทับให้');
  console.log('เปิดหลังบ้าน → จัดสินค้า เพื่อตรวจดูอีกครั้งได้เลยครับ');
})().catch(e => { console.error('❌ ผิดพลาด: ' + (e.message || e)); process.exit(1); });
