const { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, appendFileSync, readdirSync, statSync } = require('fs');
const path = require('path');

const RSS_URL = 'https://minsknews.by/feed/';
const BELTA_RSS = 'https://chn.belta.by/rss/';
const BELTA_FULLTEXT_MAX = 8;
const CHINA_ZH_KEYS = ['中国', '中方', '中白', '习近平', '北京', '上海', '中白工业园'];
const FETCH_INTERVAL_MS = 23 * 60 * 60 * 1000;
const MAX_ITEMS = 120;
const MAX_FULLTEXT = 20;
const HOMEPAGE_RECENT = 60;

const PARENT_LINK =
  '<div class="topbar"><a href="https://minsktc.me" target="_blank" rel="noopener noreferrer">明斯克同城闲置 minsktc.me ↗</a></div>';

const EVENT_KEYS = [
  'выставк', 'концерт', 'фестивал', 'спектакл', 'форум', 'ярмарк', 'премьер',
  'показ', 'встреч', 'мастер-класс', 'экскурси', 'кино', 'лекци',
  'конференция', 'турнир', 'соревновани', 'экспозиц', 'праздник',
  'музей', 'театр', 'афиша', 'конкурс', 'олимпиад', 'день открытых', 'концертн'
];
const VOLUNTEER_KEYS = [
  'волонтёр', 'волонтер', 'донор', 'благотворит', 'добровольц', 'красный крест',
  'гуманитарн', 'субботник', 'приют', 'пожертвова', 'безвозмездн', 'нуждающ'
];
const CHINA_KEYS = [
  'китай', 'кнр', 'си цзиньпин', 'шанхайск', 'поднебесн', 'белорусско-китай', 'китайско-белорусск'
];
const CAT_LABEL = { news: '新闻', event: '活动', volunteer: '志愿者', china: '中白' };
const CAT_RANK = { volunteer: 0, event: 1, china: 2, news: 3 };

const STORE_ZH = {
  Green: '绿超市',
  'Евроопт': '欧罗超市',
  'АЛМИ': '阿尔米',
  'Хит': '嗨特',
  'Гиппо': '吉波',
  'Копеечка': '小零钱',
  'Грошык': '格罗什克',
  'Санта': '圣诞超市',
  'Fix Price': '固价超市',
  'Корона': '皇冠超市',
  'UniStore': '尤尼斯特',
  'Три цены': '三价超市',
  'Дионис': '迪奥尼斯',
  'ПерекрестОК': '十字路口',
  'ProStore': '普罗超市',
  'Соседи': '邻居超市',
};
const zhStore = (s) => STORE_ZH[s] || s;

const STORE_EN = {
  Green: 'Green',
  'Евроопт': 'Euroopt',
  'АЛМИ': 'ALMI',
  'Хит': 'Hit',
  'Гиппо': 'Gippo',
  'Копеечка': 'Kopeechka',
  'Грошык': 'Groshyk',
  'Санта': 'Santa',
  'Fix Price': 'Fix Price',
  'Корона': 'Korona',
  'UniStore': 'UniStore',
  'Три цены': 'Tri Tseny',
  'Дионис': 'Dionis',
  'ПерекрестОК': 'PerekrestOK',
  'ProStore': 'ProStore',
  'Соседи': 'Sosedi',
};
const enStore = (s) => STORE_EN[s] || s;

const STORE_ICON = {
  Green: 'stores/Green.png',
  'Евроопт': 'stores/Euroopt.png',
  'АЛМИ': 'stores/ALMI.png',
  'Хит': 'stores/Hit.png',
  'Гиппо': 'stores/Gippo.png',
  'Копеечка': 'stores/Kopeechka.png',
  'Грошык': 'stores/Groshyk.png',
  'Санта': 'stores/Santa.png',
  'Fix Price': 'stores/FixPrice.png',
  'Корона': 'stores/Korona.png',
  'UniStore': 'stores/UniStore.png',
  'Три цены': 'stores/Triceny.png',
  'Дионис': 'stores/Dionis.png',
  'ПерекрестОК': 'stores/Perekrestok.png',
  'ProStore': 'stores/ProStore.png',
  'Соседи': 'stores/Sosedi.png',
};
const storeIcon = (s) => STORE_ICON[s] || '';

const DEAL_CHANNELS = [
  { user: 'shopsgreen', store: 'Green' },
  { user: 'evroopt_shop', store: 'Евроопт' },
  { user: 'hitdiscount_by', store: 'Хит' },
  { user: 'gippoby_offical', store: 'Гиппо' },
  { user: 'kopeechka_by', store: 'Копеечка' },
  { user: 'groshyk', store: 'Грошык' },
  { user: 'santaretail_by', store: 'Санта' },
  { user: 'fixprice_by', store: 'Fix Price' },
  { user: 'koronaby', store: 'Корона' },
  { user: 'unistoreminsk', store: 'UniStore' },
  { user: 'magazin_sosedi', store: 'Соседи' },
];
const DEAL_DAYS = 30;
const DEAL_MAX = 100;

const DEAL_PAGES = [
  { id: 'triceny', store: 'Три цены', url: 'https://3ceni.by/sales/', parse: parse3CeniSales, limit: 8 },
  { id: 'dionis', store: 'Дионис', url: 'https://dionis-shop.by/promotions', parse: parseDionisPromos, limit: 8 },
  { id: 'perekrestok', store: 'ПерекрестОК', url: 'https://perekrestok24.by/discounts/', parse: parsePerekrestokDiscounts, limit: 8, enrich: fetchPerekrestokPeriod },
  { id: 'almi', store: 'АЛМИ', url: 'https://www.almi.by/shares/', parse: parseAlmiShares, limit: 12, insecure: true },
  { id: 'prostore', store: 'ProStore', url: 'https://www.prostore.by/specialnye-predlozheniya', parse: parseProstoreSpecials, limit: 8 },
];

const ALL_STORES = [...new Set([...DEAL_CHANNELS.map((c) => c.store), ...DEAL_PAGES.map((p) => p.store)])];

const FF_ZH = {
  KFC: '肯德基',
  Mak: '麦当劳（Mak.by）',
  DodoPizza: '多多披萨',
  Domino: '达美乐披萨',
  BurgerKing: '汉堡王',
  PizzaTempo: '披萨快节奏',
  PapaDoner: '帕帕多纳（Papa Doner）',
  Ramiz: '拉米兹（Ramiz）',
};
const ffZh = (s) => FF_ZH[s] || s;

const FF_EN = {
  KFC: 'KFC',
  Mak: 'Mak',
  DodoPizza: 'Dodo Pizza',
  Domino: "Domino's",
  BurgerKing: 'Burger King',
  PizzaTempo: 'Pizza Tempo',
  PapaDoner: 'Papa Doner',
  Ramiz: 'Ramiz',
};
const ffEn = (s) => FF_EN[s] || s;

const FF_ICON = {
  KFC: 'stores/KFC.png',
  Mak: 'stores/Mak.png',
  DodoPizza: 'stores/DodoPizza.png',
  Domino: 'stores/Domino.png',
  BurgerKing: 'stores/BurgerKing.png',
  PizzaTempo: 'stores/PizzaTempo.png',
  PapaDoner: 'stores/PapaDoner.png',
  Ramiz: 'stores/Ramiz.png',
};
const ffIcon = (s) => FF_ICON[s] || '';

const FASTFOOD_TG = [
  { user: 'kfcbelarus', store: 'KFC' },
  { user: 'dodopizza_belarus', store: 'DodoPizza' },
  { user: 'burgerkingbelarus', store: 'BurgerKing' },
  { user: 'dominospizzabelarus', store: 'Domino' },
];
const FASTFOOD_DAYS = 30;
const FASTFOOD_MAX = 60;

const FASTFOOD_PAGES = [
  { id: 'mak', store: 'Mak', url: 'https://mak.by/news/?group=promotions', parse: parseMakPromos, limit: 6 },
  { id: 'dominosite', store: 'Domino', url: 'https://dominos.by/ru/minsk/promo/', parse: parseDominoSitePromos, limit: 6 },
  { id: 'tempo', store: 'PizzaTempo', url: 'https://pizzatempo.by/discounts', parse: parseTempoDiscounts, limit: 6 },
  { id: 'papadoner', store: 'PapaDoner', url: 'https://skidy.by/company/papa-doner', parse: parseSkidyCompany, limit: 4 },
];

const ALL_FASTFOOD = [...new Set([...FASTFOOD_TG.map((c) => c.store), ...FASTFOOD_PAGES.map((p) => p.store), 'Ramiz'])];

function classify(text) {
  const t = String(text || '').toLowerCase();
  for (const k of VOLUNTEER_KEYS) if (t.includes(k)) return 'volunteer';
  for (const k of EVENT_KEYS) if (t.includes(k)) return 'event';
  for (const k of CHINA_KEYS) if (t.includes(k)) return 'china';
  return 'news';
}

