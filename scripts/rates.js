'use strict';

/**
 * 汇率唯一取数模块。
 *
 * 网页顶部 widget、WhatsApp 汇率日报、线上校验脚本都从这里取数，
 * 保证「同一个数字只对应一个来源」，不会再出现「标着银联、实际是央行/市场价」。
 *
 * 来源优先级：
 *   1. unionpay  中国银联卡组织参考价（页面历来标注「银联」）
 *   2. nbrb      白俄罗斯央行官方牌价（周末、节假日也有数据）
 *   3. erapi     open.er-api.com 市场参考价（仅前两者都失败时）
 *   4. cache     本地缓存（明确标注原始来源与数据日期，超过 72 小时不再使用）
 *
 * 三条硬规则：
 *   - 每个来源必须同时给出 BYN→CNY 与 USD→CNY，绝不跨来源拼接；
 *   - 数值必须落在合理区间，方向写反 / 量纲写错会直接报错，不会静默展示；
 *   - 返回值一定带 source 与 date，界面据此标注，禁止冒充其他来源。
 */

const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0' };
const UNIONPAY_REFERER = 'https://www.unionpayintl.com/cn/rate/';
const UNIONPAY_BASE = 'https://www.unionpayintl.com/upload/jfimg/';
const NBRB_URL = 'https://api.nbrb.by/exrates/rates?periodicity=0';
const ERAPI_URL = 'https://open.er-api.com/v6/latest/USD';
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

/** 合理区间：1 BYN 约 1.5~4 元，1 USD 约 5~9 元。超出即视为脏数据 / 方向错误。 */
const BOUNDS = {
  bynInCny: [1.2, 4.5],
  usdInCny: [4.0, 10.0],
};

/** 来源显示名：页面与日报直接使用，调用方不得自行编造。 */
const LABELS = {
  unionpay: '银联',
  nbrb: '白央行',
  erapi: '市场参考',
  cache: '缓存',
};

const PRIORITY = ['unionpay', 'nbrb', 'erapi'];

/** 跨来源最大允许偏差：超过则视为该来源数据异常。 */
const CROSS_SOURCE_LIMIT_PCT = 2;
/** 缓存最长可用时间。 */
const MAX_CACHE_AGE_MS = 72 * 3600 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

function ymd(d) {
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}

function isoDate(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** 北京时间的「墙上时钟」，用 UTC 字段读取。 */
function beijingNow() {
  return new Date(Date.now() + BEIJING_OFFSET_MS);
}

function shortDate(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[2] + '-' + m[3] : String(date || '');
}

function validateRate(name, value, bounds) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error(name + ' 不是有效数字：' + value);
  if (v < bounds[0] || v > bounds[1]) {
    throw new Error(name + ' 超出合理区间 ' + bounds[0] + '~' + bounds[1] + '：' + v + '（疑似方向或量纲错误）');
  }
  return v;
}

function makeRate(source, date, bynInCny, usdInCny, extra) {
  return Object.assign(
    {
      source,
      sourceLabel: LABELS[source] || source,
      date: date || isoDate(new Date()),
      bynInCny: validateRate('BYN→CNY', bynInCny, BOUNDS.bynInCny),
      usdInCny: validateRate('USD→CNY', usdInCny, BOUNDS.usdInCny),
      fetchedAt: new Date().toISOString(),
    },
    extra || {}
  );
}

/* ------------------------------------------------------------------ *
 * 解析（纯函数，便于测试）
 * ------------------------------------------------------------------ */

/**
 * 银联 JSON：1 transCur = rateData baseCur。
 * 取 BYN/CNY 与 USD/CNY 两行，校验文件自带的 curDate 与请求日期一致。
 */
function parseUnionpay(payload, requestedDate) {
  const rows = payload && payload.exchangeRateJson;
  if (!Array.isArray(rows)) throw new Error('银联数据缺少 exchangeRateJson');
  const norm = (d) => String(d || '').replace(/-/g, '');
  if (payload.curDate && requestedDate && norm(payload.curDate) !== norm(requestedDate)) {
    throw new Error('银联文件日期 ' + payload.curDate + ' 与请求日期 ' + requestedDate + ' 不符');
  }
  const byn = rows.find((x) => x.transCur === 'BYN' && x.baseCur === 'CNY');
  const usd = rows.find((x) => x.transCur === 'USD' && x.baseCur === 'CNY');
  if (!byn) throw new Error('银联缺少 BYN/CNY');
  if (!usd) throw new Error('银联缺少 USD/CNY');
  return makeRate('unionpay', payload.curDate || requestedDate, Number(byn.rateData), Number(usd.rateData));
}

