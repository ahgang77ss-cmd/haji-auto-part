/** Haji Brothers — multi-source price crawler (Node 18+, no npm install needed)
 *
 * Reads price-catalog.json (your part list), visits a handful of auto-parts
 * store websites, tries to find a matching product + price for each part,
 * and writes the result to price-data.json (which the site's front page
 * already knows how to read — see the price-tracker script in index.html).
 *
 * Run it with:  node price-updater-v13.js
 * (or double-click update-prices.bat, which just runs this and waits so you
 * can read the output before the window closes)
 *
 * IMPORTANT — read this before relying on it:
 * Store websites change their structure over time, block bots, or don't
 * expose machine-readable product data at all. This script can only pick up
 * prices from stores that publish a sitemap + structured product data
 * (JSON-LD). It is normal for some or even most sources below to return 0
 * matches — that just means that particular store isn't crawlable right now,
 * not that the script is broken. Check the per-source summary it prints.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const CAT = path.join(ROOT, 'price-catalog.json');
const DATA = path.join(ROOT, 'price-data.json');
const HIST = path.join(ROOT, 'price-history.json');
const SOURCES = path.join(ROOT, 'price-sources.json');

const SOURCES_DEFAULT = [
  { name: 'Isatec', base: 'https://isatec.ir', sitemaps: ['https://isatec.ir/wp-sitemap.xml', 'https://isatec.ir/product-sitemap.xml'] },
  { name: 'YadakCar', base: 'https://yadakcar.com', sitemaps: ['https://yadakcar.com/sitemap_index.xml', 'https://yadakcar.com/product-sitemap.xml'] }
  // Yadakman, Kama Yadak, Yadaki Sena, and Ghathe Bazar were tried twice and returned zero
  // usable prices each time (dead/blocked sitemaps, or a non-WooCommerce platform our fallback
  // extractor doesn't understand). Dropped for now to keep runs fast. Add them back to
  // price-sources.json (which overrides this list) if you want to try them again later.
];

// How many product pages to check per source, and how many to fetch at once.
const MAX_PAGES_PER_SOURCE = 2000;
const CONCURRENCY = 25;
const MATCH_THRESHOLD = 0.62;

function norm(s = '') { return s.toString().toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه').replace(/[\u200c\u200f\u200e]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function money(v) {
  if (typeof v === 'number') return Math.round(v);
  let s = String(v || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/,/g, '');
  let n = Number(s.replace(/[^0-9.]/g, ''));
  if (!n) return null;
  if (/ریال/i.test(String(v))) n /= 10;
  return Math.round(n);
}
function tokens(s) { return new Set(norm(s).split(' ').filter(x => x.length > 1)); }
function score(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let hit = 0; for (const x of A) if (B.has(x)) hit++; return hit / Math.max(A.size, B.size); }

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'HajiBrothersPriceBot/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw Error(r.status + ' ' + url);
  return await r.text();
}

async function robotsSitemaps(base) {
  try {
    const text = await get(base.replace(/\/$/, '') + '/robots.txt');
    return [...text.matchAll(/^sitemap:\s*(\S+)/gim)].map(m => m[1].trim());
  } catch (e) { return []; }
}

async function urlsFromSitemap(url, seen = new Set(), depth = 0) {
  if (depth > 2 || seen.has(url)) return [];
  seen.add(url);
  let text;
  try { text = await get(url); } catch (e) { return []; }
  const loc = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
  if (!/<sitemap/i.test(text)) return loc;
  let out = [];
  for (const u of loc.slice(0, 50)) out.push(...await urlsFromSitemap(u, seen, depth + 1));
  return out;
}

function decodeHtml(s = '') { return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim(); }

const JUNK_NAME_PATTERNS = [/فروشگاه\s*آنلاین/, /فروش\s*ویژه/, /دسته[‌ ]?بندی/, /برچسب/, /صفحه\s*اصلی/];
function looksLikeJunkName(name) {
  const n = decodeHtml(name || '');
  if (n.length < 8) return true;
  return JUNK_NAME_PATTERNS.some(re => re.test(n));
}

function productsFromJsonLd(html, url) {
  let out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = m[1].trim().replace(/&quot;/g, '"');
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const x of arr) {
        if (x && ((x['@type'] === 'Product') || x.name) && x.name) {
          let offers = x.offers || {};
          if (Array.isArray(offers)) offers = offers[0] || {};
          let p = offers.price || offers.lowPrice || offers.highPrice;
          let price = money(p);
          if (price && !looksLikeJunkName(x.name)) out.push({ name: x.name, price_toman: price, url: x.url || url });
        }
      }
    } catch (e) { /* not valid JSON-LD on this page, skip it */ }
  }
  return out;
}

