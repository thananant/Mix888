-- ============================================================
--  Mix Fresh 168 — NAS archiver v2: ส่งออกข้อมูลลูกค้า/สินค้า/รายจ่าย · ประหยัดพื้นที่ Supabase · สำรองข้อมูล
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
--  ⚠️ แก้รหัสลับ "จุดเดียว" ในฟังก์ชัน nas_check_key ด้านล่าง ให้ตรงกับที่ใช้ใน mix888-nas-export.sql / archiver.config.json
-- ============================================================
create or replace function nas_check_key(p_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then raise exception 'BAD_KEY'; end if;   -- ← แก้ตรงนี้จุดเดียว
end $$;

alter table bills add column if not exists archived_at timestamptz;   -- ลบไฟล์ออกจาก Supabase แล้ว (สำเนาอยู่ NAS)
alter table bills add column if not exists nas_path    text;          -- โฟลเดอร์บน NAS ที่เก็บบิลนี้

-- 1) ข้อมูลที่โปรแกรม NAS ใช้เก็บ "ข้อมูลลูกค้า / สื่อสินค้า / รายจ่าย / ใบวางบิล" (ตารางเหล่านี้อ่านตรงด้วย key ของ NAS ไม่ได้)
create or replace function nas_export_data(p_key text, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb := '{}'::jsonb; t text; part jsonb; q text;
begin
  perform nas_check_key(p_key);
  foreach t in array array['customers','products','customer_prices','price_log','line_groups','credit_docs','petty_cash','expense_categories','credit_statements'] loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x', t) into part;
    exception when undefined_table then part := '[]'::jsonb;
    end;
    r := r || jsonb_build_object(t, part);
  end loop;
  -- ออเดอร์พร้อมรายการสินค้า (ย้อนหลังตาม p_since)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'customer_id', o.customer_id, 'created_at', o.created_at, 'status', o.status,
      'total', o.total, 'created_by', o.created_by,
      'order_items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'price', i.price, 'amount', i.amount))
                               from order_items i where i.order_id = o.id), '[]'::jsonb)) order by o.created_at), '[]'::jsonb)
      into part from orders o where o.created_at >= coalesce(p_since, now() - interval '730 days');
  exception when undefined_table then part := '[]'::jsonb;
  end;
  return r || jsonb_build_object('orders', part);
end $$;

-- 2) บันทึกว่าบิลถูกเก็บลง NAS และลบไฟล์ใน Supabase แล้ว (ล้างลิงก์รูปบิล/สลิป)
create or replace function nas_mark_pruned(p_key text, p_bill_id bigint, p_nas_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform nas_check_key(p_key);
  -- ใช้ค่าว่างแทน null (บางคอลัมน์ตั้ง not null ไว้) — หลังบ้านถือว่า '' = ไม่มีรูป เหมือน null
  update bills set image_url = '', page_urls = '[]'::jsonb, slip_url = '', archived_at = now(), nas_path = p_nas_path where id = p_bill_id;
  update payments set slips = '[]'::jsonb where bill_id = p_bill_id;
end $$;

-- 3) รายชื่อไฟล์ใน bucket (ไว้เก็บสื่อบรอดแคสต์ที่ไม่ได้อ้างในตารางสินค้า)
create or replace function nas_list_objects(p_key text, p_bucket text)
returns jsonb language plpgsql security definer set search_path = public, storage, pg_temp as $$
begin
  perform nas_check_key(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) order by o.created_at)
                     from storage.objects o where o.bucket_id = p_bucket and o.name not like '%/'), '[]'::jsonb);
end $$;

-- 4) สำรองตาราง ทีละตาราง ทีละหน้า (กัน statement timeout)
create or replace function nas_export_table(p_key text, p_table text, p_offset int default 0, p_limit int default 2000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare part jsonb;
begin
  perform nas_check_key(p_key);
  if p_table !~ '^[a-z_]+$' then raise exception 'BAD_TABLE'; end if;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from %I order by 1 offset %s limit %s) x', p_table, p_offset, p_limit) into part;
  exception when undefined_table then part := '[]'::jsonb;
  end;
  return part;
end $$;

-- 4b) (แบบเดิม — ตารางใหญ่จะ timeout ใช้ 4 แทน)
create or replace function nas_export_backup(p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb := '{}'::jsonb; t text; part jsonb;
begin
  perform nas_check_key(p_key);
  foreach t in array array['customers','products','sales','orders','order_items','bills','payments','petty_cash','expense_categories',
                           'customer_prices','warehouses','settings','sale_comp','sale_pay_adj','credit_statements','credit_docs','credit_reviews','line_groups','price_log','price_adjust_batches','holidays'] loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x', t) into part;
    exception when undefined_table then part := '[]'::jsonb;
    end;
    r := r || jsonb_build_object(t, part);
  end loop;
  return r;
end $$;

-- 5) ให้โปรแกรมบน NAS ลบไฟล์ใน bucket bills / products ได้ (bucket slips เปิดอยู่แล้วเพราะหลังบ้านใช้ลบสลิป)
--    หมายเหตุ: เป็นระดับสิทธิ์เดียวกับที่หลังบ้านใช้อยู่ (anon key) — ไฟล์ต้นฉบับทุกไฟล์มีสำเนาบน NAS ก่อนลบเสมอ
-- 6) ให้โปรแกรมบน NAS อัปโหลดไฟล์กลับ bucket products ได้ (โหมดกู้คืน --restore-media)
drop policy if exists nas_upload_media on storage.objects;
create policy nas_upload_media on storage.objects for insert to anon, authenticated with check (bucket_id in ('products'));
drop policy if exists nas_update_media on storage.objects;
create policy nas_update_media on storage.objects for update to anon, authenticated using (bucket_id in ('products')) with check (bucket_id in ('products'));

drop policy if exists nas_delete_media on storage.objects;
create policy nas_delete_media on storage.objects for delete to anon, authenticated
  using (bucket_id in ('bills', 'products', 'slips'));
