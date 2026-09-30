// netlify/functions/run-prompt-fast.js
// Fast version: 2 queries + Gemini (fits 10s timeout on Netlify)
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '434324143090-9s9jstsfbgf2pqfk0tfmtpj8rihhmgrp.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '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',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '1//097WSl6AW9cO6CgYIARAAGAkSNwF-L9IramkdHKb7jR6qU5ZxHrgYvhhh7CwbGxbGeG4rAJcdE5a8kL0Cf1Uxq5t3icD466b7bSQ',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
  llm_api_url: process.env.LLM_API_URL || 'https://europe-west1-aiplatform.googleapis.com/v1/projects/273830948644/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent',
  llm_api_key: process.env.LLM_API_KEY || '',
};

// ── HTTPS helpers (exact pattern from get-mcc-data.js) ──
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, error: true }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

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
  const res = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (res.data?.access_token) return res.data.access_token;
  throw new Error('Token fail: ' + JSON.stringify(res.data));
}

// ── GAQL queries (exact pattern from get-mcc-data.js) ──
async function queryAccount(accountId, token, query) {
  const body = JSON.stringify({ query });
  const res = await httpsRequest(
    `https://googleads.googleapis.com/v23/customers/${accountId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': CONFIG.developer_token,
        'login-customer-id': CONFIG.mcc_id,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.error || res.status !== 200) return [];

  const results = [];
  for (const batch of (res.data || [])) {
    for (const row of (batch.results || [])) {
      results.push(row);
    }
  }
  return results;
}

async function fetchData(accountId, token, days) {
  // Campaigns query (same fields as get-mcc-data.js plus name/type)
  const campaigns = await queryAccount(accountId, token,
    `SELECT campaign.name, campaign.status, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING LAST_${days}_DAYS`
  );

  // Conversion actions
  const conversions = await queryAccount(accountId, token,
    `SELECT conversion_action.name, conversion_action.type, conversion_action.conversion_action_status FROM conversion_action`
  );

  return { campaigns, conversions };
}

// ── Data formatting ──
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
  }

  o += `\nCONVERSION ACTIONS (${data.conversions.length}):\n`;
  for (const c of data.conversions) {
    const ca = c.conversionAction || {};
    o += `${ca.name || '?'} | ${ca.type || '?'} | ${ca.conversionActionStatus || '?'}\n`;
  }

  return o;
}

// ── LLM call ──
async function callLLM(prompt, account, accountId, dateRange, fmtData) {
  if (!CONFIG.llm_api_key) return null;

  const usr = `You are a senior Google Ads performance analyst with 15+ years experience.

RULES:
1. COMPARE campaigns against account average and each other
2. BENCHMARK against industry standards (Search CTR 2-5%, CVR 2-5%, ROAS 3-5x)
3. CALCULATE derived metrics
4. FLAG: 🔴 critical, 🟡 optimization, 🟢 working well
5. BE SPECIFIC: name exact campaigns, quantify impact

OUTPUT:
1. EXECUTIVE SUMMARY - 3-4 lines
2. ACCOUNT HEALTH GRADES - CTR, CVR, CPA, ROAS (A/B/C/D)
3. CAMPAIGN-BY-CAMPAIGN - state, grade, finding, 1 recommendation
4. CROSS-CAMPAIGN - best/worst spend, budget allocation
5. BIDDING ASSESSMENT
6. CONVERSION & TRACKING - gaps
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

// ── Handler ──
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