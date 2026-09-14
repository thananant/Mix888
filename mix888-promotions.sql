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
             p.product_id, p.promo_price, nullif(ent->>'normal','')::numeric as normal, p.ends_at, p.win_label
        from promotions p
        cross join lateral jsonb_array_elements(coalesce(p.customers,'[]'::jsonb)) ent
       where p.status in ('scheduled','active')
         and now() >= p.starts_at and now() < p.ends_at
         and nullif(ent->>'customer_id','')::bigint = cid
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
    cross join lateral jsonb_array_elements(coalesce(p.customers,'[]'::jsonb)) ent
   where p.product_id = p_product
     and p.status in ('scheduled','active')
     and now() >= p.starts_at and now() < p.ends_at
     and nullif(ent->>'customer_id','')::bigint = p_customer;
$$;
revoke execute on function promo_price_for(bigint, bigint) from public, anon;

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
    if r.promo is null or r.promo < 0 or r.price is null or r.promo >= r.price then continue; end if;
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
revoke execute on function promo_apply_order(bigint) from public, anon;

-- 6.3) ครอบ place_order_v2 (ฟังก์ชันรับออเดอร์ของหน้าลูกค้า) ให้ใส่ราคาโปรหลังบันทึก
--      • รันครั้งแรก: เปลี่ยนชื่อของเดิมเป็น place_order_v2_base แล้วสร้าง place_order_v2 ตัวใหม่
--        ที่รับพารามิเตอร์/คืนค่าชนิดเดิมทุกอย่าง → หน้าลูกค้าไม่ต้องแก้อะไร
--      • รันซ้ำ: สร้างตัวครอบทับของเดิม (ไม่เปลี่ยนชื่อซ้ำ ไม่มีวันเรียกตัวเองวน)
--      • ถ้าขั้นใส่ราคาโปรพลาด → ออเดอร์ยังบันทึกที่ราคาปกติ ไม่ล้มทั้งใบ (แจ้ง warning ใน log)
do $$
declare
  base_oid oid; n int;
  args text; idargs text; ret text; callargs text; body text;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_order_v2_base';
  if n > 1 then raise exception 'พบ place_order_v2_base มากกว่า 1 ตัว — ติดต่อผู้ดูแลระบบ'; end if;
  if n = 0 then
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'place_order_v2';
    if n = 0 then raise exception 'ไม่พบฟังก์ชัน place_order_v2 ในฐานข้อมูล — ราคาโปรจะยังไม่มีผลตอนลูกค้าสั่ง'; end if;
    if n > 1 then raise exception 'พบ place_order_v2 มากกว่า 1 ตัว (overload) — ติดต่อผู้ดูแลระบบ'; end if;
    select p.oid into base_oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'place_order_v2';
    if position('place_order_v2_base' in pg_get_functiondef(base_oid)) > 0 then
      raise exception 'place_order_v2 ปัจจุบันเป็นตัวครอบอยู่แล้ว แต่ไม่พบ place_order_v2_base — ติดต่อผู้ดูแลระบบ';
    end if;
    execute format('alter function %s rename to place_order_v2_base', base_oid::regprocedure);
  end if;
  select p.oid into base_oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_order_v2_base';
  args   := pg_get_function_arguments(base_oid);            -- รวมค่า default
  idargs := pg_get_function_identity_arguments(base_oid);
  ret    := pg_get_function_result(base_oid);
  if ret not in ('json', 'jsonb') then
    raise exception 'place_order_v2 คืนค่าชนิด % (คาดว่า json/jsonb) — ติดต่อผู้ดูแลระบบ', ret;
  end if;
  select string_agg(format('%I => %I', a, a), ', ' order by ord) into callargs
    from unnest((select proargnames from pg_proc where oid = base_oid)) with ordinality as t(a, ord);
  if callargs is null then raise exception 'place_order_v2 ไม่มีชื่อพารามิเตอร์ — ติดต่อผู้ดูแลระบบ'; end if;
  -- ตัวฐานเรียกผ่านตัวครอบเท่านั้น (กันหน้าเว็บ/คนนอกเรียกข้ามราคาโปร)
  execute format('revoke execute on function %s from public, anon, authenticated', base_oid::regprocedure);
  body := format($f$
create or replace function public.place_order_v2(%s) returns %s
language plpgsql security definer set search_path = public, pg_temp
as $w$
declare res jsonb; v_no text; v_oid bigint; v_total numeric; ap jsonb;
begin
  res := (place_order_v2_base(%s))::jsonb;
  begin
    v_no := res->>'order_no';
    if v_no is not null then
      select id into v_oid from orders where order_no = v_no order by id desc limit 1;
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
end $w$;$f$, args, ret, callargs, ret);
  execute body;
  execute format('revoke execute on function public.place_order_v2(%s) from public', idargs);
  execute format('grant execute on function public.place_order_v2(%s) to anon, authenticated', idargs);
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
