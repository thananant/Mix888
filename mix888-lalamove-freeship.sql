-- ============================================================
--  Mix Fresh 168 — แจ้งยอดขั้นต่ำส่งฟรีในหน้าสั่งของ (เฉพาะลูกค้าส่งแบบ Lalamove)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม · อ่านอย่างเดียว ไม่แก้ข้อมูลอะไรทั้งสิ้น
--
--  หน้าสั่งของจะเรียกฟังก์ชันนี้เพื่อรู้ว่า
--   • ลูกค้ารายนี้ส่งแบบไหน (ถ้าเป็น Lalamove ถึงจะแจ้งเรื่องค่าส่ง)
--   • ยอดขั้นต่ำที่ไม่ต้องเสียค่าส่ง (ค่าเริ่มต้น 5,000)
--
--  อยากเปลี่ยนยอดขั้นต่ำภายหลัง ไม่ต้องแก้โค้ด — รันบรรทัดนี้ใน SQL Editor:
--    insert into settings(key,value) values ('free_ship_min','6000')
--    on conflict (key) do update set value = excluded.value;
-- ============================================================

create or replace function get_customer_delivery(p_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_method text;
  v_min numeric;
begin
  if p_token is null or p_token = '' then return '{}'::jsonb; end if;
  select delivery_method into v_method from customers
    where (order_token = p_token or slug = p_token) and coalesce(active, true)
    limit 1;
  if not found then return '{}'::jsonb; end if;
  begin
    select nullif(value,'')::numeric into v_min from settings where key = 'free_ship_min' limit 1;
  exception when others then v_min := null;
  end;
  return jsonb_build_object('method', coalesce(v_method, ''), 'free_min', coalesce(v_min, 5000));
end $$;

revoke execute on function get_customer_delivery(text) from public;
grant  execute on function get_customer_delivery(text) to anon, authenticated;
