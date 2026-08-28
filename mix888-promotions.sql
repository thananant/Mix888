-- ============================================================
--  Mix Fresh 168 — ระบบโปรลดราคาตามช่วงเวลา + ตั้งเวลาส่งข้อความ
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  ⛔ สำคัญ: ระบบ "ไม่แก้ราคาสินค้าเองเด็ดขาด" — การเปลี่ยนราคาทำได้โดยพนักงานเท่านั้น
--     (หน้าจัดสินค้า) ไฟล์นี้ปิดความสามารถแก้ราคาอัตโนมัติของระบบโปรทั้งหมด
--
--  ทำอะไรบ้าง:
--  • ตาราง promotions เก็บโปรที่ตั้งไว้ (สินค้า ราคาโปร ช่วงเวลา รายชื่อร้าน)
--  • ถึงเวลา → เปลี่ยน "สถานะโปร" เท่านั้น (รอเริ่ม → กำลังลด → จบ) ไม่แตะราคาใด ๆ
--  • ส่งข้อความแจ้งโปรตามเวลาที่ตั้งไว้ (promo-runner)
--  • ป้ายโปรในหน้าลูกค้า จะขึ้นก็ต่อเมื่อ "ราคาจริงของร้านนั้นลดแล้ว" เท่านั้น ไม่โฆษณาเกินจริง
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

-- 6) โปรที่กำลังลดของร้านลูกค้า — หน้าสั่งของใช้โชว์ป้ายโปร (ยืนยันตัวตนด้วยลิงก์ประจำร้าน)
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
      'product_id', p.product_id,
      'promo_price', p.promo_price,
      'normal', (ent->>'normal')::numeric,
      'ends_at', p.ends_at,
      'win_label', p.win_label)), '[]'::jsonb)
    into result
    from promotions p
    cross join lateral jsonb_array_elements(coalesce(p.customers,'[]'::jsonb)) ent
    where p.status = 'active'
      and now() >= p.starts_at and now() < p.ends_at
      and (ent->>'customer_id')::bigint = cid
      -- โชว์ป้ายเฉพาะเมื่อ "ราคาจริงที่ร้านนี้ได้" ลดถึงราคาโปรแล้วจริง ๆ (พนักงานตั้งให้แล้ว)
      -- กันกรณีประกาศโปรแต่ยังไม่ได้ลดราคา ลูกค้าจะได้ไม่เห็นราคาที่ไม่ตรงกับตอนสั่ง
      and exists (select 1 from customer_prices cp
                   where cp.customer_id = cid and cp.product_id = p.product_id
                     and cp.price is not null and cp.price <= p.promo_price + 0.001);
  return result;
end $$;
revoke execute on function get_customer_promos(text) from public;
grant execute on function get_customer_promos(text) to anon, authenticated;

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
do $$ begin perform cron.unschedule('promo-price-tick'); exception when others then null; end $$;
select cron.schedule('promo-price-tick', '*/5 * * * *', $$select promo_tick()$$);

do $$ begin perform cron.unschedule('promo-announce'); exception when others then null; end $$;
select cron.schedule('promo-announce', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/promo-runner',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
    body    := '{"run":true}'::jsonb)
$$);
