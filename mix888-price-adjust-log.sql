-- ============================================================
--  Mix Fresh 168 — ประวัติ "ปรับราคาทุกร้าน" (ใครทำ รอบไหน แก้อะไร) + ปุ่มยกเลิกรอบ (คืนราคาเดิม)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
--
--  ทำอะไรบ้าง
--   1. ตาราง price_adjust_batches เก็บทุกรอบที่กด "ยืนยันปรับราคา" จากหน้าต่าง 📈 ปรับราคาทุกร้าน
--      (ใคร · เมื่อไร · สินค้าอะไร ± เท่าไร · ร้านไหน ราคาเดิม → ใหม่ · ส่งไลน์กี่ร้าน)
--   2. ฟังก์ชัน price_adjust_revert(รอบ) สำหรับปุ่ม "↩ ยกเลิกรอบนี้" — คืนราคาให้ทุกร้านในรอบนั้นกลับเป็นราคาเดิม
--      • คืนเฉพาะรายการที่ราคาตอนนี้ยังเท่ากับราคาที่รอบนั้นตั้งไว้ (ถ้ามีคนแก้ทีหลัง จะข้ามและรายงานให้ดู)
--      • ร้านที่ตอนนั้น "ใช้ราคากลุ่ม" แล้วถูกตั้งเป็นราคาเฉพาะร้าน → คืนกลับเป็นใช้ราคากลุ่มเหมือนเดิม
--      • ราคากลาง/เรทกลุ่มที่รอบนั้นปรับ → คืนค่าเดิม (ถ้ายังไม่ถูกแก้ทีหลัง)
--      • ทำในทีเดียว (ทั้งหมดหรือไม่ทำเลย) และบันทึกในประวัติแก้ราคา 🕘 ว่ามาจาก "ยกเลิกการปรับราคารอบ #.."
--   ⛔ ระบบไม่ทำอะไรเอง — ทุกอย่างเกิดจากพนักงานกดยืนยันในหลังบ้านเท่านั้น
-- ============================================================

create table if not exists price_adjust_batches (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  created_by   text,
  status       text not null default 'applying',   -- applying / applied / partial / reverted
  items        jsonb not null default '[]'::jsonb, -- [{product_id, sku, name, amt}]
  options      jsonb not null default '{}'::jsonb, -- {tiers, cp, line}
  tiers        jsonb not null default '[]'::jsonb, -- [{product_id, name, changes:{col:[old,new]}, applied}]
  rows         jsonb not null default '[]'::jsonb, -- [{customer_id, code, name, product_id, pname, kind, old, new, applied, line}]
  shops        int  not null default 0,
  line_ok      int  not null default 0,
  line_fail    int  not null default 0,
  reverted_at  timestamptz,
  reverted_by  text,
  revert_note  jsonb
);
alter table price_adjust_batches enable row level security;
drop policy if exists "pab_auth_all" on price_adjust_batches;
create policy "pab_auth_all" on price_adjust_batches for all to authenticated using (true) with check (true);
grant select, insert, update on price_adjust_batches to authenticated;
grant usage, select on all sequences in schema public to authenticated;
create index if not exists price_adjust_batches_created_idx on price_adjust_batches(created_at desc);

