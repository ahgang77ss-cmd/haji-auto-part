from pathlib import Path
import re,json,shutil,zipfile
from datetime import datetime, timezone
root=Path('/mnt/data/haji-v12'); out=Path('/mnt/data/haji-v13');
if out.exists(): shutil.rmtree(out)
out.mkdir()
for p in root.iterdir():
    if p.is_file(): shutil.copy2(p,out/p.name)
html=(out/'index.html').read_text(encoding='utf-8')
# Build catalog baseline from cards
pat=re.compile(r'<div class="car-part"[^>]*>([\s\S]*?)</div>\s*</div>',re.M)
# safer card chunk by cp-name boundaries
cards=[]
for m in re.finditer(r'<div class="car-part"[^>]*>[\s\S]*?<div class="cp-sku">([^<]+)</div>[\s\S]*?<div class="cp-name">([^<]+)</div>[\s\S]*?<div class="price">([^<]+)</div>[\s\S]*?</div>\s*</div>',html):
    sku=m.group(1).strip(); name=m.group(2).strip(); price=m.group(3).strip()
    digits=re.sub(r'[^0-9۰-۹]','',price).translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹','0123456789'))
    cards.append({'sku':sku,'name':name,'baseline_price_toman':int(digits or 0)})
# fallback parse if regex misses
if len(cards)<2000:
    cards=[]
    starts=[m.start() for m in re.finditer(r'<div class="car-part"',html)]
    for i,s in enumerate(starts):
        chunk=html[s: starts[i+1] if i+1<len(starts) else len(html)]
        a=re.search(r'<div class="cp-sku">([^<]+)',chunk); b=re.search(r'<div class="cp-name">([^<]+)',chunk); c=re.search(r'<div class="price">([^<]+)',chunk)
        if a and b and c:
            d=re.sub(r'[^0-9۰-۹]','',c.group(1)).translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹','0123456789'))
            cards.append({'sku':a.group(1).strip(),'name':b.group(1).strip(),'baseline_price_toman':int(d or 0)})
