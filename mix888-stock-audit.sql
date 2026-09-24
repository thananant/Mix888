-- ============================================================
--  Mix Fresh 168 — 🔍 ดูหลักฐาน: สต๊อกสินค้าตัวนี้ใครทำอะไรบ้าง เพี้ยนเพราะระบบหรือพนักงาน
--  อ่านอย่างเดียว ไม่แก้อะไรทั้งสิ้น — รันกี่ครั้งก็ได้
--
--  วิธีใช้: อยากดูสินค้าไหน แก้ 'NDL0016%' ทุกจุดในไฟล์เป็นรหัส SKU ที่ต้องการ
--  (ใส่ % ต่อท้าย = เอาทั้งตระกูล เช่น 'NDL0016%' ได้ทั้งยกลัง/ปลีก)
-- ============================================================

-- 1) คำตัดสิน: แต่ละตัวตอนนี้ตรงไหม และถ้าเคยเพี้ยน สาเหตุน่าจะมาจากอะไร
select p.sku, p.name as "สินค้า",
       coalesce(p.stock_qty,0) as "สต๊อกรวม",
       coalesce((select sum(qty) from stock s where s.product_id = p.id),0) as "รวมรายโกดัง",
       case
         when coalesce(p.stock_qty,0) = coalesce((select sum(qty) from stock s where s.product_id = p.id),0)
           then '✅ ตอนนี้ตรงกัน'
         when exists (select 1 from conversions c where p.id in (c.from_product, c.to_product))
           then '⚠️ ไม่ตรง — เคยผ่านการแปลงสินค้า (ตรงกับบั๊กระบบเวอร์ชันเก่า ไม่ใช่ความผิดพนักงาน)'
         else '⚠️ ไม่ตรง — ไม่เคยแปลง ดูประวัติข้อ 3 ประกอบ'
       end as "คำตัดสิน",
       (select count(*) from conversions c where p.id in (c.from_product, c.to_product)) as "เคยแปลง(ครั้ง)"
  from products p
 where p.sku like 'NDL0016%'
 order by p.sku;

-- 2) สต๊อกรายโกดังตอนนี้
select p.sku, w.name as "โกดัง", s.qty as "จำนวน"
  from stock s
  join products p on p.id = s.product_id
  left join warehouses w on w.id = s.warehouse_id
 where p.sku like 'NDL0016%'
 order by p.sku, w.name;

-- 3) ประวัติความเคลื่อนไหว 60 รายการล่าสุด — ใครทำอะไรเมื่อไร
--    บรรทัด "โดย: ระบบ" ที่ขึ้นต้น 🩺 หรือ "ปรับยอดรวมให้ตรงกับรายโกดัง" = ระบบซ่อมบัญชีตัวเอง ไม่ใช่คนแตะของ
select to_char(m.created_at at time zone 'Asia/Bangkok','DD/MM/YY HH24:MI') as "เวลา",
       p.sku,
       case coalesce(m.type,'')
         when 'receive' then '📥 รับเข้า' when 'sale' then '📤 ขายออก' when 'ship' then '📤 ขายออก'
         when 'adjust' then '⚖️ ปรับสต๊อก' when 'convert_in' then '🔄 แปลงเข้า' when 'convert_out' then '🔄 แปลงออก'
         when 'transfer_in' then '🚚 โอนเข้า' when 'transfer_out' then '🚚 โอนออก'
         when 'waste' then '🗑 ตีเสีย' when 'receive_cancel' then '↩ ยกเลิกรับเข้า'
         else coalesce(m.type,'?') end as "ประเภท",
       m.qty as "จำนวน",
       w.name as "โกดัง",
       coalesce(nullif(m.created_by,''),'ไม่ระบุ') as "โดย",
       m.note as "หมายเหตุ"
  from stock_movements m
  join products p on p.id = m.product_id
  left join warehouses w on w.id = m.warehouse_id
 where p.sku like 'NDL0016%'
 order by m.id desc
 limit 60;

-- 4) ประวัติการแปลงสินค้า ที่เกี่ยวกับสินค้ากลุ่มนี้ (ต้นทางบั๊กเวอร์ชันเก่า)
select c.*
  from conversions c
 where c.from_product in (select id from products where sku like 'NDL0016%')
    or c.to_product   in (select id from products where sku like 'NDL0016%')
 order by c.id desc
 limit 20;
