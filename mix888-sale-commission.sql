-- ============================================================
--  Mix Fresh 168 — ค่าคอม & เงินเดือนเซลล์ (หน้า 💼 เห็นเฉพาะ admin)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
-- ============================================================
-- ตั้งค่ารายคน (ไม่มีแถว = ใช้ค่าเริ่มต้น 1% 90 วัน → 0.5% 90 วัน → 0.25% · โบนัส 10/20/30 คน = 2,000/5,000/7,000)
create table if not exists sale_comp (
  sale_id     integer primary key references sales(id) on delete cascade,
  base_salary numeric not null default 0,      -- เงินเดือนพื้นฐาน/เดือน
  days1       integer not null default 90,     -- ช่วงที่ 1 กี่วันแรก (นับจากบิลแรกของลูกค้า)
  rate1       numeric not null default 1,      -- % ช่วงที่ 1
  days2       integer not null default 90,     -- ช่วงที่ 2 อีกกี่วัน
  rate2       numeric not null default 0.5,    -- % ช่วงที่ 2
  rate3       numeric not null default 0.25,   -- % หลังจากนั้น
  bonus       jsonb   not null default '[{"n":10,"amt":2000},{"n":20,"amt":5000},{"n":30,"amt":7000}]',
  updated_at  timestamptz default now()
);
-- เพิ่ม/หัก รายเดือน (ค่าน้ำมัน หักขาดงาน ฯลฯ)
create table if not exists sale_pay_adj (
  id         bigserial primary key,
  sale_id    integer not null references sales(id) on delete cascade,
  month      text    not null,                 -- 'YYYY-MM'
  amount     numeric not null,                 -- ติดลบ = หัก
  note       text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists sale_pay_adj_month_idx on sale_pay_adj(sale_id, month);

-- สิทธิ์: แอปยิงผ่าน anon key เหมือนตารางอื่น (หน้าเว็บกัน admin อยู่แล้ว)
alter table sale_comp    enable row level security;
alter table sale_pay_adj enable row level security;
drop policy if exists sale_comp_all    on sale_comp;
drop policy if exists sale_pay_adj_all on sale_pay_adj;
create policy sale_comp_all    on sale_comp    for all to anon, authenticated using (true) with check (true);
create policy sale_pay_adj_all on sale_pay_adj for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on sale_comp, sale_pay_adj to anon, authenticated;
grant usage, select on sequence sale_pay_adj_id_seq to anon, authenticated;
