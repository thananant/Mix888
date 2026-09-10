-- ============================================================
--  Mix Fresh 168 — ประวัติการแก้ราคา (ใครแก้ ราคาไหน เมื่อไร)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  เก็บอัตโนมัติที่ฐานข้อมูล ทุกครั้งที่:
--  • ราคาเฉพาะร้าน (จัดสินค้า) ถูกเพิ่ม / แก้ / เอาออก — ไม่ว่าแก้จากหน้าไหน
--  • ราคากลางของสินค้า (ราคาตั้งต้น / ร20 / ร50 / UPC) ถูกแก้
--  • ระบบโปรลดราคาแก้/คืนราคาให้ — ระบุที่มาว่ามาจากโปรตัวไหน
--  บันทึกชื่อคนแก้จากบัญชีที่ล็อกอินอยู่ · ดูได้ในหน้า "จัดสินค้า → 🕘 ประวัติแก้ราคา"
-- ============================================================

create table if not exists price_log (
  id          bigint generated always as identity primary key,
  customer_id bigint,                    -- null = ราคากลางของสินค้า
  product_id  bigint not null,
  field       text,                      -- ราคาเฉพาะร้าน / ราคาตั้งต้น / ราคา ร20 / ราคา ร50 / ราคา UPC
  old_price   numeric,
  new_price   numeric,
  action      text,                      -- add / change / remove
  source      text,                      -- เช่น 'โปรลดราคา #12' — ว่าง = แก้เองในระบบ
  changed_by  text,
  changed_at  timestamptz not null default now()
);
create index if not exists idx_price_log_cp on price_log(customer_id, product_id, id desc);
alter table price_log enable row level security;
drop policy if exists "plog_read" on price_log;
create policy "plog_read" on price_log for select to authenticated using (true);
-- ไม่มี policy เขียน — เขียนได้ทาง trigger เท่านั้น ปลอมประวัติไม่ได้

-- ชื่อคนที่กำลังแก้ (จากบัญชีที่ล็อกอิน) — หาไม่ได้ให้เว้นว่าง ไม่ล้มงานหลัก
create or replace function price_log_actor() returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare who text;
begin
  begin
    select display_name into who from app_users
      where auth_uid::text = auth.uid()::text limit 1;
  exception when others then who := null; end;
  return who;
end $$;

-- ราคาเฉพาะร้าน (จัดสินค้า)
create or replace function log_customer_price_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare who text := price_log_actor();
        src text := current_setting('app.price_source', true);
begin
  if tg_op = 'INSERT' then
    insert into price_log(customer_id, product_id, field, old_price, new_price, action, source, changed_by)
      values (new.customer_id, new.product_id, 'ราคาเฉพาะร้าน', null, new.price, 'add', nullif(src,''), who);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.price is distinct from old.price then
      insert into price_log(customer_id, product_id, field, old_price, new_price, action, source, changed_by)
        values (new.customer_id, new.product_id, 'ราคาเฉพาะร้าน', old.price, new.price, 'change', nullif(src,''), who);
    end if;
    return new;
  else
    insert into price_log(customer_id, product_id, field, old_price, new_price, action, source, changed_by)
      values (old.customer_id, old.product_id, 'ราคาเฉพาะร้าน', old.price, null, 'remove', nullif(src,''), who);
    return old;
  end if;
end $$;
drop trigger if exists trg_price_log_cp on customer_prices;
create trigger trg_price_log_cp
  after insert or update or delete on customer_prices
  for each row execute function log_customer_price_change();

-- ราคากลางของสินค้า (products)
create or replace function log_product_price_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare who text := price_log_actor();
        src text := current_setting('app.price_source', true);
begin
  if new.base_price is distinct from old.base_price then
    insert into price_log(product_id, field, old_price, new_price, action, source, changed_by)
      values (new.id, 'ราคาตั้งต้น', old.base_price, new.base_price, 'change', nullif(src,''), who);
  end if;
  if new.price_r20 is distinct from old.price_r20 then
    insert into price_log(product_id, field, old_price, new_price, action, source, changed_by)
      values (new.id, 'ราคา ร20', old.price_r20, new.price_r20, 'change', nullif(src,''), who);
  end if;
  if new.price_r50 is distinct from old.price_r50 then
    insert into price_log(product_id, field, old_price, new_price, action, source, changed_by)
      values (new.id, 'ราคา ร50', old.price_r50, new.price_r50, 'change', nullif(src,''), who);
  end if;
  if new.price_upc is distinct from old.price_upc then
    insert into price_log(product_id, field, old_price, new_price, action, source, changed_by)
      values (new.id, 'ราคา UPC', old.price_upc, new.price_upc, 'change', nullif(src,''), who);
  end if;
  return new;
end $$;
drop trigger if exists trg_price_log_prod on products;
create trigger trg_price_log_prod
  after update on products
  for each row execute function log_product_price_change();
