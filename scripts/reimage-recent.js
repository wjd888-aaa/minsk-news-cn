const { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } = require('fs');
const path = require('path');
const crypto = require('crypto');

const ART = path.join(__dirname, '..', 'articles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function findDivBlock(html, classPart) {
  const openRe = new RegExp(`<div\\b[^>]*class="[^"]*${classPart}[^"]*"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = m.index;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return { start: m.index, end: tagRe.lastIndex }; }
    else depth++;
  }
  return { start: m.index, end: html.length };
}
function divBlockAt(html, tagStart) {
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = tagStart;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return { start: tagStart, end: tagRe.lastIndex }; }
    else depth++;
  }
  return { start: tagStart, end: html.length };
}
function minskRegion(html) {
  const h1 = html.search(/<h1[\s>]/i);
  const anchor = h1 > -1 ? h1 : 0;
  const s1 = html.indexOf('class="page-content"', anchor);
  if (s1 > -1) return divBlockAt(html, html.lastIndexOf('<div', s1));
  return findDivBlock(html, 'news-whole-post');
}
function isJunkImageUrl(u) {
  if (!u) return true;
  if (/^data:/i.test(u) || /\.svg(\?|$)/i.test(u)) return true;
  if (/yandex|mc\.|pixel|tracker|informer|top-fwz1|mail\.ru/i.test(u)) return true;
  if (/banner|adfox|wpadcenter|adv\b/i.test(u)) return true;
  if (/logo|icon|favicon|avatar|desimages|dzen|google-logo|t-me|subscribe|social|share/i.test(u)) return true;
  if (/-80x80|-50x50|-150x130|\.thumbs\//i.test(u)) return true;
  return false;
}
function extractMinskImages(html) {
  const h1 = html.search(/<h1[\s>]/i);
  const region = minskRegion(html);
  const from = h1 > -1 ? h1 : (region ? region.start : 0);
  let to = region ? region.end : html.length;
  const zone = html.slice(from, to);
  const stop = zone.search(/Читайте также|Подписывайтесь|Наш канал|Смотрите также/i);
  if (stop > -1) to = from + stop;
  const seg = html.slice(from, to);
  const out = [];
  for (const m of seg.matchAll(/<img[^>]*wp-image-\d+[^>]*>/gi)) {
    const src = (m[0].match(/src=["']([^"']+)["']/i) || [])[1];
    if (isJunkImageUrl(src)) continue;
    if (out.includes(src)) continue;
    out.push(src);
    if (out.length >= 6) break;
  }
  return out;
}
function extractBeltaImages(html) {
  const blk = findDivBlock(html, 'js-mediator-article');
  if (!blk) return [];
  return extractImageUrlsSimple(html.slice(blk.start, blk.end));
}
function extractImageUrlsSimple(seg) {
  const out = [];
  for (const m of seg.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const u = m[1].trim();
    if (isJunkImageUrl(u)) continue;
    if (out.includes(u)) continue;
    out.push(u);
    if (out.length >= 6) break;
  }
  return out;
}
function resolveUrl(u, base) {
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(u, base).href; } catch { return null; }
}

const imgLedger = new Set();
async function downloadImages(urls, slug, base) {
  const dir = path.join(ART, 'imgs', slug);
  mkdirSync(dir, { recursive: true });
  const local = [], srcs = [];
  let i = 0, totalBytes = 0;
  for (const u of urls) {
    i++;
    const abs = resolveUrl(u, base);
    if (!abs) continue;
    try {
      const res = await fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 * 1024) continue;
      if (totalBytes + buf.length > 4 * 1024 * 1024) continue;
      const h = crypto.createHash('md5').update(buf).digest('hex');
      if (imgLedger.has(h)) continue;
      imgLedger.add(h);
      const ct = res.headers.get('content-type') || '';
      let ext = '.jpg';
      if (ct.includes('png')) ext = '.png';
      else if (ct.includes('webp')) ext = '.webp';
      else if (ct.includes('gif')) ext = '.gif';
      writeFileSync(path.join(dir, `img${i}${ext}`), buf);
      totalBytes += buf.length;
      local.push(`../imgs/${slug}/img${i}${ext}`);
      srcs.push(abs);
      await sleep(150);
    } catch { continue; }
  }
  return { local, srcs };
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.text();
}

async function main() {
  const max = Number(process.argv[2] || 80);
  const idx = JSON.parse(readFileSync(path.join(ART, 'index.json'), 'utf8'));
  const cutoff = Date.now() - 6 * 86400000;
  const candidates = idx
    .filter((r) => {
      if (!r.link) return false;
      const t = Date.parse(r.isodate);
      if (isNaN(t) || t < cutoff) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.isodate) - Date.parse(a.isodate))
    .slice(0, max);

  console.log(`重新提取图片: ${candidates.length} 篇`);
  let ok = 0, noimg = 0, fail = 0;
  for (const r of candidates) {
    try {
      process.stdout.write(`  [${r.source === 'belta' ? 'belta' : 'mn'}] ${(r.zh || r.ru).slice(0, 26)} ... `);
      const html = await fetchHtml(r.link);
      const urls = r.source === 'belta' ? extractBeltaImages(html) : extractMinskImages(html);
      const dir = path.join(ART, 'imgs', r.slug);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      const dl = await downloadImages(urls, r.slug, r.link);
      r.images = dl.local;
      r.image_srcs = dl.srcs;
      if (dl.local.length) { ok++; console.log(`图${dl.local.length}`); }
      else { noimg++; console.log('无合规图'); }
    } catch (e) {
      fail++; console.log('失败: ' + e.message);
    }
    writeFileSync(path.join(ART, 'index.json'), JSON.stringify(idx, null, 2), 'utf8');
    await sleep(600);
  }
  console.log(`完成: 有图 ${ok}, 无图 ${noimg}, 失败 ${fail}`);
}

main().catch((e) => { console.error('REIMAGE ERROR:', e.message); process.exit(1); });
