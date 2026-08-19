-- ============================================================
--  Mix Fresh 168 — ระบบโปรลดราคาตามช่วงเวลา + ตั้งเวลาส่งข้อความ
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  ทำอะไรบ้าง:
--  • ตาราง promotions เก็บโปรที่ตั้งไว้ (สินค้า ราคาโปร ช่วงเวลา รายชื่อร้าน)
--  • ถึงเวลาเริ่มโปร → แก้ราคาจริงใน "จัดสินค้า" ของร้านที่ได้โปร (จำราคาเดิมไว้)
--  • หมดเวลาโปร → คืนราคาเดิมให้อัตโนมัติ (ใครถูกแก้ราคาด้วยมือระหว่างโปร จะไม่ไปทับ)
--  • ระบบเช็คทุก 5 นาที (pg_cron) + เรียกฟังก์ชัน promo-runner ส่งข้อความตามเวลาที่ตั้ง
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

-- 2) เริ่มโปร: แก้ราคาจริงของร้านที่ได้โปร (จำราคาเดิมไว้เพื่อคืนทีหลัง)
create or replace function promo_apply(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  pr promotions%rowtype;
  ent jsonb; out_arr jsonb := '[]'::jsonb;
  cid bigint; curp numeric; hadrow boolean;
  n_done int := 0; n_skip int := 0;
begin
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status <> 'scheduled' then
    return jsonb_build_object('status', pr.status, 'note', 'โปรไม่ได้อยู่สถานะรอเริ่ม');
  end if;
  if pr.apply_price then
    for ent in select * from jsonb_array_elements(coalesce(pr.customers,'[]'::jsonb)) loop
      cid := (ent->>'customer_id')::bigint;
      select price into curp from customer_prices
        where customer_id = cid and product_id = pr.product_id limit 1;
      hadrow := found;
      if hadrow and curp is not null and curp <= pr.promo_price then
        -- ตอนนี้ร้านนี้ได้ราคาถูกกว่า/เท่าโปรไปแล้ว — ไม่ขึ้นราคาให้เด็ดขาด
        ent := ent || jsonb_build_object('applied', false, 'skip', 'ได้ราคาถูกกว่า/เท่าโปรอยู่แล้ว');
        n_skip := n_skip + 1;
      else
        if hadrow then
          update customer_prices set price = pr.promo_price
            where customer_id = cid and product_id = pr.product_id;
        else
          insert into customer_prices(customer_id, product_id, price)
            values (cid, pr.product_id, pr.promo_price);
        end if;
        ent := ent || jsonb_build_object('applied', true, 'had_row', hadrow, 'old_price', curp);
        n_done := n_done + 1;
      end if;
      out_arr := out_arr || jsonb_build_array(ent);
    end loop;
  else
    out_arr := coalesce(pr.customers,'[]'::jsonb);
  end if;
  update promotions set status = 'active', customers = out_arr where id = p_id;
  return jsonb_build_object('applied', n_done, 'skipped', n_skip);
end $$;

-- 3) จบโปร: คืนราคาเดิม (เฉพาะแถวที่ยังเป็นราคาโปรอยู่ — ใครแก้ด้วยมือระหว่างโปร ไม่ไปทับ)
create or replace function promo_revert(p_id bigint, p_final text default 'done') returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  pr promotions%rowtype;
  ent jsonb; out_arr jsonb := '[]'::jsonb;
  cid bigint; curp numeric; oldp numeric;
  n_back int := 0; n_skip int := 0;
begin
  if p_final not in ('done','cancelled') then p_final := 'done'; end if;
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status <> 'active' then
    return jsonb_build_object('status', pr.status, 'note', 'โปรไม่ได้อยู่สถานะกำลังลดราคา');
  end if;
  for ent in select * from jsonb_array_elements(coalesce(pr.customers,'[]'::jsonb)) loop
    if coalesce((ent->>'applied')::boolean, false) then
      cid := (ent->>'customer_id')::bigint;
      select price into curp from customer_prices
        where customer_id = cid and product_id = pr.product_id limit 1;
      if found and curp is not null and abs(curp - pr.promo_price) < 0.001 then
        if coalesce((ent->>'had_row')::boolean, false) then
          oldp := case when (ent->>'old_price') is null then null else (ent->>'old_price')::numeric end;
          update customer_prices set price = oldp
            where customer_id = cid and product_id = pr.product_id;
        else
          delete from customer_prices
            where customer_id = cid and product_id = pr.product_id;
        end if;
        ent := ent || jsonb_build_object('reverted', true);
        n_back := n_back + 1;
      else
        ent := ent || jsonb_build_object('reverted', false, 'skip', 'ราคาถูกแก้ด้วยมือระหว่างโปร — คงราคาปัจจุบันไว้');
        n_skip := n_skip + 1;
      end if;
    end if;
    out_arr := out_arr || jsonb_build_array(ent);
  end loop;
  update promotions set status = p_final, customers = out_arr where id = p_id;
  return jsonb_build_object('reverted', n_back, 'kept', n_skip);
end $$;

-- 4) ยกเลิกโปร (จากหน้าเว็บ): ถ้าเริ่มไปแล้ว คืนราคาเดิมก่อน · ถ้ายังไม่เริ่ม แค่ปิด
create or replace function promo_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pr promotions%rowtype; r jsonb;
begin
  select * into pr from promotions where id = p_id for update;
  if not found then raise exception 'ไม่พบโปร #%', p_id; end if;
  if pr.status = 'active' then
    r := promo_revert(p_id, 'cancelled');
    return jsonb_build_object('cancelled', true) || coalesce(r,'{}'::jsonb);
  elsif pr.status = 'scheduled' then
    update promotions set status = 'cancelled' where id = p_id;
    return jsonb_build_object('cancelled', true);
  end if;
  return jsonb_build_object('cancelled', false, 'status', pr.status);
end $$;

-- 5) ตัวเดินเวลา: เริ่มโปรที่ถึงเวลา + จบโปรที่หมดเวลา (cron เรียกทุก 5 นาที)
create or replace function promo_tick() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pid bigint;
begin
  for pid in select id from promotions where status = 'scheduled' and starts_at <= now() order by id loop
    begin perform promo_apply(pid); exception when others then null; end;
  end loop;
  for pid in select id from promotions where status = 'active' and ends_at <= now() order by id loop
    begin perform promo_revert(pid); exception when others then null; end;
  end loop;
end $$;

revoke execute on function promo_apply(bigint) from public, anon;
revoke execute on function promo_revert(bigint, text) from public, anon;
revoke execute on function promo_cancel(bigint) from public, anon;
revoke execute on function promo_tick() from public, anon;
grant execute on function promo_apply(bigint) to authenticated;
grant execute on function promo_revert(bigint, text) to authenticated;
grant execute on function promo_cancel(bigint) to authenticated;

-- 6) ตั้งเวลา: เช็คเริ่ม/จบโปรทุก 5 นาที + ให้ promo-runner ส่งข้อความตามเวลาที่ตั้งไว้
do $$ begin perform cron.unschedule('promo-price-tick'); exception when others then null; end $$;
select cron.schedule('promo-price-tick', '*/5 * * * *', $$select promo_tick()$$);

do $$ begin perform cron.unschedule('promo-announce'); exception when others then null; end $$;
select cron.schedule('promo-announce', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/promo-runner',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
    body    := '{"run":true}'::jsonb)
$$);
