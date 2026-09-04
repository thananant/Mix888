-- ============================================================
--  Mix Fresh 168 — แก้ "แปลงสินค้าแล้วสต๊อกรวมโป่ง" (ยอดรวมถูกบวก/ลบ 2 รอบ แต่ยอดรายโกดังถูก)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  ⛔ ไฟล์นี้ "ยังไม่แก้ตัวเลขสต๊อกที่โป่งอยู่" — แค่ติดตั้งตัวแก้ + โชว์รายการที่ไม่ตรงให้ดูก่อน
--
--  ทำอะไรบ้าง
--   1. เก็บฟังก์ชันแปลงเดิมไว้ในชื่อ convert_stock_v0 (ไม่ลบ ไม่แก้ของเดิม)
--   2. สร้าง convert_stock ตัวใหม่ = เรียกของเดิมทำงานตามปกติ แล้ว "คิดยอดรวมใหม่จากรายโกดัง"
--      ให้สินค้าต้นทาง+ปลายทางทุกครั้ง → ยอดรวม (ที่หน้าลูกค้าใช้) จะเท่ากับผลรวมทุกโกดังเสมอ
--   3. สร้างเครื่องมือ stock_totals_resync() สำหรับปรับยอดรวมที่โป่งอยู่แล้วให้ตรงกับรายโกดัง
--      • ดูก่อน (ไม่แก้อะไร):  select * from stock_totals_resync();
--      • ปรับจริง:             select * from stock_totals_resync(true);
--      ค่าเริ่มต้นดูเฉพาะสินค้าที่ "เคยผ่านการแปลง" (กลุ่มที่โดนบั๊กนี้)
--      ถ้าอยากเช็คสินค้าทุกตัว:  select * from stock_totals_resync(false, true);   (ดู)
--                               select * from stock_totals_resync(true,  true);   (ปรับจริง)
--
--  หลักการ: ตัวเลขจริงคือ "ยอดรายโกดัง" (ตาราง stock) — ทุกหน้าในระบบตัด/รับ/โอน/นับ ตามโกดัง
--  ส่วน products.stock_qty เป็นแค่ยอดรวมที่เก็บไว้ให้หน้าลูกค้าอ่านเร็ว ๆ จึงต้องเท่ากับผลรวมรายโกดัง
--  ท้ายไฟล์นี้จะโชว์รายการที่ไม่ตรงให้เห็นทันที (ยังไม่แก้)
-- ============================================================

-- 1) เก็บฟังก์ชันเดิมไว้เป็น convert_stock_v0 (ทำครั้งเดียว)
do $$
declare n_old int; n_v0 int; r record;
begin
  select count(*) into n_v0 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'convert_stock_v0';
  if n_v0 > 0 then
    raise notice 'มี convert_stock_v0 อยู่แล้ว — ข้ามขั้นเก็บของเดิม';
    -- ถ้ายังมี convert_stock ตัวเก่าค้างอยู่พร้อมกับ v0 (รันไฟล์ครึ่งทางครั้งก่อน) ให้ลบตัวเก่าทิ้งก่อนสร้างใหม่
    for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = 'convert_stock'
                and pg_get_functiondef(p.oid) not like '%convert_stock_v0%' loop
      execute format('drop function %s', r.sig);
    end loop;
    return;
  end if;
  select count(*) into n_old from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'convert_stock';
  if n_old = 0 then
    raise exception 'ไม่พบฟังก์ชัน convert_stock ในฐานข้อมูล — ส่งข้อความนี้กลับมาให้ดูครับ';
  elsif n_old > 1 then
    raise exception 'พบ convert_stock มากกว่า 1 ตัว (%) — ส่งข้อความนี้กลับมาให้ดูครับ ยังไม่ต้องทำอะไร', n_old;
  end if;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname = 'convert_stock' loop
    execute format('alter function %s rename to convert_stock_v0', r.sig);
    raise notice 'เก็บฟังก์ชันเดิม % ไว้เป็น convert_stock_v0 แล้ว', r.sig;
  end loop;
end $$;

-- 2) ตัวช่วย: คิดยอดรวมของสินค้า 1 ตัวใหม่จากรายโกดัง (คืนค่ายอดรวมใหม่)
create or replace function stock_recount(p_product bigint) returns numeric
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v numeric;
begin
  select coalesce(sum(qty),0) into v from stock where product_id = p_product;
  update products set stock_qty = v where id = p_product;
  return v;
end $$;
revoke execute on function stock_recount(bigint) from public, anon;
grant  execute on function stock_recount(bigint) to authenticated;

