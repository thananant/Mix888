-- Mix888: กันทำซ้ำ — ส่งบิล / ยกเลิกบิล / ยกเลิกใบรับ / รับของโอนโกดัง ทำได้ครั้งเดียวต่อเอกสาร
-- รันใน Supabase → SQL Editor ได้เลย (รันซ้ำได้ ไม่เสียหาย)
-- เหตุ: กด "🚚 ส่งแล้ว" ซ้ำ/พร้อมกันสองเครื่อง → ตัดสต๊อกบิลเดียว 2 รอบ (เช่น IV2610050009)
-- วิธี: ครอบฟังก์ชันเดิมด้วยตัวกัน — ล็อกแถวเอกสารก่อน แล้วเช็กสถานะ ถ้าทำไปแล้วไม่ทำซ้ำ
--       ตัวเดิมเปลี่ยนชื่อเป็น ..._core (เนื้อในไม่แตะ) · ใครเรียกพร้อมกัน คนที่สองจะรอแล้วเจอว่าทำไปแล้ว
-- หมายเหตุ: ถ้าวันหลังรัน SQL เก่าที่สร้าง ship_bill/cancel_bill/receive_cancel/transfer_receive ใหม่ ให้รันไฟล์นี้ซ้ำ

-- 1) ตัวล็อกแถว + อ่านสถานะ (ล็อกค้างจนจบรายการนั้น ๆ คนที่สองต้องรอ)
create or replace function mx_lock_bill(p_id bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  select coalesce(ship_status, 'pending') into s from bills where id = p_id for update;
  return coalesce(s, 'missing');
end $$;
create or replace function mx_lock_receive(p_id bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  select case when cancelled_at is null then 'active' else 'cancelled' end into s from stock_receives where id = p_id for update;
  return coalesce(s, 'missing');
end $$;
create or replace function mx_lock_transfer(p_id bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  select coalesce(status, 'pending') into s from transfers where id = p_id for update;
  return coalesce(s, 'missing');
end $$;
revoke execute on function mx_lock_bill(bigint), mx_lock_receive(bigint), mx_lock_transfer(bigint) from public, anon;
grant execute on function mx_lock_bill(bigint), mx_lock_receive(bigint), mx_lock_transfer(bigint) to authenticated;
do $$ begin
  grant execute on function mx_lock_bill(bigint), mx_lock_receive(bigint), mx_lock_transfer(bigint) to service_role;
exception when undefined_object then null; end $$;

-- 2) ตัวติดตั้งตัวกัน: เปลี่ยนชื่อตัวเดิมเป็น <ชื่อ>_core แล้วสร้าง <ชื่อ> ใหม่ = เช็กสถานะก่อน แล้วเรียกตัวเดิม
--    อาร์กิวเมนต์/ชนิดผลลัพธ์/สิทธิ์ ตามตัวเดิมทุกอย่าง (หน้าเว็บเรียกเหมือนเดิม)
create or replace function mx_guard_install(p_fn text, p_check text) returns text
language plpgsql set search_path = public, pg_temp as $install$
declare
  v_core text := p_fn || '_core';
  n int; o oid; c_oid oid; w_oid oid; w_src text; perm_src oid;
  v_args text; v_res text; v_names text[]; v_modes "char"[]; v_secdef boolean;
  v_call text; v_body text; r text; v_roles text[] := '{}';
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = p_fn;
  select p.oid into c_oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = v_core;
  if n = 0 and c_oid is null then return p_fn || ': ไม่มีในระบบ — ข้าม'; end if;
  if n > 1 then return p_fn || ': มีหลายแบบ — ข้าม (ไม่แตะ)'; end if;
  if n = 0 then return p_fn || ': เหลือแต่ ' || v_core || ' — ข้าม (ตรวจด้วยมือ)'; end if;
  select p.oid, p.prosrc into o, w_src from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = p_fn;
  if c_oid is not null and position('MX_GUARD' in w_src) > 0 then
    w_oid := o; perm_src := o;                    -- ติดตั้งไว้แล้ว: สร้างตัวกันใหม่ สิทธิ์ตามตัวกันเดิม
  else
    if c_oid is not null then                     -- มีคนสร้างตัวเดิมใหม่ทับตัวกัน → ตัวใหม่เป็นตัวเดิม
      execute format('drop function public.%I(%s)', v_core, pg_get_function_identity_arguments(c_oid));
    end if;
    execute format('alter function public.%I(%s) rename to %I', p_fn, pg_get_function_identity_arguments(o), v_core);
    c_oid := o; perm_src := o;                    -- สิทธิ์ตามตัวเดิม (อ่านก่อนเปลี่ยนอะไร)
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) and has_function_privilege(r, perm_src, 'execute') then
      v_roles := v_roles || r;
    end if;
  end loop;
  select pg_get_function_arguments(p.oid), pg_get_function_result(p.oid), p.proargnames, p.proargmodes, p.prosecdef
    into v_args, v_res, v_names, v_modes, v_secdef
    from pg_proc p where p.oid = c_oid;
  if v_modes is not null and ('o' = any(v_modes)) then return p_fn || ': มีพารามิเตอร์ OUT — ข้าม'; end if;
  if v_names is null then return p_fn || ': พารามิเตอร์ไม่มีชื่อ — ข้าม'; end if;
  select string_agg(format('%I => %I', nm, nm), ', ' order by i) into v_call
    from unnest(v_names) with ordinality as t(nm, i)
   where v_modes is null or v_modes[i] in ('i', 'b', 'v');
  v_call := format('public.%I(%s)', v_core, coalesce(v_call, ''));
  v_body := case
    when v_res = 'void' then format('perform %s;', v_call)
    when v_res like 'SETOF %' or v_res like 'TABLE(%' then format('return query select * from %s;', v_call)
    else format('return %s;', v_call) end;
  execute format($f$create or replace function public.%I(%s) returns %s language plpgsql %s set search_path = public, pg_temp as $w$
-- MX_GUARD: กันทำซ้ำ (mix888-once-guard.sql) · ตัวทำงานจริง = %I
declare _st text;
begin
  %s
  %s
end $w$$f$, p_fn, v_args, v_res, case when v_secdef then 'security definer' else 'security invoker' end, v_core, p_check, v_body);
  select p.oid into o from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn;
  -- สิทธิ์ตัวกัน = ตามตัวเดิมเป๊ะ (ไม่ใช้สิทธิ์ตั้งต้นของ Supabase ที่เปิดให้ anon)
  execute format('revoke all on function public.%I(%s) from public', p_fn, pg_get_function_identity_arguments(o));
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.%I(%s) from %I', p_fn, pg_get_function_identity_arguments(o), r);
      if r = any(v_roles) then
        execute format('grant execute on function public.%I(%s) to %I', p_fn, pg_get_function_identity_arguments(o), r);
      end if;
    end if;
  end loop;
  -- ตัวเดิมแบบ security definer: เรียกตรงไม่ได้แล้ว ต้องผ่านตัวกัน (ตัวกันเป็นเจ้าของเดียวกัน เรียกได้)
  if v_secdef then
    execute format('revoke all on function public.%I(%s) from public', v_core, pg_get_function_identity_arguments(c_oid));
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function public.%I(%s) from %I', v_core, pg_get_function_identity_arguments(c_oid), r);
      end if;
    end loop;
  end if;
  return p_fn || ': ✅ กันทำซ้ำแล้ว';
exception when others then   -- ติดตั้งตัวไหนไม่ได้ ย้อนกลับเฉพาะตัวนั้น (ของเดิมไม่เสีย) แล้วบอกเหตุ
  return p_fn || ': ❌ ติดตั้งไม่ได้ — ' || sqlerrm;
end $install$;
revoke execute on function mx_guard_install(text, text) from public, anon, authenticated;

-- 3) ติดตั้ง
select mx_guard_install('ship_bill', $c$
  _st := public.mx_lock_bill(p_bill_id);
  if _st = 'shipped' then raise exception 'ALREADY_SHIPPED|บิลนี้ส่งไปแล้ว — ไม่ตัดสต๊อกซ้ำ'; end if;
  if _st = 'cancelled' then raise exception 'ALREADY_CANCELLED|บิลนี้ถูกยกเลิกแล้ว — ส่งไม่ได้'; end if;
$c$) as "ผล"
union all
select mx_guard_install('cancel_bill', $c$
  _st := public.mx_lock_bill(p_bill_id);
  if _st = 'cancelled' then raise exception 'ALREADY_CANCELLED|บิลนี้ถูกยกเลิกไปแล้ว — ไม่คืนสต๊อกซ้ำ'; end if;
$c$)
union all
select mx_guard_install('receive_cancel', $c$
  _st := public.mx_lock_receive(p_receive_id);
  if _st = 'cancelled' then raise exception 'ALREADY_CANCELLED|ใบรับนี้ถูกยกเลิกไปแล้ว — ไม่หักสต๊อกซ้ำ'; end if;
$c$)
union all
select mx_guard_install('transfer_receive', $c$
  _st := public.mx_lock_transfer(p_transfer);
  if _st = 'received' then raise exception 'ALREADY_RECEIVED|ใบโอนนี้รับเข้าไปแล้ว — ไม่ย้ายสต๊อกซ้ำ'; end if;
  if _st = 'cancelled' then raise exception 'ALREADY_CANCELLED|ใบโอนนี้ถูกยกเลิกแล้ว — รับเข้าไม่ได้'; end if;
$c$);

notify pgrst, 'reload schema';
