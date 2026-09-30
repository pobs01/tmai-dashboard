// netlify/functions/run-prompt.js
// Full data fetch + Gemini report generation for Google Ads
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '',
  client_secret: process.env.GADS_CLIENT_SECRET || '',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '',
  developer_token: process.env.GADS_DEV_TOKEN || '',
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
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
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
  return new Promise((resolve) => {
    const req = https.request(
      `https://googleads.googleapis.com/v23/customers/${accountId}/googleAds:search`,
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
          console.log('GADS response:', res.statusCode, d.substring(0, 200));
          try {
            const parsed = JSON.parse(d);
            if (parsed.results) {
              console.log('GADS results count:', parsed.results.length, 'first key:', parsed.results[0] ? Object.keys(parsed.results[0]) : 'none');
            } else if (parsed.error) {
              console.log('GADS error:', JSON.stringify(parsed.error).substring(0, 200));
            }
            resolve(parsed.results || []);
          } catch (e) {
            console.log('GADS parse error:', e.message, d.substring(0, 200));
            resolve([]);
          }
        });
      }
    );
    req.on('error', (e) => { console.log('GADS req error:', e.message); resolve([]); });
    req.setTimeout(30000, () => { req.destroy(); resolve([]); });
    console.log('Sending GADS query for account:', accountId);
    console.log('Query:', query.substring(0, 200));
    req.end(body);
  });
}

async function fetchAll(accountId, token, days) {
  const D = `LAST_${days}_DAYS`;
  const results = [];

  // 1. Campaigns (minimal working query - same as Network plus name/status)
  results.push(await gadsSearch(accountId, token,
    `SELECT campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.cost_micros, metrics.ctr FROM campaign WHERE segments.date DURING ${D}`
  ));
  console.log('Campaigns:', results[0].length);

  // 2. Conversion actions
  results.push(await gadsSearch(accountId, token,
    `SELECT conversion_action.name, conversion_action.type, conversion_action.conversion_action_status, conversion_action.attribution_model_type, conversion_action.counting_type FROM conversion_action`
  ));
  console.log('Conversions:', results[1].length);

  // 3. Device performance
  results.push(await gadsSearch(accountId, token,
    `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.cost_micros, metrics.ctr FROM campaign WHERE segments.date DURING ${D}`
  ));
  console.log('Device:', results[2].length);

  // 4. Network performance
  results.push(await gadsSearch(accountId, token,
    `SELECT campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.cost_micros, metrics.ctr FROM campaign WHERE segments.date DURING ${D}`
  ));
  console.log('Network:', results[3].length);

  // 5. Asset groups
  results.push(await gadsSearch(accountId, token,
    `SELECT asset_group.name, asset_group.status, asset_group.ad_strength, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.cost_micros FROM asset_group WHERE segments.date DURING ${D}`
  ));
  console.log('Assets:', results[4].length);

  // 6. Negative keywords
  results.push(await gadsSearch(accountId, token,
    `SELECT campaign_negative_keyword.text, campaign_negative_keyword.match_type FROM campaign_negative_keyword`
  ));
  console.log('Negatives:', results[5].length);

  return {
    campaigns: results[0] || [],
    conversions: results[1] || [],
    device: results[2] || [],
    network: results[3] || [],
    assets: results[4] || [],
    negatives: results[5] || [],
  };
}

