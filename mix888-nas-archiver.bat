@echo off
title Mix888 NAS Archiver
cd /d %~dp0
echo กำลังเปิดโปรแกรมเก็บบิลเข้า NAS...
node mix888-nas-archiver.js
echo.
echo โปรแกรมหยุดทำงาน — ถ้าขึ้นว่าไม่รู้จักคำสั่ง node ให้ติดตั้ง Node.js ก่อน (https://nodejs.org)
pause
