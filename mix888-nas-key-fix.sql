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

-- 2) บันทึกว่าบิลถูกเก็บลง NAS (ล้างลิงก์รูปบิล/สลิปของบิลนี้) → คืนรายชื่อไฟล์ที่ "ลบได้จริง"
--    สลิปใบเดียวอาจใช้จ่ายหลายบิล (โอนรวม) — ไฟล์ที่ยังถูกบิล/การชำระ/ใบวางบิล/รายจ่ายอื่นอ้างอยู่ ห้ามลบ (คืนเป็น shared)
drop function if exists nas_mark_pruned(text, bigint, text);
create or replace function nas_mark_pruned(p_key text, p_bill_id bigint, p_nas_path text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_urls text[]; v_safe jsonb := '[]'::jsonb; v_shared jsonb := '[]'::jsonb; u text; used boolean;
begin
  perform nas_check_key(p_key);
  select array_agg(distinct x) into v_urls from (
    select image_url as x from bills where id = p_bill_id
    union all select slip_url from bills where id = p_bill_id
    union all select jsonb_array_elements_text(case when jsonb_typeof(page_urls) = 'array' then page_urls else '[]'::jsonb end) from bills where id = p_bill_id
    union all select jsonb_array_elements_text(case when jsonb_typeof(slips) = 'array' then slips else '[]'::jsonb end) from payments where bill_id = p_bill_id
  ) t where coalesce(x, '') <> '';
  -- ใช้ค่าว่างแทน null (บางคอลัมน์ตั้ง not null ไว้) — หลังบ้านถือว่า '' = ไม่มีรูป เหมือน null
  update bills set image_url = '', page_urls = '[]'::jsonb, slip_url = '', archived_at = now(), nas_path = p_nas_path where id = p_bill_id;
  update payments set slips = '[]'::jsonb where bill_id = p_bill_id;
  foreach u in array coalesce(v_urls, '{}'::text[]) loop
    used := exists (select 1 from bills where image_url = u or slip_url = u
                     or (jsonb_typeof(page_urls) = 'array' and page_urls @> jsonb_build_array(u)))
         or exists (select 1 from payments where jsonb_typeof(slips) = 'array' and slips @> jsonb_build_array(u));
    begin used := used or exists (select 1 from petty_cash where receipt_url = u);
    exception when undefined_table or undefined_column then null; end;
    begin used := used or exists (select 1 from credit_statements where image_url = u);
    exception when undefined_table or undefined_column then null; end;
    if used then v_shared := v_shared || to_jsonb(u); else v_safe := v_safe || to_jsonb(u); end if;
  end loop;
  return jsonb_build_object('safe', v_safe, 'shared', v_shared);
end $$;

-- 2b) กู้บิลจาก NAS กลับเข้าระบบ — โปรแกรม NAS (--restore-bill) อัปโหลดรูปบิล/สลิปกลับ bucket แล้วเรียกตัวนี้ใส่ลิงก์คืน
--     กู้ได้เฉพาะบิลที่โปรแกรม NAS เคยเก็บแทน Supabase (archived_at) — บิลอื่นใช้ 📎 แนบสลิปแทน ในหลังบ้านทีละใบ
--     p_slips แบบใหม่ = [[สลิปของการชำระครั้งที่ 1], [ครั้งที่ 2], …] ตามที่จดไว้ตอนเก็บ → คืนตรงครั้งเดิมทุกใบ
--     p_slips แบบเก่า = [สลิป, …] (บิลที่เก็บก่อนมีการจด) → จำนวนเท่ากันใบละครั้ง ไม่เท่าใส่ครั้งแรก · ใส่เฉพาะครั้งที่ยังว่าง
drop function if exists nas_restore_bill(text, text, text, jsonb);
create or replace function nas_restore_bill(p_key text, p_bill_no text, p_image_url text, p_slips jsonb, p_bill_slip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_arch timestamptz; v_slips jsonb := coalesce(p_slips, '[]'::jsonb); n int := 0; c int; pid bigint; i int := 0; cnt int := 0; v_layout boolean;
begin
  perform nas_check_key(p_key);
  if jsonb_typeof(v_slips) <> 'array' then v_slips := '[]'::jsonb; end if;
  select id, archived_at into v_id, v_arch from bills where bill_no = p_bill_no;
  if v_id is null then raise exception 'NO_BILL'; end if;
  if v_arch is null then raise exception 'NOT_ARCHIVED'; end if;
  v_layout := jsonb_array_length(v_slips) > 0 and jsonb_typeof(v_slips->0) = 'array';
  begin
    select count(*) into cnt from payments where bill_id = v_id;
    if v_layout then
      if cnt <> jsonb_array_length(v_slips) then raise exception 'LAYOUT_MISMATCH'; end if;
      for pid in select id from payments where bill_id = v_id order by id loop
        update payments set slips = v_slips->i
         where id = pid and (slips is null or jsonb_typeof(slips) <> 'array' or jsonb_array_length(slips) = 0)
           and jsonb_array_length(v_slips->i) > 0;
        get diagnostics c = row_count; n := n + c; i := i + 1;
      end loop;
    elsif cnt > 0 and jsonb_array_length(v_slips) > 0 then
      if cnt = jsonb_array_length(v_slips) then
        for pid in select id from payments where bill_id = v_id order by id loop
          update payments set slips = jsonb_build_array(v_slips->i)
           where id = pid and (slips is null or jsonb_typeof(slips) <> 'array' or jsonb_array_length(slips) = 0);
          get diagnostics c = row_count; n := n + c; i := i + 1;
        end loop;
      else
        update payments set slips = v_slips
         where id = (select id from payments where bill_id = v_id order by id limit 1)
           and (slips is null or jsonb_typeof(slips) <> 'array' or jsonb_array_length(slips) = 0);
        get diagnostics c = row_count; n := n + c;
      end if;
    end if;
  exception when undefined_table then n := 0;   -- ยังไม่มีตาราง payments ก็ข้าม
  end;
  update bills
     set image_url   = coalesce(nullif(p_image_url, ''), image_url),
         slip_url    = coalesce(nullif(p_bill_slip, ''),
                                case when not v_layout and jsonb_array_length(v_slips) > 0 then v_slips->>0 end,
                                slip_url),
         archived_at = null                     -- กลับมามีไฟล์ใน Supabase แล้ว (nas_path คงไว้ — สำเนาบน NAS ยังอยู่)
   where id = v_id;
  return jsonb_build_object('bill_id', v_id, 'payments_updated', n);
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
-- 6) ให้โปรแกรมบน NAS อัปโหลดไฟล์กลับได้: bucket products (--restore-media) และ bills / slips (--restore-bill)
--    (หลังบ้านอัปโหลดเข้า bills/slips อยู่แล้วด้วยสิทธิ์เดียวกัน — ไม่ได้เปิดอะไรใหม่ที่หลังบ้านทำไม่ได้)
drop policy if exists nas_upload_media on storage.objects;
create policy nas_upload_media on storage.objects for insert to anon, authenticated with check (bucket_id in ('products', 'bills', 'slips'));
drop policy if exists nas_update_media on storage.objects;
create policy nas_update_media on storage.objects for update to anon, authenticated using (bucket_id in ('products', 'bills', 'slips')) with check (bucket_id in ('products', 'bills', 'slips'));