// Fallback for pages with no JSON-LD Product schema but that still render a price server-side
// (common on WooCommerce/Iranian storefronts): try Open Graph/microdata price meta tags first,
// then the visible WooCommerce price markup as a last resort.
function productFromHtmlFallback(html, url) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const metaPrice = html.match(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle && metaPrice) {
    const price = money(metaPrice[1]);
    if (price && !looksLikeJunkName(ogTitle[1])) return [{ name: decodeHtml(ogTitle[1]), price_toman: price, url }];
  }
  const wc = [...html.matchAll(/woocommerce-Price-amount[^>]*>\s*(?:<bdi>)?\s*([\d۰-۹,٬]+)/gi)];
  const h1 = html.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (wc.length && h1) {
    const price = money(wc[wc.length - 1][1]);
    const name = decodeHtml(h1[1]).replace(/\s*[-|–].*$/, '').trim();
    if (price && !looksLikeJunkName(name)) return [{ name, price_toman: price, url }];
  }
  return [];
}

// Run `worker(item)` over `items` with at most `limit` in flight at once.
async function runPool(items, limit, worker) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx]); }
      catch (e) { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function crawlSource(s) {
  process.stdout.write(`\n🔎 ${s.name} (${s.base})\n`);
  let urls = [];
  for (const sm of s.sitemaps) {
    process.stdout.write(`   reading sitemap: ${sm}\n`);
    const found = await urlsFromSitemap(sm);
    process.stdout.write(`     → ${found.length} URLs\n`);
    urls.push(...found);
  }
  urls = [...new Set(urls)];
  // Sitemaps often include category, tag, and blog pages too - not just products. Checking
  // those produced junk "product names" (a category page's title, with some unrelated price
  // on the page). WooCommerce's standard product URL contains "/product/", so prefer that when
  // it narrows things down; fall back to the full list if a site uses a different URL scheme.
  const productUrls = urls.filter(u => /\/product\//i.test(u));
  if (productUrls.length) urls = productUrls;
  urls = urls.slice(0, MAX_PAGES_PER_SOURCE);
  if (!urls.length) {
    process.stdout.write(`   ⚠ no product URLs found — this source did not work (site structure changed, blocked, or no sitemap at those paths).\n`);
    return [];
  }
  process.stdout.write(`   checking ${urls.length} pages for prices...\n`);
  let checked = 0;
  const pages = await runPool(urls, CONCURRENCY, async u => {
    let html;
    try { html = await get(u); } catch (e) { checked++; return []; }
    checked++;
    if (checked % 50 === 0) process.stdout.write(`     ...${checked}/${urls.length}\n`);
    const items = productsFromJsonLd(html, u);
    return (items.length ? items : productFromHtmlFallback(html, u)).map(x => ({ ...x, source: s.name }));
  });
  const offers = pages.flat();
  process.stdout.write(`   ✓ done — ${offers.length} priced products found on ${s.name}\n`);
  return offers;
}

async function main() {
  const cat = JSON.parse(fs.readFileSync(CAT, 'utf8')).products;
  let sources = SOURCES_DEFAULT;
  try {
    const custom = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
    if (Array.isArray(custom.sources)) sources = custom.sources.map(x => ({ name: x.name, base: x.base, sitemaps: x.sitemaps || [] }));
  } catch (e) { /* use defaults */ }

  console.log(`Starting price crawl — ${cat.length} parts in catalog, ${sources.length} sources to try.`);
  let offers = [];
  for (const s of sources) {
    try { offers.push(...await crawlSource(s)); }
    catch (e) { console.log(`   ✗ ${s.name} failed entirely: ${e.message}`); }
  }

  const best = new Map();
  for (const o of offers) { const k = norm(o.name); if (!k) continue; const prev = best.get(k); if (!prev || o.price_toman > 0) best.set(k, o); }

  // Diagnostics: this is the important part when matchedCount comes back 0 despite offers
  // being found. Show what was actually scraped, and how close (or not) the best guess was
  // for a sample of catalog parts, so we can see whether it's a near-miss or totally unrelated.
  console.log(`\n---- تشخیصی: ${best.size} محصول یکتا پیدا شد از همه‌ی منابع ----`);
  if (best.size) {
    console.log('چند نمونه از اسم‌هایی که پیدا شد:');
    [...best.values()].slice(0, 15).forEach(o => console.log(`   [${o.source}] ${o.name} — ${o.price_toman.toLocaleString('fa-IR')} تومان`));
  }

  const now = new Date().toISOString();
  const rows = [], changes = [];
  const nearMisses = [];
  for (const p of cat) {
    let bestHit = null, bestScore = 0;
    for (const o of best.values()) { const sc = score(p.name, o.name); if (sc > bestScore) { bestScore = sc; bestHit = o; } }
    if (nearMisses.length < 15 && bestHit) nearMisses.push({ catalogName: p.name, closestOffer: bestHit.name, score: Number(bestScore.toFixed(2)) });
    if (bestHit && bestScore >= MATCH_THRESHOLD) {
      const old = p.baseline_price_toman, neu = bestHit.price_toman;
      rows.push({ sku: p.sku, name: p.name, scrapedName: bestHit.name, priceToman: neu, oldPriceToman: old, source: bestHit.source, url: bestHit.url, matchScore: Number(bestScore.toFixed(3)), checkedAt: now });
      if (old && neu !== old) changes.push({ sku: p.sku, name: p.name, oldPriceToman: old, newPriceToman: neu, changeToman: neu - old, changePercent: Number(((neu - old) / old * 100).toFixed(2)), source: bestHit.source, url: bestHit.url, matchScore: Number(bestScore.toFixed(3)) });
    }
  }

  const data = { updatedAt: now, currency: 'تومان', catalogCount: cat.length, matchedCount: rows.length, changedCount: changes.length, results: rows };
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2), 'utf8');
  const hist = { generatedAt: now, currency: 'تومان', catalogCount: cat.length, matchedCount: rows.length, changedCount: changes.length, increased: changes.filter(x => x.changeToman > 0).length, decreased: changes.filter(x => x.changeToman < 0).length, changes };
  fs.writeFileSync(HIST, JSON.stringify(hist, null, 2), 'utf8');

  if (!rows.length && nearMisses.length) {
    console.log(`\nنزدیک‌ترین تطبیق‌ها (آستانه‌ی پذیرش: ${MATCH_THRESHOLD}) برای چند قطعه‌ی نمونه از کاتالوگ:`);
    nearMisses.forEach(m => console.log(`   کاتالوگ: «${m.catalogName}»  ⟷  نزدیک‌ترین پیدا‌شده: «${m.closestOffer}»  (امتیاز: ${m.score})`));
  }

  console.log(`\n========================================`);
  console.log(` نتیجه: از ${cat.length} قطعه، ${rows.length} تا قیمت پیدا شد (${changes.length} مورد تغییر قیمت داشتن)`);
  console.log(` نوشته شد در: price-data.json و price-history.json`);
  console.log(`========================================`);
  if (!rows.length) console.log(`\nهیچ قطعه‌ای تطبیق پیدا نکرد. سایت‌های بالا رو با مرورگر چک کن ببین sitemap دارن یا نه، یا اسکرین‌شات این خروجی رو برام بفرست تا بررسی کنم.`);
}

main().catch(e => { console.error(e); process.exit(1); });
