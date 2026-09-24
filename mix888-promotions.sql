-- ============================================================
--  Mix Fresh 168 — ระบบโปรลดราคาตามช่วงเวลา + ตั้งเวลาส่งข้อความ + ราคาโปรมีผลตอนลูกค้าสั่ง
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  ⛔ สำคัญ: ระบบ "ไม่แก้ราคาที่เก็บไว้เอง" — ราคาในหน้าจัดสินค้า (customer_prices / products)
--     เปลี่ยนได้โดยพนักงานเท่านั้น ไฟล์นี้ไม่แตะราคาเหล่านั้นแม้แต่แถวเดียว
--
--  ราคาโปรทำงานอย่างไร (เวอร์ชันนี้):
--  • พนักงานตั้งโปรเอง (สินค้า ราคาโปร ช่วงเวลา ร้านที่ได้) ในหน้าบรอดแคสต์ → โปรลดราคา
--  • ช่วงเวลาโปร หน้าสั่งของของ "ร้านที่อยู่ในโปร" จะเห็นราคาโปร (ขีดราคาปกติ) และสั่งได้ในราคานั้น
--    — ตอนบันทึกออเดอร์ ระบบใช้ราคาโปรแทนราคาปกติ เฉพาะรายการที่โปรถูกกว่า (place_order_v2 ครอบไว้)
--  • หมดเวลา / กดยกเลิก → กลับราคาปกติทันที เพราะราคาที่เก็บไว้ไม่เคยถูกแก้
--  • ส่งข้อความแจ้งโปรตามเวลาที่ตั้งไว้ (promo-runner)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) ตารางโปร
create table if not exists promotions (
  id            bigint generated always as identity primary key,
  product_id    bigint not null,
  product_name  text,
  promo_price   numeric not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  announce_at   timestamptz,            -- เวลาที่ให้ส่งข้อความ (null = เว็บส่งเองตอนบันทึก)
  announced_at  timestamptz,            -- ส่งข้อความไปแล้วเมื่อไร
  apply_price   boolean not null default true,   -- แก้ราคาจริงตามช่วงโปรไหม
  status        text not null default 'scheduled',  -- scheduled / active / done / cancelled
  win_label     text,                   -- ป้ายช่วงเวลาแบบไทย (เว็บสร้างให้ ใช้ในข้อความ)
  note          text,
  customers     jsonb not null default '[]'::jsonb,  -- [{customer_id,code,name,gid,normal,tag,applied,had_row,old_price,sent}]
  created_by    text,
  created_at    timestamptz not null default now()
);
-- โปรหลายสินค้าในชุดเดียว + รูป/วิดีโอแนบ (เวอร์ชันใหม่ — รันซ้ำเพื่อเพิ่มคอลัมน์ให้ตารางเดิม)
alter table promotions add column if not exists batch_id text;            -- แถวที่ batch_id เดียวกัน = โปรชุดเดียวกัน (ลูกค้าได้ข้อความฉบับเดียวรวมทุกสินค้า)
alter table promotions add column if not exists media_url text;           -- ลิงก์รูป/วิดีโอที่แนบ
alter table promotions add column if not exists media_type text;          -- image / video
alter table promotions add column if not exists media_preview_url text;   -- ภาพตัวอย่างของวิดีโอ (LINE บังคับ)
alter table promotions add column if not exists head_text text;           -- ข้อความเปิดของโปร (พนักงานแก้ได้ · ว่าง = ใช้ค่าเริ่มต้น)
create index if not exists promotions_batch_idx on promotions(batch_id);
alter table promotions enable row level security;
drop policy if exists "promo_auth_all" on promotions;
create policy "promo_auth_all" on promotions
  for all to authenticated using (true) with check (true);

-- 2-5) ตัวเดินสถานะโปร — ⛔ ไม่แตะราคาสินค้าใด ๆ ทั้งสิ้น
--      ระบบทำได้แค่เปลี่ยนสถานะโปร (รอเริ่ม → กำลังลด → จบ) เพื่อให้ข้อความตามเวลาทำงาน
--      การลดราคาจริง ต้องให้พนักงานไปตั้งเองในหน้า "จัดสินค้า" เท่านั้น