function classifyZh(text) {
  const t = String(text || '');
  for (const k of CHINA_ZH_KEYS) if (t.includes(k)) return 'china';
  return 'news';
}

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const ART_DIR = path.join(ROOT, 'articles');
const INDEX_FILE = path.join(ART_DIR, 'index.json');
const LAST_RUN_FILE = path.join(ART_DIR, 'last_fetch.json');
const DEALS_FILE = path.join(ART_DIR, 'deals.json');
const FASTFOODS_FILE = path.join(ART_DIR, 'fastfoods.json');
const LIFE_FILE = path.join(ART_DIR, 'life.json');
const CSS_SRC = path.join(ROOT, 'public', 'style.css');
const PWA_FILES = ['manifest.json', 'sw.js', 'icon.svg', 'icon-maskable.svg', 'metro-map.jpg', 'belarus-map.svg'];
const PWA_HEAD = `<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#b33a2e">
<link rel="apple-touch-icon" href="icon.svg">`;
const PWA_REGISTER = `<script>if ('serviceWorker' in navigator) { navigator.serviceWorker.register('./sw.js').catch(function () {}); }</script>`;
const PWA_REGISTER_DEEP = `<script>if ('serviceWorker' in navigator) { navigator.serviceWorker.register('../sw.js').catch(function () {}); }</script>`;

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

async function translateChunk(q) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&q=${encodeURIComponent(q)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const parts = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [])
        .map((p) => (Array.isArray(p) && p[0] ? p[0] : ''))
        .join('');
      if (parts.trim()) return parts.trim();
      throw new Error('empty result');
    } catch (e) {
      if (attempt === 3) break;
      await sleep([1000, 2500][attempt - 1] || 1000);
    }
  }
  return '';
}

function splitChunks(text, max) {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?;…])\s*|\n+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > max) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? cur + ' ' + s : s;
    }
    if (cur.length >= max) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

const GLOSSARY = [
  [/白罗斯共和国/g, '白俄罗斯共和国'],
  [/白罗斯/g, '白俄罗斯'],
];

async function translate(text) {
  if (!text || !text.trim()) return '';
  const chunks = splitChunks(text.trim().slice(0, 9000), 1400);
  let out = '';
  for (const c of chunks) {
    const part = await translateChunk(c);
    if (!part) return '';
    out += part;
  }
  out = out.replace(/\s{2,}/g, ' ').trim();
  for (const [re, rep] of GLOSSARY) out = out.replace(re, rep);
  return out;
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

function slugFromUrl(url) {
  let last = '';
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    last = p.split('/').pop() || '';
  } catch {
    last = '';
  }
  let slug = last;
  try { slug = decodeURIComponent(last); } catch {}
  slug = slug
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  return slug || 'article-' + Math.random().toString(36).slice(2, 8);
}

function articleContentRegion(html) {
  const s1 = html.indexOf('class="page-content"');
  if (s1 < 0) return null;
  let s2 = html.indexOf('class="page-content"', s1 + 30);
  let end = html.length;
  if (s2 > s1) end = s2;
  else {
    const a = html.indexOf('<aside', s1);
    const f = html.indexOf('<footer', s1);
    const candidates = [a, f].filter((x) => x > s1);
    if (candidates.length) end = Math.min(...candidates);
  }
  return { start: s1, end };
}

function extractArticleBody(html) {
  const region = articleContentRegion(html);
  if (!region) return [];
  const seg = html.slice(region.start, region.end);
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(seg))) {
    const t = stripHtml(m[1]);
    if (t.length > 15) paras.push(t);
  }
  return paras;
}

function extractArticleImages(html) {
  const region = articleContentRegion(html);
  const seg = region ? html.slice(region.start, region.end) : html;
  return extractImageUrls(seg);
}

function extractBeltaImages(html) {
  return extractImageUrls(html);
}

function extractImageUrls(seg) {
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(seg)) && out.length < 6) {
    const u = (m[1] || '').trim();
    if (!u || /^data:/i.test(u) || /\.svg(\?|$)/i.test(u)) continue;
    if (/yandex|mc\.|pixel|tracker/i.test(u)) continue;
    if (/\/banners?\//i.test(u)) continue;
    if (/logo|t-me\.png|favicon|avatar/i.test(u)) continue;
    if (/-80x80|-50x50|-150x130|\.thumbs\//i.test(u)) continue;
    if (out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

function resolveUrl(u, base) {
  if (/^https?:\/\//i.test(u)) return u;
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

async function downloadArticleImages(urls, slug, base) {
  const dir = path.join(ART_DIR, 'imgs', slug);
  mkdirSync(dir, { recursive: true });
  const local = [];
  let i = 0;
  let totalBytes = 0;
  for (const u of urls) {
    i++;
    const abs = resolveUrl(u, base);
    if (!abs) continue;
    try {
      const res = await fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || totalBytes + buf.length > 4 * 1024 * 1024) continue;
      const ct = res.headers.get('content-type') || '';
      let ext = '.jpg';
      if (ct.includes('png')) ext = '.png';
      else if (ct.includes('webp')) ext = '.webp';
      else if (ct.includes('gif')) ext = '.gif';
      writeFileSync(path.join(dir, `img${i}${ext}`), buf);
      totalBytes += buf.length;
      local.push(`../imgs/${slug}/img${i}${ext}`);
      await sleep(150);
    } catch {
      continue;
    }
  }
  return local;
}

function extractBeltaBody(html) {
  const paras = [];
  const re = /<p[^>]*class="MsoNormal"[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = stripHtml(m[1]).replace(/&nbsp;/g, ' ').trim();
    if (t.length > 10) paras.push(t);
  }
  if (!paras.length) {
    const all = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((x) => stripHtml(x[1]).replace(/&nbsp;/g, ' ').trim())
      .filter((t) => t.length > 60);
    paras.push(...all.slice(0, 30));
  }
  return paras;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function nowBeijing() {
  const now = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;
}

const WMO_DESC = {
  0: ['☀️', '晴'], 1: ['🌤', '基本晴'], 2: ['⛅', '多云'], 3: ['☁️', '阴'],
  45: ['🌫', '雾'], 48: ['🌫', '雾凇'], 51: ['🌦', '毛毛雨'], 53: ['🌦', '毛毛雨'], 55: ['🌧', '小毛毛雨'],
  61: ['🌧', '小雨'], 63: ['🌧', '中雨'], 65: ['🌧', '大雨'], 66: ['🌧', '冻雨'], 67: ['🌧', '冻雨'],
  71: ['🌨', '小雪'], 73: ['🌨', '中雪'], 75: ['❄️', '大雪'], 77: ['❄️', '雪粒'],
  80: ['🌦', '阵雨'], 81: ['🌧', '阵雨'], 82: ['⛈', '强阵雨'], 85: ['🌨', '阵雪'], 86: ['❄️', '强阵雪'],
  95: ['⛈', '雷雨'], 96: ['⛈', '雷雨冰雹'], 99: ['⛈', '强雷雨冰雹']
};

function wmo(code, fallback) {
  const d = WMO_DESC[code] || fallback;
  return d[0];
}

async function fetchWeather() {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=53.9&longitude=27.5667' +
      '&current=temperature_2m,apparent_temperature,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
      '&forecast_days=5&timezone=Europe%2FMinsk';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('weather http ' + res.status);
    const j = await res.json();
    const cur = j.current || {};
    const d = j.daily || {};
    const nowDesc = WMO_DESC[cur.weather_code] || ['🌡', ''];
    const dayLabels = ['今天', '明天'];
    const days = (d.time || []).slice(0, 2).map((t, i) => {
      const code = (d.weather_code || [])[i];
      const em = wmo(code, ['&#9679;']);
      return `${em} ${dayLabels[i]} ${Math.round(d.temperature_2m_min[i])}~${Math.round(d.temperature_2m_max[i])}°`;
    });
    return `📍 明斯克天气 ${nowDesc[0]} ${Math.round(cur.temperature_2m)}°（体感 ${Math.round(cur.apparent_temperature)}°）${nowDesc[1]} · ${days.join(' ')}`;
  } catch (e) {
    console.log('weather fetch fail: ' + e.message);
    return '';
  }
}

async function fetchRates() {
  try {
    const url = 'https://api.nbrb.by/exrates/rates?periodicity=0';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('rates http ' + res.status);
    const list = await res.json();
    const get = (ab) => list.find((x) => x.Cur_Abbreviation === ab && x.Cur_Scale);
    const usd = get('USD');
    const cny = get('CNY');
    if (!usd || !cny) return '';
    const usdRate = Number(usd.Cur_OfficialRate) / Number(usd.Cur_Scale);
    const cnyRate = Number(cny.Cur_OfficialRate) / Number(cny.Cur_Scale);
    const usdInCny = usdRate / cnyRate;
    const bynInCny = 1 / cnyRate;
    return `🇧🇾 白央行汇率 1 卢布 ≈ ${bynInCny.toFixed(2)} 人民币 · 1 美元 ≈ ${usdInCny.toFixed(2)} 人民币`;
  } catch (e) {
    console.log('rates fetch fail: ' + e.message);
    return '';
  }
}

function parse3CeniSales(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/sale\/[a-z0-9-]+\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (seen.has(slug)) continue;
    const text = stripHtml(m[2]);
    if (!text) continue;
    seen.add(slug);
    const periodM = text.match(/(?:с|С)\s*(\d{1,2})\s+по\s+(\d{1,2})\s+([а-яё]+)/);
    out.push({
      id: slug,
      link: 'https://3ceni.by' + m[1],
      text,
      period: periodM ? `с ${periodM[1]} по ${periodM[2]} ${periodM[3]}` : '',
    });
  }
  return out;
}

function parseDionisPromos(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<div class="swiper-slide">([\s\S]*?)<\/a>\s*<\/div>\s*<\/div>/g)) {
    const block = m[1];
    const hrefM = block.match(/href='(https:\/\/dionis-shop\.by\/promotions\/[a-z0-9-]+)'/);
    const titleM = block.match(/<div class="title">([^<]*)<\/div>/);
    if (!hrefM || !titleM) continue;
    const slug = hrefM[1].split('/').pop();
    if (seen.has(slug)) continue;
    const text = stripHtml(titleM[1]);
    const dateM = block.match(/<div class="date">([^<]*)<\/div>/);
    if (!text || text.includes('Полоцк')) continue;
    seen.add(slug);
    out.push({
      id: slug,
      link: hrefM[1],
      text,
      period: dateM ? dateM[1].trim() : '',
    });
  }
  return out;
}

function parsePerekrestokDiscounts(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/discounts\/[a-z0-9-]+\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (seen.has(slug)) continue;
    const text = stripHtml(m[2]);
    if (!text) continue;
    seen.add(slug);
    const periodM = text.match(/(?:с|С)\s*(\d{1,2}(?:\s+[а-яё]+)?)\s+по\s+(\d{1,2}(?:\s+[а-яё]+)?)/);
    out.push({
      id: slug,
      link: 'https://perekrestok24.by' + m[1],
      text,
      period: periodM ? `с ${periodM[1]} по ${periodM[2]}` : '',
    });
  }
  return out;
}

function parseAlmiShares(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<div class="item">([\s\S]*?)(?=<div class="item">|<footer|<\/main>)/g)) {
    const block = m[1];
    const hrefM = block.match(/href="(\/shares\/[^"]+)/);
    const titleM = block.match(/<div class="title"><a[^>]*>([\s\S]*?)<\/a>/);
    if (!hrefM) continue;
    const text = titleM ? stripHtml(titleM[1]).replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const slug = hrefM[1].replace(/^\/|\/$/g, '');
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      id: slug,
      link: 'https://www.almi.by' + hrefM[1],
      text,
      period: '',
    });
  }
  return out;
}

