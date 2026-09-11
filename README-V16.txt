V16 — دیتابیس واقعی + اعلان سفارش + گزارش فروش
==============================================

نسخه V16 بر پایه V15 ساخته شده و این قابلیت‌ها را اضافه می‌کند:

1) SQLite واقعی
- فایل دیتابیس: data/haji.sqlite
- جدول orders برای سفارش‌ها
- جدول order_items برای اقلام هر سفارش
- جدول notifications برای اعلان‌ها
- سفارش‌های JSON قدیمی V15 در اولین اجرا، اگر دیتابیس خالی باشد، به SQLite منتقل می‌شوند.

2) اعلان سفارش
- با ثبت سفارش، اعلان «سفارش جدید دریافت شد» ساخته می‌شود.
- با تغییر وضعیت سفارش نیز اعلان ساخته می‌شود.
- پنل مدیریت تعداد اعلان‌های خوانده‌نشده را نشان می‌دهد.
- امکان باز کردن سفارش از داخل اعلان و علامت‌گذاری اعلان‌ها به‌عنوان خوانده‌شده وجود دارد.

3) گزارش فروش
- تعداد سفارش‌ها
- مجموع درآمد ثبت‌شده
- میانگین مبلغ سفارش
- فروش روزانه
- پرفروش‌ترین قطعات
- گزارش قابل فیلتر با بازه تاریخ

4) امنیت پایه
- ورود مدیر با session cookie
- محدودسازی تلاش‌های ناموفق ورود
- هدرهای امنیتی پایه
- محدودیت اندازه JSON
- عدم نمایش X-Powered-By

5) نیازمندی
- Node.js 22.5 یا بالاتر لازم است، چون V16 از node:sqlite استفاده می‌کند.
- Express از npm نصب می‌شود.

اجرا:
  npm install
  set ADMIN_PASSWORD=یک-رمز-قوی
  npm start

در Linux/macOS:
  ADMIN_PASSWORD='یک-رمز-قوی' npm start

نام کاربری پیش‌فرض: admin
رمز پیش‌فرض اگر تعیین نشود: CHANGE-ME-NOW
حتماً قبل از Production رمز را با متغیر محیطی ADMIN_PASSWORD تغییر دهید.

APIهای اصلی:
POST  /api/orders
POST  /api/admin/login
POST  /api/admin/logout
GET   /api/orders
GET   /api/orders/:id
PATCH /api/orders/:id
DELETE /api/orders/:id
GET   /api/notifications
POST  /api/notifications/read-all
POST  /api/notifications/:id/read
GET   /api/reports/summary
GET   /api/health

نکته Production:
Express توصیه می‌کند برای Production از HTTPS/TLS، reverse proxy مثل Nginx، اجرای NODE_ENV=production و مکانیزم restart استفاده شود. همچنین وابستگی‌ها باید به‌روز و audit شوند.
