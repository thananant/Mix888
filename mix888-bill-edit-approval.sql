-- ============================================================
--  Mix Fresh 168 — ระบบขออนุมัติแก้บิล (หลังส่งของ / หลังรับยอด)  v2
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ · ถ้าเคยรัน v1 แล้ว รันไฟล์นี้ทับได้เลย
--
--  • พนักงานแก้บิลที่ส่งแล้ว/รับยอดแล้ว → เป็น "คำขอ" รอ admin อนุมัติ
--  • การแก้บิลจริงทำในฐานข้อมูลจบใน transaction เดียว (apply_bill_edit)
--    สำเร็จทั้งหมดหรือไม่เกิดอะไรเลย — เน็ตสะดุด/กดซ้ำ สต๊อกไม่ถูกปรับซ้ำ
--  • ส่วนต่างสต๊อกคิดจากรายการจริงในออเดอร์ ณ วินาทีที่แก้ ไม่ใช่ภาพจำตอนเปิดจอ
-- ============================================================

-- 1) ตารางคำขอแก้บิล
create table if not exists bill_edit_requests (
  id           bigint generated always as identity primary key,
  bill_id      bigint not null,
  bill_no      text,
  payload      jsonb not null,            -- รายการแก้ทั้งหมด (สินค้า/ค่าส่ง/ส่วนลด/เหตุผล)
  summary      text,                      -- สรุปสั้น ๆ ให้ admin อ่านก่อนกด
  status       text not null default 'pending',   -- pending / approved / rejected
  requested_by text,
  decided_by   text,
  decide_note  text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
alter table bill_edit_requests enable row level security;
drop policy if exists "ber_auth_all" on bill_edit_requests;
create policy "ber_auth_all" on bill_edit_requests
  for all to authenticated using (true) with check (true);

-- 2) ล้างฟังก์ชันเก่าของ v1 (ถูกแทนด้วย apply_bill_edit)
drop function if exists bill_edit_stock_adjust(bigint,numeric,bigint,text,bigint);

