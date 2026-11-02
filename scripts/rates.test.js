'use strict';

// 汇率模块单元测试：node --test scripts/rates.test.js
// 全部使用固定 fixture，不访问网络，可在 CI 每次构建前跑。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rates = require('./rates');

const UNIONPAY = {
  curDate: '2026-11-02',
  exchangeRateJson: [
    { transCur: 'BYN', baseCur: 'CNY', rateData: 2.26479973 },
    { transCur: 'USD', baseCur: 'CNY', rateData: 6.6721 },
    { transCur: 'CNY', baseCur: 'CNY', rateData: 1 },
  ],
};

const NBRB = [
  { Cur_Abbreviation: 'CNY', Cur_Scale: 10, Cur_OfficialRate: 4.4266, Date: '2026-11-02T00:00:00' },
  { Cur_Abbreviation: 'USD', Cur_Scale: 1, Cur_OfficialRate: 2.946, Date: '2026-11-02T00:00:00' },
];

const ERAPI = {
  time_last_update_utc: 'Mon, 02 Nov 2026 00:02:31 +0000',
  rates: { CNY: 6.660856, BYN: 2.943843 },
};

const tmpFile = () =>
  path.join(os.tmpdir(), 'minsk-rates-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');

test('银联：1 BYN = 2.2648 CNY、1 USD = 6.6721 CNY，日期与来源正确', () => {
  const r = rates.parseUnionpay(UNIONPAY, '2026-11-02');
  assert.equal(r.source, 'unionpay');
  assert.equal(r.sourceLabel, '银联');
  assert.equal(r.date, '2026-11-02');
  assert.ok(Math.abs(r.bynInCny - 2.26479973) < 1e-9);
  assert.ok(Math.abs(r.usdInCny - 6.6721) < 1e-9);
});

test('银联：方向写反（1 CNY = 2.26 BYN）会被区间校验拦下', () => {
  const bad = {
    curDate: '2026-11-02',
    exchangeRateJson: [
      { transCur: 'BYN', baseCur: 'CNY', rateData: 0.4415 },
      { transCur: 'USD', baseCur: 'CNY', rateData: 6.6721 },
    ],
  };
  assert.throws(() => rates.parseUnionpay(bad, '2026-11-02'), /合理区间/);
});

test('银联：文件日期与请求日期不一致时拒绝使用（防止拿旧文件冒充今天）', () => {
  const stale = Object.assign({}, UNIONPAY, { curDate: '2026-10-30' });
  assert.throws(() => rates.parseUnionpay(stale, '2026-11-02'), /日期/);
});

test('银联：缺少 USD 时直接失败，不与央行数据混拼', () => {
  const partial = { curDate: '2026-11-02', exchangeRateJson: [UNIONPAY.exchangeRateJson[0]] };
  assert.throws(() => rates.parseUnionpay(partial, '2026-11-02'), /USD/);
});

test('NBRB：按 Cur_Scale 换算，1 BYN ≈ 2.2591 CNY、1 USD ≈ 6.6552 CNY', () => {
  const r = rates.parseNbrb(NBRB);
  assert.equal(r.source, 'nbrb');
  assert.equal(r.date, '2026-11-02');
  assert.ok(Math.abs(r.bynInCny - 2.25907) < 0.0001);
  assert.ok(Math.abs(r.usdInCny - 6.65522) < 0.0001);
});

test('er-api：用 USD/BYN 交叉算出 1 BYN ≈ 2.2626 CNY', () => {
  const r = rates.parseErApi(ERAPI);
  assert.equal(r.source, 'erapi');
  assert.ok(Math.abs(r.bynInCny - 6.660856 / 2.943843) < 1e-9);
  assert.ok(Math.abs(r.usdInCny - 6.660856) < 1e-9);
});

