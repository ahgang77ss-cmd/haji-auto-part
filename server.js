const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'haji.sqlite');
const LEGACY_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery TEXT,
  address TEXT,
  postal_code TEXT,
  note TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1,
  compat TEXT,
  img TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  order_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 2,
  reserved INTEGER NOT NULL DEFAULT 0,
  managed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL DEFAULT 'cash_on_delivery',
  status TEXT NOT NULL DEFAULT 'pending',
  amount INTEGER NOT NULL DEFAULT 0,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS customers (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_stock ON inventory(stock, min_stock);
CREATE INDEX IF NOT EXISTS idx_inventory_managed ON inventory(managed);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read, created_at);
`);

// Migration: databases created by an earlier version of this file may not have
// the "managed" column yet. Add it if missing so old data/haji.sqlite files keep working.
try {
  const cols = db.prepare("PRAGMA table_info(inventory)").all().map(c => c.name);
  if (!cols.includes('managed')) db.exec('ALTER TABLE inventory ADD COLUMN managed INTEGER NOT NULL DEFAULT 0');
} catch (e) { console.error('Inventory migration failed:', e.message); }
try {
  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes('postal_code')) db.exec('ALTER TABLE orders ADD COLUMN postal_code TEXT');
} catch (e) { console.error('Orders migration failed:', e.message); }

// Phone numbers get typed in all sorts of formats (+98..., 0098..., with spaces/dashes,
// without the leading 0). Normalize everything to the local 11-digit "09xxxxxxxxx" form
// so admin-phone matching and "my orders" lookups are reliable regardless of how it was typed.
function normalizePhone(v) {
  let s = String(v ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 10) s = '0' + s;
  return s;
}
const ADMINS = [
  { phone: normalizePhone(process.env.ADMIN1_PHONE || '+989191816422'), password: process.env.ADMIN1_PASSWORD || 'CHANGE-ME-ADMIN-1' },
  { phone: normalizePhone(process.env.ADMIN2_PHONE || '+989105694177'), password: process.env.ADMIN2_PASSWORD || 'CHANGE-ME-ADMIN-2' }
];
function findAdmin(phone) { const n = normalizePhone(phone); return ADMINS.find(a => a.phone === n) || null; }

function clean(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
// Defensive: strip a leading Persian "کد:" label if it ever ends up baked into a sku value.
function cleanSku(v, max = 80) { return clean(v, max).replace(/^کد\s*:\s*/, '').trim(); }
function faMoney(n) { return Number(n || 0); }
function now() { return new Date().toISOString(); }
function newOrderId() {
  return 'HJ-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function rowToOrder(row) {
  if (!row) return null;
  const items = db.prepare('SELECT sku,name,price,qty,compat,img FROM order_items WHERE order_id=? ORDER BY id').all(row.id);
  return {
    id: row.id, name: row.name, phone: row.phone, delivery: row.delivery,
    address: row.address, postalCode: row.postal_code, note: row.note, total: row.total, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, items
  };
}
function allOrders() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(rowToOrder);
}

// One-time migration from the older JSON order store.
const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
if (orderCount === 0 && fs.existsSync(LEGACY_FILE)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')) || [];
    const insOrder = db.prepare('INSERT OR IGNORE INTO orders(id,name,phone,delivery,address,note,total,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const insItem = db.prepare('INSERT INTO order_items(order_id,sku,name,price,qty,compat,img) VALUES(?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (const o of legacy) {
      insOrder.run(o.id, clean(o.name, 120), clean(o.phone, 40), clean(o.delivery, 40), clean(o.address, 500), clean(o.note, 800), faMoney(o.total), clean(o.status, 30) || 'new', o.createdAt || now(), o.updatedAt || o.createdAt || now());
      for (const x of (Array.isArray(o.items) ? o.items : [])) {
        insItem.run(o.id, clean(x.sku, 80), clean(x.name, 180), faMoney(x.price), Math.max(1, Math.min(999, Number(x.qty) || 1)), clean(x.compat, 180), clean(x.img, 500));
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Legacy migration failed:', e.message);
  }
}

// Seed inventory from the catalog. Existing stock values are preserved.
try {
  const catalogPath = path.join(ROOT, 'price-catalog.json');
  if (fs.existsSync(catalogPath)) {
    const catalogRaw = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) || [];
    const catalog = Array.isArray(catalogRaw) ? catalogRaw : (Array.isArray(catalogRaw.products) ? catalogRaw.products : []);
    const ins = db.prepare('INSERT OR IGNORE INTO inventory(sku,name,stock,min_stock,reserved,managed,updated_at) VALUES(?,?,?,?,?,?,?)');
    const t = now();
    for (const item of catalog) {
      const sku = cleanSku(item.sku || item.id || '');
      const name = clean(item.name || 'قطعه', 180);
      if (sku && name) ins.run(sku, name, 0, 2, 0, 0, t);
    }
  }
} catch (e) { console.error('Inventory seed failed:', e.message); }

const sessions = new Map();
const customerSessions = new Map();
const loginAttempts = new Map();

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}
function clientKey(req, body) { return `${req.socket.remoteAddress || 'unknown'}:${normalizePhone(body?.phone || body?.username)}`; }
function loginBlocked(req, body) {
  const x = loginAttempts.get(clientKey(req, body));
  return !!(x && x.until > Date.now());
}
function markFailed(req, body) {
  const k = clientKey(req, body);
  const x = loginAttempts.get(k) || { count: 0, until: 0 };
  x.count++;
  if (x.count >= 5) { x.until = Date.now() + 10 * 60 * 1000; x.count = 0; }
  loginAttempts.set(k, x);
}
function markSuccess(req, body) { loginAttempts.delete(clientKey(req, body)); }

function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}
function text(res, status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
function unauthorized(res) { return json(res, 401, { ok: false, error: 'unauthorized' }); }
function getAuthToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return parseCookies(req).haji_admin;
}
function isAuthed(req) {
  const token = getAuthToken(req);
  return !!(token && sessions.has(token));
}
function getCustomerToken(req) { return parseCookies(req).haji_customer; }
function currentCustomer(req) {
  const token = getCustomerToken(req);
  const s = token && customerSessions.get(token);
  if (!s) return null;
  return db.prepare('SELECT phone,name FROM customers WHERE phone=?').get(s.phone) || null;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8'
  })[ext] || 'application/octet-stream';
}
function safeStaticPath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath); } catch { return null; }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/categories') pathname = '/categories.html';
  if (pathname === '/order-success') pathname = '/order-success.html';
  const candidate = path.resolve(ROOT, '.' + pathname);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;
  return candidate;
}
function serveStatic(req, res, pathname) {
  const file = safeStaticPath(pathname);
  if (!file) return text(res, 400, 'Bad Request');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return text(res, 404, 'Not Found');
    // HTML pages and JSON data change whenever we update the site, so they must never be
    // cached by the browser (this was the bug: an old index.html could sit in the browser's
    // cache for up to an hour and a normal refresh wouldn't show a newly deployed change).
    // Only truly static assets (images, icons, fonts, css/js files) get long-lived caching.
    const noCache = file.endsWith('.html') || file.endsWith('.json');
    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Cache-Control': noCache ? 'no-store' : 'public, max-age=3600'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 256 * 1024) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] || '').split(';')[0].trim();
      try {
        if (type === 'application/json' || !type) return resolve(JSON.parse(raw));
        if (type === 'application/x-www-form-urlencoded') return resolve(Object.fromEntries(new URLSearchParams(raw)));
        resolve({});
      } catch (e) { reject(Object.assign(new Error('invalid json'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function matchPath(pathname, pattern) {
  const a = pathname.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (b[i] !== a[i]) return null;
  }
  return params;
}

async function handleApi(req, res, url, body) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'haji-orders-standalone', database: 'sqlite', time: now() });
  }

  if (method === 'POST' && pathname === '/api/orders') {
    const name = clean(body.name, 120), phone = normalizePhone(body.phone) || clean(body.phone, 40), delivery = clean(body.delivery, 40), address = clean(body.address, 500), postalCode = clean(body.postalCode, 20).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d]/g, ''), note = clean(body.note, 800);
    const items = Array.isArray(body.items) ? body.items.map(x => ({
      sku: cleanSku(x.sku), name: clean(x.name, 180), price: Math.max(0, Number(x.price) || 0),
      qty: Math.max(1, Math.min(999, Number(x.qty) || 1)), compat: clean(x.compat, 180), img: clean(x.img, 500)
    })).slice(0, 100) : [];
    if (!name || !phone || !items.length) return json(res, 400, { ok: false, error: 'نام، شماره تماس و اقلام سفارش الزامی است.' });
    const total = items.reduce((s, x) => s + x.price * x.qty, 0), id = newOrderId(), t = now();
    try {
      db.exec('BEGIN');
      for (const x of items) {
        if (!x.sku) continue;
        const inv = db.prepare('SELECT stock,reserved,name,managed FROM inventory WHERE sku=?').get(x.sku);
        // Only block the order if this sku is actively stock-managed (admin has set a real stock number for it).
        // Unmanaged skus (the default for a freshly-seeded catalog) are always orderable, same as before inventory existed.
        if (inv && inv.managed && (inv.stock - inv.reserved) < x.qty) {
          db.exec('ROLLBACK');
          return json(res, 409, { ok: false, error: `موجودی «${inv.name}» برای تعداد درخواستی کافی نیست. موجودی قابل فروش: ${Math.max(0, inv.stock - inv.reserved)}` });
        }
      }
      db.prepare('INSERT INTO orders(id,name,phone,delivery,address,postal_code,note,total,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, name, phone, delivery, address, postalCode, note, total, 'new', t, t);
      const ins = db.prepare('INSERT INTO order_items(order_id,sku,name,price,qty,compat,img) VALUES(?,?,?,?,?,?,?)');
      const reserve = db.prepare('UPDATE inventory SET reserved=reserved+?,updated_at=? WHERE sku=?');
      for (const x of items) { ins.run(id, x.sku, x.name, x.price, x.qty, x.compat, x.img); if (x.sku) reserve.run(x.qty, t, x.sku); }
      db.prepare('INSERT INTO payments(order_id,method,status,amount,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, 'cash_on_delivery', 'pending', total, t, t);
      db.prepare('INSERT INTO notifications(type,order_id,title,body,created_at) VALUES(?,?,?,?,?)').run('new_order', id, 'سفارش جدید دریافت شد', `${name} · ${id} · ${total.toLocaleString('fa-IR')} تومان`, t);
      db.exec('COMMIT');
      return json(res, 201, { ok: true, order: { id, status: 'new', paymentStatus: 'pending', total, createdAt: t } });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      console.error(e);
      return json(res, 500, { ok: false, error: 'خطا در ثبت سفارش.' });
    }
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    if (loginBlocked(req, body)) return json(res, 429, { ok: false, error: 'چند تلاش ناموفق ثبت شده؛ لطفاً چند دقیقه بعد دوباره تلاش کنید.' });
    const { phone, username, password } = body || {};
    const admin = findAdmin(phone || username);
    if (!admin || password !== admin.password) {
      markFailed(req, body);
      return json(res, 401, { ok: false, error: 'شماره تماس یا رمز عبور اشتباه است.' });
    }
    markSuccess(req, body);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { createdAt: Date.now(), phone: admin.phone });
    return json(res, 200, { ok: true }, { 'Set-Cookie': `haji_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    const token = parseCookies(req).haji_admin;
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'haji_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  // --- Customer accounts: lightweight, phone-based, no password. Used to prefill checkout
  // and let a customer look up their own past orders. Public endpoints, not admin-gated. ---
  if (method === 'POST' && pathname === '/api/customer/login') {
    const phone = normalizePhone(body.phone), name = clean(body.name, 120), t = now();
    if (phone.length < 11) return json(res, 400, { ok: false, error: 'شماره تماس معتبر وارد کنید.' });
    let cust = db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
    if (!cust) {
      if (!name) return json(res, 404, { ok: false, error: 'این شماره قبلاً ثبت‌نام نشده. لطفاً اسمتون رو هم وارد کنید.', needsName: true });
      db.prepare('INSERT INTO customers(phone,name,created_at,updated_at) VALUES(?,?,?,?)').run(phone, name, t, t);
      cust = { phone, name };
    } else if (name && name !== cust.name) {
      db.prepare('UPDATE customers SET name=?,updated_at=? WHERE phone=?').run(name, t, phone);
      cust = { ...cust, name };
    }
    const token = crypto.randomBytes(32).toString('hex');
    customerSessions.set(token, { phone, createdAt: Date.now() });
    return json(res, 200, { ok: true, customer: { phone: cust.phone, name: cust.name }, isAdmin: !!findAdmin(phone) },
      { 'Set-Cookie': `haji_customer=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 180}` });
  }
  if (method === 'POST' && pathname === '/api/customer/logout') {
    const token = getCustomerToken(req);
    if (token) customerSessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'haji_customer=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && pathname === '/api/customer/me') {
    const cust = currentCustomer(req);
    if (!cust) return json(res, 401, { ok: false, error: 'وارد نشده‌اید.' });
    return json(res, 200, { ok: true, customer: cust, isAdmin: !!findAdmin(cust.phone) });
  }
  if (method === 'GET' && pathname === '/api/customer/orders') {
    const cust = currentCustomer(req);
    if (!cust) return json(res, 401, { ok: false, error: 'وارد نشده‌اید.' });
    const rows = db.prepare('SELECT * FROM orders WHERE phone=? ORDER BY created_at DESC LIMIT 100').all(cust.phone).map(rowToOrder);
    return json(res, 200, { ok: true, orders: rows });
  }

  // Everything below this point is admin-only.
  if (!isAuthed(req)) return unauthorized(res);

  if (method === 'GET' && pathname === '/api/admin/me') return json(res, 200, { ok: true, user: sessions.get(getAuthToken(req))?.phone || '' });
  if (method === 'GET' && pathname === '/api/orders') return json(res, 200, { ok: true, orders: allOrders() });

  let p = matchPath(pathname, '/api/orders/:id');
  if (p && method === 'GET') {
    const o = rowToOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(p.id));
    return o ? json(res, 200, { ok: true, order: o }) : json(res, 404, { ok: false, error: 'سفارش پیدا نشد.' });
  }
  if (p && method === 'PATCH') {
    const allowed = ['new', 'confirmed', 'preparing', 'sent', 'done', 'cancelled'];
    const status = clean(body.status, 30);
    if (!allowed.includes(status)) return json(res, 400, { ok: false, error: 'وضعیت نامعتبر است.' });
    const old = db.prepare('SELECT status FROM orders WHERE id=?').get(p.id);
    if (!old) return json(res, 404, { ok: false, error: 'سفارش پیدا نشد.' });
    if ((old.status === 'done' || old.status === 'cancelled') && status !== old.status) return json(res, 409, { ok: false, error: 'سفارش نهایی شده و تغییر وضعیت آن مجاز نیست.' });
    const t = now();
    try {
      db.exec('BEGIN');
      const order = rowToOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(p.id));
      if (status === 'done' && old.status !== 'done') {
        for (const x of order.items) if (x.sku) db.prepare('UPDATE inventory SET stock=MAX(0,stock-?),reserved=MAX(0,reserved-?),updated_at=? WHERE sku=?').run(x.qty, x.qty, t, x.sku);
      } else if (status === 'cancelled' && old.status !== 'cancelled') {
        for (const x of order.items) if (x.sku) db.prepare('UPDATE inventory SET reserved=MAX(0,reserved-?),updated_at=? WHERE sku=?').run(x.qty, t, x.sku);
      }
      db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status, t, p.id);
      if (old.status !== status) db.prepare('INSERT INTO notifications(type,order_id,title,body,created_at) VALUES(?,?,?,?,?)').run('status_change', p.id, 'وضعیت سفارش تغییر کرد', `${p.id} · ${status}`, t);
      db.exec('COMMIT');
      return json(res, 200, { ok: true, order: rowToOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(p.id)) });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      console.error(e);
      return json(res, 500, { ok: false, error: 'تغییر وضعیت انجام نشد.' });
    }
  }
  if (p && method === 'DELETE') {
    const o = db.prepare('SELECT id,status FROM orders WHERE id=?').get(p.id);
    if (!o) return json(res, 404, { ok: false, error: 'سفارش پیدا نشد.' });
    if (o.status !== 'cancelled' && o.status !== 'done') {
      const its = db.prepare('SELECT sku,qty FROM order_items WHERE order_id=?').all(p.id);
      for (const x of its) if (x.sku) db.prepare('UPDATE inventory SET reserved=MAX(0,reserved-?),updated_at=? WHERE sku=?').run(x.qty, now(), x.sku);
    }
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(p.id);
    db.prepare('DELETE FROM notifications WHERE order_id=?').run(p.id);
    db.prepare('DELETE FROM orders WHERE id=?').run(p.id);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const rows = db.prepare('SELECT id,type,order_id,title,body,is_read,created_at FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit);
    const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE is_read=0').get().c;
    return json(res, 200, { ok: true, unread, notifications: rows });
  }
  if (method === 'POST' && pathname === '/api/notifications/read-all') {
    db.prepare('UPDATE notifications SET is_read=1 WHERE is_read=0').run();
    return json(res, 200, { ok: true });
  }
  p = matchPath(pathname, '/api/notifications/:id/read');
  if (p && method === 'POST') {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=?').run(Number(p.id));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/reports/summary') {
    const from = clean(url.searchParams.get('from'), 20), to = clean(url.searchParams.get('to'), 20);
    let where = '', params = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND created_at>=?'; params.push(from + 'T00:00:00.000Z'); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND created_at<?'; const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); params.push(d.toISOString()); }
    const orders = db.prepare(`SELECT status,COUNT(*) count,COALESCE(SUM(total),0) revenue FROM orders WHERE 1=1${where} GROUP BY status`).all(...params);
    const total = db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(total),0) revenue FROM orders WHERE 1=1${where}`).get(...params);
    const items = db.prepare(`SELECT oi.sku,oi.name,SUM(oi.qty) qty,SUM(oi.qty*oi.price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE 1=1${where} GROUP BY oi.sku,oi.name ORDER BY qty DESC LIMIT 10`).all(...params);
    const daily = db.prepare(`SELECT substr(created_at,1,10) day,COUNT(*) count,COALESCE(SUM(total),0) revenue FROM orders WHERE 1=1${where} GROUP BY day ORDER BY day DESC LIMIT 31`).all(...params);
    return json(res, 200, { ok: true, total, byStatus: orders, topItems: items, daily });
  }

  if (method === 'GET' && pathname === '/api/inventory') {
    const q = clean(url.searchParams.get('q'), 120);
    const rows = q
      ? db.prepare(`SELECT *,MAX(0,stock-reserved) available FROM inventory WHERE name LIKE ? OR sku LIKE ? ORDER BY (stock-reserved) ASC,name`).all('%' + q + '%', '%' + q + '%')
      : db.prepare('SELECT *,MAX(0,stock-reserved) available FROM inventory ORDER BY (stock-reserved) ASC,name').all();
    const summary = db.prepare('SELECT COUNT(*) items,COALESCE(SUM(stock),0) stock,COALESCE(SUM(reserved),0) reserved,COALESCE(SUM(CASE WHEN stock-reserved<=min_stock THEN 1 ELSE 0 END),0) low FROM inventory').get();
    return json(res, 200, { ok: true, summary, items: rows });
  }
  p = matchPath(pathname, '/api/inventory/:sku');
  if (p && method === 'PATCH') {
    const sku = cleanSku(p.sku), stock = Math.max(0, Math.min(999999, Number(body.stock) || 0)), min = Math.max(0, Math.min(9999, Number(body.minStock) || 0)), t = now();
    // Once an admin touches this sku's stock through this endpoint, treat it as actively managed
    // (i.e. actually enforce availability against it) unless they explicitly pass managed:false.
    const managed = body.managed === false ? 0 : 1;
    const old = db.prepare('SELECT * FROM inventory WHERE sku=?').get(sku);
    if (!old) return json(res, 404, { ok: false, error: 'قطعه پیدا نشد.' });
    db.prepare('UPDATE inventory SET stock=?,min_stock=?,managed=?,updated_at=? WHERE sku=?').run(stock, min, managed, t, sku);
    if (stock !== old.stock) db.prepare('INSERT INTO notifications(type,order_id,title,body,created_at) VALUES(?,?,?,?,?)').run('inventory', null, 'موجودی تغییر کرد', `${old.name} · ${old.stock} ← ${stock}`, t);
    return json(res, 200, { ok: true, item: db.prepare('SELECT *,MAX(0,stock-reserved) available FROM inventory WHERE sku=?').get(sku) });
  }

  p = matchPath(pathname, '/api/payments/:orderId');
  if (p && method === 'GET') {
    const payment = db.prepare('SELECT * FROM payments WHERE order_id=?').get(p.orderId);
    return payment ? json(res, 200, { ok: true, payment }) : json(res, 404, { ok: false, error: 'پرداخت پیدا نشد.' });
  }
  if (p && method === 'PATCH') {
    const allowed = ['pending', 'paid', 'failed', 'refunded'], status = clean(body.status, 20);
    if (!allowed.includes(status)) return json(res, 400, { ok: false, error: 'وضعیت پرداخت نامعتبر است.' });
    const payment = db.prepare('SELECT * FROM payments WHERE order_id=?').get(p.orderId);
    if (!payment) return json(res, 404, { ok: false, error: 'پرداخت پیدا نشد.' });
    const t = now();
    db.prepare('UPDATE payments SET status=?,transaction_id=?,updated_at=? WHERE order_id=?').run(status, clean(body.transactionId, 120) || payment.transaction_id, t, p.orderId);
    db.prepare('INSERT INTO notifications(type,order_id,title,body,created_at) VALUES(?,?,?,?,?)').run('payment', p.orderId, 'وضعیت پرداخت تغییر کرد', `${p.orderId} · ${status}`, t);
    return json(res, 200, { ok: true, payment: db.prepare('SELECT * FROM payments WHERE order_id=?').get(p.orderId) });
  }

  return json(res, 404, { ok: false, error: 'API endpoint not found.' });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const isApi = url.pathname.startsWith('/api/');
    let body = {};
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '') && isApi) body = await parseBody(req);

    if (isApi) return await handleApi(req, res, url, body);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('Request error:', e);
    if (!res.headersSent) json(res, e.statusCode || 500, { ok: false, error: e.statusCode === 413 ? 'حجم درخواست زیاد است.' : 'خطای داخلی سرور.' });
    else res.destroy();
  }
});

function closeServer() {
  try { db.close(); } catch {}
  try { server.close(); } catch {}
}
process.on('SIGINT', () => { closeServer(); process.exit(0); });
process.on('SIGTERM', () => { closeServer(); process.exit(0); });

server.listen(PORT, HOST, () => {
  console.log('============================================');
  console.log(' Haji Auto Parts — standalone Node server');
  console.log(' No Express / No npm install required');
  console.log(` Site:   http://localhost:${PORT}`);
  console.log(` Admin:  http://localhost:${PORT}/admin`);
  console.log(` Health: http://localhost:${PORT}/api/health`);
  console.log('============================================');
});