/** NBRB：Cur_Scale 表示「多少单位外币」，Cur_OfficialRate 是该数量对应的 BYN。 */
function parseNbrb(list) {
  if (!Array.isArray(list)) throw new Error('NBRB 返回格式异常');
  const cny = list.find((x) => x.Cur_Abbreviation === 'CNY' && Number(x.Cur_Scale) > 0);
  const usd = list.find((x) => x.Cur_Abbreviation === 'USD' && Number(x.Cur_Scale) > 0);
  if (!cny) throw new Error('NBRB 缺少 CNY');
  if (!usd) throw new Error('NBRB 缺少 USD');
  const cnyPerByn = Number(cny.Cur_OfficialRate) / Number(cny.Cur_Scale); // 1 CNY = ? BYN
  const usdPerByn = Number(usd.Cur_OfficialRate) / Number(usd.Cur_Scale); // 1 USD = ? BYN
  const bynInCny = 1 / cnyPerByn;
  const usdInCny = usdPerByn * bynInCny;
  const date = String(cny.Date || '').slice(0, 10);
  return makeRate('nbrb', date, bynInCny, usdInCny);
}

/** er-api：rates.X 表示 1 USD = ? X。 */
function parseErApi(json) {
  const r = json && json.rates;
  if (!r || !Number(r.CNY) || !Number(r.BYN)) throw new Error('er-api 缺少 CNY/BYN');
  const usdInCny = Number(r.CNY);
  const bynInCny = usdInCny / Number(r.BYN);
  const t = Date.parse(json.time_last_update_utc || '');
  const date = Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : isoDate(new Date());
  return makeRate('erapi', date, bynInCny, usdInCny);
}

/* ------------------------------------------------------------------ *
 * 抓取
 * ------------------------------------------------------------------ */

/**
 * 银联当前日期文件经常在凌晨/早间尚未发布（HTTP 404），
 * 因此从今天往前最多试 6 天；周末/节假日会自动落到最近一个已发布且日期匹配的文件。
 */