create or replace function promo_apply(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pr promotions%rowtype;
begin
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status <> 'scheduled' then
    return jsonb_build_object('status', pr.status, 'note', 'โปรไม่ได้อยู่สถานะรอเริ่ม');
  end if;
  update promotions set status = 'active' where id = p_id;
  return jsonb_build_object('status', 'active', 'prices_touched', 0,
    'note', 'ระบบไม่แก้ราคาให้ — พนักงานต้องตั้งราคาเองในหน้าจัดสินค้า');
end $$;

create or replace function promo_revert(p_id bigint, p_final text default 'done') returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pr promotions%rowtype;
begin
  if p_final not in ('done','cancelled') then p_final := 'done'; end if;
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status <> 'active' then
    return jsonb_build_object('status', pr.status, 'note', 'โปรไม่ได้อยู่สถานะกำลังลดราคา');
  end if;
  update promotions set status = p_final where id = p_id;
  return jsonb_build_object('status', p_final, 'prices_touched', 0,
    'note', 'ระบบไม่คืนราคาให้ — พนักงานต้องปรับราคาเองในหน้าจัดสินค้า');
end $$;

create or replace function promo_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pr promotions%rowtype;
begin
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status in ('scheduled','active') then
    update promotions set status = 'cancelled' where id = p_id;
    return jsonb_build_object('cancelled', true, 'prices_touched', 0);
  end if;
  return jsonb_build_object('cancelled', false, 'status', pr.status);
end $$;

create or replace function promo_tick() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update promotions set status = 'active'
    where status = 'scheduled' and starts_at <= now();
  update promotions set status = 'done'
    where status = 'active' and ends_at <= now();
end $$;

-- ปิดสวิตช์ "แก้ราคาจริง" ของโปรทุกใบที่มีอยู่ และกันไม่ให้ตั้งเป็นจริงได้อีก
update promotions set apply_price = false where apply_price;
alter table promotions alter column apply_price set default false;
do $$ begin
  alter table promotions add constraint promotions_no_autoprice check (apply_price = false);
exception when duplicate_object then null; end $$;

-- 6) โปรที่กำลังลดของร้านลูกค้า — หน้าสั่งของใช้โชว์ราคาโปร + ป้ายโปร (ยืนยันตัวตนด้วยลิงก์ประจำร้าน)
--    คืนทุกโปรที่ "อยู่ในช่วงเวลา" และร้านนี้อยู่ในรายชื่อที่พนักงานเลือกไว้
--    (ดูจากเวลาจริง ไม่รอ cron เปลี่ยนสถานะทุก 5 นาที) · สินค้าเดียวมีหลายโปรซ้อน → ใช้ราคาถูกสุด
--    หน้าเว็บจะใช้ราคาโปรก็ต่อเมื่อถูกกว่าราคาปกติของร้านตอนนั้น และตอนบันทึกออเดอร์เช็คซ้ำอีกชั้น (ข้อ 6.2)
create or replace function get_customer_promos(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid bigint; result jsonb;
begin
  if p_token is null or p_token = '' then return '[]'::jsonb; end if;
  select id into cid from customers
    where (order_token = p_token or slug = p_token) and coalesce(active, true) limit 1;
  if cid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', t.product_id,
      'promo_price', t.promo_price,
      'normal', t.normal,
      'ends_at', t.ends_at,
      'win_label', t.win_label)), '[]'::jsonb)
    into result
    from (
      select distinct on (p.product_id)
             p.product_id, p.promo_price,
             (case when ent->>'normal' ~ '^-?[0-9]+\.?[0-9]*$' then (ent->>'normal')::numeric end) as normal,
             p.ends_at, p.win_label
        from promotions p
        -- กันข้อมูล customers รูปแบบผิด (ไม่ใช่ array / id ไม่ใช่ตัวเลข) — แถวเสีย 1 แถวต้องไม่ทำให้ทุกร้านพัง
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(p.customers) = 'array' then p.customers else '[]'::jsonb end) ent
       where p.status in ('scheduled','active')
         and p.promo_price > 0
         and now() >= p.starts_at and now() < p.ends_at
         and (case when ent->>'customer_id' ~ '^[0-9]+$' then (ent->>'customer_id')::bigint end) = cid
       order by p.product_id, p.promo_price asc, p.id desc) t;
  return result;
