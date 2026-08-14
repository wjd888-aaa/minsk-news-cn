const { writeFileSync, mkdirSync, copyFileSync, existsSync } = require('fs');
const path = require('path');

const RSS_URL = 'https://minsknews.by/feed/';
const MAX_ITEMS = 20;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const CSS_SRC = path.join(ROOT, 'public', 'style.css');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function translate(text) {
  if (!text || !text.trim()) return '';
  const q = encodeURIComponent(text.trim().slice(0, 1800));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&q=${q}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const parts = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [])
        .map((p) => (Array.isArray(p) && p[0] ? p[0] : ''))
        .join('');
      return parts.trim();
    } catch (e) {
      if (attempt === 1) await sleep(800);
      else console.error('  translate failed: ' + e.message);
    }
  }
  return '';
}

function parseFeed(xml) {
  const blocks = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  return blocks;
}

function field(block, name) {
  const r = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(r);
  return m ? m[1] : '';
}

function fmtBeijing(dateString) {
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
}

async function main() {
  console.log('Fetching RSS from ' + RSS_URL);
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('RSS http ' + res.status);
  const xml = await res.text();

  const blocks = parseFeed(xml);
  console.log('Parsed items: ' + blocks.length);
  if (!blocks.length) throw new Error('no items parsed');

  const cards = [];
  const seen = new Set();
  for (const b of blocks.slice(0, MAX_ITEMS * 2)) {
    const link = field(b, 'link').trim();
    if (seen.has(link)) continue;
    seen.add(link);
    const rawTitle = stripHtml(field(b, 'title'));
    const pubDate = field(b, 'pubDate').trim();
    const desc = stripHtml(field(b, 'description'));
    if (!rawTitle) continue;

    process.stdout.write('  translating: ' + rawTitle.slice(0, 40) + ' ...  ');
    const zhTitle = await translate(rawTitle);
    const zhSummary = desc ? await translate(desc.slice(0, 420)) : '';

    console.log('done');
    cards.push({
      zhTitle: zhTitle || rawTitle,
      ruTitle: rawTitle,
      zhSummary,
      link,
      pubDate,
      beijing: fmtBeijing(pubDate),
    });
    await sleep(250);
    if (cards.length >= MAX_ITEMS) break;
  }

  if (!cards.length) throw new Error('no cards produced');
  console.log('Translated items: ' + cards.length);

  const now = new Date();
  const nowBj = new Date(now.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const updated = `${nowBj.getUTCFullYear()}-${p(nowBj.getUTCMonth() + 1)}-${p(nowBj.getUTCDate())} ${p(nowBj.getUTCHours())}:${p(nowBj.getUTCMinutes())}`;

  const cardsHtml = cards
    .map(
      (c) => `<article class="card">
  <h2 class="ttl"><a href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.zhTitle)}</a></h2>
  <div class="ru">${escapeHtml(c.ruTitle)}</div>
  ${c.zhSummary ? `<p class="sum">${escapeHtml(c.zhSummary)} <a class="more" href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></p>` : ''}
  <div class="meta">● ${escapeHtml(c.beijing)}（北京时间） · minsknews.by</div>
</article>`
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白俄新闻中文站 · 白俄罗斯新闻每日中文速览</title>
<meta name="description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克最新新闻，每 30 分钟更新，按北京时间显示。">
<meta property="og:type" content="website">
<meta property="og:site_name" content="白俄新闻中文站">
<meta property="og:title" content="白俄新闻中文站 · 白俄罗斯新闻中文速览">
<meta property="og:description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克最新新闻，每 30 分钟更新。">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="白俄新闻中文站 · 白俄罗斯新闻中文速览">
<meta name="twitter:description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克最新新闻，每 30 分钟更新。">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-head">
  <h1>白俄新闻<span class="accent">中文站</span></h1>
  <p class="sub">白俄罗斯 &amp; 明斯克最新新闻 · 自动翻译自 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">minsknews.by</a> · 每 30 分钟更新</p>
  <p class="updated">更新于 ${updated}（北京时间） · 共 ${cards.length} 条</p>
</header>
<main>
${cardsHtml}
</main>
<footer class="site-foot">
  <p>本站由机器自动抓取并翻译新闻标题与摘要，仅供学习交流，版权归原始来源 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">«Минск-новости»</a> 所有。</p>
  <p>时间均为北京时间 · <a href="https://github.com/wjd888-aaa/minsk-news-cn" target="_blank" rel="noopener noreferrer">开源项目</a></p>
</footer>
</body>
</html>
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');
  const data = { updated, count: cards.length, items: cards };
  writeFileSync(path.join(OUT_DIR, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
  if (existsSync(CSS_SRC)) copyFileSync(CSS_SRC, path.join(OUT_DIR, 'style.css'));
  console.log('Wrote out/index.html (' + cards.length + ' cards)');
}

main().catch((e) => {
  console.error('BUILD ERROR:', e.message);
  process.exit(1);
});