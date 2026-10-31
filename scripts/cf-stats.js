#!/usr/bin/env node
/**
 * 查询 news.minsktc.me 的 Cloudflare Web Analytics 数据（RUM）。
 *
 * 前置条件：
 *   1) Cloudflare 后台已为 news.minsktc.me 开启 Web Analytics（Automatic setup）
 *   2) 环境变量里有只读 token：
 *        CF_API_TOKEN   权限仅需 Account -> Account Analytics -> Read
 *        CF_ACCOUNT_ID  112823d9cf25296d60cae57f5720e02f
 *
 * 用法：
 *   node scripts/cf-stats.js              # 最近 7 天
 *   node scripts/cf-stats.js 30           # 最近 30 天
 *   node scripts/cf-stats.js 1 --json     # 只输出 JSON
 */

const TOKEN = process.env.CF_API_TOKEN || '';
const ACCOUNT = process.env.CF_ACCOUNT_ID || '112823d9cf25296d60cae57f5720e02f';
const SITE = process.env.CF_SITE || 'news.minsktc.me';

const days = Number(process.argv[2]) || 7;
const asJson = process.argv.includes('--json');

function isoDay(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

const dateFrom = isoDay(days);
const dateTo = isoDay(0);

const QUERY = `
query Stats($account: String!, $from: Date!, $to: Date!, $site: String!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      byDate: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: { date_geq: $from, date_leq: $to, siteTag: $site }
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      topPages: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $from, date_leq: $to, siteTag: $site }
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      topCountries: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: { date_geq: $from, date_leq: $to, siteTag: $site }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { countryName }
      }
    }
  }
}`;

async function main() {
  if (!TOKEN) {
    console.error('缺少 CF_API_TOKEN 环境变量。');
    process.exit(1);
  }

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { account: ACCOUNT, from: dateFrom, to: dateTo, site: SITE },
    }),
  });

  const body = await res.json();

  if (body.errors && body.errors.length) {
    console.error('Cloudflare 返回错误：');
    for (const e of body.errors) console.error('  -', e.message);
    process.exit(1);
  }

  const acc = body.data?.viewer?.accounts?.[0];
  if (!acc) {
    console.error('没有拿到数据。常见原因：');
    console.error('  - Web Analytics 还没开启，或刚开启不到 5 分钟');
    console.error('  - siteTag 不是 ' + SITE);
    console.error('  - token 没有 Account Analytics:Read 权限');
    process.exit(1);
  }

  const byDate = acc.byDate || [];
  const totalVisits = byDate.reduce((s, r) => s + (r.sum?.visits || 0), 0);
  const totalViews = byDate.reduce((s, r) => s + (r.count || 0), 0);

  const result = {
    site: SITE,
    range: { from: dateFrom, to: dateTo, days },
    totalVisits,
    totalViews,
    daily: byDate.map((r) => ({
      date: r.dimensions.date,
      visits: r.sum?.visits || 0,
      views: r.count || 0,
    })),
    topPages: (acc.topPages || []).map((r) => ({
      path: r.dimensions.requestPath,
      views: r.count,
    })),
    topCountries: (acc.topCountries || []).map((r) => ({
      country: r.dimensions.countryName,
      views: r.count,
    })),
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`站点：${SITE}`);
  console.log(`区间：${dateFrom} ~ ${dateTo}（${days} 天）`);
  console.log('');
  console.log(`独立访客：${totalVisits}`);
  console.log(`总浏览量：${totalViews}`);
  console.log('');
  console.log('每日：');
  for (const d of result.daily) {
    console.log(`  ${d.date}  访客 ${String(d.visits).padStart(4)}  浏览 ${String(d.views).padStart(5)}`);
  }
  if (result.topPages.length) {
    console.log('');
    console.log('热门页面：');
    for (const p of result.topPages) console.log(`  ${String(p.views).padStart(5)}  ${p.path}`);
  }
  if (result.topCountries.length) {
    console.log('');
    console.log('来源国家：');
    for (const c of result.topCountries) console.log(`  ${String(c.views).padStart(5)}  ${c.country}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