drop policy if exists nas_delete_media on storage.objects;
create policy nas_delete_media on storage.objects for delete to anon, authenticated
  using (bucket_id in ('bills', 'products', 'slips'));

-- 7) ตรวจการสำรอง: ไฟล์ที่ "สำรองไม่ได้" → แจ้งกลุ่มรีพอร์ต + ไม่ลบออกจาก Supabase จนกว่าจะมีสำเนาครบ
--    โปรแกรม NAS ส่งรายการทุกรอบ · แจ้งไลน์ครั้งเดียวต่อไฟล์ · ถ้าโปรแกรม NAS ส่งไลน์เองไม่ได้ หลังบ้านที่เปิดอยู่จะส่งแทน
create table if not exists nas_issues (
  id            bigserial primary key,
  kind          text not null,                 -- slip / bill / receipt / doc / statement / product
  ref           text,                          -- เลขบิล / รหัสลูกค้า / รายการ
  file_url      text not null unique,
  reason        text not null,                 -- gone = ไม่มีทั้งใน Supabase และ NAS แล้ว · error = โหลดไม่ได้ (อาจชั่วคราว)
  detail        text,
  fail_count    int not null default 1,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  notified_at   timestamptz,
  notified_by   text,
  resolved_at   timestamptz,
  resolved_note text
);
alter table nas_issues add column if not exists accepted_at timestamptz;   -- กด "ช่างมัน" แล้ว (ยอมรับว่าหายถาวร) → ไม่เปิดเรื่อง/ไม่แจ้งไฟล์นี้อีก
alter table nas_issues add column if not exists accepted_by text;
alter table nas_issues enable row level security;
revoke all on nas_issues from anon;
grant select on nas_issues to authenticated;
drop policy if exists nas_issues_read on nas_issues;
create policy nas_issues_read on nas_issues for select to authenticated using (true);

