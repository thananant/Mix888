-- ============================================================
--  Mix Fresh 168 — ให้หน้าสั่งของลูกค้าแยกสินค้าตามหมวด SKU
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ · อ่านอย่างเดียว ไม่แก้ข้อมูลอะไรทั้งสิ้น
--
--  ส่งชื่อหมวด (จากหน้า "หมวดหมู่ SKU" ในหลังบ้าน) ให้หน้าสั่งของ
--  เพื่อจัดกลุ่มสินค้าให้ลูกค้าเลือกง่ายขึ้น
-- ============================================================

create or replace function get_sku_categories(p_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare ok boolean; result jsonb;
begin
  if p_token is null or p_token = '' then return '[]'::jsonb; end if;
  select true into ok from customers
    where (order_token = p_token or slug = p_token) and coalesce(active, true) limit 1;
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'prefix', prefix, 'name', name, 'sort_order', coalesce(sort_order, 999))
      order by coalesce(sort_order, 999), prefix), '[]'::jsonb)
    into result
    from sku_categories
   where coalesce(active, true);
  return result;
end $$;

revoke execute on function get_sku_categories(text) from public;
grant  execute on function get_sku_categories(text) to anon, authenticated;
