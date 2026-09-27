-- ============================================================
--  Mix Fresh 168 — NAS archiver v2: ประหยัดพื้นที่ Supabase + สำรองข้อมูล
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้
--  ⚠️ แก้ 'PASTE_NAS_EXPORT_KEY_HERE' ทั้ง 3 จุดให้เป็นรหัสลับตัวเดียวกับใน mix888-nas-export.sql
-- ============================================================
alter table bills add column if not exists archived_at timestamptz;   -- ลบไฟล์ออกจาก Supabase แล้ว (สำเนาอยู่ NAS)
alter table bills add column if not exists nas_path    text;          -- โฟลเดอร์บน NAS ที่เก็บบิลนี้

-- 1) บันทึกว่าบิลถูกเก็บลง NAS และลบไฟล์ใน Supabase แล้ว (ล้างลิงก์รูปบิล/สลิป)
create or replace function nas_mark_pruned(p_key text, p_bill_id bigint, p_nas_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then raise exception 'BAD_KEY'; end if;
  update bills set image_url = null, page_urls = null, slip_url = null, archived_at = now(), nas_path = p_nas_path where id = p_bill_id;
  update payments set slips = '[]'::jsonb where bill_id = p_bill_id;
end $$;

-- 2) รายชื่อไฟล์ใน bucket (ไว้เก็บสื่อบรอดแคสต์ที่ไม่ได้อ้างในตารางสินค้า)
create or replace function nas_list_objects(p_key text, p_bucket text)
returns jsonb language plpgsql security definer set search_path = public, storage, pg_temp as $$
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then raise exception 'BAD_KEY'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'size', (o.metadata->>'size')::bigint, 'created_at', o.created_at) order by o.created_at)
                     from storage.objects o where o.bucket_id = p_bucket and o.name not like '%/'), '[]'::jsonb);
end $$;

-- 3) สำรองตารางหลักทั้งหมด (CSV/JSON บน NAS ทุก 7 วัน)
create or replace function nas_export_backup(p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb := '{}'::jsonb; t text; part jsonb;
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then raise exception 'BAD_KEY'; end if;
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

-- 4) ให้โปรแกรมบน NAS ลบไฟล์ใน bucket bills / products ได้ (bucket slips เปิดอยู่แล้วเพราะหลังบ้านใช้ลบสลิป)
--    หมายเหตุ: เป็นระดับสิทธิ์เดียวกับที่หลังบ้านใช้อยู่ (anon key) — ไฟล์ต้นฉบับทุกไฟล์มีสำเนาบน NAS ก่อนลบเสมอ
drop policy if exists nas_delete_media on storage.objects;
create policy nas_delete_media on storage.objects for delete to anon, authenticated
  using (bucket_id in ('bills', 'products', 'slips'));