-- 7a) โปรแกรม NAS ส่งรายการที่สำรองไม่ได้ / ที่กลับมาสำรองได้แล้ว → คืนรายการที่ต้องแจ้งไลน์ตอนนี้ (จองไว้ให้แล้ว กันส่งซ้ำ)
--     p_full_kinds = ประเภทที่รอบนี้ "ตรวจครบทุกไฟล์" → เรื่องเก่าของประเภทนั้นที่ไม่เจอแล้ว (เช่น แนบสลิปใหม่แทน) ปิดให้เอง
create or replace function nas_report_issues(p_key text, p_items jsonb, p_ok_urls jsonb default '[]'::jsonb, p_full_kinds jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb; v_items jsonb := coalesce(p_items, '[]'::jsonb); v_notify jsonb;
begin
  perform nas_check_key(p_key);
  if jsonb_typeof(v_items) <> 'array' then v_items := '[]'::jsonb; end if;
  update nas_issues set resolved_at = now(), resolved_note = 'สำรองได้แล้ว'
   where resolved_at is null
     and file_url in (select jsonb_array_elements_text(case when jsonb_typeof(p_ok_urls) = 'array' then p_ok_urls else '[]'::jsonb end));
  if jsonb_typeof(p_full_kinds) = 'array' and jsonb_array_length(p_full_kinds) > 0 then
    update nas_issues set resolved_at = now(), resolved_note = 'ไม่พบปัญหาแล้วในรอบตรวจเต็ม'
     where resolved_at is null
       and kind in (select jsonb_array_elements_text(p_full_kinds))
       and not exists (select 1 from jsonb_array_elements(v_items) x where x->>'url' = nas_issues.file_url);
  end if;
  for it in select * from jsonb_array_elements(v_items) loop
    continue when coalesce(it->>'url', '') = '';
    insert into nas_issues (kind, ref, file_url, reason, detail)
    values (coalesce(it->>'kind', 'file'), it->>'ref', it->>'url', coalesce(it->>'reason', 'error'), left(it->>'detail', 300))
    on conflict (file_url) do update set
      kind        = excluded.kind,
      ref         = excluded.ref,
      reason      = excluded.reason,
      detail      = excluded.detail,
      fail_count  = case when nas_issues.resolved_at is null then nas_issues.fail_count + 1 else 1 end,
      first_seen  = case when nas_issues.resolved_at is null then nas_issues.first_seen else now() end,
      notified_at = case when nas_issues.resolved_at is null then nas_issues.notified_at else null end,
      notified_by = case when nas_issues.resolved_at is null then nas_issues.notified_by else null end,
      last_seen   = now(),
      resolved_at = null, resolved_note = null
    where nas_issues.accepted_at is null;                -- กด "ช่างมัน" แล้ว = ไม่เปิดเรื่องใหม่ ไม่แจ้งซ้ำ (โปรแกรม NAS รุ่นเก่าที่ยังส่งมาก็ไม่มีผล)
  end loop;
  -- จองรายการที่ถึงเวลาแจ้ง: หายถาวร (gone) แจ้งทันที · โหลดไม่ได้ (error) แจ้งเมื่อพลาดติดกัน 3 รอบ
  -- (จองค้าง "กำลังส่ง" เกิน 1 ชั่วโมง = โปรแกรม/เบราว์เซอร์ดับกลางทาง → จองใหม่ได้ ไม่ค้างเงียบตลอดไป)
  with c as (
    select id from nas_issues
     where resolved_at is null and (reason <> 'error' or fail_count >= 3)
       and (notified_at is null or (notified_by in ('nas-sending', 'web-sending') and notified_at < now() - interval '1 hour'))
     order by id for update skip locked),
  u as (
    update nas_issues i set notified_at = now(), notified_by = 'nas-sending' from c where i.id = c.id returning i.*)
  select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) into v_notify from u;
  return jsonb_build_object(
    'notify', v_notify,
    'open', (select count(*) from nas_issues where resolved_at is null),
    'report_group', (select value from settings where key = 'line_report_group' limit 1));