-- ยกเลิกรอบ: p_apply=false = แค่ดูว่าจะคืนอะไรได้บ้าง · p_apply=true = คืนจริง (ทีเดียวทั้งรอบ)
create or replace function price_adjust_revert(p_id bigint, p_apply boolean default false, p_by text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  b price_adjust_batches%rowtype;
  r jsonb; t jsonb; ch record;
  cid bigint; pid bigint; oldp numeric; newp numeric; curp numeric; hasrow boolean;
  n_rev int := 0; n_skip int := 0; n_tier int := 0; n_tier_skip int := 0;
  skipped jsonb := '[]'::jsonb; tskipped jsonb := '[]'::jsonb;
  col text; oldv numeric; newv numeric; curv numeric;
begin
  select * into b from price_adjust_batches where id = p_id for update;
  if not found then raise exception 'ไม่พบรอบปรับราคา #%', p_id; end if;
  if b.status = 'reverted' then raise exception 'รอบ #% ถูกยกเลิกไปแล้วเมื่อ %', p_id, to_char(b.reverted_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI'); end if;
  if b.status = 'applying' then raise exception 'รอบ #% ยังไม่เสร็จ (กำลังปรับอยู่) — รอให้เสร็จก่อน', p_id; end if;

  perform set_config('app.price_source', 'ยกเลิกการปรับราคาทั้งกระดาน #'||p_id, true);

  -- 1) ราคาเฉพาะร้าน
  for r in select * from jsonb_array_elements(coalesce(b.rows,'[]'::jsonb)) loop
    if coalesce((r->>'applied')::boolean,false) is not true then continue; end if;
    if r->>'kind' not in ('cp','grp2cp') then continue; end if;   -- 'grp' = ขยับตามราคากลุ่ม ไม่มีอะไรต้องคืนที่ร้าน
    cid := (r->>'customer_id')::bigint; pid := (r->>'product_id')::bigint;
    oldp := nullif(r->>'old','')::numeric; newp := nullif(r->>'new','')::numeric;
    select price into curp from customer_prices where customer_id = cid and product_id = pid limit 1;
    hasrow := found;
    if not hasrow or curp is null or newp is null or abs(curp - newp) > 0.001 then
      n_skip := n_skip + 1;   -- ถูกแก้ทีหลัง / ถูกลบ → ไม่แตะ
      skipped := skipped || jsonb_build_array(jsonb_build_object('customer_id',cid,'product_id',pid,'code',r->>'code','name',r->>'name','pname',r->>'pname',
                   'expected',newp,'now',case when not hasrow then null else curp end,'has_row',hasrow));
      continue;
    end if;
    n_rev := n_rev + 1;
    if p_apply then
      if r->>'kind' = 'grp2cp' then
        update customer_prices set price = null where customer_id = cid and product_id = pid;   -- กลับไปใช้ราคากลุ่มเหมือนเดิม
      else
        update customer_prices set price = oldp where customer_id = cid and product_id = pid;
      end if;
    end if;
  end loop;

  -- 2) ราคากลาง / เรทกลุ่ม
  for t in select * from jsonb_array_elements(coalesce(b.tiers,'[]'::jsonb)) loop
    if coalesce((t->>'applied')::boolean,false) is not true then continue; end if;
    pid := (t->>'product_id')::bigint;
    for ch in select key as k, value as v from jsonb_each(coalesce(t->'changes','{}'::jsonb)) loop
      col := ch.k;
      if col not in ('base_price','price_r20','price_r50','price_upc') then continue; end if;
      oldv := nullif(ch.v->>0,'')::numeric; newv := nullif(ch.v->>1,'')::numeric;
      execute format('select %I from products where id = $1', col) into curv using pid;
      if curv is null or newv is null or abs(curv - newv) > 0.001 then
        n_tier_skip := n_tier_skip + 1;
        tskipped := tskipped || jsonb_build_array(jsonb_build_object('product_id',pid,'name',t->>'name','col',col,'expected',newv,'now',curv));
        continue;
      end if;
      n_tier := n_tier + 1;
      if p_apply then
        execute format('update products set %I = $1 where id = $2', col) using oldv, pid;
      end if;
    end loop;
  end loop;

  if p_apply then
    update price_adjust_batches
       set status = 'reverted', reverted_at = now(), reverted_by = p_by,
           revert_note = jsonb_build_object('reverted_rows', n_rev, 'skipped_rows', n_skip, 'reverted_tiers', n_tier, 'skipped_tiers', n_tier_skip,
                                            'skipped', skipped, 'skipped_tiers_detail', tskipped)
     where id = p_id;
  end if;

  return jsonb_build_object('applied', p_apply, 'reverted_rows', n_rev, 'skipped_rows', n_skip,
                            'reverted_tiers', n_tier, 'skipped_tiers', n_tier_skip,
                            'skipped', skipped, 'skipped_tiers_detail', tskipped);
end $$;
revoke execute on function price_adjust_revert(bigint, boolean, text) from public, anon;
grant  execute on function price_adjust_revert(bigint, boolean, text) to authenticated;
