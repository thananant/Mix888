-- ============================================================
--  Mix Fresh 168 — ใบวางบิลอัตโนมัติ (ลูกค้าเครดิตตามรอบวางบิล)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
--  คู่กับ Edge Function: credit-statement (deploy ผ่าน Dashboard)
-- ============================================================
-- ประวัติการส่งใบวางบิล / ทวงสลิป (กันส่งซ้ำ + ดูย้อนหลังในหลังบ้าน)
create table if not exists credit_statements (
  id          bigserial primary key,
  customer_id integer not null references customers(id) on delete cascade,
  kind        text    not null default 'statement',   -- statement = ใบวางบิล · reminder = ทวงสลิป
  period_from date    not null,
  period_to   date    not null,
  bill_date   date    not null,                       -- วันวางบิลตามตาราง (ใช้เป็นกุญแจกันส่งซ้ำ)
  due_date    date    not null,
  bills       integer not null default 0,
  total       numeric not null default 0,
  paid        numeric not null default 0,
  unpaid      numeric not null default 0,
  image_url   text,                                   -- รูปใบวางบิลที่ส่งไป (bucket bills/statements/)
  line_ok     boolean not null default false,         -- ส่งเข้ากลุ่มลูกค้าสำเร็จ
  report_ok   boolean not null default false,         -- ส่งเข้ากลุ่มรีพอร์ตสำเร็จ
  error       text,
  created_at  timestamptz default now()
);
create index if not exists credit_statements_cust_idx on credit_statements(customer_id, bill_date, kind);

alter table credit_statements enable row level security;
drop policy if exists credit_statements_all on credit_statements;
create policy credit_statements_all on credit_statements for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on credit_statements to anon, authenticated;
grant usage, select on sequence credit_statements_id_seq to anon, authenticated;

-- กลุ่มไลน์รีพอร์ต (ตั้งในหลังบ้านได้เช่นกัน)
insert into settings(key, value) values ('line_report_group', '') on conflict (key) do nothing;

-- ตั้งเวลา: ทุกวัน 10:00 น. เวลาไทย (= 03:00 UTC) ให้เรียก Edge Function credit-statement
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'credit-statement-daily';
select cron.schedule(
  'credit-statement-daily',
  '0 3 * * *',
  $$ select net.http_post(
       url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/credit-statement',
       headers := '{"Content-Type":"application/json","apikey":"sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
       body    := '{}'::jsonb,
       timeout_milliseconds := 120000
     ); $$
);
