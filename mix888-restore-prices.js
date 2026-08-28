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

   ① ไทม์ไลน์ — ราคาถูกเปลี่ยน/หายไปตั้งแต่วันไหน
        node mix888-restore-prices.js

   ② วันนั้นเปลี่ยนอะไรบ้าง (ร้านไหน สินค้าอะไร จากเท่าไรเป็นเท่าไร)
        node mix888-restore-prices.js --diff 2026-08-21

   ③ ดูรายละเอียดว่าจะกู้อะไรบ้างจากวันนั้น (ยังไม่แก้จริง)
        node mix888-restore-prices.js --date 2026-08-20

   ④ กู้จริง
        node mix888-restore-prices.js --date 2026-08-20 --apply

   ⑤ เฉพาะร้านเดียว (ใส่รหัสร้าน) — ใช้ร่วมกับทุกโหมดข้างบน
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
const DIFF  = argOf('--diff');
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

/** เทียบไฟล์สำรอง กับราคาปัจจุบัน — คืน "ทุกความต่าง" พร้อมบอกว่าอันไหนระบบกู้ให้ อันไหนต้องตรวจเอง */
function compareToLive(backupRows, liveRows){
  const live = new Map(liveRows.map(r => [keyOf(r), num(r.price)]));
  const seen = new Set(), out = [];
  for(const b of backupRows){
    const k = keyOf(b), bp = num(b.price);
    seen.add(k);
    const has = live.has(k), cv = has ? live.get(k) : undefined;
    if(bp === null){                                   // ตอนนั้นใช้ราคากลางอยู่แล้ว
      if(has && cv !== null) out.push({k, was: null, now: cv, cat: 'ตั้งราคาเพิ่มทีหลัง', willRestore: false});
      continue;
    }
    if(!has)             out.push({k, was: bp, now: undefined, cat: 'หายไปทั้งรายการ',  willRestore: true});
    else if(cv === null) out.push({k, was: bp, now: null,      cat: 'กลายเป็นราคากลาง', willRestore: true});
    else if(Math.abs(cv - bp) > 0.001)
                         out.push({k, was: bp, now: cv,        cat: 'ราคาต่างจากเดิม',   willRestore: false});
  }
  for(const [k, cv] of live)
    if(!seen.has(k) && cv !== null) out.push({k, was: undefined, now: cv, cat: 'รายการใหม่ (ไม่มีในสำรอง)', willRestore: false});
  return out;
}

