-- ============================================================
--  Mix Fresh 168 — ตั้งเวลาแจ้งยอดบิลค้างอัตโนมัติ (18:30 ทุกวัน)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run (รันซ้ำได้)
--  ตัวฟังก์ชัน billing-reminder จะเช็คเองว่า "วันนี้" เป็นวันแจ้งไหม
--  (วันที่ 16 และวันสุดท้ายของเดือนเท่านั้น) วันอื่นจบเงียบ ๆ
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ลบตารางเวลาเดิม (ถ้ามี) แล้วตั้งใหม่
do $$ begin perform cron.unschedule('billing-reminder-daily'); exception when others then null; end $$;

-- 18:30 เวลาไทย = 11:30 UTC
select cron.schedule('billing-reminder-daily', '30 11 * * *', $$
  select net.http_post(
    url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/billing-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
    body    := '{}'::jsonb)
$$);
