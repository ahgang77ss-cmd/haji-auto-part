لوازم یدکی برادران حاجی — نسخه Standalone

این نسخه عمداً Express و npm dependency ندارد.

پیش‌نیاز:
- Node.js 22.5 یا بالاتر
- نسخه‌های جدید Node مثل 24.x کاملاً مناسب هستند.

اجرای سایت:
1) این پوشه را کامل استخراج کن.
2) وارد پوشه site شو.
3) روی start-windows.bat دوبار کلیک کن.
4) پنجره مشکی را نبند.
5) در Chrome برو به:
   http://localhost:3000

پنل مدیریت:
   http://localhost:3000/admin

بررسی سلامت سرور:
   http://localhost:3000/api/health

اطلاعات ورود پیش‌فرض پنل:
   username: admin
   password: CHANGE-ME-NOW

نکته مهم:
- npm install لازم نیست.
- اتصال به registry.npmjs.org لازم نیست.
- Express نصب نمی‌شود.
- دیتابیس SQLite با node:sqlite خود Node ساخته می‌شود.

اگر سایت باز نشد، check-server.bat را اجرا کن و متن پنجره مشکی را بفرست.
