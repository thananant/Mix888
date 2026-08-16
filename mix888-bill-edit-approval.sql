-- ============================================================
--  Mix Fresh 168 — ระบบขออนุมัติแก้บิล (หลังส่งของ / หลังรับยอด)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  • พนักงานแก้บิลที่ส่งแล้ว/รับยอดแล้ว → กลายเป็น "คำขอแก้บิล" รอ admin
--  • admin เห็นปุ่ม 🛎️ คำขอแก้บิล ในหน้า บัญชี → กดอนุมัติ / ไม่อนุมัติ
--  • ฟังก์ชันปรับสต๊อกใช้ตอนอนุมัติแก้จำนวนสินค้าของบิลที่ส่งของไปแล้ว
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

-- 2) ปรับสต๊อกตอนแก้จำนวนสินค้าของบิลที่ "ส่งของแล้ว"
--    p_delta > 0 = ขายเพิ่ม (ตัดสต๊อกเพิ่ม) · p_delta < 0 = ลดจำนวน/รับของคืน (คืนสต๊อก)
create or replace function bill_edit_stock_adjust(
  p_product bigint, p_delta numeric, p_warehouse bigint, p_note text, p_ref bigint default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_delta = 0 then return; end if;
  update products set stock_qty = greatest(0, coalesce(stock_qty,0) - p_delta) where id = p_product;
  update stock set qty = greatest(0, coalesce(qty,0) - p_delta)
    where product_id = p_product and warehouse_id = p_warehouse;
  if not found then
    insert into stock(product_id, warehouse_id, qty)
    values (p_product, p_warehouse, greatest(0, -p_delta));
  end if;
  insert into stock_movements(product_id, type, qty, ref_id, note)
  values (p_product, 'adjust', -p_delta, p_ref, coalesce(p_note,'แก้บิลหลังส่ง'));
end $$;
revoke execute on function bill_edit_stock_adjust(bigint,numeric,bigint,text,bigint) from public, anon;
grant  execute on function bill_edit_stock_adjust(bigint,numeric,bigint,text,bigint) to authenticated;
