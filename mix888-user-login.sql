-- Mix888: ตั้งรหัสผ่านแล้วล็อกอินได้จริง — ปุ่ม "บันทึก" ในหน้าผู้ใช้ตั้งรหัสในระบบล็อกอิน (Supabase Auth) ให้ด้วย
-- รันใน Supabase → SQL Editor ได้เลย (รันซ้ำได้ ไม่เสียหาย) · รันครั้งเดียว แล้วใช้หน้าผู้ใช้ตามปกติ
-- เหตุ: ตั้งแต่ 23/07 หลังบ้านล็อกอินผ่าน Supabase Auth อย่างเดียว (อีเมล ชื่อผู้ใช้@mf168.local)
--      แต่ app_set_user (ตัวบันทึกผู้ใช้เดิม) ไม่ได้ตั้งรหัสในระบบนั้น → ผู้ใช้ใหม่/รหัสใหม่ เข้าไม่ได้ ขึ้น "รหัสผ่านไม่ถูกต้อง"

-- 1) ตั้งรหัสเข้าระบบของผู้ใช้ 1 คน: มีบัญชีล็อกอินแล้ว = เปลี่ยนรหัส · ยังไม่มี = สร้างให้ (แบบเดียวกับที่ Supabase สร้าง)
--    เฉพาะ admin · ผูกรายชื่อกับบัญชีล็อกอินให้ด้วย · หลังบ้านเรียกต่อจาก app_set_user ทุกครั้งที่ใส่รหัสแล้วกดบันทึก
create or replace function app_set_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = extensions, public, pg_temp as $$   -- extensions ก่อน: crypt/gen_salt ของ pgcrypto ไม่โดนฟังก์ชันชื่อซ้ำใน public แทนที่
declare
  v_name  text := lower(trim(coalesce(p_username, '')));
  v_email text;
  v_uid   uuid;
  v_inst  uuid;
  v_new   boolean := false;
  c       text;
begin
  if not exists (select 1 from app_users where auth_uid = auth.uid() and active and role = 'admin') then
    raise exception 'เฉพาะ admin เท่านั้นที่ตั้งรหัสผ่านได้';
  end if;
  if v_name = '' or v_name ~ '[[:space:]@]' then
    raise exception 'ชื่อผู้ใช้ "%" ใช้ไม่ได้ (ห้ามมีช่องว่าง หรือ @)', p_username;
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'รหัสผ่านอย่างน้อย 4 ตัวอักษร';
  end if;
  if (select count(*) from app_users where lower(username) = v_name) <> 1 then
    raise exception 'ไม่พบผู้ใช้ "%" (หรือมีชื่อซ้ำกัน)', p_username;
  end if;
  v_email := v_name || '@mf168.local';
  select id into v_uid from auth.users where lower(email) = v_email order by created_at limit 1;
  if v_uid is null then
    select instance_id into v_inst from auth.users where instance_id is not null limit 1;
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values (coalesce(v_inst, '00000000-0000-0000-0000-000000000000'), v_uid, 'authenticated', 'authenticated', v_email,
            crypt(p_password, gen_salt('bf', 10)), now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    v_new := true;
  else
    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf', 10)),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until = null,
           updated_at = now()
     where id = v_uid;
  end if;
  -- ช่อง token ที่ว่าง (NULL) ทำให้ Supabase ล็อกอินพัง ("Database error querying schema") → ใส่ค่าว่าง
  for c in select column_name from information_schema.columns
            where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
              and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                                  'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %1$I = '''' where id = $1 and %1$I is null', c) using v_uid;
  end loop;
  -- ตัวตนแบบอีเมล (Supabase ใช้คู่กับบัญชี) — ยังไม่มีก็สร้าง
  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
      execute 'insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               values ($1, $2, $3, ''email'', now(), now(), now())'
        using v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false);
    else
      execute 'insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               values ($1, $2, $3, ''email'', now(), now(), now())'
        using v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email);
    end if;
  end if;
  -- ผูกรายชื่อ ↔ บัญชีล็อกอิน (ถ้าบัญชีนี้เคยผูกกับรายชื่ออื่นผิดตัว ปลดออก)
  update app_users set auth_uid = null where auth_uid = v_uid and lower(username) <> v_name;
  update app_users set auth_uid = v_uid where lower(username) = v_name;
  return jsonb_build_object('user', v_name, 'created', v_new);
end $$;
revoke execute on function app_set_login(text, text) from public, anon;
grant execute on function app_set_login(text, text) to authenticated;

-- 2) ซ่อมบัญชีล็อกอินพนักงานที่มีอยู่ (ไม่แตะรหัสผ่าน · ไม่แตะสถานะ ใช้งาน/ระงับ)
--    ช่อง token ว่าง (NULL) → ล็อกอินพัง "Database error querying schema" และหน้ารายชื่อผู้ใช้ใน Supabase เปิดไม่ขึ้น → ใส่ค่าว่าง
do $$
declare c text;
begin
  for c in select column_name from information_schema.columns
            where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
              and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                                  'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %1$I = '''' where email like ''%%@mf168.local'' and %1$I is null', c);
  end loop;