end $$;

-- 7b) ผลการส่งไลน์ของโปรแกรม NAS: ส่งได้ = จบ · ส่งไม่ได้ = ปล่อยคืน ให้หลังบ้านส่งแทน
create or replace function nas_notify_result(p_key text, p_ids jsonb, p_ok boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform nas_check_key(p_key);
  update nas_issues
     set notified_at = case when p_ok then notified_at else null end,
         notified_by = case when p_ok then 'nas' else null end
   where notified_by = 'nas-sending'
     and id in (select (jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end))::bigint);
end $$;

-- 7c) กู้ไฟล์จาก NAS กลับขึ้น Supabase แล้ว (ชื่อไฟล์ใหม่) → เปลี่ยนลิงก์ทุกจุดที่อ้างไฟล์เดิม
create or replace function nas_relink(p_key text, p_old text, p_new text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; c int;
begin
  perform nas_check_key(p_key);
  if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' or p_old = p_new then return 0; end if;
  update bills set image_url = p_new where image_url = p_old; get diagnostics c = row_count; n := n + c;
  update bills set slip_url  = p_new where slip_url  = p_old; get diagnostics c = row_count; n := n + c;
  update bills set page_urls = (select jsonb_agg(case when e = to_jsonb(p_old) then to_jsonb(p_new) else e end order by o)
                                  from jsonb_array_elements(page_urls) with ordinality t(e, o))
   where jsonb_typeof(page_urls) = 'array' and page_urls @> jsonb_build_array(p_old);
  get diagnostics c = row_count; n := n + c;
  begin
    update payments set slips = (select jsonb_agg(case when e = to_jsonb(p_old) then to_jsonb(p_new) else e end order by o)
                                   from jsonb_array_elements(slips) with ordinality t(e, o))
     where jsonb_typeof(slips) = 'array' and slips @> jsonb_build_array(p_old);
    get diagnostics c = row_count; n := n + c;
  exception when undefined_table then null;
  end;
  begin update slip_log set image_path = p_new where image_path = p_old; get diagnostics c = row_count; n := n + c;
  exception when undefined_table or undefined_column then null; end;
  begin update petty_cash set receipt_url = p_new where receipt_url = p_old; get diagnostics c = row_count; n := n + c;
  exception when undefined_table or undefined_column then null; end;
  update nas_issues set resolved_at = now(), resolved_note = 'กู้จาก NAS อัตโนมัติ' where file_url = p_old and resolved_at is null;
  return n;
end $$;

-- 7d) หลังบ้านช่วยส่งไลน์แทน (กรณีโปรแกรม NAS ส่งเองไม่ได้) — ต้องล็อกอินเท่านั้น
create or replace function nas_issues_claim()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  with c as (
    select id from nas_issues
     where resolved_at is null and (reason <> 'error' or fail_count >= 3)
       and (notified_at is null or (notified_by in ('nas-sending', 'web-sending') and notified_at < now() - interval '1 hour'))
     order by id for update skip locked),
  u as (
    update nas_issues i set notified_at = now(), notified_by = 'web-sending' from c where i.id = c.id returning i.*)
  select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) into r from u;
  return r;
