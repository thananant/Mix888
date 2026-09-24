-- ============================================================
--  Mix Fresh 168 — เปิดให้เพิ่ม/แก้/ซ่อน/ลบ "หมวดค่าใช้จ่าย" (Petty Cash) ได้เองจากหลังบ้าน
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run (รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
--
--  รันเมื่อไร: ถ้ากด "เพิ่มหมวด" หรือ "🗑 ลบ" ในหน้ารายจ่าย (ปุ่ม ⚙️ ข้างช่องหมวด) แล้วขึ้น
--  "บันทึกไม่สำเร็จ: new row violates row-level security policy" / "permission denied" /
--  "ลบไม่สำเร็จ — ระบบไม่อนุญาตให้ลบ"
--  แปลว่าตารางหมวดยังเปิดให้ "อ่าน" อย่างเดียว — ไฟล์นี้เปิดสิทธิ์เพิ่ม/แก้/ลบให้ผู้ที่ล็อกอินหลังบ้าน
--  (ถ้ากดแล้วสำเร็จอยู่แล้ว ไม่ต้องรันก็ได้)
--
--  เรื่องลบ: หน้าเว็บจะลบหมวดก็ต่อเมื่อไม่มีรายจ่ายใช้หมวดนั้นแล้วเท่านั้น
--  (ถ้ามี จะให้ย้ายรายจ่ายไปหมวดอื่นก่อน หรือซ่อนแทน) ข้อมูลรายจ่ายจึงไม่หายไปไหน
-- ============================================================

-- คอลัมน์ที่หน้าเว็บใช้ — เติมให้ครบถ้าตารางเดิมยังไม่มี
alter table expense_categories add column if not exists sort_order integer not null default 0;
alter table expense_categories add column if not exists active boolean not null default true;

alter table expense_categories enable row level security;
drop policy if exists "expcat_auth_all" on expense_categories;
create policy "expcat_auth_all" on expense_categories
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on expense_categories to authenticated;
grant usage, select on all sequences in schema public to authenticated;