end $$;
revoke execute on function get_customer_promos(text) from public;
grant execute on function get_customer_promos(text) to anon, authenticated;

-- 6.1) ราคาโปรที่ร้านนี้ได้ "ตอนนี้" สำหรับสินค้าตัวนั้น (null = ไม่มีโปร) — ใช้ตอนบันทึกออเดอร์
create or replace function promo_price_for(p_customer bigint, p_product bigint) returns numeric
language sql stable security definer set search_path = public, pg_temp
as $$
  select min(p.promo_price)
    from promotions p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.customers) = 'array' then p.customers else '[]'::jsonb end) ent
   where p.product_id = p_product
     and p.status in ('scheduled','active')
     and p.promo_price > 0
     and now() >= p.starts_at and now() < p.ends_at
     and (case when ent->>'customer_id' ~ '^[0-9]+$' then (ent->>'customer_id')::bigint end) = p_customer;
$$;
revoke execute on function promo_price_for(bigint, bigint) from public, anon, authenticated;

-- 6.2) ใส่ราคาโปรให้ออเดอร์ที่เพิ่งบันทึก — เฉพาะรายการที่ราคาโปร "ถูกกว่า" ราคาที่คิดไว้
--      แก้แค่ order_items.price ของออเดอร์ใบนี้ + orders.total (ลดลงเท่าส่วนลด)
--      ⛔ ไม่แตะ customer_prices / products แม้แต่แถวเดียว
create or replace function promo_apply_order(p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  o record; r record;
  n int := 0; cut numeric := 0;
  amt_plain boolean;   -- order_items.amount เป็นคอลัมน์ธรรมดา (ไม่ใช่ generated) → ต้องอัปเดตเอง
begin
  select id, customer_id into o from orders where id = p_order_id for update;
  if not found or o.customer_id is null then return jsonb_build_object('changed', 0, 'reduction', 0); end if;
  select (is_generated <> 'ALWAYS') into amt_plain
    from information_schema.columns
   where table_schema = 'public' and table_name = 'order_items' and column_name = 'amount';
  for r in
    select oi.id, oi.qty, oi.price, promo_price_for(o.customer_id, oi.product_id) as promo
      from order_items oi
     where oi.order_id = p_order_id
  loop
    if r.promo is null or r.promo <= 0 or r.price is null or r.promo >= r.price then continue; end if;
    if coalesce(amt_plain, false) then
      update order_items set price = r.promo, amount = r.promo * coalesce(qty, 0) where id = r.id;
    else
      update order_items set price = r.promo where id = r.id;
    end if;
    n := n + 1;
    cut := cut + (r.price - r.promo) * coalesce(r.qty, 0);
  end loop;
  if n > 0 then
    update orders set total = greatest(0, coalesce(total, 0) - cut) where id = p_order_id;
  end if;
  return jsonb_build_object('changed', n, 'reduction', cut);
end $$;
-- เรียกได้เฉพาะจากในฐานข้อมูล (ตัวครอบ place_order_v2) — คนนอก/พนักงานเรียกตรงไม่ได้ กันไปไล่ลดออเดอร์เก่า
revoke execute on function promo_apply_order(bigint) from public, anon, authenticated;

-- 6.3) ครอบ place_order_v2 (ฟังก์ชันรับออเดอร์ของหน้าลูกค้า) ให้ใส่ราคาโปรหลังบันทึก
--      • รันครั้งแรก: เปลี่ยนชื่อของเดิมเป็น place_order_v2_base (ถ้ามีหลายแบบ/overload → _base, _base_2, …
--        คนละชื่อ กันเรียกสลับตัว) แล้วสร้าง place_order_v2 ตัวใหม่ที่รับพารามิเตอร์/คืนค่าชนิดเดิมทุกอย่าง
--        ครบทุกแบบ → หน้าลูกค้าไม่ต้องแก้อะไร
--      • รันซ้ำ: สร้างตัวครอบใหม่แทนของเดิม (ไม่เปลี่ยนชื่อซ้ำ ไม่มีวันเรียกตัวเองวน)
--      • ⭐ ถ้าภายหลังมีการวางฟังก์ชัน place_order_v2 เวอร์ชันใหม่ทับ (ตัวครอบจะหายไป ราคาโปรหยุดทำงาน)
--        แค่รันไฟล์นี้ซ้ำ = กลับมาครอบเวอร์ชันใหม่ให้เอง และลบฐานรุ่นเก่าที่ถูกแทนที่ทิ้ง
--      • แบบที่ไม่คืน json/jsonb / พารามิเตอร์ไม่มีชื่อ / มี OUT-VARIADIC → ปล่อยไว้ตามเดิม (แจ้ง notice)
--      • ถ้าขั้นใส่ราคาโปรพลาด → ออเดอร์ยังบันทึกที่ราคาปกติ ไม่ล้มทั้งใบ (แจ้ง warning ใน log)
do $$
declare
  f record; k int; base_name text; ref_base text;
  n_wrapped int := 0; callargs text; cid_snip text; body text;
