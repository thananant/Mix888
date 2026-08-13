-- ============================================================
--  Mix Fresh 168 — ประทับชื่อพนักงานให้ออเดอร์ที่สั่งผ่านลิงก์ลูกค้า
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run (รันซ้ำได้)
--
--  หน้าเว็บลูกค้าจะเรียกฟังก์ชันนี้ "เฉพาะเครื่องที่เคยล็อกอินหลังบ้าน"
--  (= เครื่องพนักงาน) เพื่อบันทึกว่าใครเป็นคนกดสั่ง
--  ลูกค้าสั่งจากมือถือตัวเอง = ไม่ถูกเรียก = ขึ้น "ลูกค้าสั่งเอง"
-- ============================================================
create or replace function mark_order_creator(p_order_no text, p_staff text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(trim(p_staff), '') = '' or length(p_staff) > 60 then return; end if;
  -- แก้ได้เฉพาะออเดอร์ที่ยังไม่มีชื่อผู้สั่ง และเพิ่งสร้างไม่เกิน 3 นาที (กันย้อนแก้ของเก่า)
  update orders
     set created_by = trim(p_staff)
   where order_no = p_order_no
     and created_by is null
     and created_at > now() - interval '3 minutes';
end $$;
