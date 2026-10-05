-- Mix888: ปุ่ม "ลบ" ผู้ใช้ในหน้าผู้ใช้ + ตรวจ/ซ่อมบัญชีล็อกอินพนักงาน
-- รันใน Supabase → SQL Editor ได้เลย (รันซ้ำได้ ไม่เสียหาย)
-- ชื่อผู้ใช้ X ล็อกอินด้วยบัญชี Supabase Auth อีเมล x@mf168.local (ดู authEmail ในหลังบ้าน)

-- 1) ลบผู้ใช้ถาวร: รายชื่อ (app_users) + บัญชีล็อกอิน (auth.users) — เฉพาะ admin · ลบตัวเองไม่ได้ · ต้องเหลือ admin อย่างน้อย 1 คน
--    ประวัติบิล/ออเดอร์/รับยอดเก็บชื่อคนทำเป็นข้อความ → ยังอยู่ครบ
create or replace function app_delete_user(p_username text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me   app_users.id%type;
  v_id   app_users.id%type;
  v_name text;
  v_role text;
  v_auth int := 0;
begin
  select id into v_me from app_users where auth_uid = auth.uid() and active and role = 'admin' limit 1;
  if v_me is null then
    raise exception 'เฉพาะ admin เท่านั้นที่ลบผู้ใช้ได้';
  end if;
  select id, username, role into v_id, v_name, v_role
    from app_users where lower(username) = lower(trim(coalesce(p_username, ''))) limit 1;
  if v_id is null then
    raise exception 'ไม่พบผู้ใช้ "%"', p_username;
  end if;
  if v_id = v_me then
    raise exception 'ลบบัญชีตัวเองไม่ได้';
  end if;
  if v_role = 'admin' and not exists (select 1 from app_users where role = 'admin' and active and id <> v_id) then
    raise exception 'ต้องเหลือ admin ที่ใช้งานได้อย่างน้อย 1 คน';
  end if;
  begin
    delete from app_users where id = v_id;
  exception when foreign_key_violation then
    raise exception 'ลบไม่ได้ — มีข้อมูลอื่นผูกกับผู้ใช้นี้อยู่ ใช้ "ระงับ" แทน (%)', sqlerrm;
  end;
  -- บัญชีล็อกอินของชื่อนี้ (ไม่ลบถ้ายังมีรายชื่ออื่นผูกอยู่) · ลบไม่ได้ก็ไม่เป็นไร: ไม่มีรายชื่อแล้ว = เข้าระบบไม่ได้อยู่ดี
  begin
    delete from auth.users u
     where u.email = lower(v_name) || '@mf168.local'
       and not exists (select 1 from app_users b where b.auth_uid = u.id);
    get diagnostics v_auth = row_count;
  exception when others then
    v_auth := -1;
  end;
  return jsonb_build_object('deleted', v_name, 'auth', v_auth);
end $$;
revoke execute on function app_delete_user(text) from public, anon;
grant execute on function app_delete_user(text) to authenticated;

-- 2) ซ่อมบัญชีล็อกอินพนักงานที่เข้าไม่ได้ (ไม่แตะรหัสผ่าน · ไม่แตะสถานะ ใช้งาน/ระงับ)
--    ยังไม่ยืนยันอีเมล → ยืนยันให้ (อีเมล @mf168.local เป็นอีเมลสมมติ ยืนยันทางเมลไม่ได้อยู่แล้ว)
update auth.users set email_confirmed_at = now()
 where email like '%@mf168.local' and email_confirmed_at is null;
--    รายชื่อผูกกับบัญชีล็อกอินผิดตัว/ยังไม่ผูก → ผูกกับบัญชีชื่อเดียวกัน (ถ้าบัญชีนั้นไม่ได้ผูกกับรายชื่ออื่นอยู่)
update app_users a set auth_uid = u.id
  from auth.users u
 where u.email = lower(a.username) || '@mf168.local'
   and a.auth_uid is distinct from u.id
   and not exists (select 1 from app_users b where b.auth_uid = u.id and b.id <> a.id);

-- 3) ผลตรวจ: ทุกคนควรขึ้น "✅ ปกติ" · ถ้าขึ้น ระงับ → หน้าผู้ใช้ กด "เปิดใช้"
select a.username as "ผู้ใช้",
       a.display_name as "ชื่อ",
       case when a.active then 'ใช้งาน' else '⛔ ระงับ (กด เปิดใช้ ในหน้าผู้ใช้)' end as "สถานะ",
       case when u.id is null then '❌ ไม่มีบัญชีล็อกอิน'
            when u.banned_until > now() then '⛔ ถูกแบนใน Supabase'
            when u.email_confirmed_at is null then '⚠️ ยังไม่ยืนยัน'
            when a.auth_uid is distinct from u.id then '⚠️ ผูกบัญชีผิดตัว'
            else '✅ ปกติ' end as "บัญชีล็อกอิน",
       coalesce(to_char(u.last_sign_in_at at time zone 'Asia/Bangkok', 'DD/MM/YY HH24:MI'), 'ยังไม่เคยเข้า') as "เข้าล่าสุด"
  from app_users a
  left join auth.users u on u.email = lower(a.username) || '@mf168.local'
 order by a.username;
