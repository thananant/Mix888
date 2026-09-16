-- ============================================================
--  Mix Fresh 168 — แก้บั๊ก "ปรับสต๊อกแล้วยอดรวมบวกซ้ำ (เบิ้ล)" + ซ่อมยอดที่เพี้ยนอยู่ทั้งหมด
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  อาการ: กดปรับสต๊อก (🔧) เช่น 0 → 10 แล้ว "สต๊อกรวม" กระโดดเกินจริง
--  เช่น รายโกดังเป็น 10+4=14 แต่สต๊อกรวมขึ้น 24 — เพราะฟังก์ชันปรับสต๊อกใน
--  ฐานข้อมูลคิดยอดรวมใหม่แล้ว "บวกส่วนต่างซ้ำอีกรอบ" (บั๊กตระกูลเดียวกับแปลงสินค้า)
--
--  ไฟล์นี้ทำอะไร (วิธีเดียวกับที่แก้แปลงสินค้าสำเร็จมาแล้ว)
--   1. เก็บฟังก์ชันปรับสต๊อกเดิมไว้ในชื่อ stock_adjust_v0 + ปิดไม่ให้แอปเรียกตรง
--   2. สร้าง stock_adjust ตัวใหม่ (หน้าเว็บไม่ต้องแก้): ทำงานเหมือนเดิมทุกอย่าง
--      แล้ว "คิดยอดรวมใหม่จากรายโกดัง" ปิดท้ายเสมอ → ปรับกี่ครั้งก็ไม่เบิ้ลอีก
--   3. ซ่อมยอดรวมของทุกสินค้าที่เพี้ยนค้างอยู่ ให้ตรงกับรายโกดัง (มีบันทึกในหน้าเดินสินค้า)
--   ⛔ ไม่แตะราคา · ไม่แตะยอดรายโกดัง · ประวัติปรับสต๊อก (ใคร/เหตุผล) เก็บเหมือนเดิมทุกอย่าง
-- ============================================================

-- 1) ตัวช่วยคิดยอดรวมจากรายโกดัง (ตัวเดียวกับไฟล์แก้แปลงสินค้า — รันซ้ำได้)
create or replace function stock_recount(p_product bigint) returns numeric
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v numeric;
begin
  if not exists (select 1 from stock where product_id = p_product) then
    select coalesce(stock_qty,0) into v from products where id = p_product;
    return v;   -- ไม่มีแถวรายโกดัง → ไม่แตะยอดรวม กันเผลอตั้งเป็น 0
  end if;
  select coalesce(sum(qty),0) into v from stock where product_id = p_product;
  update products set stock_qty = v where id = p_product;
  return v;
end $$;
revoke execute on function stock_recount(bigint) from public, anon, authenticated;

-- 2) ครอบ stock_adjust: ของเดิม → stock_adjust_v0 · ตัวใหม่เรียกของเดิมแล้วคิดยอดรวมปิดท้าย
do $$
declare
  f record; k int; base_name text; n_wrapped int := 0;
  callargs text; body text;