(out/'price-catalog.json').write_text(json.dumps({'generated_at':datetime.now(timezone.utc).isoformat(),'currency':'تومان','count':len(cards),'products':cards},ensure_ascii=False,indent=2),encoding='utf-8')
# Full crawler updater
up=r'''/** Haji Brothers V13 — multi-source price crawler (Node 18+) */
const fs=require('fs'), path=require('path');
const ROOT=__dirname, CAT=path.join(ROOT,'price-catalog.json'), DATA=path.join(ROOT,'price-data.json'), HIST=path.join(ROOT,'price-history.json'), SOURCES=path.join(ROOT,'price-sources.json');
const SOURCES_DEFAULT=[
 {name:'Yadakman',base:'https://yadackman.ir',sitemaps:['https://yadackman.ir/sitemap_index.xml','https://yadackman.ir/product-sitemap.xml']},
 {name:'Isatec',base:'https://isatec.ir',sitemaps:['https://isatec.ir/wp-sitemap.xml','https://isatec.ir/product-sitemap.xml']},
 {name:'Kama Yadak',base:'https://kamayadak.com',sitemaps:['https://kamayadak.com/sitemap.xml','https://kamayadak.com/sitemap_index.xml']},
 {name:'YadakCar',base:'https://yadakcar.com',sitemaps:['https://yadakcar.com/sitemap_index.xml','https://yadakcar.com/product-sitemap.xml']},
 {name:'Yadaki Sena',base:'https://yadaki-sena.ir',sitemaps:['https://yadaki-sena.ir/sitemap_index.xml','https://yadaki-sena.ir/product-sitemap.xml']},
 {name:'Ghathe Bazar',base:'https://www.ghatehbazar.ir',sitemaps:['https://www.ghatehbazar.ir/sitemap.xml','https://www.ghatehbazar.ir/sitemap_index.xml']}
];
function norm(s=''){return s.toString().toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[ۀة]/g,'ه').replace(/[\u200c\u200f\u200e]/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim()}
function money(v){if(typeof v==='number')return Math.round(v); let s=String(v||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/,/g,''); let n=Number(s.replace(/[^0-9.]/g,'')); if(!n)return null; if(/ریال/i.test(String(v)))n/=10; return Math.round(n)}
function tokens(s){return new Set(norm(s).split(' ').filter(x=>x.length>1))}
function score(a,b){const A=tokens(a),B=tokens(b); if(!A.size||!B.size)return 0; let hit=0; for(const x of A)if(B.has(x))hit++; return hit/Math.max(A.size,B.size)}
async function get(url){const r=await fetch(url,{headers:{'user-agent':'HajiBrothersPriceBot/1.0'},signal:AbortSignal.timeout(12000)}); if(!r.ok)throw Error(r.status+' '+url); return await r.text()}
async function urlsFromSitemap(url,seen=new Set(),depth=0){if(depth>2||seen.has(url))return[];seen.add(url);let text;try{text=await get(url)}catch{return[]}const loc=[...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>m[1].trim());if(!/<sitemap/i.test(text))return loc;let out=[];for(const u of loc.slice(0,50))out.push(...await urlsFromSitemap(u,seen,depth+1));return out}
function productsFromJsonLd(html,url){let out=[];for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const raw=m[1].trim().replace(/&quot;/g,'"');const j=JSON.parse(raw);const arr=Array.isArray(j)?j:(j['@graph']||[j]);for(const x of arr){if(x&&((x['@type']==='Product')||x.name)&&x.name){let offers=x.offers||{};if(Array.isArray(offers))offers=offers[0]||{};let p=offers.price||offers.lowPrice||offers.highPrice;let price=money(p);if(price)out.push({name:x.name,price_toman:price,url:x.url||url,source:url})}}}catch{}}
return out}
async function main(){const cat=JSON.parse(fs.readFileSync(CAT,'utf8')).products;let sources=SOURCES_DEFAULT;try{const custom=JSON.parse(fs.readFileSync(SOURCES,'utf8')); if(Array.isArray(custom.sources))sources=custom.sources.map(x=>({name:x.name,base:x.base,sitemaps:x.sitemaps||[]}))}catch{}
let offers=[];for(const s of sources){for(const sm of s.sitemaps){const urls=await urlsFromSitemap(sm);for(const u of urls.slice(0,3000)){try{const h=await get(u);offers.push(...productsFromJsonLd(h,u).map(x=>({...x,source:s.name})));}catch{}}}}
// dedupe same normalized name, keep latest/first valid
const best=new Map();for(const o of offers){const k=norm(o.name);if(!k)continue;const prev=best.get(k);if(!prev||o.price_toman>0)best.set(k,o)}
const now=new Date().toISOString();const rows=[];const changes=[];for(const p of cat){let bestHit=null,bestScore=0;for(const o of best.values()){const sc=score(p.name,o.name);if(sc>bestScore){bestScore=sc;bestHit=o}}if(bestHit&&bestScore>=0.62){const old=p.baseline_price_toman;const neu=bestHit.price_toman;rows.push({sku:p.sku,name:p.name,priceToman:neu,oldPriceToman:old,source:bestHit.source,url:bestHit.url,matchScore:Number(bestScore.toFixed(3)),checkedAt:now});if(old&&neu!==old)changes.push({sku:p.sku,name:p.name,oldPriceToman:old,newPriceToman:neu,changeToman:neu-old,changePercent:Number(((neu-old)/old*100).toFixed(2)),source:bestHit.source,url:bestHit.url,matchScore:Number(bestScore.toFixed(3))})}}
const data={updatedAt:now,currency:'تومان',catalogCount:cat.length,matchedCount:rows.length,changedCount:changes.length,results:rows};fs.writeFileSync(DATA,JSON.stringify(data,null,2),'utf8');
const hist={generatedAt:now,currency:'تومان',catalogCount:cat.length,matchedCount:rows.length,changedCount:changes.length,increased:changes.filter(x=>x.changeToman>0).length,decreased:changes.filter(x=>x.changeToman<0).length,changes};fs.writeFileSync(HIST,JSON.stringify(hist,null,2),'utf8');console.log(`V13: catalog ${cat.length}, matched ${rows.length}, changed ${changes.length}`)}
main().catch(e=>{console.error(e);process.exit(1)});
'''
(out/'price-updater-v13.js').write_text(up,encoding='utf-8')
# sources config
(out/'price-sources.json').write_text(json.dumps({'updated_at':datetime.now().isoformat(),'sources':[{'name':'Yadakman','base':'https://yadackman.ir','sitemaps':['https://yadackman.ir/sitemap_index.xml','https://yadackman.ir/product-sitemap.xml']},{'name':'Isatec','base':'https://isatec.ir','sitemaps':['https://isatec.ir/wp-sitemap.xml','https://isatec.ir/product-sitemap.xml']},{'name':'Kama Yadak','base':'https://kamayadak.com','sitemaps':['https://kamayadak.com/sitemap.xml','https://kamayadak.com/sitemap_index.xml']},{'name':'YadakCar','base':'https://yadakcar.com','sitemaps':['https://yadakcar.com/sitemap_index.xml','https://yadakcar.com/product-sitemap.xml']},{'name':'Yadaki Sena','base':'https://yadaki-sena.ir','sitemaps':['https://yadaki-sena.ir/sitemap_index.xml','https://yadaki-sena.ir/product-sitemap.xml']},{'name':'Ghathe Bazar','base':'https://www.ghatehbazar.ir','sitemaps':['https://www.ghatehbazar.ir/sitemap.xml','https://www.ghatehbazar.ir/sitemap_index.xml']}]},ensure_ascii=False,indent=2),encoding='utf-8')
# UI replace old tracker script with V13 tracker
old=(out/'index.html').read_text(encoding='utf-8')
start=old.find('<script>\nwindow.HAJI_PRICE_DATA_URL')
end=old.find('</body>',start)
tracker=r'''<script>
window.HAJI_PRICE_DATA_URL="price-data.json";
(function(){
 const norm=s=>(s||'').toString().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[ۀة]/g,'ه').replace(/[\u200c\u200f\u200e]/g,' ').replace(/\s+/g,' ').trim();
 const fmt=n=>new Intl.NumberFormat('fa-IR').format(Math.round(n))+' تومان';
 async function run(){try{const r=await fetch('price-data.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)return;const d=await r.json();const rows=d.results||[];const m=new Map(rows.map(x=>[x.sku,x]));let valid=0,changed=0,up=0,down=0,flat=0;
 document.querySelectorAll('.car-part').forEach(c=>{const sku=(c.querySelector('.cp-sku')?.textContent||'').trim();const x=m.get(sku);if(!x)return;const el=c.querySelector('.price');if(!el)return;const old=Number(x.oldPriceToman||0),neu=Number(x.priceToman||0);el.textContent=fmt(neu);el.title='منبع: '+(x.source||'')+' | بررسی: '+new Date(x.checkedAt).toLocaleString('fa-IR');valid++;let tag=c.querySelector('.v13-change');if(!tag){tag=document.createElement('div');tag.className='v13-change';el.parentElement.appendChild(tag)}if(old&&neu!==old){const pct=(neu-old)/old*100;changed++;if(pct>0){up++;tag.className='v13-change up';tag.textContent='▲ افزایش '+Math.abs(pct).toFixed(1)+'% ('+fmt(neu-old)+')'}else{down++;tag.className='v13-change down';tag.textContent='▼ کاهش '+Math.abs(pct).toFixed(1)+'% ('+fmt(Math.abs(neu-old))+')'}}else{flat++;tag.className='v13-change flat';tag.textContent='بدون تغییر'}});
 document.getElementById('v12Updated').textContent=valid.toLocaleString('fa-IR');document.getElementById('v12Changed').textContent=changed.toLocaleString('fa-IR');document.getElementById('v12Up').textContent=up.toLocaleString('fa-IR');document.getElementById('v12Down').textContent=down.toLocaleString('fa-IR');document.getElementById('v12Note').textContent='V13 · '+valid.toLocaleString('fa-IR')+' قطعه با منبع تطبیق داده شد · '+changed.toLocaleString('fa-IR')+' تغییر قیمت ثبت شده';
 const st=document.getElementById('priceUpdateStatus');if(st)st.textContent='🔄 قیمت‌ها: آخرین snapshot · '+(d.updatedAt?new Date(d.updatedAt).toLocaleString('fa-IR'):'—');
 }catch(e){console.warn(e)}}document.addEventListener('DOMContentLoaded',run);
})();
</script>
<style id="v13-price-tracker">.v13-change{font-size:10px;font-weight:900;margin-top:5px}.v13-change.up{color:#55d68a}.v13-change.down{color:#ff7474}.v13-change.flat{color:#aeb8c2}</style>
'''
if start>=0: old=old[:start]+tracker+old[end:]
else: old=old.replace('</body>',tracker+'</body>')
(out/'index.html').write_text(old,encoding='utf-8')
(out/'README-V13.txt').write_text('''نسخه V13 — بروزرسانی چندمنبعی قیمت\n\nاین نسخه برای پوشش گسترده کاتالوگ، sitemap فروشگاه‌های قطعات را می‌خواند، صفحات محصول را از JSON-LD استخراج می‌کند، نام قطعه را fuzzy-match می‌کند و فقط تطبیق‌های با امتیاز حداقل 0.62 را ثبت می‌کند. تاریخچه تغییرات در price-history.json ذخیره می‌شود.\n\nاجرا: Node.js 18+\nnode price-updater-v13.js\n\nبرای اجرای خودکار، روی سرور cron هر 6 ساعت یا روزانه تنظیم شود. اگر سایتی sitemap/JSON-LD نداشته باشد، به‌صورت خودکار کنار گذاشته می‌شود و قیمت حدسی وارد کاتالوگ نمی‌شود.\n''',encoding='utf-8')
# zip
zip_path=Path('/mnt/data/haji-site-complete-catalog-v13-auto-price-engine.zip')
if zip_path.exists(): zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for p in out.rglob('*'):
        if p.is_file(): z.write(p,p.relative_to(out.parent))
print('cards',len(cards),'zip',zip_path,zip_path.stat().st_size)