/** เทียบราคา 2 ช่วงเวลา — ใช้ไล่ว่าวันไหนราคาถูกเปลี่ยน */
function diffPrices(prevRows, curRows){
  const P = new Map(prevRows.map(r => [keyOf(r), num(r.price)]));
  const C = new Map(curRows.map(r => [keyOf(r), num(r.price)]));
  const lost = [], changed = [], added = [];
  for(const [k, pv] of P){
    const has = C.has(k), cv = has ? C.get(k) : undefined;
    if(pv === null){                                        // เดิมใช้ราคากลาง
      if(has && cv !== null) added.push({k, from: null, to: cv});
      continue;
    }
    if(!has)              lost.push({k, from: pv, to: null, how: 'ถูกเอาออกจากร้าน'});
    else if(cv === null)  lost.push({k, from: pv, to: null, how: 'ถูกเปลี่ยนเป็นราคากลาง'});
    else if(Math.abs(pv - cv) > 0.001) changed.push({k, from: pv, to: cv, how: 'ถูกแก้ราคา'});
  }
  for(const [k, cv] of C) if(!P.has(k) && cv !== null) added.push({k, from: null, to: cv});
  return {lost, changed, added};
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

  // ---------- โหมด ①: ไทม์ไลน์ — ราคาเปลี่ยนวันไหน ----------
  if(!DATE && !DIFF){
    console.log('\n📅 ไทม์ไลน์ราคาเฉพาะร้าน' + (SHOP ? ' · เฉพาะร้าน ' + SHOP : '') + '\n');
    console.log('วันที่           ตั้งราคาเอง  กู้คืนได้  เทียบกับวันก่อนหน้า');
    const snaps = [];
    for(const d of days){
      const rows = readBackup(d);
      if(!rows){ console.log(d.padEnd(16) + '(ไม่มีไฟล์ราคาในโฟลเดอร์นี้)'); continue; }
      snaps.push({d, rows: rows.filter(r => inShop(r.customer_id))});
    }
    snaps.push({d: 'ตอนนี้', rows: live.filter(r => inShop(r.customer_id)), isLive: true});
    const suspects = [];
    let bestDay = null, bestN = 0;
    for(let i = 0; i < snaps.length; i++){
      const s = snaps[i];
      const own = s.rows.filter(r => num(r.price) !== null).length;
      // "กู้คืนได้" = ราคาที่วันนั้นเคยตั้งไว้ แต่ตอนนี้หายไปแล้ว (ยิ่งเยอะ = วันนั้นเป็นฐานกู้ที่ดี)
      const recoverable = s.isLive ? 0 : compareToLive(s.rows, live).filter(r => r.willRestore).length;
      if(recoverable > bestN){ bestN = recoverable; bestDay = s.d; }
      let note = '—';
      if(i > 0){
        const df = diffPrices(snaps[i - 1].rows, s.rows);
        const bits = [];
        if(df.lost.length)    bits.push('⚠️ ราคาหาย ' + df.lost.length);
        if(df.changed.length) bits.push('แก้ราคา ' + df.changed.length);
        if(df.added.length)   bits.push('ตั้งเพิ่ม ' + df.added.length);
        note = bits.length ? bits.join(' · ') : 'เท่าเดิม';
        if(df.lost.length || df.changed.length) suspects.push(s.d);
      }
      console.log(String(s.d).padEnd(16) + String(own).padStart(6) + '     '
        + String(s.isLive ? '-' : recoverable).padStart(6) + '   ' + note);
    }
    console.log('\nอ่านยังไง:');
    console.log('  • "ราคาหาย"  = เคยตั้งราคาเอง แล้วกลายเป็นราคากลาง/หายทั้งรายการ  ← มักเป็นอุบัติเหตุ');
    console.log('  • "แก้ราคา"  = เปลี่ยนจากเลขหนึ่งเป็นอีกเลข  ← พนักงานตั้งใจแก้');
    console.log('  • "ตั้งเพิ่ม" = เพิ่มราคาเฉพาะร้านใหม่          ← พนักงานตั้งใจเพิ่ม');
    console.log('  • "กู้คืนได้" = ราคาของวันนั้นที่ตอนนี้หายไปแล้ว และระบบกู้คืนให้ได้');
    if(bestDay) console.log('\n🎯 วันที่กู้คืนได้มากที่สุดคือ ' + bestDay + ' (' + bestN + ' รายการ)'
      + '\n   ดูรายละเอียดก่อนกู้:  node mix888-restore-prices.js --date ' + bestDay + (SHOP ? ' --shop ' + SHOP : ''));
    if(suspects.length){
      console.log('\n🔎 วันที่มีการเปลี่ยนราคา: ' + suspects.join(', '));
      console.log('   ดูว่าวันนั้นเปลี่ยนอะไรบ้าง:');
      console.log('   node mix888-restore-prices.js --diff ' + suspects[0] + (SHOP ? ' --shop ' + SHOP : ''));
    }else{
      console.log('\n✅ ไม่พบการเปลี่ยนราคาในช่วงที่มีสำรองข้อมูล');
    }
    return;
  }

  // ---------- โหมด ①ข: ดูว่าวันนั้นเปลี่ยนอะไรบ้าง ----------
  if(DIFF){
    const idx = days.indexOf(DIFF);
    const isLive = DIFF === 'ตอนนี้' || DIFF === 'now';
    if(!isLive && idx < 0){ console.log('❌ ไม่มีสำรองของวันที่ ' + DIFF + '\n   มีวันที่: ' + days.join(', ')); return; }
    const curRows  = isLive ? live : readBackup(DIFF);
    const prevDay  = isLive ? days[days.length - 1] : days[idx - 1];
    if(!prevDay){ console.log('❌ ไม่มีสำรองของวันก่อนหน้าไว้เทียบ'); return; }
    const prevRows = readBackup(prevDay);
    if(!curRows || !prevRows){ console.log('❌ อ่านไฟล์สำรองไม่ได้'); return; }
    const df = diffPrices(prevRows.filter(r => inShop(r.customer_id)), curRows.filter(r => inShop(r.customer_id)));
    console.log('\n📋 สิ่งที่เปลี่ยนไประหว่าง ' + prevDay + ' → ' + DIFF
      + (SHOP ? ' · เฉพาะร้าน ' + SHOP : '') + '\n');
    const label = (k) => {
      const [cid, pid] = k.split('|').map(Number);
      const c = shopOf(cid), p = pById.get(pid) || {};
      return (c.code || '#' + cid) + ' ' + (c.name || '') + ' · ' + (p.sku || '#' + pid) + ' ' + (p.name || '');
    };
    const dump = (title, arr, fn) => {
      if(!arr.length) return;
      console.log(title + ' (' + arr.length + ' รายการ)');
      for(const r of arr.slice(0, 40)) console.log('   ' + label(r.k) + ' — ' + fn(r));
      if(arr.length > 40) console.log('   … และอีก ' + (arr.length - 40) + ' รายการ');
      console.log('');
    };
    // สรุปตามร้าน — ราคาหายกระจุกอยู่ที่ไม่กี่ร้าน = คนกดทำทีเดียว (เช่นคัดลอกราคาจากร้านอื่น)
    if(df.lost.length){
      const byShop = new Map();
      for(const r of df.lost){
        const cid = Number(r.k.split('|')[0]);
        byShop.set(cid, (byShop.get(cid) || 0) + 1);
      }
      const top = [...byShop.entries()].sort((a, b) => b[1] - a[1]);
      console.log('🏪 ราคาหายกระจุกที่ร้านไหน (' + byShop.size + ' ร้าน)');
      for(const [cid, n] of top.slice(0, 15)){
        const c = shopOf(cid);
        console.log('   ' + String(n).padStart(4) + ' รายการ — ' + (c.code || '#' + cid) + ' ' + (c.name || '')
          + (c.branch_name ? ' • ' + c.branch_name : ''));
      }
      if(top.length > 15) console.log('   … และอีก ' + (top.length - 15) + ' ร้าน (ดูครบในไฟล์ CSV ของโหมด --date)');
      const many = top.filter(([, n]) => n >= 20).length;
      console.log(many
        ? '   → มี ' + many + ' ร้านที่หายทีละหลายสิบรายการ = น่าจะเกิดจากการกดทำทีเดียว เช่นปุ่ม "คัดลอกการจัดสินค้า+ราคา จากร้านอื่น"'
        : '   → หายกระจาย ร้านละไม่กี่รายการ = น่าจะเกิดจากการแก้ทีละรายการ');
      console.log('');
    }
    dump('⚠️ ราคาที่หายไป', df.lost, r => r.how + ' (เคยตั้งไว้ ' + fmtB(r.from) + ')');
    dump('✏️ ราคาที่ถูกแก้ (พนักงานตั้งใจแก้)', df.changed, r => fmtB(r.from) + ' → ' + fmtB(r.to));
    dump('➕ ราคาที่ตั้งเพิ่ม (พนักงานตั้งใจเพิ่ม)', df.added, r => 'ตั้งเป็น ' + fmtB(r.to));
    if(!df.lost.length && !df.changed.length && !df.added.length) console.log('เท่าเดิมทุกรายการ');
    if(df.lost.length){
      console.log('กู้ราคาที่หายของวันนั้นคืนได้ด้วย:');
      console.log('   node mix888-restore-prices.js --date ' + prevDay + (SHOP ? ' --shop ' + SHOP : ''));
    }
    return;
  }

  // ---------- โหมด ②/③: ดูรายละเอียด / กู้จริง ----------
  const rows = readBackup(DATE);
  if(!rows){ console.log('❌ ไม่มีไฟล์สำรองราคาของวันที่ ' + DATE); return; }
  const scoped = rows.filter(r => inShop(r.customer_id));
  const all = compareToLive(scoped, live);            // ทุกความต่าง ไม่ใช่แค่ที่หาย
  const lost = all.filter(r => r.willRestore);        // เฉพาะที่จะกู้คืนจริง
  const diff = all.filter(r => r.cat === 'ราคาต่างจากเดิม');
  const other = all.filter(r => !r.willRestore && r.cat !== 'ราคาต่างจากเดิม');
  if(!all.length){
    console.log('✅ เทียบกับสำรองวันที่ ' + DATE + ' แล้ว ราคาเหมือนกันทุกรายการ' + (SHOP ? ' (ร้าน ' + SHOP + ')' : ''));
    return;
  }
  const pr = (v) => v === undefined ? 'ไม่มีรายการ' : (v === null ? 'ราคากลาง' : fmtB(v));
  const line = (r) => {
    const [cid, pid] = r.k.split('|').map(Number);
    const c = shopOf(cid), p = pById.get(pid) || {};
    return '  ' + (c.code || '#' + cid) + ' ' + (c.name || '') + ' · ' + (p.sku || '#' + pid) + ' ' + (p.name || '')
      + '\n      เดิม ' + pr(r.was) + '  →  ตอนนี้ ' + pr(r.now);
  };
  console.log('\n📋 เทียบราคาปัจจุบัน กับสำรองวันที่ ' + DATE + (SHOP ? ' · เฉพาะร้าน ' + SHOP : '') + '\n');
  console.log('   ✅ จะกู้คืนให้    ' + String(lost.length).padStart(5) + ' รายการ  (ราคาหายไป/กลายเป็นราคากลาง)');
  console.log('   ⚠️ ต้องตรวจเอง  ' + String(diff.length).padStart(5) + ' รายการ  (มีราคาเฉพาะร้านอยู่ แต่คนละตัวเลข — ระบบจะไม่ไปทับ)');
  console.log('   ℹ️ ไม่เกี่ยวข้อง ' + String(other.length).padStart(5) + ' รายการ  (ตั้งเพิ่มทีหลัง / รายการใหม่)');
  if(lost.length){
    console.log('\n✅ รายการที่จะกู้คืน' + (lost.length > 25 ? ' (แสดง 25 แรก — ดูครบในไฟล์ CSV)' : '') + ':');
    lost.slice(0, 25).forEach(r => console.log(line(r)));
  }
  if(diff.length){
    console.log('\n⚠️ ราคาต่างจากเดิม — ระบบไม่แตะให้ ต้องดูเองว่าอันไหนถูก'
      + (diff.length > 25 ? ' (แสดง 25 แรก — ดูครบในไฟล์ CSV)' : '') + ':');
    diff.slice(0, 25).forEach(r => console.log(line(r)));
  }

  // สรุปรายร้าน — ลูกค้าแต่ละเจ้ามีกี่รายการที่ราคาไม่ตรงกับวันนั้น (ไว้ไล่แก้ทีละร้าน)
  const byShop = new Map();
  for(const r of all){
    if(!r.willRestore && r.cat !== 'ราคาต่างจากเดิม') continue;   // ของที่ตั้งเพิ่มทีหลัง ไม่ใช่ความผิดปกติ
    const cid = Number(r.k.split('|')[0]);
    const e = byShop.get(cid) || {restore: 0, check: 0};
    if(r.willRestore) e.restore++; else e.check++;
    byShop.set(cid, e);
  }
  const shopRows = [...byShop.entries()]
    .map(([cid, e]) => ({cid, ...e, total: e.restore + e.check}))
    .sort((a, b) => b.total - a.total);
  if(shopRows.length){
    console.log('\n🏪 สรุปรายร้าน — ลูกค้าแต่ละเจ้ามีกี่รายการที่ราคาไม่ตรงกับวันที่ ' + DATE
      + ' (ทั้งหมด ' + shopRows.length + ' ร้าน)\n');
    console.log('  ไม่ตรง  กู้ให้  ตรวจเอง  ร้าน');
    for(const r of shopRows.slice(0, 30)){
      const c = shopOf(r.cid);
      console.log('  ' + String(r.total).padStart(5) + String(r.restore).padStart(7) + String(r.check).padStart(9)
        + '   ' + (c.code || '#' + r.cid) + ' ' + (c.name || '')
        + (c.branch_name ? ' • ' + c.branch_name : '') + (c.sale_name ? '  [' + c.sale_name + ']' : ''));
    }
    if(shopRows.length > 30) console.log('  … และอีก ' + (shopRows.length - 30) + ' ร้าน (ดูครบในไฟล์ CSV รายร้าน)');
    try{
      const cols = ['รหัสร้าน','ชื่อร้าน','สาขา','เซลล์','รายการไม่ตรงทั้งหมด','ระบบกู้ให้ได้','ต้องตรวจเอง'];
      const csv2 = [cols.map(csvCell).join(',')].concat(shopRows.map(r => {
        const c = shopOf(r.cid);
        return [c.code || r.cid, c.name || '', c.branch_name || '', c.sale_name || '',
                r.total, r.restore, r.check].map(csvCell).join(',');
      }));
      fs.writeFileSync(path.join(baseDir, 'รายงานกู้ราคา-รายร้าน.csv'), '\ufeff' + csv2.join('\r\n'));
      console.log('\n📄 สรุปรายร้าน (เปิดด้วย Excel): ' + path.join(baseDir, 'รายงานกู้ราคา-รายร้าน.csv'));
    }catch(e){ console.log('⚠️ เขียนไฟล์สรุปรายร้านไม่ได้: ' + e.message); }
  }

  // รายงาน CSV เปิดด้วย Excel — ครบทุกความต่าง พร้อมบอกว่าอันไหนระบบกู้ให้ อันไหนต้องตรวจเอง
  try{
    const cols = ['รหัสร้าน','ชื่อร้าน','เซลล์','SKU','ชื่อสินค้า','ราคาเมื่อ ' + DATE,'ราคาตอนนี้','สถานะ','ระบบจะทำอะไร'];
    const csv = [cols.map(csvCell).join(',')].concat(all.map(r => {
      const [cid, pid] = r.k.split('|').map(Number);
      const c = shopOf(cid), p = pById.get(pid) || {};
      return [c.code || cid, c.name || '', c.sale_name || '', p.sku || pid, p.name || '',
              r.was === undefined ? 'ไม่มีรายการ' : (r.was === null ? 'ราคากลาง' : r.was),
              r.now === undefined ? 'ไม่มีรายการ' : (r.now === null ? 'ราคากลาง' : r.now),
              r.cat, r.willRestore ? 'กู้คืนให้' : 'ไม่แตะ'].map(csvCell).join(',');
    }));
    fs.writeFileSync(path.join(baseDir, 'รายงานกู้ราคา.csv'), '﻿' + csv.join('\r\n'));
    console.log('\n📄 รายงานเต็มทุกรายการ (เปิดด้วย Excel): ' + path.join(baseDir, 'รายงานกู้ราคา.csv'));
  }catch(e){ console.log('⚠️ เขียนไฟล์รายงานไม่ได้: ' + e.message); }

  if(!APPLY){
    console.log('\n👀 นี่คือการดูเฉย ๆ ยังไม่ได้แก้อะไรเลย');
    if(lost.length){
      console.log('   ถ้าถูกต้องแล้ว สั่งกู้จริงด้วย:');
      console.log('   node mix888-restore-prices.js --date ' + DATE + (SHOP ? ' --shop ' + SHOP : '') + ' --apply');
    }else console.log('   ไม่มีรายการที่ต้องกู้คืน');
    return;
  }
  if(!lost.length){ console.log('\n✅ ไม่มีรายการที่ต้องกู้คืน'); return; }

  console.log('\n🔧 กำลังกู้คืน ' + lost.length + ' รายการ…');
  let miss = 0, cen = 0, kept = 0;
  for(let i = 0; i < lost.length; i += 500){
    const chunk = lost.slice(i, i + 500).map(r => {
      const [cid, pid] = r.k.split('|').map(Number);
      return {customer_id: cid, product_id: pid, price: r.was};
    });
    const res = await rpc('nas_restore_prices', {p_key: NAS_EXPORT_KEY, p_rows: chunk, p_apply: true});
    miss += res.lost_missing || 0; cen += res.lost_to_central || 0; kept += res.kept_new_price || 0;
  }
  console.log('✅ กู้คืนแล้ว ' + (miss + cen) + ' รายการ'
    + ' (เพิ่มรายการที่หายไป ' + miss + ' · คืนราคาที่กลายเป็นราคากลาง ' + cen + ')');
  if(kept) console.log('ℹ️ ข้าม ' + kept + ' รายการ เพราะตอนนี้มีราคาเฉพาะร้านใหม่อยู่แล้ว — ไม่ไปทับให้');
  console.log('เปิดหลังบ้าน → จัดสินค้า เพื่อตรวจดูอีกครั้งได้เลยครับ');
})().catch(e => { console.error('❌ ผิดพลาด: ' + (e.message || e)); process.exit(1); });