function parseProstoreSpecials(html) {
  const out = [];
  const seen = new Set();
  const cards = html.matchAll(/<a\b[^>]*href="(specialnye-predlozheniya\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g);
  for (const m of cards) {
    const slug = m[1].split('/').pop();
    if (seen.has(slug)) continue;
    const block = m[2];
    const text = stripHtml(block).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(slug);
    const priceM = text.match(/(?:за|по)\s+(\d{1,4}[.,]\d{2})\s*руб/i);
    out.push({
      id: slug,
      link: 'https://www.prostore.by/' + m[1],
      text,
      period: '',
      price: priceM ? Number(priceM[1].replace(',', '.')) : null,
    });
  }
  return out;
}

function parseMakPromos(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/class="promocode"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const text = stripHtml(m[1]).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const slug = text.toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-').slice(0, 50);
    if (seen.has(slug) || seen.size >= 4) continue;
    seen.add(slug);
    out.push({
      id: slug,
      link: 'https://mak.by/news/?group=promotions',
      text,
      period: '',
    });
  }
  return out;
}

function parseDominoSitePromos(html) {
  const out = [];
  const text = stripHtml(html).replace(/\s+/g, ' ').trim();
  const m = text.match(/(Только в понедельник[^.!?]*\d+[.,]\d{2}[^.!?]*)/i);
  if (m) {
    out.push({
      id: 'monday',
      link: 'https://dominos.by/ru/minsk/promo/',
      text: m[1].trim(),
      period: '',
    });
  }
  return out;
}

function parseTempoDiscounts(html) {
  const out = [];
  const seen = new Set();
  let idx = 0;
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const head = stripHtml(m[1]).replace(/\s+/g, ' ').trim();
    if (!head || /^[a-zа-яё]{1,3}$/i.test(head)) continue;
    if (seen.has(head) || seen.size >= 6) continue;
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 700);
    const bodyM = tail.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    let body = '';
    if (bodyM) {
      body = stripHtml(bodyM[1]).replace(/\s+/g, ' ').trim();
    }
    const text = (head + (body ? ' — ' + body : '')).slice(0, 500);
    if (!/\d/.test(text) && !/акци|скидк|промо|бонус|%/.test(text)) continue;
    seen.add(head);
    out.push({
      id: 'tempo-' + (idx++),
      link: 'https://pizzatempo.by/discounts',
      text,
      period: '',
    });
  }
  return out;
}

function parseSkidyCompany(html) {
  const out = [];
  const seen = new Set();
  const hits = [];
  let pos = -1;
  while ((pos = html.indexOf('w-object-promocode-catalog-list-item', pos + 1)) !== -1) hits.push(pos);
  for (let k = 0; k < hits.length; k++) {
    const seg = html.slice(hits[k], Math.min((k + 1 < hits.length ? hits[k + 1] : hits[k] + 9000), hits[k] + 9000));
    const linkM = seg.match(/href="(https:\/\/skidy\.by\/promo\/[a-z0-9-]+)"/);
    const altM = seg.match(/alt="([^"]+)"/);
    if (!linkM || !altM) continue;
    const slug = linkM[1].split('/').pop();
    if (seen.has(slug)) continue;
    const text = altM[1].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(slug);
    out.push({ id: slug, link: linkM[1], text, period: '' });
  }
  return out;
}

async function fetchPerekrestokPeriod(it) {
  try {
    const res = await fetch(it.link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return it;
    const html = await res.text();
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
    if (h1) it.text = stripHtml(h1);
    const p =
      (html.match(/с\s+\d{1,2}(?:\s+[а-яё]+)?\s+по\s+\d{1,2}(?:\s+[а-яё]+)?/i) || [])[0] ||
      (html.match(/\d{1,2}\.\d{2}\.\d{4}\s*[-–]\s*\d{1,2}\.\d{2}\.\d{4}/) || [])[0] ||
      '';
    if (p) it.period = p;
  } catch (e) {
    // keep listing item as-is
  }
  return it;
}

async function fetchPageHtml(url, insecure) {
  if (!insecure) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.text();
  }
  const https = require('https');
  return await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('http ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(new Error('timeout')); });
  });
}

function monthKey(w) {
  const s = String(w || '').toLowerCase();
  if (s.startsWith('январ')) return 0;
  if (s.startsWith('феврал')) return 1;
  if (s.startsWith('март')) return 2;
  if (s.startsWith('апрел')) return 3;
  if (s.startsWith('ма')) return 4;
  if (s.startsWith('июн')) return 5;
  if (s.startsWith('июл')) return 6;
  if (s.startsWith('август')) return 7;
  if (s.startsWith('сентябр')) return 8;
  if (s.startsWith('октябр')) return 9;
  if (s.startsWith('ноябр')) return 10;
  if (s.startsWith('декабр')) return 11;
  return -1;
}

function ruDateToNumeric(str) {
  const t = String(str || '').trim();
  if (!t) return '';
  const p = (n) => String(n).padStart(2, '0');
  const num = (s) => (s ? Number(s) : null);
  let m;
  // 12.08.2026 - 25.08.2026
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${p(m[2])}-${p(m[1])} 至 ${m[6]}-${p(m[5])}-${p(m[4])}`;
  // 1 января 2024 - 31 декабря 2026
  m = t.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s*[-–—]\s*(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (m) {
    const a = monthKey(m[2]), b = monthKey(m[5]);
    if (a >= 0 && b >= 0) return `${m[3]}-${p(a + 1)}-${p(m[1])} 至 ${m[6]}-${p(b + 1)}-${p(m[4])}`;
  }
  // с 1 сентября по 30 сентября
  m = t.match(/с\s+(\d{1,2})\s+([а-яё]+)\s+по\s+(\d{1,2})\s+([а-яё]+)/i);
  if (m) {
    const a = monthKey(m[2]), b = monthKey(m[4]);
    if (a >= 0 && b >= 0) return `${p(a + 1)}-${p(m[1])} 至 ${p(b + 1)}-${p(m[3])}`;
  }
  // с 12 по 25 августа
  m = t.match(/с\s+(\d{1,2})\s+по\s+(\d{1,2})\s+([а-яё]+)/i);
  if (m) {
    const mo = monthKey(m[3]);
    if (mo >= 0) return `${p(mo + 1)}-${p(m[1])} 至 ${p(mo + 1)}-${p(m[2])}`;
  }
  // 12 августа - 25 августа
  m = t.match(/(\d{1,2})\s+([а-яё]+)\s*[-–—]\s*(\d{1,2})\s+([а-яё]+)/i);
  if (m) {
    const a = monthKey(m[2]), b = monthKey(m[4]);
    if (a >= 0 && b >= 0) return `${p(a + 1)}-${p(m[1])} 至 ${p(b + 1)}-${p(m[3])}`;
  }
  // с 03.08 по 16.08
  m = t.match(/с\s+(\d{1,2})\.(\d{1,2})\s+по\s+(\d{1,2})\.(\d{1,2})/i);
  if (m) return `${p(m[2])}-${p(m[1])} 至 ${p(m[4])}-${p(m[3])}`;
  // 12.08.2026 (single)
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${p(m[2])}-${p(m[1])}`;
  // 12 августа (single)
  m = t.match(/(\d{1,2})\s+([а-яё]+)/i);
  if (m) {
    const mo = monthKey(m[2]);
    if (mo >= 0) return `${p(mo + 1)}-${p(m[1])}`;
  }
  return t;
}