-- 3) convert_stock ตัวใหม่: ทำงานเหมือนเดิมทุกอย่าง (เรียกของเดิม) แล้วคิดยอดรวมใหม่ให้ 2 สินค้า
create or replace function convert_stock(
  p_cv_no text, p_from bigint, p_to bigint, p_from_qty numeric, p_to_qty numeric,
  p_wh bigint, p_note text default null, p_by text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_from numeric; v_to numeric;
begin
  if p_from is null or p_to is null or p_wh is null or p_from_qty is null or p_to_qty is null then
    raise exception 'ข้อมูลแปลงสินค้าไม่ครบ';
  end if;
  if p_from = p_to then raise exception 'ต้นทางกับปลายทางต้องคนละตัว'; end if;
  if p_from_qty <= 0 or p_to_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
  -- ให้ฟังก์ชันเดิมทำงานตามปกติ (บันทึกประวัติแปลง / ปรับรายโกดัง / ลอต ฯลฯ เหมือนเดิมทุกอย่าง)
  execute format(
    'select convert_stock_v0(p_cv_no => %L, p_from => %s, p_to => %s, p_from_qty => %s, p_to_qty => %s, p_wh => %s, p_note => %L, p_by => %L)',
    p_cv_no, p_from, p_to, p_from_qty, p_to_qty, p_wh, p_note, p_by);
  -- จุดที่แก้: ยอดรวมต้องเท่ากับผลรวมรายโกดังเสมอ ไม่ว่าของเดิมจะบวก/ลบไปกี่รอบ
  v_from := stock_recount(p_from);
  v_to   := stock_recount(p_to);
  return jsonb_build_object('ok', true, 'from_total', v_from, 'to_total', v_to);
end $$;
revoke execute on function convert_stock(text,bigint,bigint,numeric,numeric,bigint,text,text) from public, anon;
grant  execute on function convert_stock(text,bigint,bigint,numeric,numeric,bigint,text,text) to authenticated;

-- 4) เครื่องมือปรับยอดรวมที่โป่ง/ขาดอยู่ ให้ตรงกับรายโกดัง (p_apply=false = แค่ดู)
create or replace function stock_totals_resync(p_apply boolean default false, p_all boolean default false)
returns table(sku text, "สินค้า" text, "ยอดรวมเดิม" numeric, "รวมรายโกดัง" numeric, "ต่าง" numeric, "จองอยู่" numeric, "สถานะ" text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in
    select p.id, p.sku, p.name, coalesce(p.stock_qty,0) as old_total, coalesce(s.sum_qty,0) as new_total,
           coalesce(p.reserved_qty,0) as reserved
      from products p
      join (select product_id, sum(qty) as sum_qty from stock group by product_id) s on s.product_id = p.id
     where coalesce(p.stock_qty,0) <> coalesce(s.sum_qty,0)
       and (p_all or p.id in (select from_product from conversions union select to_product from conversions))
     order by abs(coalesce(p.stock_qty,0) - coalesce(s.sum_qty,0)) desc, p.sku
  loop
    if p_apply then
      update products set stock_qty = r.new_total where id = r.id;
      begin
        insert into stock_movements(product_id, type, qty, note, created_by)
        values (r.id, 'adjust', r.new_total - r.old_total,
                'ปรับยอดรวมให้ตรงกับรายโกดัง (แก้ยอดโป่งจากการแปลงสินค้า) '||r.old_total||' → '||r.new_total, 'ระบบ');
      exception when others then null;   -- บันทึกประวัติไม่ได้ก็ไม่เป็นไร ยอดถูกปรับแล้ว
      end;
    end if;
    sku := r.sku; "สินค้า" := r.name; "ยอดรวมเดิม" := r.old_total; "รวมรายโกดัง" := r.new_total;
    "ต่าง" := r.new_total - r.old_total; "จองอยู่" := r.reserved;
    "สถานะ" := case when p_apply then '✅ ปรับแล้ว' else 'ยังไม่ปรับ (ดูเฉย ๆ)' end;
    return next;
  end loop;
  return;
end $$;
revoke execute on function stock_totals_resync(boolean,boolean) from public, anon;
grant  execute on function stock_totals_resync(boolean,boolean) to authenticated;

-- 5) โชว์รายการที่ยอดรวมไม่ตรงกับรายโกดัง (เฉพาะสินค้าที่เคยแปลง) — ยังไม่แก้อะไร
--    ถ้าดูแล้วโอเค ให้รันบรรทัดนี้เพื่อปรับจริง:   select * from stock_totals_resync(true);
select * from stock_totals_resync();
