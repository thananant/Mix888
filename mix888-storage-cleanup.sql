-- ============================================================
--  Mix Fresh 168 — ลบรูปบิล+สลิปออกจาก Supabase หลังเก็บเข้า NAS แล้ว
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  วงจรทำงาน:
--  1. โปรแกรมบน NAS เก็บรูปบิล+สลิปครบแล้ว → เรียก nas_confirm_saved มาประทับ
--     ตราว่า "บิลนี้อยู่ใน NAS แล้ว" (คอลัมน์ nas_saved_at)
--  2. ตี 3 ครึ่งทุกคืน ระบบเรียก Edge Function storage-cleanup ให้ลบไฟล์ของบิลที่
--     จ่ายครบ + อยู่ใน NAS มาแล้วเกิน 2 วัน (และบิลที่ยกเลิกเกิน 7 วัน)
--     แล้วประทับ storage_cleaned_at กันลบซ้ำ — รูปวาดใหม่ได้เสมอ สำเนาจริงอยู่ NAS
-- ============================================================

-- 1) คอลัมน์ประทับตรา
alter table bills add column if not exists nas_saved_at timestamptz;
alter table bills add column if not exists storage_cleaned_at timestamptz;

-- 2) ให้โปรแกรมบน NAS ยืนยันว่าบิลถูกเก็บครบแล้ว (ใช้รหัสลับเดียวกับ nas_export_bills)
create or replace function nas_confirm_saved(p_key text, p_ids bigint[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then
    raise exception 'BAD_KEY';
  end if;
  update bills set nas_saved_at = coalesce(nas_saved_at, now())
    where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function nas_confirm_saved(text, bigint[]) from public;
grant  execute on function nas_confirm_saved(text, bigint[]) to anon, authenticated;

-- 3) ตั้งเวลาเรียกตัวลบทุกคืน 03:30 เวลาไทย (20:30 UTC)
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'storage-cleanup-daily') then
    perform cron.unschedule('storage-cleanup-daily');
  end if;
end $$;
select cron.schedule(
  'storage-cleanup-daily',
  '30 20 * * *',
  $$
  select net.http_post(
    url := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/storage-cleanup',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
    body := '{"run":true}'::jsonb
  );
  $$
);