begin
  -- 1) เปลี่ยนชื่อของเดิมทุกแบบ (ที่ยังไม่ใช่ตัวครอบ) เป็นชื่อฐานที่ไม่ซ้ำกัน
  for f in
    select p.oid, p.proargnames, p.proargmodes, pg_get_function_result(p.oid) as ret,
           pg_get_function_identity_arguments(p.oid) as idargs, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'place_order_v2' and p.prokind = 'f'
     order by p.oid
  loop
    if position('place_order_v2_base' in f.def) > 0 then
      -- ตัวครอบจากการรันครั้งก่อน → ฐานที่มันเรียกต้องยังอยู่
      ref_base := substring(f.def from '(place_order_v2_base(?:_[0-9]+)?)');
      if not exists (select 1 from pg_proc b join pg_namespace bn on bn.oid = b.pronamespace
                      where bn.nspname = 'public' and b.proname = ref_base) then
        raise exception 'place_order_v2(%) เป็นตัวครอบอยู่แล้ว แต่ไม่พบฟังก์ชันฐาน % — ติดต่อผู้ดูแลระบบ', f.idargs, ref_base;
      end if;
      continue;
    end if;
    if f.ret not in ('json', 'jsonb') or f.proargnames is null or f.proargmodes is not null
       or exists (select 1 from unnest(f.proargnames) a where coalesce(a, '') = '') then
      raise notice 'ข้าม place_order_v2(%) — คืนค่า % / พารามิเตอร์แบบพิเศษหรือไม่มีชื่อ (ครอบเฉพาะแบบธรรมดาที่คืน json/jsonb)', f.idargs, f.ret;
      continue;
    end if;
    k := 1; base_name := 'place_order_v2_base';
    while exists (select 1 from pg_proc b join pg_namespace bn on bn.oid = b.pronamespace
                   where bn.nspname = 'public' and b.proname = base_name) loop
      k := k + 1; base_name := 'place_order_v2_base_' || k;
    end loop;
    execute format('alter function %s rename to %I', f.oid::regprocedure, base_name);
    raise notice 'เปลี่ยนชื่อ place_order_v2(%) → %', f.idargs, base_name;
  end loop;

  -- 1.5) ฐานลายเซ็นซ้ำกัน (เกิดเมื่อมีคนวางฟังก์ชันรับออเดอร์เวอร์ชันใหม่ทับ แล้วรันไฟล์นี้ซ้ำ)
  --      → เก็บเฉพาะตัวใหม่สุด ลบตัวเก่าทิ้ง กัน create ตัวครอบชนกันเองจน error
  for f in
    select q.oid from (
      select p.oid,   -- จับคู่ด้วย "ชนิด" พารามิเตอร์ (ตัวตนจริงของฟังก์ชัน) — ชื่อพารามิเตอร์อาจถูกเปลี่ยนตอน redeploy
             row_number() over (partition by p.proargtypes order by p.oid desc) as rn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname ~ '^place_order_v2_base(_[0-9]+)?$' and p.prokind = 'f') q
     where q.rn > 1
  loop
    raise notice 'ลบฐานรุ่นเก่าที่ถูกวางเวอร์ชันใหม่ทับแล้ว: %', f.oid::regprocedure;
    execute format('drop function %s', f.oid::regprocedure);
  end loop;

  -- 2) สร้างตัวครอบให้ทุกฐาน (ชื่อ/พารามิเตอร์/ค่า default/ชนิดผลลัพธ์เหมือนฐานของมัน)
  for f in
    select p.oid, p.proname, p.proargnames, p.proargmodes,
           pg_get_function_arguments(p.oid) as args,            -- รวมค่า default
           pg_get_function_identity_arguments(p.oid) as idargs,
           pg_get_function_result(p.oid) as ret
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname ~ '^place_order_v2_base(_[0-9]+)?$' and p.prokind = 'f'
     order by p.oid
  loop
    if f.ret not in ('json', 'jsonb') or f.proargnames is null or f.proargmodes is not null then
      raise notice 'ข้ามฐาน %(%) — ครอบไม่ได้ (คืนค่า % / พารามิเตอร์แบบพิเศษ)', f.proname, f.idargs, f.ret;
      continue;
    end if;
    select string_agg(format('%I => %I', a, a), ', ' order by ord) into callargs
      from unnest(f.proargnames) with ordinality as t(a, ord);
    if callargs is null then
      raise notice 'ข้ามฐาน %(%) — ไม่มีชื่อพารามิเตอร์', f.proname, f.idargs;
      continue;
    end if;
    -- หาออเดอร์ที่เพิ่งบันทึกให้แม่น: จำกัดด้วยร้าน (จาก p_token) + เพิ่งสร้างไม่เกิน 1 นาที
    -- กันกรณีเลขออเดอร์ซ้ำข้ามร้าน แล้วไปลดราคาผิดใบ
    cid_snip := case when 'p_token' = any(f.proargnames)
      then 'select id into v_cid from customers where order_token = p_token or slug = p_token limit 1;'
      else 'v_cid := null;' end;
    -- ตัวฐานเรียกผ่านตัวครอบเท่านั้น (กันหน้าเว็บ/คนนอกเรียกข้ามราคาโปร)
    execute format('revoke execute on function %s from public, anon, authenticated', f.oid::regprocedure);
    -- drop แล้วสร้างใหม่ (แทน create or replace) — กันติดกฎห้ามเปลี่ยนชื่อพารามิเตอร์/ค่า default ของตัวครอบเก่า
    execute format('drop function if exists public.place_order_v2(%s)', f.idargs);
    -- search_path มี extensions ด้วย ให้เหมือนตอน Supabase เรียกตรง — ฟังก์ชันฐานที่ใช้ crypt()/uuid ฯลฯ ทำงานเหมือนเดิม
    body := format($f$
create function public.place_order_v2(%s) returns %s
language plpgsql security definer set search_path = public, extensions, pg_temp
as $w$
declare res jsonb; v_no text; v_oid bigint; v_total numeric; ap jsonb; v_cid bigint;
begin
  res := (%I(%s))::jsonb;
  begin
    v_no := res->>'order_no';
    if v_no is not null then
      %s
      select id into v_oid from orders
       where order_no = v_no
         and (v_cid is null or customer_id = v_cid)
         and coalesce(created_at, now()) >= now() - interval '1 minute'
       order by id desc limit 1;
      if v_oid is not null then
        ap := promo_apply_order(v_oid);
        if coalesce((ap->>'changed')::int, 0) > 0 then
          select total into v_total from orders where id = v_oid;
          res := jsonb_set(res, '{total}', to_jsonb(v_total))
                 || jsonb_build_object('promo_items', ap->'changed', 'promo_reduction', ap->'reduction');
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'promo_apply_order %%: %%', v_no, sqlerrm;   -- ราคาโปรพลาด → ออเดอร์ยังอยู่ที่ราคาปกติ
  end;
  return res::%s;
end $w$;$f$, f.args, f.ret, f.proname, callargs, cid_snip, f.ret);
    execute body;
    execute format('revoke execute on function public.place_order_v2(%s) from public', f.idargs);
    execute format('grant execute on function public.place_order_v2(%s) to anon, authenticated', f.idargs);
    n_wrapped := n_wrapped + 1;
  end loop;
  if n_wrapped = 0 then
    raise exception 'ไม่พบฟังก์ชัน place_order_v2 ที่ครอบได้ — ราคาโปรจะยังไม่มีผลตอนลูกค้าสั่ง';
  end if;
  raise notice 'ครอบ place_order_v2 แล้ว % แบบ', n_wrapped;