begin
  -- 2.1) เปลี่ยนชื่อของเดิม (ที่ยังไม่ใช่ตัวครอบ)
  for f in
    select p.oid, p.proargnames, p.proargmodes, pg_get_function_result(p.oid) as ret,
           pg_get_function_identity_arguments(p.oid) as idargs, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'stock_adjust' and p.prokind = 'f'
     order by p.oid
  loop
    if position('stock_adjust_v0' in f.def) > 0 then
      if not exists (select 1 from pg_proc b join pg_namespace bn on bn.oid = b.pronamespace
                      where bn.nspname = 'public' and b.proname ~ '^stock_adjust_v0(_[0-9]+)?$') then
        raise exception 'stock_adjust เป็นตัวครอบอยู่แล้ว แต่ไม่พบฟังก์ชันเดิม stock_adjust_v0 — ส่งข้อความนี้กลับมาให้ดูครับ ยังไม่ต้องทำอะไร';
      end if;
      continue;
    end if;
    if f.proargnames is null or f.proargmodes is not null
       or not ('p_product' = any(f.proargnames))
       or f.ret ~ '^(SETOF|TABLE)' or f.ret = 'record'
       or exists (select 1 from unnest(f.proargnames) a where coalesce(a,'') = '') then
      raise notice 'ข้าม stock_adjust(%) — รูปแบบไม่รองรับ (คืนค่า % / ไม่มี p_product)', f.idargs, f.ret;
      continue;
    end if;
    k := 1; base_name := 'stock_adjust_v0';
    while exists (select 1 from pg_proc b join pg_namespace bn on bn.oid = b.pronamespace
                   where bn.nspname = 'public' and b.proname = base_name) loop
      k := k + 1; base_name := 'stock_adjust_v0_' || k;
    end loop;
    execute format('alter function %s rename to %I', f.oid::regprocedure, base_name);
    raise notice 'เก็บฟังก์ชันเดิม stock_adjust(%) ไว้เป็น %', f.idargs, base_name;
  end loop;

  -- 2.2) ตัวเดิมซ้ำชนิดพารามิเตอร์ (เกิดจากวางเวอร์ชันใหม่ทับแล้วรันไฟล์ซ้ำ) → เก็บตัวใหม่สุด
  for f in
    select q.oid from (
      select p.oid, row_number() over (partition by p.proargtypes order by p.oid desc) as rn
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname ~ '^stock_adjust_v0(_[0-9]+)?$' and p.prokind = 'f') q
     where q.rn > 1
  loop
    raise notice 'ลบตัวเดิมรุ่นเก่าที่ถูกวางทับแล้ว: %', f.oid::regprocedure;
    execute format('drop function %s', f.oid::regprocedure);
  end loop;

  -- 2.3) สร้างตัวครอบ (ชื่อ/พารามิเตอร์/ค่า default/ชนิดคืนค่าเหมือนเดิมทุกอย่าง)
  for f in
    select p.oid, p.proname, p.proargnames, p.proargmodes,
           pg_get_function_arguments(p.oid) as args,
           pg_get_function_identity_arguments(p.oid) as idargs,
           pg_get_function_result(p.oid) as ret
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname ~ '^stock_adjust_v0(_[0-9]+)?$' and p.prokind = 'f'
     order by p.oid
  loop
    if f.proargnames is null or f.proargmodes is not null or not ('p_product' = any(f.proargnames))
       or f.ret ~ '^(SETOF|TABLE)' or f.ret = 'record' then
      raise notice 'ข้ามตัวเดิม %(%) — ครอบไม่ได้', f.proname, f.idargs;
      continue;
    end if;
    select string_agg(format('%I => %I', a, a), ', ' order by ord) into callargs
      from unnest(f.proargnames) with ordinality as t(a, ord);
    execute format('revoke execute on function %s from public, anon, authenticated', f.oid::regprocedure);
    execute format('drop function if exists public.stock_adjust(%s)', f.idargs);
    if f.ret = 'void' then
      body := format($f$
create function public.stock_adjust(%s) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp
as $w$
begin
  perform %I(%s);              -- ทำงานเดิมทุกอย่าง (ปรับรายโกดัง + บันทึกประวัติ/เหตุผล)
  perform stock_recount(p_product);   -- ปิดท้าย: ยอดรวม = ผลรวมรายโกดังเสมอ (จุดที่เคยเบิ้ล)
end $w$;$f$, f.args, f.proname, callargs);
    else
      body := format($f$
create function public.stock_adjust(%s) returns %s
language plpgsql security definer set search_path = public, extensions, pg_temp
as $w$
declare res %s;
begin
  res := %I(%s);
  perform stock_recount(p_product);
  return res;
end $w$;$f$, f.args, f.ret, f.ret, f.proname, callargs);
    end if;
    execute body;
    execute format('revoke execute on function public.stock_adjust(%s) from public, anon', f.idargs);
    execute format('grant execute on function public.stock_adjust(%s) to authenticated', f.idargs);
    n_wrapped := n_wrapped + 1;
  end loop;
  if n_wrapped = 0 then
    raise exception 'ไม่พบฟังก์ชัน stock_adjust ที่ครอบได้ — ส่งข้อความนี้กลับมาให้ดูครับ';
  end if;
  raise notice 'ครอบ stock_adjust แล้ว % แบบ — ปรับสต๊อกจะไม่บวกยอดเบิ้ลอีก', n_wrapped;
end $$;
notify pgrst, 'reload schema';

-- 3) ซ่อมยอดรวมที่เพี้ยนค้างอยู่ทั้งหมด ให้ตรงกับรายโกดัง (มีบันทึกในหน้าเดินสินค้า)
do $$
declare r record; n int := 0;
begin
  for r in
    select p.id, coalesce(p.stock_qty,0) as old_total, s.sum_qty as new_total
      from products p
      join (select product_id, sum(qty) as sum_qty from stock group by product_id) s on s.product_id = p.id
     where coalesce(p.active, true)
       and coalesce(p.stock_qty,0) <> coalesce(s.sum_qty,0)
  loop
    begin
      insert into stock_movements(product_id, type, qty, note, created_by)
      values (r.id, 'adjust', r.new_total - r.old_total,
              'ซ่อมยอดรวมให้ตรงรายโกดัง '||r.old_total||' → '||r.new_total||' (บั๊กปรับสต๊อกบวกซ้ำ)', 'ระบบ');
    exception when others then null;
    end;
    update products set stock_qty = r.new_total where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'ซ่อมยอดรวมแล้ว % สินค้า', n;
end $$;

-- 4) สรุปผล: ต้องเห็น stock_adjust = "✅ ตัวครอบ" · และจำนวนสินค้าที่ยอดยังไม่ตรงต้องเป็น 0
select p.proname as "ฟังก์ชัน",
       pg_get_function_identity_arguments(p.oid) as "พารามิเตอร์",
       case when p.proname = 'stock_adjust' and position('stock_adjust_v0' in pg_get_functiondef(p.oid)) > 0 then '✅ ตัวครอบ (ปรับสต๊อกไม่เบิ้ลแล้ว)'
            when p.proname = 'stock_adjust' then '⚠️ ยังไม่ได้ครอบ (ดู notice ด้านบน)'
            else 'ตัวเดิม (เรียกผ่านตัวครอบเท่านั้น)' end as "สถานะ"
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname ~ '^stock_adjust(_v0(_[0-9]+)?)?$'
 order by p.proname, 2;

select count(*) as "ยังไม่ตรง (ต้องเป็น 0)"
  from products p
  join (select product_id, sum(qty) as sq from stock group by product_id) s on s.product_id = p.id
 where coalesce(p.active,true) and coalesce(p.stock_qty,0) <> coalesce(s.sq,0);