-- 3) แก้บิลทั้งก้อนใน transaction เดียว
--    p_items = รายการ "เป้าหมายสุดท้าย" ทั้งชุด [{product_id,qty,price},...]
--    ส่วนต่างสต๊อก = เป้าหมาย − ของจริงปัจจุบัน  → เรียกซ้ำด้วยเป้าหมายเดิม ส่วนต่างเป็น 0 (กันปรับซ้ำ)
create or replace function apply_bill_edit(
  p_bill bigint,
  p_expected_rev int,
  p_items jsonb,
  p_ship numeric,
  p_disc numeric,
  p_note text default '',
  p_warehouse bigint default null,
  p_skip_rev boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b bills%rowtype;
  r record;
  v_shipped boolean;
  v_sub numeric := 0;
  v_grand numeric;
  v_paid numeric;
  v_status text;
  v_rev int;
  v_deltas jsonb := '{}'::jsonb;
begin
  select * into b from bills where id = p_bill for update;
  if not found then raise exception 'ไม่พบบิล'; end if;
  if coalesce(b.ship_status,'pending') = 'cancelled' then
    raise exception 'บิล % ถูกยกเลิกไปแล้ว', b.bill_no;
  end if;
  if (not p_skip_rev) and coalesce(b.revision,1) <> p_expected_rev then
    raise exception 'REV_MISMATCH|บิล % ถูกแก้เป็นเวอร์ชันใหม่กว่าแล้ว (ตอนนี้ v.%)', b.bill_no, coalesce(b.revision,1);
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'บิลต้องมีอย่างน้อย 1 รายการ';
  end if;
  v_shipped := (b.ship_status = 'shipped');

  -- ส่วนต่างต่อสินค้า = เป้าหมาย − ปัจจุบัน
  for r in
    with tgt as (select (x->>'product_id')::bigint pid, sum((x->>'qty')::numeric) q
                   from jsonb_array_elements(p_items) x group by 1),
         cur as (select product_id pid, sum(qty) q
                   from order_items where order_id = b.order_id group by 1)
    select coalesce(t.pid,c.pid) pid, coalesce(t.q,0)-coalesce(c.q,0) d
      from tgt t full join cur c on c.pid = t.pid
  loop
    if r.d = 0 then continue; end if;
    if v_shipped then
      -- ส่งของแล้ว: ปรับสต๊อกจริง (ไม่ clamp — ถ้าติดลบให้เห็นตรง ๆ แล้วไปเช็คนับสต๊อก)
      if p_warehouse is null then raise exception 'ต้องระบุคลังสำหรับปรับสต๊อก'; end if;
      update products set stock_qty = coalesce(stock_qty,0) - r.d where id = r.pid;
      update stock set qty = coalesce(qty,0) - r.d
        where product_id = r.pid and warehouse_id = p_warehouse;
      if not found then
        insert into stock(product_id, warehouse_id, qty) values (r.pid, p_warehouse, -r.d);
      end if;
      insert into stock_movements(product_id, type, qty, ref_id, note)
        values (r.pid, 'adjust', -r.d, b.order_id, coalesce(nullif(p_note,''), 'แก้บิล '||b.bill_no||' หลังส่ง'));
    else
      -- ยังไม่ส่ง: ปรับยอดจอง (จองติดลบไม่ได้)
      update products set reserved_qty = greatest(0, coalesce(reserved_qty,0) + r.d) where id = r.pid;
    end if;
    v_deltas := v_deltas || jsonb_build_object(r.pid::text, r.d);
  end loop;

  -- แทนที่รายการทั้งชุดด้วยเป้าหมาย (amount เป็น generated column — DB คำนวณเอง)
  delete from order_items where order_id = b.order_id;
  insert into order_items(order_id, product_id, qty, price)
    select b.order_id, (x->>'product_id')::bigint, (x->>'qty')::numeric, (x->>'price')::numeric
      from jsonb_array_elements(p_items) x;
  select coalesce(sum(qty*price),0) into v_sub from order_items where order_id = b.order_id;
  update orders set total = v_sub where id = b.order_id;

  v_grand := greatest(0, v_sub + coalesce(p_ship,0) - coalesce(p_disc,0));
  v_rev   := coalesce(b.revision,1) + 1;
  v_paid  := coalesce(b.paid_amount,0);
  v_status := b.payment_status;
  -- คิดสถานะใหม่เฉพาะบิลที่ยังถือว่ามีการรับยอดอยู่ (จ่ายครบ/บางส่วน)
  -- บิลที่กด "ยกเลิกรับยอด" ไปแล้ว (unpaid) ไม่ฟื้นสถานะกลับ
  if b.payment_status in ('paid','partial') then
    v_status := case when v_paid + 0.01 >= v_grand then 'paid'
                     when v_paid > 0.009 then 'partial'
                     else 'unpaid' end;
  end if;

  -- ล้างรูปเก่า (ฝั่งเว็บจะวาดเวอร์ชันใหม่แล้วอัปเข้ามาแทน — ถ้าพลาด รูปวาดใหม่ได้เสมอ)
  -- หมายเหตุ: บางคอลัมน์ตั้งห้ามเป็น null — ใช้ค่าว่างแทน
  update bills set
    total = v_grand, shipping_fee = coalesce(p_ship,0), discount = coalesce(p_disc,0),
    revision = v_rev, edit_note = nullif(p_note,''), payment_status = v_status,
    image_url = ''
    where id = p_bill;
  begin
    update bills set page_urls = '[]'::jsonb where id = p_bill;
  exception when others then
    -- เผื่อโปรเจกต์ที่คอลัมน์เป็นชนิด array
    update bills set page_urls = '{}' where id = p_bill;
  end;

  return jsonb_build_object('new_rev', v_rev, 'grand', v_grand, 'sub', v_sub,
    'payment_status', v_status, 'prev_status', b.payment_status,
    'paid_amount', v_paid, 'deltas', v_deltas, 'shipped', v_shipped, 'bill_no', b.bill_no);
end $$;
revoke execute on function apply_bill_edit(bigint,int,jsonb,numeric,numeric,text,bigint,boolean) from public, anon;
grant  execute on function apply_bill_edit(bigint,int,jsonb,numeric,numeric,text,bigint,boolean) to authenticated;
