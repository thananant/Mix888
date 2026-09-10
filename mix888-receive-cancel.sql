-- ============================================================
--  Mix Fresh 168 — ปุ่ม "↩ ยกเลิกใบรับสินค้า" (ใช้ตอนรับเข้าซ้ำ / รับผิด) — ย้อนสต๊อกที่ใบนั้นบวกเข้าไป
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
--
--  ทำอะไรบ้าง
--   1. เพิ่มช่อง cancelled_at / cancelled_by / cancel_note ให้ตารางใบรับ (stock_receives)
--   2. ฟังก์ชัน receive_cancel(ใบรับ) ทำทีเดียวทั้งใบ:
--      • ลดสต๊อกรายโกดังและยอดรวมของทุกสินค้าในใบนั้น เท่าจำนวนที่เคยบวกเข้า
--      • ลดลอต FIFO ที่สร้างจากใบนั้น (จับคู่ตามสินค้า/จำนวน/เวลาใกล้กัน) — ถ้าลอตถูกขายไปบางส่วนแล้ว ลดได้เท่าที่เหลือ
--      • บันทึกความเคลื่อนไหว type 'receive_cancel' (หน้าเดินสินค้าจะเห็นเป็น "↩ ยกเลิกรับเข้า")
--      • ประทับว่าใบนี้ถูกยกเลิกแล้ว (ยกเลิกซ้ำไม่ได้ · ประวัติยังอยู่ ไม่ลบทิ้ง)
--   ⛔ ระบบไม่ทำอะไรเอง — เกิดจากพนักงานกดปุ่มในหลังบ้านเท่านั้น
-- ============================================================

alter table stock_receives add column if not exists cancelled_at timestamptz;
alter table stock_receives add column if not exists cancelled_by text;
alter table stock_receives add column if not exists cancel_note text;

create or replace function receive_cancel(p_receive_id bigint, p_by text default null, p_note text default null, p_warehouse bigint default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r stock_receives%rowtype;
  it record; lot record;
  wh bigint; fkcol text;
  n_items int := 0; n_lots int := 0; qty_total numeric := 0;
  lines jsonb := '[]'::jsonb;
begin
  select * into r from stock_receives where id = p_receive_id for update;
  if not found then raise exception 'ไม่พบใบรับ #%', p_receive_id; end if;
  if r.cancelled_at is not null then
    raise exception 'ใบรับ % ถูกยกเลิกไปแล้วเมื่อ %', r.receive_no, to_char(r.cancelled_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI');
  end if;

  -- โกดังของใบนี้: ใช้ค่าที่ส่งมา → ช่อง warehouse_id ของใบ (ถ้ามี) → โกดังหลัก
  wh := coalesce(p_warehouse, nullif(to_jsonb(r)->>'warehouse_id','')::bigint);
  if wh is null then
    select id into wh from warehouses where coalesce(is_default,false) order by id limit 1;
    if wh is null then select id into wh from warehouses order by id limit 1; end if;
  end if;

  -- ชื่อคอลัมน์ที่โยงรายการเข้ากับใบรับ (ปกติ receive_id) — หาจาก foreign key จริง กันชื่อไม่ตรง
  select kcu.column_name into fkcol
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
   where tc.table_schema = 'public' and tc.table_name = 'stock_receive_items' and tc.constraint_type = 'FOREIGN KEY'
     and ccu.table_name = 'stock_receives'
   limit 1;
  fkcol := coalesce(fkcol, 'receive_id');

  for it in execute format('select product_id, qty from stock_receive_items where %I = $1', fkcol) using r.id loop
    if it.qty is null or it.qty = 0 then continue; end if;
    n_items := n_items + 1; qty_total := qty_total + it.qty;
    -- 1) สต๊อกรายโกดัง
    update stock set qty = coalesce(qty,0) - it.qty where product_id = it.product_id and warehouse_id = wh;
    if not found then insert into stock(product_id, warehouse_id, qty) values (it.product_id, wh, -it.qty); end if;
    -- 2) ยอดรวม
    update products set stock_qty = coalesce(stock_qty,0) - it.qty where id = it.product_id;
    -- 3) ลอต FIFO ที่สร้างจากใบนี้ (หน้าเว็บสร้างลอตหลังรับเข้า ภายในไม่กี่วินาที ref เริ่มด้วย "รับเข้า")
    select * into lot from stock_lots
      where product_id = it.product_id and qty = it.qty and coalesce(ref,'') like 'รับเข้า%'
        and created_at between r.created_at - interval '2 minutes' and r.created_at + interval '10 minutes'
        and remaining > 0
      order by (remaining >= qty) desc, abs(extract(epoch from (created_at - r.created_at))) limit 1;   -- เอาลอตที่ยังไม่ถูกขายก่อน
    if found then
      update stock_lots set remaining = greatest(0, remaining - it.qty) where id = lot.id;
      n_lots := n_lots + 1;
    end if;
    -- 4) ความเคลื่อนไหว
    insert into stock_movements(product_id, type, qty, ref_id, note, warehouse_id, created_by)
      values (it.product_id, 'receive_cancel', -it.qty, r.id, 'ยกเลิกใบรับ '||coalesce(r.receive_no,'#'||r.id)||coalesce(' — '||nullif(p_note,''),''), wh, p_by);
    lines := lines || jsonb_build_array(jsonb_build_object('product_id', it.product_id, 'qty', it.qty));
  end loop;

  update stock_receives set cancelled_at = now(), cancelled_by = p_by, cancel_note = nullif(p_note,'') where id = r.id;

  return jsonb_build_object('receive_no', r.receive_no, 'warehouse_id', wh, 'items', n_items, 'qty_total', qty_total, 'lots_reduced', n_lots, 'lines', lines);
end $$;
revoke execute on function receive_cancel(bigint, text, text, bigint) from public, anon;
grant  execute on function receive_cancel(bigint, text, text, bigint) to authenticated;
