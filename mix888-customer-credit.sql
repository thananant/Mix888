-- ============================================================
--  Mix Fresh 168 — ประเภทการชำระเงินของลูกค้า (จ่ายก่อนส่ง / จ่ายหลังส่ง / เครดิต)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบข้อมูลเดิม (ลูกค้าเดิมทุกรายจะเป็น "จ่ายก่อนส่ง" ไปก่อน)
-- ============================================================
alter table customers add column if not exists pay_type text not null default 'prepay';   -- prepay | postpay | credit
alter table customers add column if not exists credit_mode text;                            -- days | schedule (เฉพาะ credit)
alter table customers add column if not exists credit_days integer;                         -- เครดิตตามจำนวนวัน
alter table customers add column if not exists credit_schedule jsonb;                       -- ตารางรอบวางบิล [{from,to,bill,due}] (YYYY-MM-DD)

alter table customers drop constraint if exists customers_pay_type_chk;
alter table customers add constraint customers_pay_type_chk check (pay_type in ('prepay','postpay','credit'));
alter table customers drop constraint if exists customers_credit_mode_chk;
alter table customers add constraint customers_credit_mode_chk check (credit_mode is null or credit_mode in ('days','schedule'));

comment on column customers.pay_type is 'prepay=จ่ายก่อนส่ง postpay=จ่ายหลังส่ง credit=เครดิต';
comment on column customers.credit_schedule is 'รอบวางบิลทั้งปี: [{"from":"2026-01-26","to":"2026-02-25","bill":"2026-02-25","due":"2026-03-10"}]';
