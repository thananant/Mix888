-- ============================================================
--  Mix Fresh 168 — ประตูสำรองข้อมูลทั้งระบบลง NAS (รายวัน)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  โปรแกรม archiver บน NAS จะเรียกฟังก์ชันนี้วันละครั้ง ดึงข้อมูลทุกตาราง
--  (ลูกค้า ราคา ออเดอร์ บิล สต๊อก ฯลฯ) ไปเก็บเป็นไฟล์ในโฟลเดอร์ "สำรองข้อมูล"
--  ต้องแนบรหัสลับเดียวกับ nas_export_bills เท่านั้น · อ่านอย่างเดียว เขียน/ลบไม่ได้
-- ============================================================

create or replace function nas_backup_dump(p_key text, p_table text, p_limit int default 5000, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed constant text[] := array[
    'customers','products','customer_prices','orders','order_items','bills',
    'sales','warehouses','stock','stock_lots','stock_movements','stock_receives',
    'stock_receive_items','transfers','transfer_items','stock_counts','stock_adjustments',
    'conversions','quotations','sku_categories','settings','app_users','summary_log',
    'payments','bill_edit_requests','slip_log','holidays'];
  result jsonb;
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then
    raise exception 'BAD_KEY';
  end if;
  if not (p_table = any(allowed)) then
    raise exception 'BAD_TABLE';
  end if;
  if to_regclass('public.' || p_table) is null then
    return null;   -- ตารางนี้ยังไม่ถูกสร้างในโปรเจกต์ — ให้ฝั่ง NAS ข้ามไป
  end if;
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb)
       from (select * from %I order by 1 limit %s offset %s) t',
    p_table, greatest(1, least(p_limit, 5000)), greatest(0, p_offset)
  ) into result;
  return result;
end $$;
revoke execute on function nas_backup_dump(text, text, int, int) from public;
grant  execute on function nas_backup_dump(text, text, int, int) to anon, authenticated;