function formatData(data) {
  let o = '';

  // Account totals
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

  o = `ACCOUNT TOTALS:\nSpend: $${totalSpend.toFixed(2)} | Clicks: ${totalClicks} | Impressions: ${totalImps} | CTR: ${acctCtr.toFixed(2)}% | Conversions: ${totalConv} | Revenue: $${totalRev.toFixed(2)} | ROAS: ${acctRoas.toFixed(2)}x | CPA: $${acctCpa.toFixed(2)} | CVR: ${acctCvr.toFixed(2)}%\n\n`;

  // Aggregate by channel type
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

  o += `SPEND BY CHANNEL (${data.campaigns.length} total campaigns):\n`;
  for (const [ch, s] of Object.entries(byChannel)) {
    const ctr = s.imps > 0 ? (s.clicks / s.imps * 100) : 0;
    const roas = s.spend > 0 ? (s.rev / s.spend) : 0;
    const cpa = s.convs > 0 ? (s.spend / s.convs) : 0;
    const share = totalSpend > 0 ? (s.spend / totalSpend * 100) : 0;
    o += `  ${ch} (${s.count} campaigns): Share ${share.toFixed(1)}% | Spend $${s.spend.toFixed(2)} | CTR ${ctr.toFixed(2)}% | Convs ${s.convs.toFixed(1)} | Rev $${s.rev.toFixed(2)} | ROAS ${roas.toFixed(2)}x | CPA $${cpa.toFixed(2)}\n`;
  }

  // Top 10 campaigns by spend (only those with spend > 0)
  const active = data.campaigns.filter(c => {
    const m = c.metrics || {};
    return parseInt(m.costMicros || 0) / 1e6 > 0;
  }).sort((a, b) => {
    const ma = a.metrics || {};
    const mb = b.metrics || {};
    return parseInt(mb.costMicros || 0) - parseInt(ma.costMicros || 0);
  }).slice(0, 10);

  o += `\nTOP 20 CAMPAIGNS BY SPEND (${active.length} of ${data.campaigns.length} have spend):\n`;
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
    o += `${cm.name || '?'} | ${cm.advertisingChannelType || '?'} | ${cm.biddingStrategyType || '?'}\n`;
    o += `  Spend $${spend.toFixed(2)} (${share.toFixed(1)}%) | Clicks ${parseInt(m.clicks || 0)} | CTR ${ctr.toFixed(2)}% | CVR ${cvr.toFixed(2)}% | Convs ${convs.toFixed(1)} | Rev $${rev.toFixed(2)} | ROAS ${roas.toFixed(2)}x | CPA $${cpa.toFixed(2)}\n`;
    if (cm.targetRoas) o += `  Target ROAS: ${(cm.targetRoas / 1000).toFixed(1)}x vs Actual ${roas.toFixed(2)}x\n`;
  }

  // Zero-spend campaign count
  const zeroSpend = data.campaigns.length - active.length;
  if (zeroSpend > 0) o += `\n⚠ ${zeroSpend} campaigns with $0 spend (inactive/paused/learning)\n`;

  // Conversions
  o += `\nCONVERSION ACTIONS (${data.conversions.length}):\n`;
  for (const c of data.conversions) {
    const ca = c.conversionAction || {};
    o += `${ca.name || '?'} | Type: ${ca.type || '?'} | Status: ${ca.conversionActionStatus || '?'} | Attribution: ${ca.attributionModelType || '?'} | Counting: ${ca.countingType || '?'}\n`;
  }

  // Device
  o += `\nDEVICE PERFORMANCE:\n`;
  for (const v of data.device) {
    const m = v.metrics || {};
    const spend = parseInt(m.costMicros || 0) / 1e6;
    const rev = parseFloat(m.conversionsValue || 0);
    const share = totalSpend > 0 ? (spend / totalSpend * 100) : 0;
    o += `${v.segments?.device || '?'}: Share ${share.toFixed(1)}% | Spend $${spend.toFixed(2)} | Clicks ${parseInt(m.clicks || 0)} | Convs ${parseFloat(m.conversions || 0).toFixed(1)} | ROAS ${spend > 0 ? (rev / spend).toFixed(2) + 'x' : '?'} | CVR ${parseInt(m.clicks || 0) > 0 ? (parseFloat(m.conversions || 0) / parseInt(m.clicks || 0) * 100).toFixed(2) + '%' : '?'}\n`;
  }

  // Assets
  o += `\nASSET GROUPS (${data.assets.length}):\n`;
  const activeAssets = data.assets.filter(a => (parseInt(a.metrics?.costMicros || 0) / 1e6) > 0).slice(0, 15);
  for (const a of activeAssets) {
    const ag = a.assetGroup || {};
    const m = a.metrics || {};
    const spend = parseInt(m.costMicros || 0) / 1e6;
    o += `${ag.name || '?'} | Strength: ${ag.adStrength || '?'} | Status: ${ag.status || '?'} | Spend: $${spend.toFixed(2)} | Convs: ${parseFloat(m.conversions || 0).toFixed(1)} | Rev: $${parseFloat(m.conversionsValue || 0).toFixed(2)}\n`;
  }
  const zeroAssets = data.assets.length - activeAssets.length;
  if (zeroAssets > 0) o += `  (${zeroAssets} asset groups with $0 spend)\n`;

  // Negatives
  o += `\nNEGATIVE KEYWORDS (${data.negatives.length} total)\n`;

  return o;
}