end $$;
--    ยังไม่ยืนยันอีเมล → ยืนยันให้ (อีเมล @mf168.local เป็นอีเมลสมมติ ยืนยันทางเมลไม่ได้อยู่แล้ว)
update auth.users set email_confirmed_at = now()
 where email like '%@mf168.local' and email_confirmed_at is null;
--    รายชื่อที่ยังไม่ผูกกับบัญชีล็อกอิน → ผูกกับบัญชีชื่อเดียวกัน (เฉพาะที่ชัดเจน: ชื่อไม่ซ้ำ และบัญชีนั้นไม่ได้ผูกกับรายชื่ออื่น)
update app_users a set auth_uid = u.id
  from auth.users u
 where lower(u.email) = lower(a.username) || '@mf168.local'
   and a.auth_uid is null
   and (select count(*) from app_users c where lower(c.username) = lower(a.username)) = 1
   and not exists (select 1 from app_users b where b.auth_uid = u.id);

-- 3) ผลตรวจ: ทุกคนควรขึ้น "✅ เข้าได้" — ถ้าไม่ใช่ ไปหน้าผู้ใช้ กดแก้ไข ใส่รหัสใหม่ แล้วบันทึก
select a.username as "ผู้ใช้",
       case when a.active then 'ใช้งาน' else '⛔ ระงับ' end as "สถานะ",
       case when u.id is null then '❌ ยังไม่มีบัญชีล็อกอิน → แก้ไข ใส่รหัสใหม่ บันทึก'
            when coalesce(u.encrypted_password, '') !~ '^\$2[aby]\$' then '❌ รหัสในระบบล็อกอินใช้ไม่ได้ → แก้ไข ใส่รหัสใหม่ บันทึก'
            when u.email_confirmed_at is null then '⚠️ ยังไม่ยืนยัน → แก้ไข ใส่รหัสใหม่ บันทึก'
            when u.confirmation_token is null or u.recovery_token is null then '⚠️ ข้อมูลบัญชีไม่ครบ → แก้ไข ใส่รหัสใหม่ บันทึก'
            when a.auth_uid is distinct from u.id then '⚠️ ยังไม่ผูก (ผูกเองตอนเข้าครั้งแรก)'
            else '✅ เข้าได้' end as "ระบบล็อกอิน",
       coalesce(to_char(u.last_sign_in_at at time zone 'Asia/Bangkok', 'DD/MM/YY HH24:MI'), 'ยังไม่เคยเข้า') as "เข้าล่าสุด"
  from app_users a
  left join auth.users u on lower(u.email) = lower(a.username) || '@mf168.local'
 order by a.username;
