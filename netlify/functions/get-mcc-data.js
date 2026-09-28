// Netlify Function: get-mcc-data
// Fetches live Google Ads performance data from MCC 9060186325
// Returns account-level spend, conversions, CPA for enabled accounts
const https = require('https');

// ── Credentials (stored as Netlify env vars in production) ──
const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '434324143090-9s9jstsfbgf2pqfk0tfmtpj8rihhmgrp.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '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',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '1//097WSl6AW9cO6CgYIARAAGAkSNwF-L9IramkdHKb7jR6qU5ZxHrgYvhhh7CwbGxbGeG4rAJcdE5a8kL0Cf1Uxq5t3icD466b7bSQ',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
};

// ── Managed accounts to fetch (ADD/REMOVE as needed) ──
const MANAGED_ACCOUNTS = [
  { id: '6457701262', name: 'Tri Tool Technologies', currency: 'ZAR', abbrev: 'TT' },
  { id: '3938092858', name: 'Spier E-commerce', currency: 'ZAR', abbrev: 'SP' },
  { id: '1174876049', name: 'Geddes Capital', currency: 'ZAR', abbrev: 'GC' },
  { id: '8808134001', name: 'AURA SOS', currency: 'ZAR', abbrev: 'AU' },
  { id: '3199837831', name: 'Snap Kitchen', currency: 'USD', abbrev: 'SK' },
  { id: '4379852145', name: '1Voucher', currency: 'ZAR', abbrev: '1V' },
  { id: '8391694125', name: 'Spier Hotel', currency: 'ZAR', abbrev: 'SH' },
  { id: '5010689409', name: 'Spier Destination', currency: 'ZAR', abbrev: 'SD' },
  { id: '2162040364', name: 'Fut Afrique', currency: 'ZAR', abbrev: 'FA' },
  { id: '4035336692', name: 'Tri Tool US Dollar', currency: 'USD', abbrev: 'TU' },
  { id: '1039498028', name: 'Tri Tool Inc.', currency: 'USD', abbrev: 'TI' },
  { id: '1504414244', name: 'Pesalink', currency: 'USD', abbrev: 'PL' },
  { id: '8043998866', name: 'Zapmed', currency: 'ZAR', abbrev: 'ZM' },
];

// ── Helpers ──
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

async function getAccessToken() {
  const postData = new URLSearchParams({
    client_id: CONFIG.client_id,
    client_secret: CONFIG.client_secret,
    refresh_token: CONFIG.refresh_token,
    grant_type: 'refresh_token',
  }).toString();

  const res = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
  }, postData);

  if (res.data.access_token) return res.data.access_token;
  throw new Error('Token refresh failed: ' + JSON.stringify(res.data));
}

async function queryAccount(accountId, accessToken, days) {
  const query = `
    SELECT
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.clicks,
      metrics.impressions
    FROM campaign
    WHERE segments.date DURING LAST_${days}_DAYS
      AND campaign.status = ENABLED
  `;

  const body = JSON.stringify({ query });
  const res = await httpsRequest(
    `https://googleads.googleapis.com/v23/customers/${accountId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': CONFIG.developer_token,
        'login-customer-id': CONFIG.mcc_id,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.error || res.status !== 200) {
    return { spend: 0, conversions: 0, revenue: 0, clicks: 0, impressions: 0, cpa: 0, ctr: 0 };
  }

  let spend = 0, conversions = 0, revenue = 0, clicks = 0, impressions = 0;
  for (const batch of (res.data || [])) {
    for (const row of (batch.results || [])) {
      const m = row.metrics || {};
      spend += parseInt(m.costMicros || 0) / 1_000_000;
      conversions += parseFloat(m.conversions || 0);
      revenue += parseFloat(m.conversionsValue || 0);
      clicks += parseInt(m.clicks || 0);
      impressions += parseInt(m.impressions || 0);
    }
  }

  return {
    spend: Math.round(spend * 100) / 100,
    conversions: Math.round(conversions),
    revenue: Math.round(revenue * 100) / 100,
    clicks,
    impressions,
    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
  };
}

// ── Handler ──
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const days = parseInt(event.queryStringParameters?.days) || 30;
    const accessToken = await getAccessToken();

    // Query all accounts in parallel (batches of 5 to avoid rate limits)
    const results = [];
    for (let i = 0; i < MANAGED_ACCOUNTS.length; i += 5) {
      const batch = MANAGED_ACCOUNTS.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (acct) => {
          const data = await queryAccount(acct.id, accessToken, days);
          return { ...acct, ...data };
        })
      );
      results.push(...batchResults);
    }

    // Filter out accounts with no spend, sort by spend descending
    const active = results.filter(r => r.spend > 0).sort((a, b) => b.spend - a.spend);
    const inactive = results.filter(r => r.spend === 0);

    // Calculate totals
    const totals = active.reduce((acc, r) => ({
      spend: acc.spend + r.spend,
      conversions: acc.conversions + r.conversions,
      revenue: acc.revenue + r.revenue,
    }), { spend: 0, conversions: 0, revenue: 0 });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        generated: new Date().toISOString(),
        period: `last_${days}_days`,
        mcc: CONFIG.mcc_id,
        totals: {
          spend: Math.round(totals.spend * 100) / 100,
          conversions: totals.conversions,
          revenue: Math.round(totals.revenue * 100) / 100,
          cpa: totals.conversions > 0 ? Math.round((totals.spend / totals.conversions) * 100) / 100 : 0,
        },
        accounts: active,
        inactive,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
