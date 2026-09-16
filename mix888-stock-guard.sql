-- ============================================================
--  Mix Fresh 168 — 🛡 เกราะสต๊อก: "สต๊อกรวม" ผิดไม่ได้อีก กับทุกสินค้า ทุกช่องทาง ตลอดไป
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  ที่ผ่านมา: บั๊ก "บวกยอดซ้ำ" โผล่ทีละฟังก์ชัน (แปลงสินค้า → ปรับสต๊อก) ไล่แก้ทีละตัวได้ แต่ไม่จบ
--  ไฟล์นี้แก้ที่ราก: ติด "กฎเหล็ก" ไว้ในฐานข้อมูลเลยว่า
--
--      สต๊อกรวมของสินค้า = ผลรวมสต๊อกรายโกดัง เสมอ
--
--  ใครจะเขียนเลขอะไรมาก็ตาม (ฟังก์ชันเก่า ฟังก์ชันใหม่ โค้ดที่ยังมีบั๊ก หรือคนแก้ตรงใน SQL)
--  ฐานข้อมูลจะคิดจากรายโกดังทับให้ถูกเองทันที ในจังหวะเดียวกับที่เขียน — บั๊กตระกูลนี้จบทั้งตระกูล
--
--  ทำอะไรบ้าง
--   1. กฎที่ 1: แตะสต๊อกรายโกดังเมื่อไร (รับเข้า/ขาย/โอน/แปลง/ปรับ) → ยอดรวมคิดใหม่ให้ทันที
--   2. กฎที่ 2: ใครพยายามเขียน "สต๊อกรวม" ของสินค้าที่มีรายโกดัง → ระบบทับด้วยผลรวมรายโกดังเสมอ
--   3. เก็บตก: สินค้าที่ตั้งยอดรวมมาโดยไม่มีรายโกดัง (เช่นนำเข้า CSV) → ลงให้ที่โกดังหลักอัตโนมัติ
--      (มีบันทึกในหน้าเดินสินค้า) เพื่อให้ทุกตัวมี "รายโกดัง" เป็นความจริงชุดเดียว
--   4. ซ่อมยอดที่เพี้ยนค้างอยู่ตอนนี้ทั้งหมดในไฟล์เดียว
--   ⛔ ไม่แตะราคาใด ๆ · ไม่เปลี่ยนวิธีทำงานของพนักงาน · ประวัติ/เหตุผลเก็บเหมือนเดิม
--
--  หมายเหตุ: ตัวเลข "รายโกดัง" ยังแก้ได้ทางเดียวคือพนักงานทำผ่านเมนู (รับเข้า/ปรับ/แปลง/โอน)
--  เกราะนี้คุมแค่ "เลขสรุปรวม" ไม่ให้คิดผิดจากรายโกดังเท่านั้น
-- ============================================================

-- 1) ตัวช่วยคิดยอดรวม (ตัวเดียวกับไฟล์ก่อน ๆ — รันซ้ำได้)
create or replace function stock_recount(p_product bigint) returns numeric
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v numeric;
begin
  if not exists (select 1 from stock where product_id = p_product) then
    select coalesce(stock_qty,0) into v from products where id = p_product;
    return v;
  end if;
  select coalesce(sum(qty),0) into v from stock where product_id = p_product;
  update products set stock_qty = v where id = p_product;
  return v;
end $$;
revoke execute on function stock_recount(bigint) from public, anon, authenticated;

-- 2) กฎที่ 1: สต๊อกรายโกดังเปลี่ยน → ยอดรวมของสินค้านั้นคิดใหม่ทันที
create or replace function stock_guard_rows() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v numeric;
begin
  if tg_op in ('INSERT','UPDATE') and new.product_id is not null then
    select coalesce(sum(s.qty),0) into v from stock s where s.product_id = new.product_id;
    update products p set stock_qty = v where p.id = new.product_id and p.stock_qty is distinct from v;
  end if;
  if tg_op in ('DELETE','UPDATE') and old.product_id is not null
     and (tg_op = 'DELETE' or old.product_id is distinct from new.product_id) then
    select coalesce(sum(s.qty),0) into v from stock s where s.product_id = old.product_id;
    update products p set stock_qty = v where p.id = old.product_id and p.stock_qty is distinct from v;
  end if;
  return null;
end $$;
drop trigger if exists stock_guard_rows_t on stock;
create trigger stock_guard_rows_t
after insert or update or delete on stock
for each row execute function stock_guard_rows();

-- 3) กฎที่ 2: ใครเขียน "สต๊อกรวม" ของสินค้าที่มีรายโกดัง → ทับด้วยผลรวมรายโกดังเสมอ
--    (จุดที่บั๊ก "บวกซ้ำ" เคยหลุด — ต่อไปเขียนเลขผิดมาก็ถูกแก้เป็นเลขจริงทันที)
create or replace function stock_guard_total() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from stock s where s.product_id = new.id) then
    select coalesce(sum(s.qty),0) into new.stock_qty from stock s where s.product_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists stock_guard_total_t on products;
