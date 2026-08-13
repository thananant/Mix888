-- ============================================================
--  Mix Fresh 168 — เพิ่มคอลัมน์ "วันนัดส่ง" ให้ออเดอร์
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบข้อมูลเดิม
-- ============================================================
alter table orders add column if not exists deliver_date date;
create index if not exists orders_deliver_date_idx on orders(deliver_date) where deliver_date is not null;