end $$;
-- ผลการส่งไลน์จากหลังบ้าน: ส่งได้ (p_ok) = จบ · ส่งไม่ได้ = ปล่อยคืนให้รอบหน้า
drop function if exists nas_issues_unclaim(bigint[]);
create or replace function nas_issues_unclaim(p_ids bigint[], p_ok boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update nas_issues
     set notified_at = case when p_ok then notified_at else null end,
         notified_by = case when p_ok then 'web' else null end
   where notified_by = 'web-sending' and id = any(p_ids);
end $$;
-- 7e) หลังบ้านแนบสลิปแทนไฟล์ที่หาย → ปิดเรื่องของไฟล์เดิม
create or replace function nas_issues_resolve_url(p_url text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update nas_issues set resolved_at = now(), resolved_note = left(coalesce(p_note, 'แก้จากหลังบ้าน'), 200)
   where file_url = p_url and resolved_at is null;
end $$;
-- 7f) "ช่างมัน" — ไฟล์ที่หายถาวร (หาสลิปไม่ได้แล้ว / ไม่ต้องการแล้ว) → ปิดเรื่องถาวร
--     ต่างจาก 7e: 7e ปิดชั่วคราว (ยังหายอยู่ รอบตรวจหน้าเปิดใหม่) · 7f ไม่เปิดเรื่อง/ไม่แจ้งไลน์ไฟล์นี้อีก
--     โปรแกรม NAS อ่านรายการนี้ (nas_accepted_urls) → ไม่นับเป็นปัญหา · บิลที่เหลือไฟล์นี้ไฟล์เดียว เก็บเข้าคลัง NAS ได้ตามปกติ
--     เฉพาะ gone / nas_unverified — โหลดไม่ได้ชั่วคราว (error) ช่างมันไม่ได้ (อาจเป็นเน็ต/เซิร์ฟเวอร์ ไฟล์ยังอยู่)
create or replace function nas_issues_accept(p_url text, p_note text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update nas_issues
     set accepted_at   = now(),
         accepted_by   = left(coalesce(p_note, ''), 200),
         resolved_at   = coalesce(resolved_at, now()),
         resolved_note = left('ช่างมัน (ไม่ต้องตามแล้ว)' || coalesce(' · ' || nullif(p_note, ''), ''), 200)
   where file_url = p_url and accepted_at is null and reason in ('gone', 'nas_unverified');
  get diagnostics n = row_count;
  -- จดในประวัติการชำระด้วย (หลังบิลเก็บเข้าคลัง ลิงก์สลิปถูกล้าง — หน้าประวัติชำระจะรู้ว่าใบนี้หายถาวร ไม่ใช่ "เก็บที่ NAS")
  if n > 0 then
    begin
      update payments set note = concat_ws(' · ', nullif(note, ''), '🙈 สลิปหายถาวร (ช่างมัน)' || coalesce(' ' || nullif(p_note, ''), ''))
       where jsonb_typeof(slips) = 'array' and slips @> jsonb_build_array(p_url)
         and coalesce(note, '') not like '%🙈 สลิปหายถาวร%';
    exception when undefined_table or undefined_column then null;
    end;
  end if;
  return n;
end $$;
create or replace function nas_accepted_urls(p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform nas_check_key(p_key);
  return coalesce((select jsonb_agg(file_url order by id) from nas_issues where accepted_at is not null), '[]'::jsonb);
end $$;
revoke execute on function nas_issues_claim() from public, anon;
revoke execute on function nas_issues_unclaim(bigint[], boolean) from public, anon;
revoke execute on function nas_issues_resolve_url(text, text) from public, anon;
revoke execute on function nas_issues_accept(text, text) from public, anon;
grant execute on function nas_issues_claim() to authenticated;
grant execute on function nas_issues_unclaim(bigint[], boolean) to authenticated;
grant execute on function nas_issues_resolve_url(text, text) to authenticated;
grant execute on function nas_issues_accept(text, text) to authenticated;

-- ============================================================
--  ผลลัพธ์: ค่านี้คือ NAS_EXPORT_KEY — ก๊อปไปใส่ใน archiver.config.json บน NAS ให้ตรงทุกตัวอักษร
-- ============================================================
select export_key as "NAS_EXPORT_KEY (ใส่ใน archiver.config.json)", updated_at from nas_config where id = 1;
