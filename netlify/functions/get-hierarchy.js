// netlify/functions/get-hierarchy.js
// Fetches the full MCC hierarchy including sub-MCCs
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '434324143090-9s9jstsfbgf2pqfk0tfmtpj8rihhmgrp.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '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',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '1//097WSl6AW9cO6CgYIARAAGAkSNwF-L9IramkdHKb7jR6qU5ZxHrgYvhhh7CwbGxbGeG4rAJcdE5a8kL0Cf1Uxq5t3icD466b7bSQ',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
};

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const body = `client_id=${encodeURIComponent(CONFIG.client_id)}&client_secret=${encodeURIComponent(CONFIG.client_secret)}&refresh_token=${encodeURIComponent(CONFIG.refresh_token)}&grant_type=refresh_token`;
  const res = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (res.data?.access_token) return res.data.access_token;
  throw new Error('Token fail: ' + JSON.stringify(res.data || res.raw));
}

async function getManagedAccounts(accessToken) {
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
  if (res.status === 200) return res.data.result || [];
  return [];
}

// Recursively get accounts under a sub-MCC
async function getSubAccounts(accessToken, customerId) {
  const res = await httpsRequest(
    `https://googleads.googleapis.com/v16/customers/${customerId}/managedAccounts`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': CONFIG.developer_token,
        'Content-Type': 'application/json',
      },
    }
  );
  if (res.status === 200) return res.data.result || [];
  return [];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const accessToken = await getAccessToken();
    const managedAccounts = await getManagedAccounts(accessToken);
    
    // Build hierarchy
    const hierarchy = {
      mcc: CONFIG.mcc_id,
      directAccounts: [],
      subMCCs: [],
      allAccounts: [],
    };

    for (const ma of managedAccounts) {
      const account = {
        id: ma.googleAdsCustomerId?.customerId || '',
        name: ma.descriptiveName || ma.displayName || 'Unnamed',
        currency: ma.currencyCode || 'USD',
        isSubMCC: ma.isManagedCustomer === true,
      };

      if (account.isSubMCC) {
        // Get accounts under this sub-MCC
        const subAccounts = await getSubAccounts(accessToken, account.id);
        account.accounts = subAccounts.map(sa => ({
          id: sa.googleAdsCustomerId?.customerId || '',
          name: sa.descriptiveName || sa.displayName || 'Unnamed',
          currency: sa.currencyCode || 'USD',
        }));
        hierarchy.subMCCs.push(account);
        hierarchy.allAccounts.push(...account.accounts);
      } else {
        hierarchy.directAccounts.push(account);
        hierarchy.allAccounts.push(account);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        ...hierarchy,
        totalAccounts: hierarchy.allAccounts.length,
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