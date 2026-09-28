// netlify/functions/run-prompt-fast.js
// Fast version: single query + Gemini (fits 10s timeout)
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '952336408253-5km5qd6j40qm7mvl03n9eh505pnksqj4.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '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',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '1//090WfwXbFh-1DCgYIARAAGAkSNwF-L9IrbnAxfenvRVY6xGrIruBsqZ7GBZg8cPDKyjHrr38rZyp7oozrYJkKnAGfgcaHDgeeEF8',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
  llm_api_url: process.env.LLM_API_URL || 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent',
  llm_api_key: process.env.LLM_API_KEY || '',
};

function httpsPost(url, opts, body) {
  return new Promise((resolve) => {
    const req = https.request(url, opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, raw: d.substring(0, 500), error: true }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: CONFIG.client_id,
    client_secret: CONFIG.client_secret,
    refresh_token: CONFIG.refresh_token,
    grant_type: 'refresh_token',
  }).toString();
  const res = await httpsPost('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (res.data?.access_token) return res.data.access_token;
  throw new Error('Token fail: ' + (res.raw || res.error));
}

function gadsSearch(accountId, token, query) {
  const body = JSON.stringify({ query });
  // Format account ID with dashes: 8808134001 → 880-813-4001
  const formattedId = accountId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  return new Promise((resolve) => {
    const req = https.request(
      `https://googleads.googleapis.com/v23/customers/${formattedId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': CONFIG.developer_token,
          'login-customer-id': CONFIG.mcc_id,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.error) {
              console.error('GAQL error:', JSON.stringify(parsed.error).substring(0, 200));
              resolve([]);
              return;
            }
            resolve(parsed.results || []);
          } catch (e) {
            console.error('GAQL parse error:', e.message, d.substring(0, 200));
            resolve([]);
          }
        });
      }
    );
    req.on('error', (e) => { console.error('GAQL request error:', e.message); resolve([]); });
    req.setTimeout(20000, () => { req.destroy(); resolve([]); });
    req.end(body);
  });
}

async function fetchData(accountId, token, days) {
  const D = `LAST_${days}_DAYS`;
  
  // Single comprehensive query - campaigns with metrics
  const campaigns = await gadsSearch(accountId, token,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.average_cpc, metrics.ctr, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING ${D}`
  );

  // Conversion actions (quick lookup)
  const conversions = await gadsSearch(accountId, token,
    `SELECT conversion_action.id, conversion_action.name, conversion_action.type, conversion_action.conversion_action_status FROM conversion_action`
  );

  return { campaigns, conversions };
}

function formatData(data) {
  let o = '';
  
  let totalSpend = 0, totalConv = 0, totalRev = 0, totalClicks = 0, totalImps = 0;
  for (const c of data.campaigns) {
    const m = c.metrics || {};
    totalSpend += parseInt(m.costMicros || 0) / 1e6;
    totalConv += parseFloat(m.conversions || 0);
    totalRev += parseFloat(m.conversionsValue || 0);
    totalClicks += parseInt(m.clicks || 0);
    totalImps += parseInt(m.impressions || 0);
  }
  const acctCtr = totalImps > 0 ? (totalClicks / totalImps * 100) : 0;
  const acctCvr = totalClicks > 0 ? (totalConv / totalClicks * 100) : 0;
  const acctRoas = totalSpend > 0 ? (totalRev / totalSpend) : 0;
  const acctCpa = totalConv > 0 ? (totalSpend / totalConv) : 0;

  o = `ACCOUNT TOTALS (${data.campaigns.length} campaigns):\nSpend: $${totalSpend.toFixed(2)} | Clicks: ${totalClicks} | Impressions: ${totalImps} | CTR: ${acctCtr.toFixed(2)}% | Conversions: ${totalConv.toFixed(1)} | Revenue: $${totalRev.toFixed(2)} | ROAS: ${acctRoas.toFixed(2)}x | CPA: $${acctCpa.toFixed(2)} | CVR: ${acctCvr.toFixed(2)}%\n\n`;

  // By channel
  const byChannel = {};
  for (const c of data.campaigns) {
    const m = c.metrics || {};
    const cm = c.campaign || {};
    const ch = cm.advertisingChannelType || 'UNKNOWN';
    if (!byChannel[ch]) byChannel[ch] = { spend: 0, clicks: 0, imps: 0, convs: 0, rev: 0, count: 0 };
    byChannel[ch].spend += parseInt(m.costMicros || 0) / 1e6;
    byChannel[ch].clicks += parseInt(m.clicks || 0);
    byChannel[ch].imps += parseInt(m.impressions || 0);
    byChannel[ch].convs += parseFloat(m.conversions || 0);
    byChannel[ch].rev += parseFloat(m.conversionsValue || 0);
    byChannel[ch].count++;
  }
  o += `BY CHANNEL:\n`;
  for (const [ch, s] of Object.entries(byChannel)) {
    const roas = s.spend > 0 ? (s.rev / s.spend) : 0;
    const cpa = s.convs > 0 ? (s.spend / s.convs) : 0;
    const share = totalSpend > 0 ? (s.spend / totalSpend * 100) : 0;
    o += `  ${ch} (${s.count}): Share ${share.toFixed(1)}% | Spend $${s.spend.toFixed(2)} | CTR ${(s.imps > 0 ? (s.clicks/s.imps*100) : 0).toFixed(2)}% | Convs ${s.convs.toFixed(1)} | Rev $${s.rev.toFixed(2)} | ROAS ${roas.toFixed(2)}x | CPA $${cpa.toFixed(2)}\n`;
  }

  // Top campaigns
  const active = data.campaigns.filter(c => (parseInt(c.metrics?.costMicros || 0) / 1e6) > 0)
    .sort((a, b) => parseInt(b.metrics?.costMicros || 0) - parseInt(a.metrics?.costMicros || 0))
    .slice(0, 15);

  o += `\nTOP CAMPAIGNS (${active.length} of ${data.campaigns.length} active):\n`;
  for (const c of active) {
    const cm = c.campaign || {};
    const m = c.metrics || {};
    const spend = parseInt(m.costMicros || 0) / 1e6;
    const rev = parseFloat(m.conversionsValue || 0);
    const convs = parseFloat(m.conversions || 0);
    const roas = spend > 0 ? (rev / spend) : 0;
    const cpa = convs > 0 ? (spend / convs) : 0;
    const ctr = parseFloat(m.ctr || 0) > 0 ? (parseFloat(m.ctr) * 100) : 0;
    const cvr = parseInt(m.clicks || 0) > 0 ? (convs / parseInt(m.clicks || 0) * 100) : 0;
    const share = totalSpend > 0 ? (spend / totalSpend * 100) : 0;
    o += `${cm.name || '?'} | ${cm.advertisingChannelType || '?'} | ${cm.status || '?'}\n`;
    o += `  Spend $${spend.toFixed(2)} (${share.toFixed(1)}%) | Clicks ${parseInt(m.clicks || 0)} | CTR ${ctr.toFixed(2)}% | CVR ${cvr.toFixed(2)}% | Convs ${convs.toFixed(1)} | Rev $${rev.toFixed(2)} | ROAS ${roas.toFixed(2)}x | CPA $${cpa.toFixed(2)}\n`;
    if (cm.targetRoas) o += `  Target ROAS: ${(cm.targetRoas / 1000).toFixed(1)}x vs Actual ${roas.toFixed(2)}x\n`;
  }

  // Conversions
  o += `\nCONVERSION ACTIONS (${data.conversions.length}):\n`;
  for (const c of data.conversions) {
    const ca = c.conversionAction || {};
    o += `${ca.name || '?'} | ${ca.type || '?'} | ${ca.conversionActionStatus || '?'}\n`;
  }

  return o;
}

async function callLLM(prompt, account, accountId, dateRange, fmtData) {
  if (!CONFIG.llm_api_key) return null;

  const usr = `You are a senior Google Ads performance analyst with 15+ years experience. Known for finding hidden waste, efficiency leaks, and strategic misalignments.

RULES:
1. COMPARE campaigns against account average and each other
2. BENCHMARK against industry standards (Search CTR 2-5%, CVR 2-5%, ROAS 3-5x)
3. CALCULATE derived metrics - share of wallet, budget efficiency, CPA per campaign
4. FLAG: 🔴 critical, 🟡 optimization, 🟢 working well
5. BE SPECIFIC: name exact campaigns, state current vs target metrics, quantify impact

OUTPUT:
1. EXECUTIVE SUMMARY - 3-4 lines
2. ACCOUNT HEALTH GRADES - CTR, CVR, CPA, ROAS (A/B/C/D)
3. CAMPAIGN-BY-CAMPAIGN - state, grade, finding, 1 recommendation
4. CROSS-CAMPAIGN - best/worst spend, budget allocation
5. BIDDING ASSESSMENT - strategy appropriateness, target vs actual
6. CONVERSION & TRACKING - gaps, attribution
7. TOP 5 RECOMMENDATIONS - prioritized with impact

DO NOT restate data, use filler, give generic advice.

---
PROMPT: ${prompt || 'Deep performance audit with actionable specific recommendations'}
ACCOUNT: ${account} (${accountId})
DATE RANGE: ${dateRange}

RAW DATA:
${fmtData}`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: usr }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
  });

  const url = `${CONFIG.llm_api_url}?key=${CONFIG.llm_api_key}`;
  const res = await httpsPost(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body);

  if (res.error || res.status !== 200 || res.data?.error) return null;
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

function basicReport(name, id, dr, data) {
  let r = `# Report: ${name}\n\n**Account:** ${id} | **Period:** ${dr}\n\n`;
  r += `## Campaigns\n\n| Campaign | Type | Status | Spend | Clicks | Convs | ROAS |\n|----------|------|--------|-------|--------|-------|------|\n`;
  for (const c of data.campaigns || []) {
    const cm = c.campaign || {}; const m = c.metrics || {};
    const sp = parseInt(m.costMicros||0)/1e6; const rv = parseFloat(m.conversionsValue||0);
    r += `| ${cm.name||'?'} | ${cm.advertisingChannelType||'?'} | ${cm.status||'?'} | $${sp.toFixed(2)} | ${parseInt(m.clicks||0)} | ${parseFloat(m.conversions||0)} | ${(sp>0?(rv/sp).toFixed(2):'0')}x |\n`;
  }
  return r;
}

exports.handler = async (event) => {
  const hdrs = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: hdrs, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: hdrs, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { prompt, promptName, account, accountId, dateRange, days, channel, category } = JSON.parse(event.body || '{}');
    if (!accountId) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'Missing accountId' }) };

    const d = parseInt(days) || 7;
    const token = await getAccessToken();
    const data = await fetchData(accountId, token, d);
    const fmt = formatData(data);
    let report = await callLLM(prompt, account, accountId, dateRange, fmt);
    if (!report) report = basicReport(account, accountId, dateRange, data);

    return {
      statusCode: 200,
      headers: hdrs,
      body: JSON.stringify({
        ok: true,
        prompt: promptName,
        account, accountId, dateRange,
        report,
        dataPoints: { campaigns: data.campaigns.length, conversions: data.conversions.length },
        generated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'Failed', detail: err.message }) };
  }
};