async function fetchUnionpay(options) {
  const daysBack = (options && options.daysBack) != null ? options.daysBack : 6;
  const now = beijingNow();
  let lastErr = null;
  for (let back = 0; back <= daysBack; back++) {
    const dt = new Date(now.getTime() - back * 86400000);
    const date = ymd(dt);
    try {
      const res = await fetch(UNIONPAY_BASE + date + '.json', {
        headers: Object.assign({}, UA, { Referer: UNIONPAY_REFERER }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastErr = new Error('银联 ' + date + ' http ' + res.status);
        continue;
      }
      return parseUnionpay(await res.json(), isoDate(dt));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('银联汇率不可用');
}

async function fetchNbrb() {
  const res = await fetch(NBRB_URL, {
    headers: UA,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('NBRB http ' + res.status);
  return parseNbrb(await res.json());
}

async function fetchErApi() {
  const res = await fetch(ERAPI_URL, {
    headers: UA,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('er-api http ' + res.status);
  return parseErApi(await res.json());
}

/** 并发抓取全部来源；单个来源失败不影响其他来源。 */
async function fetchAllSources(fetchers) {
  const map = fetchers || { unionpay: fetchUnionpay, nbrb: fetchNbrb, erapi: fetchErApi };
  const entries = Object.entries(map);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
  const rates = [];
  const errors = [];
  settled.forEach((s, i) => {
    const name = entries[i][0];
    if (s.status === 'fulfilled') rates.push(s.value);
    else errors.push((LABELS[name] || name) + '：' + (s.reason && s.reason.message ? s.reason.message : String(s.reason)));
  });
  return { rates, errors };
}

/* ------------------------------------------------------------------ *
 * 选择与校验
 * ------------------------------------------------------------------ */

function median(values) {
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/**
 * 多源交叉校验：
 *   - 给每个来源标注与中位数的最大偏差；
 *   - 有 3 个及以上来源时，偏差 > 2% 的来源直接剔除。
 */
function crossCheck(rates, errors) {
  const out = errors || [];
  if (rates.length < 2) return rates.slice();
  const mb = median(rates.map((r) => r.bynInCny));
  const mu = median(rates.map((r) => r.usdInCny));
  return rates.filter((r) => {
    const db = (Math.abs(r.bynInCny - mb) / mb) * 100;
    const du = (Math.abs(r.usdInCny - mu) / mu) * 100;
    const dev = Math.max(db, du);
    r.deviationPct = Math.round(dev * 100) / 100;
    if (rates.length >= 3 && dev > CROSS_SOURCE_LIMIT_PCT) {
      out.push(r.sourceLabel + '(' + r.date + ') 与多源中位数偏差 ' + dev.toFixed(1) + '%，已忽略');
      return false;
    }
    return true;
  });
}

function pickRate(rates) {
  for (const source of PRIORITY) {
    const hit = rates.find((r) => r.source === source);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

function readCache(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeCache(file, rate) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.assign({}, rate, { ts: Date.now() }), null, 1), 'utf8');
  } catch (e) {
    console.log('rates cache write fail: ' + e.message);
  }
}

/** 缓存结构：{ source, sourceLabel, date, bynInCny, usdInCny, ts }，兼容旧版无 source/date 的缓存。 */
function rateFromCache(cached, options) {
  const opts = options || {};
  const now = opts.now != null ? opts.now : Date.now();
  const maxAge = opts.maxCacheAgeMs != null ? opts.maxCacheAgeMs : MAX_CACHE_AGE_MS;
  if (!cached || !Number.isFinite(Number(cached.bynInCny)) || !Number.isFinite(Number(cached.usdInCny))) return null;
  const ts = Number(cached.ts);
  if (!ts || now - ts > maxAge) return null;
  const source = PRIORITY.indexOf(cached.source) >= 0 ? cached.source : 'cache';
  const date = cached.date ? String(cached.date).slice(0, 10) : isoDate(new Date(ts));
  return makeRate(source, date, Number(cached.bynInCny), Number(cached.usdInCny), {
    cached: true,
    cacheTs: ts,
    fetchedAt: new Date(ts).toISOString(),
  });
}

/* ------------------------------------------------------------------ *
 * 对外主入口
 * ------------------------------------------------------------------ */

/**
 * 取得当前应展示的汇率。
 * @returns {Promise<{rate: object|null, errors: string[]}>}
 */
async function resolveRates(options) {
  const opts = options || {};
  const cacheFile = opts.cacheFile || null;
  const { rates, errors } = await fetchAllSources(opts.fetchers);
  const usable = crossCheck(rates, errors);
  const chosen = pickRate(usable);
  if (chosen) {
    if (cacheFile) writeCache(cacheFile, chosen);
    return { rate: chosen, errors };
  }
  const cached = cacheFile ? rateFromCache(readCache(cacheFile), opts) : null;
  if (cached) {
    errors.push('实时来源全部失败，改用 ' + cached.date + ' 缓存（' + cached.sourceLabel + '）');
    return { rate: cached, errors };
  }
  errors.push('实时来源全部失败，且没有可用缓存');
  return { rate: null, errors };
}

/** 首页 widget 文案：来源 + 数据日期 + 双向金额，一行可读。 */
function formatRates(rate) {
  if (!rate || !Number.isFinite(rate.bynInCny) || !Number.isFinite(rate.usdInCny)) return '';
  const label = rate.sourceLabel || LABELS[rate.source] || rate.source;
  const date = shortDate(rate.date);
  const cached = rate.cached ? '（缓存）' : '';
  return (
    '🇧🇾 ' +
    label +
    ' ' +
    date +
    cached +
    '｜1 Br ≈ ' +
    rate.bynInCny.toFixed(3) +
    ' ¥｜1 $ ≈ ' +
    rate.usdInCny.toFixed(3) +
    ' ¥'
  );
}

module.exports = {
  BOUNDS,
  LABELS,
  PRIORITY,
  MAX_CACHE_AGE_MS,
  CROSS_SOURCE_LIMIT_PCT,
  ymd,
  isoDate,
  shortDate,
  validateRate,
  makeRate,
  parseUnionpay,
  parseNbrb,
  parseErApi,
  fetchUnionpay,
  fetchNbrb,
  fetchErApi,
  fetchAllSources,
  crossCheck,
  pickRate,
  readCache,
  writeCache,
  rateFromCache,
  resolveRates,
  formatRates,
};

if (require.main === module) {
  const i = process.argv.indexOf('--cache');
  const cacheFile = i >= 0 ? process.argv[i + 1] : null;
  resolveRates({ cacheFile })
    .then(({ rate, errors }) => {
      for (const e of errors) console.error('rates: ' + e);
      if (!rate) process.exit(1);
      console.log(formatRates(rate));
      console.log(JSON.stringify(rate, null, 2));
    })
    .catch((e) => {
      console.error('rates fail: ' + e.message);
      process.exit(1);
    });
}
