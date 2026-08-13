-- ============================================================
--  Mix Fresh 168 — ประตูส่งออกข้อมูลบิลให้โปรแกรมเก็บเข้า NAS
--  รันทั้งไฟล์ใน Supabase (โปรเจกต์ Mix Fresh) → SQL Editor → Run
--  รันซ้ำได้ ไม่กระทบระบบเดิม
--
--  ตาราง bills ถูกล็อกด้วย RLS (อ่านได้เฉพาะผู้ที่ล็อกอิน) ตัวโปรแกรม
--  บน NAS จึงอ่านตรงไม่ได้ — ฟังก์ชันนี้เป็นช่องทางเดียวที่เปิดให้
--  โดยต้องแนบรหัสลับ (p_key) ที่ตรงกันเท่านั้น และให้ข้อมูลเฉพาะ
--  ที่จำเป็นต่อการเก็บไฟล์บิล ไม่เปิดสิทธิ์เขียน/ลบใด ๆ
-- ============================================================

create or replace function nas_export_bills(p_key text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_key is null or p_key <> 'PASTE_NAS_EXPORT_KEY_HERE' then
    raise exception 'BAD_KEY';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'created_at'))
      from (
        select jsonb_build_object(
          'id',             b.id,
          'bill_no',        b.bill_no,
          'total',          b.total,
          'shipping_fee',   b.shipping_fee,
          'discount',       b.discount,
          'revision',       b.revision,
          'created_at',     b.created_at,
          'payment_status', b.payment_status,
          'paid_at',        b.paid_at,
          'pay_method',     b.pay_method,
          'ship_status',    b.ship_status,
          'image_url',      b.image_url,
          'page_urls',      b.page_urls,
          'slip_url',       b.slip_url,
          'customers', (select jsonb_build_object('code', c.code, 'name', c.name, 'branch_name', c.branch_name)
                          from customers c where c.id = b.customer_id),
          'orders',    (select jsonb_build_object('order_no', o.order_no)
                          from orders o where o.id = b.order_id),
          'payments',  coalesce((select jsonb_agg(jsonb_build_object(
                                          'amount', p.amount, 'created_at', p.created_at, 'slips', p.slips)
                                        order by p.id)
                                   from payments p where p.bill_id = b.id), '[]'::jsonb)
        ) as x
        from bills b
        where b.created_at >= p_since
      ) s), '[]'::jsonb);
end $$;
