-- ============================================================
--  Mix Fresh 168 — ตรวจสอบ "แปลงสินค้าแล้วสต๊อกโป่ง" (อ่านอย่างเดียว ไม่แก้ข้อมูลใด ๆ)
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  แล้วกด "Download CSV" (หรือถ่ายรูปผลลัพธ์ทั้งหมด) ส่งกลับมาให้ดูครับ
--
--  ไฟล์นี้ดึงมาให้ดู 6 อย่าง:
--   1. โค้ดจริงของฟังก์ชัน convert_stock / stock_add / stock_adjust / place_order_v2 / get_customer_catalog
--   2. ทริกเกอร์ (ตัวทำงานอัตโนมัติ) บนตารางสต๊อก — ถ้ามีตัวบวกสต๊อกซ้ำจะเห็นตรงนี้
--   3. สินค้าที่ยอด products.stock_qty (ตัวเลขที่หน้าลูกค้าใช้) ไม่ตรงกับยอดรวมรายโกดัง (ตาราง stock)
--   4. ประวัติแปลงสินค้า 20 ครั้งล่าสุด
--   5. ความเคลื่อนไหวสต๊อกที่เกิดรอบ ๆ การแปลง 10 ครั้งล่าสุด (ดูว่าบวกซ้ำหรือไม่ตัดต้นทาง)
--   6. ยอดลอต FIFO ของสินค้าที่เคยแปลง เทียบกับ stock_qty
-- ============================================================

drop table if exists pg_temp.diag;
create temp table diag(id serial, sec text, line text);

do $$
begin
  -- 1) โค้ดฟังก์ชัน
  begin
    insert into diag(sec,line)
      select '1 ฟังก์ชัน '||p.proname, pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('convert_stock','stock_add','stock_adjust','place_order_v2','get_customer_catalog','fifo_take')
       order by p.proname;
    if not found then insert into diag(sec,line) values ('1 ฟังก์ชัน','ไม่พบฟังก์ชันชื่อเหล่านี้ใน schema public'); end if;
  exception when others then insert into diag(sec,line) values ('1 ฟังก์ชัน','อ่านไม่ได้: '||sqlerrm); end;

  -- 2) ทริกเกอร์บนตารางสต๊อก
  begin
    insert into diag(sec,line)
      select '2 ทริกเกอร์ '||event_object_table,
             trigger_name||' → '||action_timing||' '||event_manipulation||' : '||action_statement
        from information_schema.triggers
       where event_object_schema = 'public'
         and event_object_table in ('stock','products','conversions','stock_movements','stock_lots','order_items','orders')
       order by event_object_table, trigger_name;
    if not found then insert into diag(sec,line) values ('2 ทริกเกอร์','ไม่มีทริกเกอร์บนตารางสต๊อกเลย'); end if;
  exception when others then insert into diag(sec,line) values ('2 ทริกเกอร์','อ่านไม่ได้: '||sqlerrm); end;

  -- 3) สินค้าที่ stock_qty ไม่ตรงกับยอดรวมรายโกดัง
  begin
    insert into diag(sec,line)
      select '3 สต๊อกไม่ตรง',
             format('%s %s | หน้าลูกค้าเห็น(stock_qty)=%s | รวมทุกโกดัง=%s | ต่าง=%s | จองอยู่=%s',
                    p.sku, p.name, coalesce(p.stock_qty,0), coalesce(s.sum_qty,0),
                    coalesce(p.stock_qty,0) - coalesce(s.sum_qty,0), coalesce(p.reserved_qty,0))
        from products p
        left join (select product_id, sum(qty) sum_qty from stock group by product_id) s on s.product_id = p.id
       where coalesce(p.active,true)
         and coalesce(p.stock_qty,0) <> coalesce(s.sum_qty,0)
       order by abs(coalesce(p.stock_qty,0) - coalesce(s.sum_qty,0)) desc
       limit 80;
    if not found then insert into diag(sec,line) values ('3 สต๊อกไม่ตรง','✅ ทุกสินค้า stock_qty ตรงกับยอดรวมรายโกดัง'); end if;
  exception when others then insert into diag(sec,line) values ('3 สต๊อกไม่ตรง','อ่านไม่ได้: '||sqlerrm); end;

  -- 4) ประวัติแปลงล่าสุด
  begin
    insert into diag(sec,line)
      select '4 แปลงล่าสุด',
             format('%s | %s | %s −%s → %s +%s | โกดัง %s | โดย %s | %s',
                    to_char(c.created_at at time zone 'Asia/Bangkok','DD/MM HH24:MI:SS'), coalesce(c.cv_no,'-'),
                    coalesce(pf.name,'?'), c.from_qty, coalesce(pt.name,'?'), c.to_qty,
                    c.warehouse_id, coalesce(c.created_by,'-'), coalesce(c.note,''))
        from conversions c
        left join products pf on pf.id = c.from_product
        left join products pt on pt.id = c.to_product
       order by c.created_at desc limit 20;
    if not found then insert into diag(sec,line) values ('4 แปลงล่าสุด','ยังไม่มีการแปลงสินค้า'); end if;
  exception when others then insert into diag(sec,line) values ('4 แปลงล่าสุด','อ่านไม่ได้: '||sqlerrm); end;

  -- 5) ความเคลื่อนไหวสต๊อกรอบการแปลง 10 ครั้งล่าสุด (±2 นาที)
  begin
    insert into diag(sec,line)
      select '5 รอบแปลง '||coalesce(c.cv_no,to_char(c.created_at,'HH24:MI')),
             format('%s | %s | %s | qty %s | โกดัง %s | ref %s | %s',
                    to_char(m.created_at at time zone 'Asia/Bangkok','DD/MM HH24:MI:SS'), m.type, p.name, m.qty,
                    coalesce(m.warehouse_id::text,'-'), coalesce(m.ref_id::text,'-'), coalesce(m.note,''))
        from (select * from conversions order by created_at desc limit 10) c
        join stock_movements m
          on m.product_id in (c.from_product, c.to_product)
         and m.created_at between c.created_at - interval '2 minutes' and c.created_at + interval '2 minutes'
        join products p on p.id = m.product_id
       order by c.created_at desc, m.created_at;
    if not found then insert into diag(sec,line) values ('5 รอบแปลง','ไม่พบ stock_movements รอบการแปลงเลย (ฟังก์ชันแปลงอาจไม่ได้บันทึกความเคลื่อนไหว)'); end if;
  exception when others then insert into diag(sec,line) values ('5 รอบแปลง','อ่านไม่ได้: '||sqlerrm); end;

  -- 6) ลอต FIFO ของสินค้าที่เคยแปลง
  begin
    insert into diag(sec,line)
      select '6 ลอต FIFO',
             format('%s %s | stock_qty=%s | รวมโกดัง=%s | รวมลอตคงเหลือ=%s',
                    p.sku, p.name, coalesce(p.stock_qty,0),
                    (select coalesce(sum(qty),0) from stock where product_id = p.id),
                    (select coalesce(sum(remaining),0) from stock_lots where product_id = p.id))
        from products p
       where p.id in (select from_product from conversions union select to_product from conversions)
       order by p.name limit 80;
    if not found then insert into diag(sec,line) values ('6 ลอต FIFO','ไม่มีสินค้าที่เคยแปลง'); end if;
  exception when others then insert into diag(sec,line) values ('6 ลอต FIFO','อ่านไม่ได้: '||sqlerrm); end;
end $$;

select sec as "หัวข้อ", line as "รายละเอียด" from diag order by id;
