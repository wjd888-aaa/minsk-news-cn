#!/usr/bin/env node
/**
 * news.minsktc.me 每日数据简报 -> WhatsApp（Kontato /v1/send）
 *
 * 环境变量：
 *   CF_API_TOKEN     必填，Cloudflare token（Account Analytics: Read 即可）
 *   CF_ACCOUNT_ID    默认 112823d9cf25296d60cae57f5720e02f
 *   CF_HOST          默认 news.minsktc.me
 *   KONTATO_API_KEY  必填，发消息用
 *   KONTATO_DESTS    收件人，逗号分隔
 *   DRY_RUN=1        只打印不发送
 */

const TOKEN = process.env.CF_API_TOKEN || '';
const ACCOUNT = process.env.CF_ACCOUNT_ID || '112823d9cf25296d60cae57f5720e02f';
const HOST = process.env.CF_HOST || 'news.minsktc.me';

const API = 'https://api.kontato.ai/v1/send';
const DESTS = (process.env.KONTATO_DESTS || '375259741332,375292238345')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const KEY = process.env.KONTATO_API_KEY || '';
const DRY = process.env.DRY_RUN === '1';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = iso(now);
const yesterday = iso(new Date(now.getTime() - DAY));
const weekFrom = iso(new Date(now.getTime() - 6 * DAY));

const QUERY = `
query Stats($account: String!, $from: Date!, $to: Date!, $host: String!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      days: rumPageloadEventsAdaptiveGroups(
        limit: 50
        filter: { date_geq: $from, date_leq: $to, requestHost: $host }
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      paths: rumPageloadEventsAdaptiveGroups(
        limit: 5
        filter: { date_geq: $from, date_leq: $to, requestHost: $host }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { requestPath }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        limit: 4
        filter: { date_geq: $from, date_leq: $to, requestHost: $host }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { countryName }
      }
    }
  }
}`;

async function query() {
  if (!TOKEN) throw new Error('CF_API_TOKEN 未设置');
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { account: ACCOUNT, from: weekFrom, to: today, host: HOST },
    }),
  });
  const body = await res.json();
  if (body.errors && body.errors.length) {
    throw new Error('Cloudflare: ' + body.errors.map((e) => e.message).join('; '));
  }
  const acc = body.data && body.data.viewer && body.data.viewer.accounts[0];
  if (!acc) throw new Error('Cloudflare 没有返回账号数据（token 权限或账号 ID 不对）');
  return acc;
}

function shortPath(p) {
  if (!p || p === '/') return '/ 首页';
  const clean = p.replace(/^\/article\/article\//, '').replace(/^\/article\//, '').replace(/\.html$/, '');
  return clean.length > 34 ? clean.slice(0, 34) + '…' : clean;
}

function buildMessage(acc) {
  const days = acc.days || [];
  const y = days.find((d) => d.dimensions.date === yesterday);
  const yVisits = y ? y.sum.visits : 0;
  const yViews = y ? y.count : 0;

  const totalVisits = days.reduce((s, d) => s + d.sum.visits, 0);
  const totalViews = days.reduce((s, d) => s + d.count, 0);
  const avg = days.length ? Math.round(totalVisits / days.length) : 0;

  const lines = [];
  lines.push('📊 新闻站数据 ' + HOST);
  lines.push('');
  lines.push('昨日 ' + yesterday.slice(5));
  lines.push('访问 ' + yVisits + ' · 浏览 ' + yViews);
  lines.push('');
  lines.push('最近 7 天');
  lines.push('访问 ' + totalVisits + ' · 浏览 ' + totalViews);
  lines.push('日均 ' + avg + ' 次访问');

  if (acc.paths && acc.paths.length) {
    lines.push('');
    lines.push('热门页面');
    for (const p of acc.paths.slice(0, 3)) {
      lines.push('· ' + shortPath(p.dimensions.requestPath) + '  ' + p.count);
    }
  }

  if (acc.countries && acc.countries.length) {
    lines.push('');
    lines.push('来源');
    lines.push(acc.countries.map((c) => c.dimensions.countryName + ' ' + c.count).join(' · '));
  }

  return lines.join('\n');
}

async function sendTo(dest, message) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, to: dest }),
  });
  const txt = await res.text();
  console.log('send => ' + res.status + ' to ' + dest + ' ' + txt);
  if (!res.ok) throw new Error('kontato send http ' + res.status + ' to ' + dest + ': ' + txt);
}

async function main() {
  const acc = await query();
  const message = buildMessage(acc);
  console.log('---- message ----');
  console.log(message);
  console.log('-----------------');

  if (DRY) {
    console.log('DRY_RUN=1，不发送');
    return;
  }
  if (!KEY) throw new Error('KONTATO_API_KEY 未设置');

  let failed = 0;
  for (const dest of DESTS) {
    try {
      await sendTo(dest, message);
    } catch (e) {
      failed++;
      console.error(e.message);
    }
  }
  if (failed === DESTS.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