end $$;
notify pgrst, 'reload schema';

-- 7) รายงานผลโปร — ใครสั่งบ้าง สั่งเท่าไร เทียบช่วงก่อนโปร (สำหรับหน้ารายละเอียดการลดราคา)
create or replace function promo_report(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  pr promotions%rowtype;
  ids bigint[];
  win interval;
  v_during jsonb; v_before jsonb;
begin
  select * into pr from promotions where id = p_id;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  select coalesce(array_agg((e->>'customer_id')::bigint), '{}') into ids
    from jsonb_array_elements(coalesce(pr.customers,'[]'::jsonb)) e;
  win := pr.ends_at - pr.starts_at;
  -- ยอดสั่งสินค้าตัวนี้ของร้านที่ได้โปร "ช่วงโปร" รายร้าน
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_during
    from (select o.customer_id,
                 count(distinct o.id) as orders,
                 sum(oi.qty) as qty,
                 sum(oi.qty * oi.price) as amount
            from orders o join order_items oi on oi.order_id = o.id
           where oi.product_id = pr.product_id
             and o.customer_id = any(ids)
             and o.created_at >= pr.starts_at and o.created_at < pr.ends_at
             and coalesce(o.status,'') <> 'cancelled'
           group by o.customer_id
           order by sum(oi.qty * oi.price) desc) t;
  -- ฐานเทียบ: ช่วงเวลายาวเท่ากัน "ก่อนโปรเริ่ม" (ร้านกลุ่มเดียวกัน สินค้าตัวเดียวกัน)
  select jsonb_build_object(
      'qty',    coalesce(sum(oi.qty), 0),
      'amount', coalesce(sum(oi.qty * oi.price), 0),
      'orders', count(distinct o.id),
      'shops',  count(distinct o.customer_id))
    into v_before
    from orders o join order_items oi on oi.order_id = o.id
   where oi.product_id = pr.product_id
     and o.customer_id = any(ids)
     and o.created_at >= pr.starts_at - win and o.created_at < pr.starts_at
     and coalesce(o.status,'') <> 'cancelled';
  return jsonb_build_object('during', v_during, 'before', v_before);
end $$;
revoke execute on function promo_report(bigint) from public, anon;
grant execute on function promo_report(bigint) to authenticated;

-- 8) ตั้งเวลา: เช็คเริ่ม/จบโปรทุก 5 นาที + ให้ promo-runner ส่งข้อความตามเวลาที่ตั้งไว้
-- ลบงานเก่าชื่อ promo-price-tick ทิ้ง (เวอร์ชันเก่าที่เคยแก้ราคาให้อัตโนมัติ) แล้วตั้งงานใหม่
-- ที่ทำแค่เปลี่ยน "สถานะโปร" อย่างเดียว — ชื่อใหม่บอกชัดว่าไม่ยุ่งกับราคา
do $$ begin perform cron.unschedule('promo-price-tick'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('promo-status-tick'); exception when others then null; end $$;
select cron.schedule('promo-status-tick', '*/5 * * * *', $$select promo_tick()$$);

do $$ begin perform cron.unschedule('promo-announce'); exception when others then null; end $$;
select cron.schedule('promo-announce', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/promo-runner',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
    body    := '{"run":true}'::jsonb)
$$);

-- 9) สรุปผล (ตารางที่โชว์หลังรัน): ต้องเห็น place_order_v2 = "ตัวครอบ (ราคาโปรมีผล)" คู่กับฐาน place_order_v2_base…
select p.proname as "ฟังก์ชัน",
       pg_get_function_identity_arguments(p.oid) as "พารามิเตอร์",
       pg_get_function_result(p.oid) as "คืนค่า",
       case when p.proname = 'place_order_v2' and position('place_order_v2_base' in pg_get_functiondef(p.oid)) > 0 then '✅ ตัวครอบ (ราคาโปรมีผลตอนสั่ง)'
            when p.proname = 'place_order_v2' then '⚠️ ยังไม่ได้ครอบ (ดู notice ด้านบน)'
            else 'ฐานเดิม (เรียกผ่านตัวครอบเท่านั้น)' end as "สถานะ"
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname ~ '^place_order_v2(_base(_[0-9]+)?)?$'
 order by p.proname, 2;