function parseEndDate(str) {
  if (!str) return null;
  const t = String(str).trim();
  let day, mon, yr;
  let m = t.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/i);
  if (m) {
    day = +m[1]; mon = monthKey(m[2]); yr = +m[3];
  } else {
    m = t.match(/^(\d{1,2})\s+([а-яё]+)$/i);
    if (m) { day = +m[1]; mon = monthKey(m[2]); }
    else {
      m = t.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{4}))?$/);
      if (m) { day = +m[1]; mon = +m[2] - 1; yr = m[3] ? +m[3] : undefined; }
    }
  }
  if (day === undefined || mon === undefined || mon < 0) return null;
  const now = new Date();
  if (!yr) {
    yr = now.getFullYear();
    let d = new Date(yr, mon, day);
    if (now - d > 120 * 86400000) d = new Date(yr + 1, mon, day);
    return d;
  }
  return new Date(yr, mon, day);
}

function isDealExpired(d) {
  const end = parseEndDate(d && d.endDate);
  if (!end) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end.getTime() < today.getTime();
}

function isRealDeal(d) {
  if (d == null) return false;
  if (d.price != null || d.oldPrice != null || d.discount != null) return true;
  const t = String(d.text || '');
  if (/промокод|промо-код|по промокод/i.test(t) || /BYN|бел\. руб|бел. руб/i.test(t)) return true;
  return (d.user || '').startsWith('page:') && t.length > 1;
}

