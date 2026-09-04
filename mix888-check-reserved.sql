-- ============================================================
--  Mix Fresh 168 — ตรวจ "จองรอส่ง" ที่ค้างเกินจริง (สินค้ามีของ แต่ขึ้น "หมด" เพราะยอดจองกินหมด)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  ⛔ ไฟล์นี้ "ยังไม่แก้ตัวเลข" — แค่ติดตั้งเครื่องมือ แล้วโชว์รายการที่ยอดจองไม่ตรงให้ดูก่อน
--
--  หลักการ: "จองรอส่ง" (products.reserved_qty) ควรเท่ากับจำนวนที่อยู่ในออเดอร์ที่ยังไม่ส่ง
--  = ออเดอร์ที่ไม่ได้ยกเลิก และบิลยังไม่ถูกส่ง/ยกเลิก (ส่งแล้ว = ตัดสต๊อกจริงและคืนจองไปแล้ว)
--  ถ้ายอดจองในระบบมากกว่านั้น = จองค้าง (มักเกิดจากบิลที่ถูกลบ/แก้/ส่งโดยไม่ได้คืนจอง)
--
--   • ดูก่อน (ไม่แก้อะไร):  select * from reserved_resync();
--   • ปรับจริง:             select * from reserved_resync(true);
--  ตารางที่ได้จะบอกด้วยว่า ออเดอร์ไหนบ้างที่ยังรอส่งและกินยอดจองอยู่ — เช็คได้ว่าจริงไหม
-- ============================================================

create or replace function reserved_resync(p_apply boolean default false)
returns table(sku text, "สินค้า" text, "จองในระบบ" numeric, "จองที่ควรเป็น" numeric, "ต่าง" numeric,
              "สต๊อกรวม" numeric, "ออเดอร์ที่รอส่ง" text, "สถานะ" text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in
    with pending as (
      -- ออเดอร์ที่ยังถือว่า "รอส่ง" = ไม่ยกเลิก และไม่มีบิลที่ส่งแล้ว/ยกเลิกแล้ว
      select o.id, o.order_no
        from orders o
       where coalesce(o.status,'') <> 'cancelled'
         and not exists (select 1 from bills b where b.order_id = o.id and b.ship_status in ('shipped','cancelled'))
    ),
    need as (
      select oi.product_id, sum(oi.qty) as qty,
             string_agg(p.order_no||' ('||oi.qty||')', ', ' order by p.order_no) as ords
        from order_items oi join pending p on p.id = oi.order_id
       group by oi.product_id
    )
    select pr.id, pr.sku, pr.name, coalesce(pr.reserved_qty,0) as cur, coalesce(n.qty,0) as want,
           coalesce(pr.stock_qty,0) as total, coalesce(n.ords,'— ไม่มีออเดอร์รอส่ง —') as ords
      from products pr left join need n on n.product_id = pr.id
     where coalesce(pr.reserved_qty,0) <> coalesce(n.qty,0)
     order by abs(coalesce(pr.reserved_qty,0) - coalesce(n.qty,0)) desc, pr.sku
  loop
    if p_apply then
      update products set reserved_qty = r.want where id = r.id;
      begin
        insert into stock_movements(product_id, type, qty, note, created_by)
        values (r.id, case when r.want < r.cur then 'unreserve' else 'reserve' end, abs(r.want - r.cur),
                'ปรับยอดจองให้ตรงกับออเดอร์ที่รอส่ง '||r.cur||' → '||r.want, 'ระบบ');
      exception when others then null;
      end;
    end if;
    sku := r.sku; "สินค้า" := r.name; "จองในระบบ" := r.cur; "จองที่ควรเป็น" := r.want; "ต่าง" := r.want - r.cur;
    "สต๊อกรวม" := r.total; "ออเดอร์ที่รอส่ง" := r.ords;
    "สถานะ" := case when p_apply then '✅ ปรับแล้ว' else 'ยังไม่ปรับ (ดูเฉย ๆ)' end;
    return next;
  end loop;
  return;
end $$;
revoke execute on function reserved_resync(boolean) from public, anon;
grant  execute on function reserved_resync(boolean) to authenticated;

-- โชว์รายการที่ยอดจองไม่ตรง (ยังไม่แก้) — ถ้าดูแล้วโอเค รัน:  select * from reserved_resync(true);
select * from reserved_resync();
