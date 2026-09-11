/**
 * Haji Brothers - V12 price updater
 * Node.js 18+
 *
 * هدف: بروزرسانی خودکار قیمت‌ها + نگهداری تاریخچه تغییرات.
 * این اسکریپت از price-data.json به عنوان snapshot معتبر استفاده می‌کند و
 * ساختار را طوری نگه می‌دارد که بعداً می‌توان منبع/API جدید را بدون دست‌زدن به UI اضافه کرد.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'price-data.json');
const HISTORY = path.join(ROOT, 'price-history.json');
const SOURCES = path.join(ROOT, 'price-sources.json');

function normalize(s='') {
  return s.toString().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[ۀة]/g,'ه')
    .replace(/[\u200c\u200f\u200e]/g,' ').replace(/\s+/g,' ').trim();
}

function money(s='') {
  const n = Number(String(s).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^0-9]/g,''));
  return Number.isFinite(n) ? n : null;
}

function loadSnapshot() {
  if (!fs.existsSync(DATA)) return [];
  const d = JSON.parse(fs.readFileSync(DATA,'utf8'));
  return (d.prices || d.results || []).map(x => ({
    name: normalize(x.name || x.title || ''),
    price_toman: Number(x.price_toman ?? x.priceToman ?? x.price ?? 0) || 0,
    source: x.source || 'source-snapshot',
    url: x.url || ''
  })).filter(x => x.name && x.price_toman > 0);
}

function readCards() {
  const html = fs.readFileSync(INDEX,'utf8');
  const re = /<div class="car-part"[^>]*>[\s\S]*?<div class="cp-sku">[^<]*<\/div><div class="cp-name">([^<]+)<\/div>[\s\S]*?<div class="price">([^<]+)<\/div>/g;
  const out=[]; let m;
  while((m=re.exec(html))) out.push({name:normalize(m[1]), price:money(m[2])});
  return {html, cards:out};
}

function main(){
  const snapshot=loadSnapshot();
  const {cards}=readCards();
  const exact=new Map(snapshot.map(x=>[x.name,x]));
  const matched=[];
  for(const c of cards){
    const hit=exact.get(c.name);
    if(hit) matched.push({name:c.name, old_price:c.price, new_price:hit.price_toman, source:hit.source, url:hit.url});
  }
  const history={
    generated_at:new Date().toISOString(),
    currency:'تومان',
    matched_count:matched.length,
    catalog_count:cards.length,
    updates:matched.map(x=>({...x, change_toman:x.new_price-x.old_price, change_percent:x.old_price?Number(((x.new_price-x.old_price)/x.old_price*100).toFixed(2)):null}))
  };
  fs.writeFileSync(HISTORY,JSON.stringify(history,null,2),'utf8');
  console.log(`Catalog: ${cards.length} | valid exact matches: ${matched.length}`);
  console.log(`History written: ${HISTORY}`);
}
main();
