-- ============================================================
--  Mix Fresh 168 — เอกสารขอใช้เครดิต + อนุมัติโดย admin
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
-- ============================================================
-- สถานะเครดิตของลูกค้า: pending = รอ admin อนุมัติ · approved = ใช้เครดิตได้ · rejected = ตีกลับเอกสาร
alter table customers add column if not exists credit_entity        text;          -- person = บุคคลธรรมดา · company = บริษัท
alter table customers add column if not exists credit_status        text;          -- pending | approved | rejected (null = ไม่ใช่เครดิต)
alter table customers add column if not exists credit_reviewed_by   text;
alter table customers add column if not exists credit_reviewed_at   timestamptz;
alter table customers add column if not exists credit_reject_reason text;
-- ลูกค้าเครดิตที่มีอยู่ก่อนระบบนี้ → ให้ admin ไปตรวจเอกสารแล้วกดอนุมัติ (ระหว่างนี้ใบวางบิลอัตโนมัติจะยังไม่ส่ง)
update customers set credit_status = 'pending' where pay_type = 'credit' and credit_status is null;

-- ไฟล์เอกสาร (1 แถวต่อประเภทเอกสารต่อลูกค้า)
create table if not exists credit_docs (
  id          bigserial primary key,
  customer_id integer not null references customers(id) on delete cascade,
  doc_type    text    not null,   -- id_card | house_reg | pp20 | company_cert | dir_id_card | dir_house_reg
  file_path   text    not null,   -- path ใน bucket credit-docs
  file_name   text,
  stamped     boolean not null default false,   -- admin ตรวจแล้วว่ามีตราประทับบริษัท (เฉพาะบริษัท)
  stamped_by  text,
  uploaded_by text,
  uploaded_at timestamptz default now(),
  unique (customer_id, doc_type)
);
-- ประวัติการอนุมัติ/ตีกลับ
create table if not exists credit_reviews (
  id          bigserial primary key,
  customer_id integer not null references customers(id) on delete cascade,
  action      text    not null,   -- pending | approved | rejected | เปลี่ยนเอกสาร …
  reason      text,
  by          text,
  created_at  timestamptz default now()
);
alter table credit_docs    enable row level security;
alter table credit_reviews enable row level security;
drop policy if exists credit_docs_all    on credit_docs;
drop policy if exists credit_reviews_all on credit_reviews;
create policy credit_docs_all    on credit_docs    for all to anon, authenticated using (true) with check (true);
create policy credit_reviews_all on credit_reviews for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on credit_docs, credit_reviews to anon, authenticated;
grant usage, select on sequence credit_docs_id_seq, credit_reviews_id_seq to anon, authenticated;

-- ที่เก็บไฟล์ (private — เปิดดูผ่านลิงก์ชั่วคราวจากหลังบ้านเท่านั้น ไม่ใช่ลิงก์สาธารณะ)
insert into storage.buckets (id, name, public, file_size_limit)
  values ('credit-docs', 'credit-docs', false, 10485760)
  on conflict (id) do update set public = false, file_size_limit = 10485760;
drop policy if exists credit_docs_rw on storage.objects;
create policy credit_docs_rw on storage.objects for all to anon, authenticated
  using (bucket_id = 'credit-docs') with check (bucket_id = 'credit-docs');