// Get OAuth2 token from Google Cloud metadata server (Cloud Run)
async function getCloudToken() {
  const http2 = require('http');
  return new Promise((resolve) => {
    const options = {
      hostname: 'metadata.google.internal',
      port: 80,
      path: '/computeMetadata/v1/instance/service-accounts/default/token?audience=https://aiplatform.googleapis.com/',
      headers: { 'Metadata-Flavor': 'Google' },
    };
    const req = http2.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).access_token); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function callLLM(prompt, accountName, accountId, dateRange, fmtData, channel, category) {
  // Try Google Cloud metadata auth first (Cloud Run), fall back to API key
  let token = null;
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE) {
    token = await getCloudToken();
  }
  if (!token && !CONFIG.llm_api_key) return null;

  const cleanCat = category.replace(/[^\w\s]/g, '').trim();

  const sys = `You are a senior Google Ads performance analyst with 15+ years of experience auditing high-spend ecommerce and lead gen accounts. You are known for finding hidden waste, efficiency leaks, and strategic misalignments that junior analysts miss.

YOUR OUTPUT MUST BE A DEEP AUDIT REPORT — NOT a summary, NOT a description.

RULES FOR DEPTH:
1. COMPARE: Every campaign should be compared against the account average AND against each other. Rank them by efficiency (ROAS/CPA).
2. BENCHMARK: Compare metrics against industry benchmarks (Search CTR 2-5%, Shopping CTR 1-3%, PMAX CTR 0.5-1.5%, CVR 2-5% for ecommerce, ROAS 3-5x for ecommerce).
3. CALCULATE: Derive insights — share of wallet per campaign, budget efficiency, spend-to-revenue ratio, CPA per conversion type.
4. FLAG: Use 🔴 for critical issues, 🟡 for optimization opportunities, 🟢 for what's working well.
5. PRIORITIZE: Top recommendations ordered by expected impact (revenue uplift / wasted spend recovered).
6. BE SPECIFIC: Every recommendation must name the exact campaign, state the current metric, state the target, and quantify expected impact.

OUTPUT STRUCTURE:
1. EXECUTIVE SUMMARY — 3-4 lines. State the single biggest finding and biggest opportunity.
2. ACCOUNT HEALTH GRADES — Spend efficiency, CTR, CVR, CPA, ROAS vs benchmarks. Grade each (A/B/C/D).
3. CAMPAIGN-BY-CAMPAIGN — For each: current state, performance grade, key finding, 1 specific recommendation.
4. CROSS-CAMPAIGN — Where is the best/worst money spent? Is budget allocated efficiently?
5. BIDDING ASSESSMENT — Are bid strategies appropriate? Target ROAS realistic vs actual?
6. CONVERSION & TRACKING — Gaps in measurement, attribution issues.
7. TOP 5 RECOMMENDATIONS — Prioritized with expected impact quantified.

DO NOT simply restate data, use filler phrases, give generic advice, or skip calculations.`;

  const usr = `You are a senior Google Ads performance analyst with 15+ years of experience auditing high-spend ecommerce and lead gen accounts. You are known for finding hidden waste, efficiency leaks, and strategic misalignments that junior analysts miss.

RULES:
1. COMPARE campaigns against account average and each other. Rank by efficiency.
2. BENCHMARK against industry standards (Search CTR 2-5%, CVR 2-5%, ROAS 3-5x for ecommerce).
3. CALCULATE derived metrics — share of wallet, budget efficiency, CPA per campaign.
4. FLAG issues: 🔴 critical, 🟡 optimization, 🟢 working well.
5. BE SPECIFIC: name exact campaigns, state current vs target metrics, quantify impact.

OUTPUT STRUCTURE:
1. EXECUTIVE SUMMARY — 3-4 lines. Biggest finding + biggest opportunity.
2. ACCOUNT HEALTH GRADES — CTR, CVR, CPA, ROAS vs benchmarks (A/B/C/D grade).
3. CAMPAIGN-BY-CAMPAIGN — Current state, grade, finding, 1 recommendation each.
4. CROSS-CAMPAIGN — Best/worst spend, budget allocation efficiency.
5. BIDDING ASSESSMENT — Strategy appropriateness, target vs actual.
6. CONVERSION & TRACKING — Gaps, attribution issues.
7. TOP 5 RECOMMENDATIONS — Prioritized with quantified impact.

DO NOT restate data, use filler phrases, give generic advice, or skip calculations.

---

PROMPT: ${prompt || 'Deep performance audit with actionable specific recommendations'}

ACCOUNT: ${accountName} (${accountId})
CHANNEL: ${channel}
DATE RANGE: ${dateRange}

RAW ACCOUNT DATA:
${fmtData}`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: usr }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
  });

  let url, headers;
  if (token) {
    // Cloud Run: Vertex AI endpoint with OAuth Bearer token
    url = 'https://europe-west1-aiplatform.googleapis.com/v1/projects/273830948644/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  } else {
    // Netlify fallback: API key
    url = `${CONFIG.llm_api_url}?key=${CONFIG.llm_api_key}`;
    headers = { 'Content-Type': 'application/json' };
  }
  console.log('Calling LLM:', url);

  // 8-second timeout so Netlify doesn't kill the function
  const res = await httpsPost(url, {
    method: 'POST',
    headers,
  }, body);
  
  console.log('LLM response status:', res.status, 'error:', res.error);

  if (res.error || res.status !== 200 || res.data?.error) {
    console.log('LLM fallback: status=' + res.status + ' error=' + JSON.stringify(res.data?.error || res.raw || res.error));
    return null;
  }
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
  r += `\n*Generated: ${new Date().toISOString().split('T')[0]}*\n`;
  return r;
}

exports.handler = async (event) => {
  const hdrs = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: hdrs, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { prompt, promptName, account, accountId, dateRange, days, channel, category } = JSON.parse(event.body || '{}');
    if (!accountId) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'Missing accountId' }) };

    const d = parseInt(days) || 7;
    console.log('run-prompt: accountId=' + accountId + ' days=' + d);

    const token = await getAccessToken();
    const data = await fetchAll(accountId, token, d);

    console.log('Fetched: campaigns=' + data.campaigns.length + ' conversions=' + data.conversions.length + ' assets=' + data.assets.length);

    const fmt = formatData(data);
    let report = await callLLM(prompt, account, accountId, dateRange, fmt, channel || 'Google Ads', category || '');

    if (!report) report = basicReport(account, accountId, dateRange, data);

    return {
      statusCode: 200,
      headers: hdrs,
      body: JSON.stringify({
        ok: true,
        prompt: promptName,
        account, accountId, dateRange,
        report,
        dataPoints: {
          campaigns: data.campaigns.length,
          conversions: data.conversions.length,
          assets: data.assets.length,
          negatives: data.negatives.length,
        },
        generated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'Failed', detail: err.message }) };
  }
};