test('来源优先级：银联 > 白央行 > 市场参考', () => {
  const up = rates.parseUnionpay(UNIONPAY, '2026-11-02');
  const nb = rates.parseNbrb(NBRB);
  const er = rates.parseErApi(ERAPI);
  assert.equal(rates.pickRate([er, nb, up]).source, 'unionpay');
  assert.equal(rates.pickRate([er, nb]).source, 'nbrb');
  assert.equal(rates.pickRate([er]).source, 'erapi');
  assert.equal(rates.pickRate([]), null);
});

test('交叉校验：三源中偏差过大的来源被剔除，正常的保留', () => {
  const up = rates.parseUnionpay(UNIONPAY, '2026-11-02');
  const nb = rates.parseNbrb(NBRB);
  const bad = rates.makeRate('erapi', '2026-11-02', 3.5, 6.6); // 偏离 ~55%
  const errors = [];
  const kept = rates.crossCheck([up, nb, bad], errors);
  assert.equal(kept.length, 2);
  assert.ok(!kept.some((r) => r === bad));
  assert.ok(errors.some((e) => /偏差/.test(e)));
  assert.equal(rates.pickRate(kept).source, 'unionpay');
});

test('银联失败时回退白央行，并如实标注来源与日期（不再冒充银联）', async () => {
  const fail = () => Promise.reject(new Error('unionpay http 404'));
  const { rate, errors } = await rates.resolveRates({
    fetchers: {
      unionpay: fail,
      nbrb: () => Promise.resolve(rates.parseNbrb(NBRB)),
      erapi: () => Promise.resolve(rates.parseErApi(ERAPI)),
    },
  });
  assert.equal(rate.source, 'nbrb');
  assert.equal(rate.sourceLabel, '白央行');
  const line = rates.formatRates(rate);
  assert.ok(line.includes('白央行 11-02'));
  assert.ok(!line.includes('银联'));
  assert.ok(errors.some((e) => /银联/.test(e)));
});

test('全部来源失败时使用缓存，并标注原始来源、日期与「缓存」', async () => {
  const file = tmpFile();
  const up = rates.parseUnionpay(UNIONPAY, '2026-11-02');
  rates.writeCache(file, up);
  const fail = () => Promise.reject(new Error('offline'));
  const { rate } = await rates.resolveRates({
    cacheFile: file,
    fetchers: { unionpay: fail, nbrb: fail, erapi: fail },
  });
  assert.equal(rate.cached, true);
  assert.equal(rate.source, 'unionpay');
  const line = rates.formatRates(rate);
  assert.ok(line.includes('银联 11-02（缓存）'));
  fs.rmSync(file, { force: true });
});

test('缓存超过 72 小时不再展示（避免陈旧汇率）', () => {
  const old = { source: 'unionpay', date: '2026-10-20', bynInCny: 2.26, usdInCny: 6.66, ts: Date.now() - 4 * 86400000 };
  assert.equal(rates.rateFromCache(old), null);
});

test('旧版缓存（无 source/date）仍可用，但只标「缓存」，不冒充银联', () => {
  const legacy = { bynInCny: 2.267, usdInCny: 6.679, ts: Date.now() - 3600000 };
  const r = rates.rateFromCache(legacy);
  assert.equal(r.source, 'cache');
  assert.ok(r.date);
  const line = rates.formatRates(r);
  assert.ok(line.includes('缓存'));
  assert.ok(!line.includes('银联'));
});

test('首页文案包含来源、日期与双向汇率', () => {
  const line = rates.formatRates(rates.parseUnionpay(UNIONPAY, '2026-11-02'));
  assert.equal(line, '🇧🇾 银联 11-02｜1 Br ≈ 2.265 ¥｜1 $ ≈ 6.672 ¥');
});

test('写入缓存时保留 source/date，供下次回退时如实标注', () => {
  const file = tmpFile();
  rates.writeCache(file, rates.parseUnionpay(UNIONPAY, '2026-11-02'));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.source, 'unionpay');
  assert.equal(saved.date, '2026-11-02');
  assert.ok(saved.ts > 0);
  fs.rmSync(file, { force: true });
});
