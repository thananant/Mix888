-- ============================================================
--  Mix Fresh 168 — ประตูกู้ "ราคาเฉพาะร้าน" คืนจากสำรองข้อมูล NAS
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  ใช้คู่กับโปรแกรม mix888-restore-prices.js ที่รันบน NAS
--  ต้องแนบรหัสลับเดียวกับ nas_export_bills / nas_backup_dump เท่านั้น
--
--  ⚠️ กฎความปลอดภัยของการกู้ (สำคัญ):
--   • คืนเฉพาะรายการที่ "เคยตั้งราคาเอง" ในไฟล์สำรอง แต่ตอนนี้หายไปแล้ว
--     (ไม่มีรายการ หรือกลายเป็นราคากลาง)
--   • ถ้าตอนนี้ร้านนั้นมีราคาเฉพาะร้านอยู่แล้ว "คนละตัวเลข" → ไม่แตะ
--     (อาจเป็นราคาใหม่ที่ตั้งใจตั้ง) แค่รายงานให้ดูเฉย ๆ
--   • ไม่ลบอะไรทั้งสิ้น
-- ============================================================

create or replace function nas_restore_prices(p_key text, p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ent jsonb;
  cid bigint; pid bigint; bp numeric;
  curp numeric; hasrow boolean;
  out_arr jsonb := '[]'::jsonb;
  n_missing int := 0; n_null int := 0; n_same int := 0; n_diff int := 0;
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then
    raise exception 'BAD_KEY';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BAD_ROWS';
  end if;
  -- ให้ประวัติแก้ราคา (mix888-price-log.sql) รู้ว่าการเปลี่ยนรอบนี้มาจากการกู้ข้อมูล
  perform set_config('app.price_source', 'กู้ราคาจากสำรองข้อมูล NAS', true);

  for ent in select * from jsonb_array_elements(p_rows) loop
    cid := nullif(ent->>'customer_id','')::bigint;
    pid := nullif(ent->>'product_id','')::bigint;
    bp  := nullif(ent->>'price','')::numeric;
    -- สนใจเฉพาะรายการที่ในไฟล์สำรอง "ตั้งราคาเอง" ไว้จริง ๆ
    if cid is null or pid is null or bp is null then continue; end if;

    select price into curp from customer_prices
      where customer_id = cid and product_id = pid limit 1;
    hasrow := found;

    if not hasrow then
      n_missing := n_missing + 1;
      if p_apply then
        insert into customer_prices(customer_id, product_id, price) values (cid, pid, bp);
      end if;
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'customer_id', cid, 'product_id', pid, 'now', 'ไม่มีรายการนี้แล้ว', 'restore_to', bp, 'action', 'กู้คืน'));

    elsif curp is null then
      n_null := n_null + 1;
      if p_apply then
        update customer_prices set price = bp where customer_id = cid and product_id = pid;
      end if;
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'customer_id', cid, 'product_id', pid, 'now', 'ถูกเปลี่ยนเป็นราคากลาง', 'restore_to', bp, 'action', 'กู้คืน'));

    elsif abs(curp - bp) > 0.001 then
      n_diff := n_diff + 1;   -- มีราคาเฉพาะร้านอยู่แล้วแต่คนละเลข — อาจตั้งใหม่ทีหลัง ไม่แตะ
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'customer_id', cid, 'product_id', pid, 'now', curp, 'restore_to', bp, 'action', 'ข้าม (มีราคาใหม่อยู่แล้ว)'));

    else
      n_same := n_same + 1;   -- เหมือนเดิม ไม่ต้องทำอะไร
    end if;
  end loop;

  return jsonb_build_object(
    'applied', p_apply,
    'lost_missing', n_missing,      -- รายการที่หายไปเลย
    'lost_to_central', n_null,      -- รายการที่กลายเป็นราคากลาง
    'unchanged', n_same,
    'kept_new_price', n_diff,
    'items', out_arr);
end $$;

revoke execute on function nas_restore_prices(text, jsonb, boolean) from public;
grant  execute on function nas_restore_prices(text, jsonb, boolean) to anon, authenticated;
