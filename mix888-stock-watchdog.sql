-- ============================================================
--  Mix Fresh 168 — 🩺 ตัวตรวจสต๊อกอัตโนมัติ (stock watchdog) — กันสต๊อกรวมเพี้ยนซ้ำ
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run  (รันซ้ำได้)
--
--  ทำอะไร: ทุก 1 ชั่วโมง ระบบตรวจบัญชีตัวเอง
--   1. สินค้าที่ "สต๊อกรวม" ไม่เท่ากับผลรวมรายโกดัง → ปรับให้ตรง (รายโกดังคือของจริง)
--      พร้อมบันทึกในหน้าเดินสินค้า และแจ้งกลุ่มไลน์กลางว่า ตัวไหนเพี้ยน จากเท่าไรเป็นเท่าไร
--      และ "ความเคลื่อนไหวล่าสุดก่อนเพี้ยนคืออะไร ใครทำ" — จะได้รู้ต้นเหตุทันที ไม่ต้องเดา
--   2. สต๊อกรายโกดังติดลบ → แจ้งเตือนอย่างเดียว (อันนี้ระบบไม่แก้เอง ต้องให้พนักงานเช็คของจริง
--      แล้วแก้ด้วยปุ่ม 🔧 สต๊อก) — ติดลบ = มีการตัดของออกจากโกดังที่ไม่มีของ
--   ⛔ ไม่แตะราคา ไม่แตะยอดรายโกดัง — แก้เฉพาะตัวเลข "สต๊อกรวม" ที่เป็นบัญชีสรุปของระบบเอง
--
--  ถ้าไลน์เตือนโผล่บ่อย ๆ = ยังมีช่องทางที่ทำเลขเพี้ยนอยู่ → ส่งภาพข้อความเตือนให้ Claude ดู
--  (ปกติหลังติดตั้งชุดแก้บั๊กแปลงสินค้าแล้ว ไม่ควรเห็นข้อความเตือนอีกเลย)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function stock_watchdog(p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r record; g record;
  v_fixed int := 0; v_neg int := 0;
  v_lines text := ''; v_neg_lines text := '';
  v_central text; v_msg text;
  v_last text;
begin
  -- 1) สต๊อกรวมไม่ตรงรายโกดัง → ปรับให้ตรง + เก็บหลักฐานว่าก่อนหน้านี้ความเคลื่อนไหวล่าสุดคืออะไร
  for r in
    select p.id, p.sku, p.name, coalesce(p.stock_qty,0) as old_total, s.sum_qty as new_total
      from products p
      join (select product_id, sum(qty) as sum_qty from stock group by product_id) s on s.product_id = p.id
     where coalesce(p.active, true)
       and coalesce(p.stock_qty,0) <> coalesce(s.sum_qty,0)
     order by abs(coalesce(p.stock_qty,0) - coalesce(s.sum_qty,0)) desc
  loop
    -- ความเคลื่อนไหวล่าสุด "ก่อน" ระบบแก้ — คือเบาะแสว่าอะไรทำเพี้ยน
    v_last := null;
    select case coalesce(sm.type,'')
             when 'receive' then 'รับเข้า' when 'sale' then 'ขายออก' when 'ship' then 'ขายออก'
             when 'adjust' then 'ปรับสต๊อก' when 'convert_in' then 'แปลงเข้า' when 'convert_out' then 'แปลงออก'
             when 'transfer_in' then 'โอนเข้า' when 'transfer_out' then 'โอนออก'
             when 'waste' then 'ตีเสีย' when 'receive_cancel' then 'ยกเลิกรับเข้า'
             else coalesce(sm.type,'?') end
           ||' '||coalesce(sm.qty,0)||' โดย '||coalesce(nullif(sm.created_by,''),'ไม่ระบุ')
           ||' เมื่อ '||to_char(sm.created_at at time zone 'Asia/Bangkok','DD/MM HH24:MI')
      into v_last
      from stock_movements sm where sm.product_id = r.id order by sm.id desc limit 1;
    begin
      insert into stock_movements(product_id, type, qty, note, created_by)
      values (r.id, 'adjust', r.new_total - r.old_total,
              '🩺 ตรวจอัตโนมัติ: ยอดรวมไม่ตรงรายโกดัง '||r.old_total||' → '||r.new_total
              ||coalesce(' · ก่อนหน้านี้: '||v_last, ''), 'ระบบ');
    exception when others then null;
    end;
    update products set stock_qty = r.new_total where id = r.id;
    v_fixed := v_fixed + 1;
    if v_fixed <= 8 then
      v_lines := v_lines||E'\n• '||r.sku||' '||r.name||': '||r.old_total||' → '||r.new_total
                 ||coalesce(E'\n   ↳ ล่าสุดก่อนเพี้ยน: '||v_last, '');
    end if;
  end loop;

  -- 2) รายโกดังติดลบ → เตือนอย่างเดียว (พนักงานต้องเช็คของจริงแล้วแก้เองด้วยปุ่ม 🔧 สต๊อก)
  for g in
    select p.sku, p.name, w.name as wh, s.qty
      from stock s join products p on p.id = s.product_id
      left join warehouses w on w.id = s.warehouse_id
     where s.qty < 0 and coalesce(p.active, true)
     order by s.qty asc
  loop
    v_neg := v_neg + 1;
    if v_neg <= 8 then
      v_neg_lines := v_neg_lines||E'\n• '||g.sku||' '||g.name||' @'||coalesce(g.wh,'?')||' = '||g.qty;
    end if;
  end loop;

  -- 3) มีอะไรผิด → แจ้งกลุ่มไลน์กลาง (ไม่มีอะไรผิด = เงียบ ไม่รบกวน)
  if p_notify and (v_fixed > 0 or v_neg > 0) then
    begin
      select value into v_central from settings where key = 'line_central_group';
      if coalesce(v_central,'') <> '' then
        v_msg := '🩺 ตรวจสต๊อกอัตโนมัติ';
        if v_fixed > 0 then
          v_msg := v_msg||E'\nพบสต๊อกรวมไม่ตรงรายโกดัง '||v_fixed||' รายการ — ปรับให้ตรงแล้ว:'||v_lines
                   ||case when v_fixed > 8 then E'\n…และอีก '||(v_fixed-8)||' รายการ (ดูหน้าเดินสินค้า)' else '' end;
        end if;
        if v_neg > 0 then
          v_msg := v_msg||E'\n⚠️ สต๊อกรายโกดังติดลบ '||v_neg||' จุด (ระบบไม่แก้เอง — เช็คของจริงแล้วแก้ด้วยปุ่ม 🔧 สต๊อก):'||v_neg_lines
                   ||case when v_neg > 8 then E'\n…และอีก '||(v_neg-8)||' จุด' else '' end;
        end if;
        v_msg := v_msg||E'\n\nถ้าเห็นข้อความนี้บ่อย แปลว่ายังมีอะไรทำเลขเพี้ยนอยู่ — ส่งภาพนี้ให้ Claude ดูได้เลย';
        perform net.http_post(
          url     := 'https://eqbzpgynzgdwvouuzfwt.supabase.co/functions/v1/line-push',
          headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_HqLNQDwR4omYcb7BNUEKIw_vyHCo4N-"}'::jsonb,
          body    := jsonb_build_object('to', v_central, 'messages',
                       jsonb_build_array(jsonb_build_object('type','text','text', left(v_msg, 4900)))));
      end if;
    exception when others then null;   -- แจ้งไลน์ไม่ได้ ไม่กระทบการซ่อม
  end;
  end if;

  return jsonb_build_object('fixed', v_fixed, 'negative_warehouse_rows', v_neg);
end $$;
revoke execute on function stock_watchdog(boolean) from public, anon, authenticated;

-- ตั้งเวลา: ตรวจทุก 1 ชั่วโมง (นาทีที่ 12)
do $$ begin perform cron.unschedule('stock-watchdog'); exception when others then null; end $$;
select cron.schedule('stock-watchdog', '12 * * * *', $$select stock_watchdog()$$);

-- รันตรวจทันที 1 รอบให้เห็นผลเลย (fixed = ปรับกี่ตัว · negative_warehouse_rows = ติดลบรายโกดังกี่จุด)
select stock_watchdog() as "ผลตรวจรอบแรก";
