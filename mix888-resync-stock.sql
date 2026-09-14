-- ============================================================
--  Mix Fresh 168 — ซ่อม "สต๊อกรวม" ที่เพี้ยน ให้ตรงกับยอดรายโกดัง (ทำจริง ไม่ใช่แค่ดู)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  ใช้กับอาการ: คอลัมน์รายโกดังมีของ (เช่น 9) แต่ "สต๊อกรวม" เป็นเลขอื่น/ติดลบ (เช่น -6)
--  ทำให้สินค้าขึ้น "หมด" ทั้งที่มีของ — เศษความเสียหายจากบั๊กแปลงสินค้าเวอร์ชันเก่า
--
--  ไฟล์นี้ทำอะไร
--   1. เช็คว่าเครื่องมือซ่อม (จากไฟล์ mix888-fix-convert.sql) ติดตั้งแล้วหรือยัง — ถ้ายัง จะหยุดพร้อมบอกว่าต้องรันไฟล์ไหนก่อน
--   2. ปรับ "สต๊อกรวม" ของทุกสินค้าที่ไม่ตรง ให้เท่ากับผลรวมรายโกดัง (ยอดรายโกดังคือของจริง)
--      ทุกตัวที่ปรับจะมีบันทึกในหน้า "เดินสินค้า" ว่าปรับจากเท่าไรเป็นเท่าไร
--   3. โชว์ผลก่อน/หลัง โดยเฉพาะกลุ่มบะหมี่สไลด์ (NDL0016*)
--   ⛔ ไม่แตะราคาใด ๆ · ไม่แตะยอดรายโกดัง — แก้แค่ตัวเลข "สต๊อกรวม" ที่ระบบจำผิดเท่านั้น
--
--  หลังรัน: ถ้าตัวเลขใหม่ยังไม่ตรงกับของจริงที่นับได้หน้าคลัง ให้ใช้ปุ่ม 🔧 สต๊อก
--  หรือหน้า "นับ/ปรับสต๊อก" ตั้งเป็นจำนวนที่นับได้ (พนักงานเป็นคนตั้งเอง)
-- ============================================================

-- 1) เครื่องมือซ่อมต้องถูกติดตั้งก่อน (มาจากไฟล์ mix888-fix-convert.sql)
do $$
begin
  if to_regprocedure('stock_totals_resync(boolean,boolean)') is null then
    raise exception e'ยังไม่ได้ติดตั้งชุดแก้บั๊กแปลงสินค้า\n→ รันไฟล์ mix888-fix-convert.sql ทั้งไฟล์ก่อน แล้วค่อยกลับมารันไฟล์นี้ซ้ำอีกครั้ง';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'convert_stock'
                    and pg_get_functiondef(p.oid) like '%convert_stock_v0%') then
    raise warning 'ตัวกันแปลงเบิ้ลยังไม่ทำงาน — รันไฟล์ mix888-fix-convert.sql ซ้ำด้วย ไม่งั้นแปลงสินค้าครั้งหน้าตัวเลขจะเพี้ยนอีก';
  end if;
end $$;

-- 2) สถานะกลุ่มบะหมี่สไลด์ "ก่อนปรับ"
select p.sku, p.name as "สินค้า", coalesce(p.stock_qty,0) as "สต๊อกรวม(ระบบจำ)",
       coalesce((select sum(qty) from stock s where s.product_id = p.id),0) as "รวมรายโกดัง(ของจริง)",
       coalesce(p.reserved_qty,0) as "จองรอส่ง"
  from products p where p.sku like 'NDL0016%' order by p.sku;

-- 3) ปรับจริงทุกสินค้า (ทั้งที่เคยแปลงและไม่เคยแปลง) — ตารางนี้คือรายการที่ถูกปรับ
select * from stock_totals_resync(true, true);

-- 4) ผล "หลังปรับ" — สต๊อกรวมต้องเท่ากับรวมรายโกดังแล้ว
select p.sku, p.name as "สินค้า", coalesce(p.stock_qty,0) as "สต๊อกรวม(ใหม่)",
       coalesce((select sum(qty) from stock s where s.product_id = p.id),0) as "รวมรายโกดัง",
       coalesce(p.reserved_qty,0) as "จองรอส่ง",
       case when coalesce(p.stock_qty,0) = coalesce((select sum(qty) from stock s where s.product_id = p.id),0)
            then '✅ ตรงกันแล้ว' else '⚠️ ยังไม่ตรง — ส่งภาพนี้กลับมาให้ดู' end as "สถานะ"
  from products p where p.sku like 'NDL0016%' order by p.sku;

-- 5) ทั้งระบบเหลือสินค้าที่ยังไม่ตรงอีกไหม (0 = เรียบร้อยทั้งหมด · ที่ "ไม่มีแถวรายโกดัง" ระบบตั้งใจไม่แตะ)
select count(*) as "ยังไม่ตรง (ควรเป็น 0)"
  from products p
  left join (select product_id, sum(qty) as sq from stock group by product_id) s on s.product_id = p.id
 where coalesce(p.active,true) and s.product_id is not null
   and coalesce(p.stock_qty,0) <> coalesce(s.sq,0);
