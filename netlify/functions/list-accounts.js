// netlify/functions/list-accounts.js
// Fetch all managed accounts from MCC
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '434324143090-9s9jstsfbgf2pqfk0tfmtpj8rihhmgrp.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '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',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '1//097WSl6AW9cO6CgYIARAAGAkSNwF-L9IramkdHKb7jR6qU5ZxHrgYvhhh7CwbGxbGeG4rAJcdE5a8kL0Cf1Uxq5t3icD466b7bSQ',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
};

// Known active accounts (update this list as accounts become active/inactive)
const KNOWN_ACTIVE_ACCOUNTS = new Set([
  '8808134001', // AURA SOS
  '1174876049', // Geddes Capital
  '8391694125', // Spier Hotel
  '3938092858', // Spier E-commerce
  '3199837831', // Snap Kitchen
  '5010689409', // Spier Destination
  '4379852145', // 1Voucher
  '4035336692', // Tri Tool US Dollar
]);

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, raw: data.substring(0, 500), error: true }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const accessToken = await getAccessToken();

    // Try ManagedAccountService via REST API
    const res = await httpsRequest(
      `https://googleads.googleapis.com/v16/customers/${CONFIG.mcc_id}/managedAccounts`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': CONFIG.developer_token,
          'Content-Type': 'application/json',
        },
      }
    );

    if (res.error) {
      // Fallback: return hardcoded list
      console.warn('ManagedAccountService failed, using fallback:', res.raw);
      const fallback = [
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
      ].map(acc => ({ ...acc, active: KNOWN_ACTIVE_ACCOUNTS.has(acc.id) }));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, mcc: CONFIG.mcc_id, source: 'fallback', count: fallback.length, accounts: fallback }),
      };
    }

    const result = res.data;
    const managedAccounts = result?.result || [];

    const accounts = managedAccounts.map(ma => ({
      id: ma.googleAdsCustomerId?.customerId || ma.googleAdsCustomerId || '',
      name: ma.descriptiveName || ma.displayName || 'Unnamed',
      currency: ma.currencyCode || 'USD',
      timezone: ma.timeZone || '',
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, mcc: CONFIG.mcc_id, source: 'api', count: accounts.length, accounts }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};