create trigger stock_guard_total_t
before insert or update of stock_qty on products
for each row execute function stock_guard_total();

-- 4) เก็บตก: ตั้ง "ยอดรวม" ให้สินค้าที่ยังไม่มีรายโกดัง (เช่นนำเข้า CSV / เพิ่มตรง)
--    → ระบบลงจำนวนนั้นให้ที่โกดังหลัก เพื่อให้รายโกดังเป็นความจริงชุดเดียวของทุกตัว
create or replace function stock_guard_seed() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare wh bigint;
begin
  if pg_trigger_depth() > 2 then return null; end if;
  if coalesce(new.stock_qty,0) = 0 then return null; end if;
  if exists (select 1 from stock s where s.product_id = new.id) then return null; end if;
  select id into wh from warehouses where coalesce(is_default,false) order by id limit 1;
  if wh is null then select id into wh from warehouses order by id limit 1; end if;
  if wh is null then return null; end if;   -- ยังไม่ตั้งค่าโกดัง — ปล่อยตามเดิม
  insert into stock(product_id, warehouse_id, qty) values (new.id, wh, new.stock_qty);
  begin
    insert into stock_movements(product_id, type, qty, note, warehouse_id, created_by)
    values (new.id, 'adjust', new.stock_qty,
            'ตั้งยอดรวมโดยไม่มีรายโกดัง — ระบบลงให้ที่โกดังหลักเพื่อให้ตรวจสอบได้', wh, 'ระบบ');
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists stock_guard_seed_t on products;
create trigger stock_guard_seed_t
after insert or update of stock_qty on products
for each row execute function stock_guard_seed();

-- 5) ย้ายของเก่า: สินค้าที่มียอดรวมแต่ไม่มีรายโกดังอยู่แล้วตอนนี้ → ลงให้ที่โกดังหลัก (ครั้งเดียว)
do $$
declare r record; wh bigint; n int := 0;
begin
  select id into wh from warehouses where coalesce(is_default,false) order by id limit 1;
  if wh is null then select id into wh from warehouses order by id limit 1; end if;
  if wh is null then raise notice 'ยังไม่มีโกดังในระบบ — ข้ามขั้นย้ายของเก่า'; return; end if;
  for r in
    select p.id, p.sku, coalesce(p.stock_qty,0) as q from products p
     where coalesce(p.active,true) and coalesce(p.stock_qty,0) <> 0
       and not exists (select 1 from stock s where s.product_id = p.id)
  loop
    insert into stock(product_id, warehouse_id, qty) values (r.id, wh, r.q);
    begin
      insert into stock_movements(product_id, type, qty, note, warehouse_id, created_by)
      values (r.id, 'adjust', 0, 'ย้ายยอดรวมเดิม '||r.q||' ที่ไม่มีรายโกดัง มาลงโกดังหลัก (ยอดรวมเท่าเดิม)', wh, 'ระบบ');
    exception when others then null;
    end;
    n := n + 1;
  end loop;
  raise notice 'ย้ายยอดรวมที่ไม่มีรายโกดังมาลงโกดังหลักแล้ว % สินค้า', n;
end $$;

-- 6) ซ่อมยอดที่เพี้ยนค้างอยู่ตอนนี้ทั้งหมด (ต่อจากนี้เกราะจะกันเองอัตโนมัติ)
do $$
declare r record; n int := 0;
begin
  for r in
    select p.id, coalesce(p.stock_qty,0) as old_total, s.sum_qty as new_total
      from products p
      join (select product_id, sum(qty) as sum_qty from stock group by product_id) s on s.product_id = p.id
     where coalesce(p.stock_qty,0) <> coalesce(s.sum_qty,0)
  loop
    begin
      insert into stock_movements(product_id, type, qty, note, created_by)
      values (r.id, 'adjust', r.new_total - r.old_total,
              'ซ่อมยอดรวมให้ตรงรายโกดัง '||r.old_total||' → '||r.new_total||' (ติดตั้งเกราะสต๊อก)', 'ระบบ');
    exception when others then null;
    end;
    update products set stock_qty = r.new_total where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'ซ่อมยอดรวมแล้ว % สินค้า', n;
end $$;

-- 7) สรุปผล: เกราะ 3 ชั้นต้องขึ้นครบ · ยอดไม่ตรงต้องเป็น 0 · ไม่มีรายโกดังต้องเป็น 0
select tgname as "เกราะ", 'ติดตั้งแล้ว ✅' as "สถานะ"
  from pg_trigger where tgname in ('stock_guard_rows_t','stock_guard_total_t','stock_guard_seed_t')
 order by 1;
select
  (select count(*) from products p join (select product_id, sum(qty) sq from stock group by product_id) s on s.product_id = p.id
    where coalesce(p.stock_qty,0) <> coalesce(s.sq,0)) as "ยอดไม่ตรง(ต้อง 0)",
  (select count(*) from products p where coalesce(p.active,true) and coalesce(p.stock_qty,0) <> 0
    and not exists (select 1 from stock s where s.product_id = p.id)) as "ไม่มีรายโกดัง(ต้อง 0)";