function dealSig(d) {
  const t = String(d.text || '')
    .toLowerCase()
    .replace(/\d{1,4}[.,]\d{2}/g, ' ')
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .replace(/[^а-яёa-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (d.store + '|' + t).slice(0, 80);
}

function trendOf(d) {
  const h = (d && d.history) || [];
  if (h.length < 2) return '';
  const cur = h[h.length - 1].p;
  const prev = h[h.length - 2].p;
  if (cur == null || prev == null || cur === prev) return '';
  const delta = cur - prev;
  return delta < 0 ? `▼${Math.abs(delta).toFixed(2)}` : `▲${delta.toFixed(2)}`;
}

function shareText(d) {
  const zh = d.zh || d.text || '';
  let prefix = '';
  if (d.price != null) {
    prefix = `${d.price.toFixed(2).replace('.', ',')} BYN${d.priceUnit ? '/' + d.priceUnit : ''}`;
  } else if (d.discount != null && zh.indexOf('-' + d.discount + '%') === -1 && zh.indexOf('−' + d.discount + '%') === -1) {
    prefix = `−${d.discount}%`;
  }
  return `【${zhStore(d.store)}】${prefix ? prefix + ' ' : ''}${zh.slice(0, 120)} — ${d.link}`;
}

function extractDealFields(text, period) {
  const t = String(text || '');
  const out = { price: null, priceUnit: '', oldPrice: null, discount: null, endDate: '' };
  if (!t) return out;
  const num = (s) => (s ? Number(s.replace(',', '.')) : null);
  const oldM = t.match(/вместо\s+(\d{1,4}[.,]\d{2})/i);
  if (oldM) out.oldPrice = num(oldM[1]);
  const discM = t.match(/(?:скидк[а-яё]*\s+(?:до\s+)?)?[-−]?\s*(\d{1,3})\s*%/i);
  if (discM) out.discount = Number(discM[1]);
  const months = /(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;
  const re = /(\d{1,4}[.,]\d{2})(?!\d)/gi;
  for (const m of t.matchAll(re)) {
    if (oldM && m[1] === oldM[1]) continue;
    const day = parseInt(m[1], 10);
    const head = t.slice(Math.max(0, m.index - 26), m.index);
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 26);
    const unitM = t.slice(m.index + m[0].length, m.index + m[0].length + 12).match(/\/кг|за\s*кг|\/шт|за\s*шт|\/л|за\s*л|кг|шт|литр/);
    const unit = unitM ? unitM[0].replace(/за\s+/, '/') : '';
    const isDate =
      day <= 31 &&
      !unit &&
      (/\.\d{2,4}/.test(tail) ||
        /(?:по|до|с)\s+\d{1,2}[.,]\d{2}/.test(tail) ||
        /(?:с|по|до)\s+\d{1,2}[.,]\d{2}/.test(head) ||
        months.test(tail.slice(0, 14)) ||
        months.test(head.slice(-14)));
    if (isDate) continue;
    out.price = num(m[1]);
    out.priceUnit = unit;
    break;
  }
  const src = String(period || text || '');
  const full = src.match(/\d{1,2}\s+[а-яё]+\s+\d{4}/gi);
  if (full && full.length) out.endDate = full[full.length - 1];
  else {
    const rel = src.match(/(?:по|до)\s+(\d{1,2}\s+[а-яё]+)/i);
    if (rel) out.endDate = rel[1];
    else {
      const dotted = src.match(/(\d{1,2}\.\d{2}(?:\.\d{4})?)\s*$/);
      if (dotted) out.endDate = dotted[1];
    }
  }
  return out;
}

function parseTelegramPage(html) {
  const out = [];
  const posts = [];
  const rePost = /data-post="([\w-]+\/\d+)"/g;
  let m;
  while ((m = rePost.exec(html))) posts.push({ post: m[1], at: m.index });
  for (let i = 0; i < posts.length; i++) {
    const start = posts[i].at;
    const end = i + 1 < posts.length ? posts[i + 1].at : html.length;
    const block = html.slice(start, end);
    if (block.includes('service_message')) continue;
    const textM = block.match(/js-message_text" dir="auto">([\s\S]*?)<\/div>/);
    const dateM = block.match(/datetime="([^"]+)"/);
    const photoM = block.match(/background-image:url\(\\?'(https:\/\/cdn4\.telesco\.pe\/[^'\\]+)/);
    const text = textM ? stripHtml(textM[1]) : '';
    if (!text && !photoM) continue;
    out.push({
      id: posts[i].post.split('/')[1],
      link: 'https://t.me/' + posts[i].post,
      date: dateM ? dateM[1] : '',
      text,
      photo: photoM ? photoM[1] : '',
    });
  }
  return out;
}

async function fetchDeals() {
  mkdirSync(ART_DIR, { recursive: true });
  const existing = readJson(DEALS_FILE, []);
  const clean = (d) => (d.user || '').length > 1 && d.id && d.id !== 'undefined';
  const tgMap = new Map(existing.filter((d) => !(d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const pageMap = new Map(existing.filter((d) => (d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const cutoff = Date.now() - DEAL_DAYS * 86400000;
  const histMap = new Map();
  for (const d of existing) {
    if (!clean(d)) continue;
    const k = dealSig(d);
    histMap.set(k, (histMap.get(k) || []).concat((d.history || []).map((h) => ({ t: String(h.t || '').slice(0, 10), p: h.p }))));
  }
  const withHistory = (d) => {
    const sig = dealSig(d);
    const hist = (histMap.get(sig) || []).slice();
    const today = new Date().toISOString().slice(0, 10);
    const last = hist[hist.length - 1];
    if (d.price != null && (!last || last.p !== d.price || last.t !== today)) {
      hist.push({ t: today, p: d.price });
    }
    if (hist.length > 8) hist.splice(0, hist.length - 8);
    histMap.set(sig, hist);
    d.history = hist;
    return d;
  };
  for (const ch of DEAL_CHANNELS) {
    try {
      const res = await fetch(`https://t.me/s/${ch.user}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const html = await res.text();
      const msgs = parseTelegramPage(html);
      let kept = 0;
      for (const msg of msgs) {
        if (!msg.date || new Date(msg.date).getTime() < cutoff) continue;
        const fields = extractDealFields(msg.text, '');
        if (!isRealDeal(fields)) continue;
        const key = ch.user + '/' + msg.id;
        const prev = tgMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(msg.text.slice(0, 1500))) || msg.text;
          await sleep(150);
        }
        tgMap.set(key, withHistory({
          user: ch.user,
          id: msg.id,
          store: ch.store,
          link: msg.link,
          date: msg.date,
          beijing: fmtBeijing(msg.date),
          text: msg.text,
          zh,
          photo: msg.photo,
          ...fields,
        }));
        kept++;
      }
      console.log(`  deals ${ch.user}: ${msgs.length} 帖，保留 ${kept}`);
    } catch (e) {
      console.log(`  deals ${ch.user} fail: ${e.message}`);
    }
    await sleep(300);
  }
  for (const src of DEAL_PAGES) {
    try {
      const html = await fetchPageHtml(src.url, !!src.insecure);
      const items = src.parse(html);
      const now = new Date().toISOString();
      let kept = 0;
      for (const it of items.slice(0, src.limit || 8)) {
        if (src.enrich) {
          await src.enrich(it);
          await sleep(200);
        }
        const key = 'page:' + src.id + '/' + it.id;
        const prev = pageMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(it.text.slice(0, 1500))) || it.text;
          await sleep(150);
        }
        pageMap.set(key, withHistory({
          user: 'page:' + src.id,
          id: it.id,
          store: src.store,
          link: it.link,
          date: now,
          beijing: fmtBeijing(now),
          text: it.text,
          zh,
          period: it.period || '',
          photo: '',
          ...extractDealFields(it.text, it.period || ''),
        }));
        kept++;
      }
      console.log(`  deals ${src.id}: ${items.length} 条，保留 ${kept}`);
    } catch (e) {
      console.log(`  deals ${src.id} fail: ${e.message}`);
    }
    await sleep(300);
  }
  const pageItems = [...pageMap.values()];
  const tgItems = [...tgMap.values()]
    .filter((d) => d.date && new Date(d.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const deals = [...pageItems, ...tgItems]
    .filter((d) => !isDealExpired(d) && isRealDeal(d))
    .slice(0, DEAL_MAX);
  writeFileSync(DEALS_FILE, JSON.stringify(deals, null, 2), 'utf8');
  return deals;
}

async function fetchFastfoods() {
  mkdirSync(ART_DIR, { recursive: true });
  const existing = readJson(FASTFOODS_FILE, []);
  const clean = (d) => (d.user || '').length > 1 && d.id && d.id !== 'undefined';
  const tgMap = new Map(existing.filter((d) => !(d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const pageMap = new Map(existing.filter((d) => (d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const cutoff = Date.now() - FASTFOOD_DAYS * 86400000;
  const histMap = new Map();
  for (const d of existing) {
    if (!clean(d)) continue;
    const k = dealSig(d);
    histMap.set(k, (histMap.get(k) || []).concat((d.history || []).map((h) => ({ t: String(h.t || '').slice(0, 10), p: h.p }))));
  }
  const withHistory = (d) => {
    const sig = dealSig(d);
    const hist = (histMap.get(sig) || []).slice();
    const today = new Date().toISOString().slice(0, 10);
    const last = hist[hist.length - 1];
    if (d.price != null && (!last || last.p !== d.price || last.t !== today)) {
      hist.push({ t: today, p: d.price });
    }
    if (hist.length > 8) hist.splice(0, hist.length - 8);
    histMap.set(sig, hist);
    d.history = hist;
    return d;
  };
  for (const ch of FASTFOOD_TG) {
    try {
      const res = await fetch(`https://t.me/s/${ch.user}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const html = await res.text();
      const msgs = parseTelegramPage(html);
      let kept = 0;
      for (const msg of msgs) {
        if (!msg.date || new Date(msg.date).getTime() < cutoff) continue;
        const fields = extractDealFields(msg.text, '');
        if (!isRealDeal({ ...fields, text: msg.text })) continue;
        const key = ch.user + '/' + msg.id;
        const prev = tgMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(msg.text.slice(0, 1500))) || msg.text;
          await sleep(150);
        }
        tgMap.set(key, withHistory({
          user: ch.user,
          id: msg.id,
          store: ch.store,
          link: msg.link,
          date: msg.date,
          beijing: fmtBeijing(msg.date),
          text: msg.text,
          zh,
          photo: msg.photo,
          ...fields,
        }));
        kept++;
      }
      console.log(`  fastfood ${ch.user}: ${msgs.length} 帖，保留 ${kept}`);
    } catch (e) {
      console.log(`  fastfood ${ch.user} fail: ${e.message}`);
    }
    await sleep(300);
  }
  for (const src of FASTFOOD_PAGES) {
    try {
      const html = await fetchPageHtml(src.url, !!src.insecure);
      const items = src.parse(html);
      const now = new Date().toISOString();
      let kept = 0;
      for (const it of items.slice(0, src.limit || 6)) {
        const key = 'page:' + src.id + '/' + it.id;
        const prev = pageMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(it.text.slice(0, 1500))) || it.text;
          await sleep(150);
        }
        pageMap.set(key, withHistory({
          user: 'page:' + src.id,
          id: it.id,
          store: src.store,
          link: it.link,
          date: now,
          beijing: fmtBeijing(now),
          text: it.text,
          zh,
          period: it.period || '',
          photo: '',
          ...extractDealFields(it.text, it.period || ''),
        }));
        kept++;
      }
      console.log(`  fastfood ${src.id}: ${items.length} 条，保留 ${kept}`);
    } catch (e) {
      console.log(`  fastfood ${src.id} fail: ${e.message}`);
    }
    await sleep(300);
  }
  const pageItems = [...pageMap.values()];
  const tgItems = [...tgMap.values()]
    .filter((d) => d.date && new Date(d.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const items = [...pageItems, ...tgItems]
    .filter((d) => !isDealExpired(d) && isRealDeal(d))
    .slice(0, FASTFOOD_MAX);
  writeFileSync(FASTFOODS_FILE, JSON.stringify(items, null, 2), 'utf8');
  return items;
}

function articlePageHtml(rec) {
  const isBelta = rec.source === 'belta';
  const origLabel = isBelta ? '查看中文原文 ↗' : '查看俄语原文 ↗';
  let bodyHtml;
  if (rec.body && rec.body.length) {
    const imgs = (rec.images || []).map((src) => `<img class="article-img" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join('\n');
    bodyHtml = (imgs ? imgs + '\n' : '') + rec.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  } else {
    bodyHtml = `<p>${escapeHtml(rec.sum || rec.zh)} <a href="${escapeHtml(rec.link)}" target="_blank" rel="noopener noreferrer">${origLabel}</a></p>
<p class="note">本文尚无全文译文，请看摘要或原文。</p>`;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(rec.zh)} · 白俄新闻中文站</title>
<meta name="description" content="${escapeHtml((rec.sum || rec.zh).slice(0, 160))}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="../style.css">
</head>
<body>
${PARENT_LINK}
<nav class="crumb"><a href="../index.html">← 返回首页</a></nav>
<header class="site-head article-head">
  <h1>${escapeHtml(rec.zh)}</h1>
  ${isBelta ? '' : `<div class="ru">${escapeHtml(rec.ru)}</div>`}
  <div class="meta">${catBadge(rec.cat)} <span class="mtime">● ${escapeHtml(rec.beijing)}（北京时间）</span> · <a href="${escapeHtml(rec.link)}" target="_blank" rel="noopener noreferrer">${origLabel}</a></div>
</header>
<main class="article-body">
${bodyHtml}
</main>
<footer class="site-foot">
  <p>${isBelta ? '本文转载自白通社中文版（chn.belta.by），版权归原作者所有。' : '本文由机器自动翻译，可能存在不准确之处，仅供学习交流。'}</p>
  <p><a href="../index.html">← 返回首页</a></p>
</footer>
${PWA_REGISTER_DEEP}
</body>
</html>
`;
}

function catBadge(cat) {
  const c = cat || 'news';
  return `<span class="badge badge-${c}">${CAT_LABEL[c] || '新闻'}</span>`;
}

function lifePageHtml(life) {
  const secs = (life || [])
    .map(
      (s) => `<section class="life-sec">
  <h2>${s.icon ? s.icon + ' ' : ''}${escapeHtml(s.title)}</h2>
  <ul class="life-list">
    ${(s.items || [])
      .map(
        (it) => `<li>
      <div class="life-name">${escapeHtml(it.name)}${it.phone ? ` <span class="life-phone">${escapeHtml(it.phone)}</span>` : ''}</div>
      ${it.img ? `<img class="life-img" src="${escapeHtml(it.img)}" alt="${escapeHtml(it.name)}" loading="lazy">` : ''}
      ${it.addr ? `<div class="life-addr">📍 ${escapeHtml(it.addr)}</div>` : ''}
      ${it.note ? `<div class="life-note">${escapeHtml(it.note).split('\n').join('<br>')}</div>` : ''}
      ${it.link ? `<div class="life-link"><a href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.link.replace(/^https?:\/\//, ''))} ↗</a></div>` : ''}
    </li>`
      )
      .join('\n')}
  </ul>
</section>`
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>生活指南 · 白俄新闻中文站</title>
<meta name="description" content="在白俄罗斯生活的实用信息：紧急电话、中国驻白大使馆与签证、医疗就医、交通出行、白俄高校地址。">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="style.css">
</head>
<body>
${PARENT_LINK}
<nav class="crumb"><a href="index.html">← 返回首页</a></nav>
<header class="site-head article-head">
  <h1>📖 生活指南</h1>
</header>
<main>
${secs}
</main>
<footer class="site-foot">
  <p>信息仅供参考，地址和电话可能变动，请以官方渠道为准。</p>
  <p><a href="index.html">← 返回首页</a></p>
</footer>
${PWA_REGISTER}
</body>
</html>
`;
}

function highlightPromoCode(text) {
  const t = String(text || '');
  const m = t.match(/промокод[а-яё]*\s*[:№\s»«"'\u00A0]*\s*([A-ZА-ЯЁ0-9]{3,12})/i);
  if (!m) return '';
  const raw = m[1];
  if (!/[0-9A-ZА-ЯЁ]/.test(raw) || /[а-яё]/.test(raw)) return '';
  const code = raw.toUpperCase();
  return `<div class="promo-code">🎟️ 优惠码 <b>${escapeHtml(code)}</b></div>`;
}

function homepageHtml(records, deals, fastfoods, updated, widgets) {
  const recent = records.slice(0, HOMEPAGE_RECENT);
  const storeCounts = {};
  for (const d of deals) storeCounts[d.store] = (storeCounts[d.store] || 0) + 1;
  const storeChips = ALL_STORES
    .map((s) => ({ s, n: storeCounts[s] || 0 }))
    .sort((a, b) => b.n - a.n)
    .map(
      ({ s, n }) =>
        `<button class="chip" data-store="${escapeHtml(s)}" type="button">${storeIcon(s) ? `<img class="chip-ico" src="${storeIcon(s)}" alt="" loading="lazy">` : ''}${escapeHtml(enStore(s))}<b>${n}</b></button>`
    )
    .join('\n');
  const ffCounts = {};
  for (const d of fastfoods) ffCounts[d.store] = (ffCounts[d.store] || 0) + 1;
  const ffChips = ALL_FASTFOOD
    .map((s) => ({ s, n: ffCounts[s] || 0 }))
    .sort((a, b) => b.n - a.n)
    .map(
      ({ s, n }) =>
        `<button class="chip ff-chip" data-ffstore="${escapeHtml(s)}" type="button">${ffIcon(s) ? `<img class="chip-ico" src="${ffIcon(s)}" alt="" loading="lazy">` : ''}${escapeHtml(ffEn(s))}<b>${n}</b></button>`
    )
    .join('\n');
  const fastfoodBar = `<div class="deals-bar ff-bar">
  <div class="storechips">
    <button class="chip ff-chip active" data-ffstore="" type="button">All</button>
    ${ffChips}
  </div>
  <div class="deal-sort">
    <span class="deals-n">🍔 ${fastfoods.length} deals</span>
  </div>
</div>`;
  const ffCard = (d) => {
    const dPeriod = ruDateToNumeric(d.period);
    return `<article class="card deal ff-deal" data-cat="ff" data-ffstore="${escapeHtml(d.store)}" data-price="${d.price != null ? d.price : ''}" data-key="${escapeHtml(d.user + '/' + d.id)}" title="${escapeHtml((dPeriod ? dPeriod + ' · ' : '') + d.text.slice(0, 160))}">
  ${d.photo ? `<img class="deal-img" src="${escapeHtml(d.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  <div class="deal-head"><span class="store-chip ff-store-chip">${ffIcon(d.store) ? `<img class="chip-ico" src="${ffIcon(d.store)}" alt="" loading="lazy">` : ''}${escapeHtml(ffEn(d.store))}</span> <span class="mtime">● ${escapeHtml(dPeriod || d.beijing + '（北京时间）')}</span></div>
  ${d.price != null
    ? `<div class="deal-price">${d.price.toFixed(2).replace('.', ',')}${d.priceUnit ? ' ' + escapeHtml(d.priceUnit) : ''}<span class="cur"> BYN</span>${d.oldPrice != null ? ` <s>${d.oldPrice.toFixed(2).replace('.', ',')}</s>` : ''}${trendOf(d) ? ` <span class="trend ${trendOf(d)[0] === '▼' ? 'down' : 'up'}">${trendOf(d)}</span>` : ''}</div>`
    : d.discount != null
      ? `<div class="deal-price off">−${d.discount}%</div>`
      : ''}
  <p class="deal-text clamp">${escapeHtml((d.zh || d.text).slice(0, 1500))}</p>
  ${highlightPromoCode((d.text || ''))}
  <button class="deal-more" type="button" hidden>展开全文</button>
  <span class="ru-src" hidden>${escapeHtml(d.text)}</span>
  <div class="meta deal-actions"><a href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>
</article>`;
  };
  const ffGroupOf = (s) => {
    const list = fastfoods.filter((d) => d.store === s);
    if (!list.length) return '';
    return `<section class="ff-group" data-ffgroup="${escapeHtml(s)}">
<h3 class="ff-group-h">${ffIcon(s) ? `<img class="chip-ico" src="${ffIcon(s)}" alt="" loading="lazy">` : ''}${escapeHtml(ffEn(s))}<b>${list.length}</b></h3>
${list.map(ffCard).join('\n')}
</section>`;
  };
  const ffGroups = [...ALL_FASTFOOD]
    .map((s) => ({ s, n: fastfoods.filter((d) => d.store === s).length }))
    .sort((a, b) => b.n - a.n)
    .map((o) => ffGroupOf(o.s))
    .join('\n');
  const fastfoodCards = `<section class="ff-section">
<div class="ff-title">
  <h2>🍔 明斯克快餐折扣</h2>
</div>
<div class="deal-feed ff-feed">
${fastfoodBar}
<div class="deal-empty" hidden>该快餐品牌暂无折扣信息</div>
${ffGroups}
</div>
</section>`;
  const dealBar = `<div class="deals-bar">
  <div class="storechips">
    <button class="chip active" data-store="" type="button">All</button>
    ${storeChips}
  </div>
  <div class="deal-sort">
    <span class="deals-n">${deals.length} deals</span>
    <button class="sbtn active" data-sort="time" type="button">Newest</button>
    <button class="sbtn" data-sort="price" type="button">Price (Low→High)</button>
    <button class="sbtn favbtn" type="button">♡ 收藏</button>
  </div>
</div>`;
  const dealCards = `<div class="deal-feed">
${dealBar}
<div class="deal-empty" hidden>该超市暂无折扣信息</div>
${deals
  .map(
    (d) => {
    const dPeriod = ruDateToNumeric(d.period);
    return `<article class="card deal" data-cat="deal" data-store="${escapeHtml(d.store)}" data-price="${d.price != null ? d.price : ''}" data-key="${escapeHtml(d.user + '/' + d.id)}" title="${escapeHtml((dPeriod ? dPeriod + ' · ' : '') + d.text.slice(0, 160))}">
  ${d.photo ? `<img class="deal-img" src="${escapeHtml(d.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  <div class="deal-head"><span class="store-chip">${storeIcon(d.store) ? `<img class="chip-ico" src="${storeIcon(d.store)}" alt="" loading="lazy">` : ''}${escapeHtml(enStore(d.store))}</span> <span class="mtime">● ${escapeHtml(dPeriod || d.beijing + '（北京时间）')}</span></div>
  ${d.price != null
    ? `<div class="deal-price">${d.price.toFixed(2).replace('.', ',')}${d.priceUnit ? ' ' + escapeHtml(d.priceUnit) : ''}<span class="cur"> BYN</span>${d.oldPrice != null ? ` <s>${d.oldPrice.toFixed(2).replace('.', ',')}</s>` : ''}${trendOf(d) ? ` <span class="trend ${trendOf(d)[0] === '▼' ? 'down' : 'up'}">${trendOf(d)}</span>` : ''}</div>`
    : d.discount != null
      ? `<div class="deal-price off">−${d.discount}%</div>`
      : ''}
  <p class="deal-text clamp">${escapeHtml((d.zh || d.text).slice(0, 1500))}</p>
  <button class="deal-more" type="button" hidden>展开全文</button>
  <span class="ru-src" hidden>${escapeHtml(d.text)}</span>
  <div class="meta deal-actions"><button class="fav" type="button" data-key="${escapeHtml(d.user + '/' + d.id)}" title="收藏">♡</button><button class="share" type="button" data-share="${escapeHtml(shareText(d))}">分享</button><a href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>
</article>`;
  }
  )
  .join('\n')}
</div>`;
  const cards = recent
    .map(
      (c) => `<article class="card" data-cat="${c.cat || 'news'}" title="${escapeHtml((c.ru || c.zh).slice(0, 160))}">
  <h2 class="ttl"><a href="article/${encodeURIComponent(c.slug)}.html">${escapeHtml(c.zh)}</a></h2>
  <span class="ru-src" hidden>${escapeHtml(c.ru)}</span>
  ${(c.sum || '').length > 1 ? `<p class="sum">${escapeHtml(c.sum.slice(0, 160))} <a class="more" href="article/${encodeURIComponent(c.slug)}.html">阅读全文 ↗</a></p>` : ''}
  <div class="meta">${catBadge(c.cat)} <span class="mtime">● ${escapeHtml(c.beijing)}（北京时间）</span> <a href="article/${encodeURIComponent(c.slug)}.html">中文全文 ↗</a></div>
</article>`
    )
    .join('\n');

  const older = records.slice(HOMEPAGE_RECENT);
  let olderHtml = '';
  if (older.length) {
    const list = older
      .map((o) => `<li class="arch-item" data-cat="${o.cat || 'news'}">${catBadge(o.cat)} <a href="article/${encodeURIComponent(o.slug)}.html">${escapeHtml(o.zh)}</a> <span class="old-date">${escapeHtml(o.beijing)}</span></li>`)
      .join('\n');
    olderHtml = `<details class="archive"><summary>更早的新闻（${records.length - recent.length} 篇）</summary>
<ul>${list}</ul></details>`;
  }

  const counts = { news: 0, event: 0, volunteer: 0, china: 0 };
  for (const r of records) counts[r.cat || 'news']++;
  const catInfo = `新闻 ${counts.news} · 活动 ${counts.event} · 中白 ${counts.china} · 超市折扣 ${deals.length} 条 · 快餐 ${fastfoods.length} 条`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白俄新闻中文站 · 白俄罗斯新闻中文明日速览</title>
<meta name="description" content="minsknews.by 自动翻译的白俄罗斯与明斯克新闻、白通社中文版新闻，以及明斯克各大超市折扣，定时更新，按北京时间显示。">
<meta property="og:type" content="website">
<meta property="og:site_name" content="白俄新闻中文站">
<meta property="og:title" content="白俄新闻中文站 · 白俄罗斯新闻中文明日速览">
<meta property="og:description" content="白俄罗斯与明斯克新闻（minsknews.by 自动翻译 + 白通社中文版）与明斯克超市折扣汇总，定时更新。">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
${PWA_HEAD}
<link rel="stylesheet" href="style.css">
</head>
<body>
${PARENT_LINK}
<header class="site-head">
  <h1>白俄新闻<span class="accent">中文站</span></h1>
  <p class="updated">更新于 ${updated}（北京时间）· 收录 ${records.length} 篇 · ${catInfo}</p>
</header>
${widgets}
<main>
<div class="searchbar">
  <input id="search" type="search" placeholder="🔍 搜索中文或俄语标题…" autocomplete="off" aria-label="站内搜索">
</div>
<div class="tabs" role="tablist">
  <button class="tab" data-f="deal">超市折扣</button>
  <button class="tab" data-f="ff">快餐折扣</button>
  <a class="tab tab-link" href="life.html" data-f="life">📖 生活指南</a>
  <button class="tab" data-f="news">新闻</button>
  <button class="tab" data-f="event">活动</button>
  <button class="tab" data-f="china">中白</button>
</div>
<p id="nores" class="nores" hidden>没有匹配的结果，换个关键词试试。</p>
${dealCards}
${fastfoodCards}
${cards}
${olderHtml}
</main>
<footer class="site-foot">
  <p>本站由机器自动抓取并翻译新闻，仅供学习交流，版权归原始来源 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">«Минск-новости»</a> 所有。</p>
  <p>时间均为北京时间 · <a href="https://github.com/wjd888-aaa/minsk-news-cn" target="_blank" rel="noopener noreferrer">开源项目</a></p>
</footer>
<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var items = document.querySelectorAll('.card, .arch-item');
  var arch = document.querySelector('.archive');
  var input = document.getElementById('search');
  var nores = document.getElementById('nores');
  var chips = document.querySelectorAll('.chip[data-store]');
  var sbtns = document.querySelectorAll('.sbtn');
  var activeStore = '';
  var sortMode = 'time';
  var favOnly = false;
  var feed = document.querySelector('.deal-feed');
  var origOrder = Array.prototype.slice.call(document.querySelectorAll('.card.deal'));
  var ffChips = document.querySelectorAll('.ff-chip');
  var ffFeed = document.querySelector('.ff-feed');
  var ffSection = document.querySelector('.ff-section');
  var activeFf = '';
  function favKeys() {
    try { return JSON.parse(localStorage.getItem('favDeals') || '[]') || []; }
    catch (e) { return []; }
  }
  function saveFavs(k) {
    try { localStorage.setItem('favDeals', JSON.stringify(k)); } catch (e) {}
  }
  function renderFavs() {
    var k = favKeys();
    document.querySelectorAll('.card.deal .fav').forEach(function (b) {
      b.textContent = k.indexOf(b.getAttribute('data-key')) !== -1 ? '♥' : '♡';
    });
    var fb = document.querySelector('.favbtn');
    if (fb) fb.textContent = favOnly ? '♥ 收藏 ' + k.length : '♡ 收藏 ' + k.length;
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'show';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = ''; }, 1800);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { return true; });
    }
    return new Promise(function (res) {
      var ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { res(document.execCommand('copy')); } catch (e) { res(false); }
      document.body.removeChild(ta);
    });
  }
  function applyFf() {
    if (!ffFeed) return;
    var q = (input && input.value || '').toLowerCase().trim();
    var vis = 0;
    ffFeed.querySelectorAll('.ff-deal').forEach(function (c) {
      var ok = (!activeFf || c.getAttribute('data-ffstore') === activeFf) &&
               (!q || (c.textContent || '').toLowerCase().indexOf(q) !== -1);
      c.style.display = ok ? '' : 'none';
      if (ok) vis++;
    });
    ffFeed.querySelectorAll('.ff-group').forEach(function (g) {
      var any = Array.prototype.some.call(g.querySelectorAll('.ff-deal'), function (c) {
        return c.style.display !== 'none';
      });
      g.style.display = any ? '' : 'none';
    });
    var empty = ffFeed.querySelector('.deal-empty');
    if (empty) empty.hidden = vis !== 0;
    ffFeed.style.display = vis ? '' : 'none';
  }
  var origSuper = origOrder.filter(function (el) { return !el.classList.contains('ff-deal'); });
  function sortDeals() {
    if (!feed) return;
    var list;
    if (sortMode === 'price') {
      list = origSuper.slice().sort(function (a, b) {
        var pa = parseFloat(a.getAttribute('data-price') || '');
        var pb = parseFloat(b.getAttribute('data-price') || '');
        pa = isNaN(pa) ? 1e12 : pa;
        pb = isNaN(pb) ? 1e12 : pb;
        return pa - pb;
      });
    } else {
      list = origSuper.slice();
    }
    list.forEach(function (el) { feed.appendChild(el); });
  }
  function apply() {
    var active = document.querySelector('.tab.active');
    var f = active ? active.getAttribute('data-f') : 'all';
    var q = (input && input.value || '').toLowerCase().trim();
    var vis = 0;
    items.forEach(function (c) {
      var okCat = (f === 'all' || c.getAttribute('data-cat') === f);
      var okTxt = !q || (c.textContent || '').toLowerCase().indexOf(q) !== -1;
      var okStore = (c.getAttribute('data-cat') !== 'deal') || !activeStore || c.getAttribute('data-store') === activeStore;
      var okFav = (c.getAttribute('data-cat') !== 'deal') || !favOnly || favKeys().indexOf(c.getAttribute('data-key')) !== -1;
      var show = okCat && okTxt && okStore && okFav;
      c.style.display = show ? '' : 'none';
      if (show) vis++;
    });
    if (nores) nores.hidden = vis !== 0;
    if (arch) arch.open = (q !== '' || f !== 'all');
    if (feed) {
      var dealVis = Array.prototype.some.call(feed.querySelectorAll('.card.deal'), function (c) {
        return c.style.display !== 'none';
      });
      var empty = feed.querySelector('.deal-empty');
      if (activeStore) {
        feed.style.display = '';
        if (empty) empty.hidden = dealVis;
      } else {
        feed.style.display = dealVis ? '' : 'none';
        if (empty) empty.hidden = true;
      }
    }
    if (ffSection) {
      if (f === 'all' || f === '' || f === 'ff') {
        ffSection.style.display = '';
        applyFf();
      } else {
        ffSection.style.display = 'none';
      }
    }
    sortDeals();
    refreshDealButtons();
  }
  function refreshDealButtons() {
    document.querySelectorAll('.card.deal .deal-text').forEach(function (t) {
      var btn = t.parentElement.querySelector('.deal-more');
      if (!btn) return;
      if (t.classList.contains('clamp')) {
        btn.hidden = t.scrollHeight <= t.clientHeight + 2;
        btn.textContent = '展开全文';
      } else {
        btn.hidden = false;
        btn.textContent = '收起';
      }
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.deal-more') : null;
    if (!btn) return;
    var t = btn.parentElement.querySelector('.deal-text');
    if (t) t.classList.toggle('clamp');
    refreshDealButtons();
  });
  tabs.forEach(function (t) {
    t.addEventListener('click', function (e) {
      if (t.tagName === 'A') return;
      tabs.forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      apply();
    });
  });
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      activeStore = c.getAttribute('data-store');
      chips.forEach(function (x) { x.classList.toggle('active', x === c); });
      var dealTab = document.querySelector('.tab[data-f="deal"]');
      if (dealTab) {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        dealTab.classList.add('active');
      }
      apply();
    });
  });
  ffChips.forEach(function (c) {
    c.addEventListener('click', function () {
      activeFf = c.getAttribute('data-ffstore');
      ffChips.forEach(function (x) { x.classList.toggle('active', x === c); });
      var ffTab = document.querySelector('.tab[data-f="ff"]');
      if (ffTab) {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        ffTab.classList.add('active');
      }
      apply();
    });
  });
  sbtns.forEach(function (b) {
    b.addEventListener('click', function () {
      sortMode = b.getAttribute('data-sort');
      sbtns.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      apply();
    });
  });
  var favbtn = document.querySelector('.favbtn');
  if (favbtn) favbtn.addEventListener('click', function () {
    favOnly = !favOnly;
    renderFavs();
    apply();
  });
  document.addEventListener('click', function (e) {
    var fav = e.target.closest ? e.target.closest('.fav') : null;
    if (fav) {
      var k = favKeys();
      var key = fav.getAttribute('data-key');
      var i = k.indexOf(key);
      if (i === -1) k.push(key); else k.splice(i, 1);
      saveFavs(k);
      renderFavs();
      apply();
      return;
    }
    var sh = e.target.closest ? e.target.closest('.share') : null;
    if (sh) {
      copyText(sh.getAttribute('data-share') || '').then(function () {
        toast('已复制，请粘贴到微信发送');
      });
    }
  });
  renderFavs();
  refreshDealButtons();
  if (window.addEventListener) window.addEventListener('load', refreshDealButtons);
  if (input) input.addEventListener('input', apply);
})();
</script>
${PWA_REGISTER}
</body>
</html>
`;
}

async function fetchFeed(url, name) {
  console.log('Fetching ' + name + ' from ' + url);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(name + ' http ' + res.status);
  const xml = await res.text();
  const blocks = parseFeed(xml);
  if (!blocks.length) throw new Error(name + ': no items parsed');
  return blocks;
}

async function fetchNews() {
  const [blocks, bBlocks] = await Promise.all([
    fetchFeed(RSS_URL, 'minsknews RSS'),
    fetchFeed(BELTA_RSS, 'belta CN RSS').catch((e) => {
      console.log(e.message);
      return [];
    }),
  ]);
  console.log('Parsed items: ' + blocks.length + ' (minsknews) + ' + bBlocks.length + ' (belta)');

  // ---- 1. load existing index (re-classify by title so rules stay consistent) ----
  let index = readJson(INDEX_FILE, []);
  for (const r of index) r.cat = r.source === 'belta' ? classifyZh(r.zh) : classify(r.ru || '');
  const byLink = new Map(index.map((r) => [r.link, r]));

  // ---- 2. collect new records (minsknews: 俄文需翻译；belta: 已是中文) ----
  const newRecords = [];
  for (const b of blocks.slice(0, MAX_ITEMS)) {
    const link = field(b, 'link').trim();
    if (byLink.has(link)) continue;
    const ru = stripHtml(field(b, 'title'));
    if (!ru) continue;
    const isodate = field(b, 'pubDate').trim();
    newRecords.push({
      slug: slugFromUrl(link),
      link,
      ru,
      cat: classify(ru),
      isodate,
      beijing: fmtBeijing(isodate),
    });
  }
  for (const b of bBlocks.slice(0, MAX_ITEMS)) {
    const link = field(b, 'link').trim();
    if (byLink.has(link)) continue;
    const zh = stripHtml(field(b, 'title')).replace(/\s+/g, ' ').trim();
    if (!zh) continue;
    const isodate = field(b, 'pubDate').trim();
    newRecords.push({
      slug: slugFromUrl(link),
      link,
      ru: '',
      zh,
      source: 'belta',
      cat: classifyZh(zh),
      isodate,
      beijing: fmtBeijing(isodate),
    });
  }
  console.log('New articles: ' + newRecords.length);

  // ---- 3. translate new records (仅 minsknews 俄文标题；belta 无需翻译) ----
  for (const rec of newRecords) {
    if (rec.source === 'belta') continue;
    const desc = stripHtml(field(blocks.find((b) => field(b, 'link').trim() === rec.link) || '', 'description'));
    process.stdout.write(`  title: ${rec.ru.slice(0, 40)} ... `);
    rec.zh = (await translate(rec.ru)) || rec.ru;
    rec.sum = desc ? (await translate(desc.slice(0, 700))) || '' : '';
    console.log('done');
    await sleep(200 + Math.random() * 200);
  }

  // ---- 4. full text（belta 优先：已是中文、无翻译成本，每次最多 8 篇；再志愿者/活动优先，按最新） ----
  const prio = (r) => (r.source === 'belta' ? -1 : CAT_RANK[r.cat || 'news'] || 2);
  const fulltextOrder = [...newRecords].sort((a, b) => prio(a) - prio(b));
  let fulltextDone = 0;
  let beltaDone = 0;
  for (const rec of fulltextOrder) {
    if (fulltextDone >= MAX_FULLTEXT) break;
    if (rec.source === 'belta' && beltaDone >= BELTA_FULLTEXT_MAX) continue;
    process.stdout.write(`  body: ${(rec.zh || rec.ru).slice(0, 40)} ... `);
    try {
      const pr = await fetch(rec.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (pr.ok) {
        const html = await pr.text();
        if (rec.source === 'belta') {
          rec.body = extractBeltaBody(html).slice(0, 30);
          rec.images = await downloadArticleImages(extractBeltaImages(html), rec.slug, rec.link);
          if (rec.body.length) fulltextDone++;
          beltaDone++;
          console.log(`done (${rec.body.length} 段, ${rec.images.length} 图)`);
        } else {
          const paras = extractArticleBody(html);
          rec.body = [];
          for (const p of paras.slice(0, 40)) {
            const zh = await translate(p);
            if (zh) rec.body.push(zh);
            await sleep(200 + Math.random() * 200);
          }
          rec.images = await downloadArticleImages(extractArticleImages(html), rec.slug, rec.link);
          if (rec.body.length) fulltextDone++;
          console.log(`done (${rec.body.length} 段, ${rec.images.length} 图)`);
        }
      } else {
        rec.body = [];
        console.log('http ' + pr.status);
      }
    } catch (e) {
      rec.body = [];
      console.log('fetch fail');
    }
  }

  // ---- 5. merge into index, sort desc ----
  for (const rec of newRecords) byLink.set(rec.link, rec);
  const records = [...byLink.values()].sort((a, b) => new Date(b.isodate) - new Date(a.isodate));

  // ---- 6. write article pages + persist ----
  mkdirSync(ART_DIR, { recursive: true });
  for (const rec of newRecords) {
    writeFileSync(path.join(ART_DIR, `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
  }
  writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2), 'utf8');
  writeFileSync(LAST_RUN_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }), 'utf8');

  return { records, newCount: newRecords.length, fulltextDone };
}

async function buildSite(records, deals, fastfoods) {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(path.join(OUT_DIR, 'article'), { recursive: true });
  const updated = nowBeijing();
  let widgets = '';
  try {
    const [w1, r1] = await Promise.all([fetchWeather(), fetchRates()]);
    const parts = [w1, r1].filter(Boolean).map((p) => `<p class="widget">${p}</p>`);
    if (parts.length) widgets = `<div class="widgets">${parts.join('')}</div>`;
  } catch (e) {
    console.log('widgets fetch fail: ' + e.message);
  }
  writeFileSync(path.join(OUT_DIR, 'index.html'), homepageHtml(records, deals, fastfoods || [], updated, widgets), 'utf8');
  writeFileSync(path.join(OUT_DIR, 'life.html'), lifePageHtml(readJson(LIFE_FILE, [])), 'utf8');
  for (const rec of records) {
    try {
      writeFileSync(path.join(OUT_DIR, 'article', `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
    } catch {
      continue;
    }
  }
  copyFileSync(CSS_SRC, path.join(OUT_DIR, 'style.css'));
  for (const f of PWA_FILES) copyFileSync(path.join(ROOT, 'public', f), path.join(OUT_DIR, f));
  const storesDir = path.join(OUT_DIR, 'stores');
  mkdirSync(storesDir, { recursive: true });
  for (const f of readdirSync(path.join(ROOT, 'public', 'stores'))) {
    copyFileSync(path.join(ROOT, 'public', 'stores', f), path.join(storesDir, f));
  }
  const imgsDir = path.join(ART_DIR, 'imgs');
  if (existsSync(imgsDir)) {
    const outImgs = path.join(OUT_DIR, 'imgs');
    const walk = (from, to) => {
      mkdirSync(to, { recursive: true });
      for (const f of readdirSync(from)) {
        const s = path.join(from, f);
        const d = path.join(to, f);
        if (statSync(s).isDirectory()) walk(s, d);
        else copyFileSync(s, d);
      }
    };
    walk(imgsDir, outImgs);
  }
}

async function main() {
  // ---- 1. news 23h gate（只拦新闻，不拦超市折扣）----
  const lastRun = readJson(LAST_RUN_FILE, null);
  const gateBlocked = !!(lastRun && lastRun.ts && Date.now() - lastRun.ts < FETCH_INTERVAL_MS);

  let records = [];
  let newCount = 0;
  let fulltextDone = 0;
  if (gateBlocked) {
    const left = Math.ceil((FETCH_INTERVAL_MS - (Date.now() - lastRun.ts)) / 3600000);
    console.log(`SKIP news: 距上次抓取不足 23 小时，${left} 小时后再次检查。仍会抓取超市折扣并重建页面。`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'news_skipped=true\n');
    records = readJson(INDEX_FILE, []);
  } else {
    const r = await fetchNews();
    records = r.records;
    newCount = r.newCount;
    fulltextDone = r.fulltextDone;
  }

  // ---- 2. 超市折扣（始终抓取）----
  const deals = await fetchDeals();
  console.log('Deals: ' + deals.length + ' 条');

  // ---- 2.5 快餐折扣（始终抓取）----
  const fastfoods = await fetchFastfoods();
  console.log('Fastfoods: ' + fastfoods.length + ' 条');

  // ---- 3. build site（始终重建）----
  await buildSite(records, deals, fastfoods);
  console.log(`DONE: 共 ${records.length} 篇，本次新增 ${newCount} 篇（全文 ${fulltextDone} 篇），折扣 ${deals.length} 条，快餐 ${fastfoods.length} 条。`);
}

main().catch((e) => {
  console.error('BUILD ERROR:', e.message);
  process.exit(1);
});