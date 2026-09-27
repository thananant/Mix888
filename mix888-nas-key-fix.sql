-- ============================================================
--  Mix Fresh 168 — NAS archiver: ตั้งค่าครบจบในไฟล์เดียว (แทน mix888-nas-export.sql + mix888-nas-archiver-v2.sql)
--  รันใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run · รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  รหัสลับของโปรแกรม NAS เก็บ "ที่เดียว" ในตาราง nas_config (อ่านได้เฉพาะฟังก์ชันหลังบ้าน anon อ่านไม่ได้)
--  ทุกฟังก์ชัน nas_* ตรวจรหัสจากตารางนี้ → ไม่ต้องแก้ตัวเลขในฟังก์ชันอีก
--  รันเสร็จ บรรทัดสุดท้ายจะโชว์ค่า NAS_EXPORT_KEY ให้ก๊อปไปใส่ archiver.config.json
-- ============================================================

-- 0) ตารางเก็บรหัสลับ (แถวเดียว)
create table if not exists nas_config (
  id          int primary key default 1 check (id = 1),
  export_key  text not null,
  updated_at  timestamptz not null default now()
);
alter table nas_config enable row level security;          -- ไม่มี policy = anon/authenticated อ่านไม่ได้ อ่านได้เฉพาะฟังก์ชัน security definer
revoke all on nas_config from anon, authenticated;

-- ใส่รหัสครั้งแรก: ดึงจากฟังก์ชันเดิม (nas_check_key / nas_export_bills) ถ้าเคยใส่ไว้ · ไม่มีก็สุ่มให้ใหม่
do $$
declare k text; def text;
begin
  if exists (select 1 from nas_config where id = 1) then return; end if;
  for def in
    select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('nas_check_key', 'nas_export_bills')
  loop
    k := (regexp_match(def, '<>[[:space:]]*''([^'']+)'''))[1];
    if k is not null and k <> 'PASTE_NAS_EXPORT_KEY_HERE' then exit; end if;
    k := null;
  end loop;
  if k is null then k := encode(gen_random_bytes(18), 'hex'); end if;
  insert into nas_config (id, export_key) values (1, k);
end $$;

-- 1) ตรวจรหัส (ทุกฟังก์ชัน nas_* เรียกตัวนี้) — เทียบแบบตัดช่องว่างหัวท้าย กันก๊อปติดช่องว่าง/ขึ้นบรรทัด
create or replace function nas_check_key(p_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  select export_key into k from nas_config where id = 1;
  if k is null or p_key is null or btrim(p_key) <> btrim(k) then raise exception 'BAD_KEY'; end if;
end $$;

-- 2) ทดสอบการเชื่อมต่อ (โปรแกรม NAS เรียกก่อนเริ่มทุกรอบ — รหัสไม่ตรงจะหยุดทันที ไม่แตะอะไร)
create or replace function nas_ping(p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare nc bigint; np bigint; nb bigint;
begin
  perform nas_check_key(p_key);
  select count(*) into nc from customers;
  select count(*) into np from products;
  select count(*) into nb from bills;
  return jsonb_build_object('ok', true, 'customers', nc, 'products', np, 'bills', nb, 'server_time', now());
end $$;

-- 3) บิล (ตาราง bills ล็อก RLS — เป็นช่องทางเดียวของโปรแกรม NAS)
create or replace function nas_export_bills(p_key text, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform nas_check_key(p_key);
  return coalesce((
    select jsonb_agg(x order by (x->>'created_at'))
      from (
        select jsonb_build_object(
          'id',             b.id,
          'bill_no',        b.bill_no,
          'total',          b.total,
          'shipping_fee',   b.shipping_fee,
          'discount',       b.discount,
          'revision',       b.revision,
          'created_at',     b.created_at,
          'payment_status', b.payment_status,
          'paid_amount',    b.paid_amount,
          'paid_at',        b.paid_at,
          'pay_method',     b.pay_method,
          'ship_status',    b.ship_status,
          'image_url',      b.image_url,
          'page_urls',      b.page_urls,
          'slip_url',       b.slip_url,
          'customers', (select jsonb_build_object('code', c.code, 'name', c.name, 'branch_name', c.branch_name)
                          from customers c where c.id = b.customer_id),
          'orders',    (select jsonb_build_object('order_no', o.order_no)
                          from orders o where o.id = b.order_id),
          'payments',  coalesce((select jsonb_agg(jsonb_build_object(
                                          'amount', p.amount, 'created_at', p.created_at, 'slips', p.slips)
                                        order by p.id)
                                   from payments p where p.bill_id = b.id), '[]'::jsonb)
        ) as x
        from bills b
        where b.created_at >= p_since
      ) s), '[]'::jsonb);
end $$;

-- 4) ส่วนที่เหลือ (ข้อมูลลูกค้า/สินค้า/รายจ่าย · ลบไฟล์บิลที่เก็บแล้ว · รายชื่อไฟล์ · สำรองตาราง · สิทธิ์ storage)
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

-- ============================================================
--  ผลลัพธ์: ค่านี้คือ NAS_EXPORT_KEY — ก๊อปไปใส่ใน archiver.config.json บน NAS ให้ตรงทุกตัวอักษร
-- ============================================================
select export_key as "NAS_EXPORT_KEY (ใส่ใน archiver.config.json)", updated_at from nas_config where id = 1;
