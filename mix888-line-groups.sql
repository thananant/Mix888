-- ============================================================
--  Mix Fresh 168 — ชื่อกลุ่มไลน์ (แสดงชื่อแทนรหัส Cxxxx… ในหลังบ้าน)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
--  คู่กับ Edge Function: line-group-name (deploy ผ่าน Dashboard)
-- ============================================================
create table if not exists line_groups (
  group_id    text primary key,       -- Cxxxx… (กลุ่ม) หรือ Rxxxx… (ห้องแชท)
  name        text,                   -- ชื่อกลุ่มจาก LINE
  picture_url text,
  error       text,                   -- ดึงไม่ได้เพราะอะไร (เช่น 404 = บอทไม่อยู่ในกลุ่มแล้ว)
  updated_at  timestamptz default now()
);
alter table line_groups enable row level security;
drop policy if exists line_groups_all on line_groups;
create policy line_groups_all on line_groups for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on line_groups to anon, authenticated;
