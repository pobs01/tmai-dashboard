// Debug: test Google Ads API response format
const https = require('https');

const CONFIG = {
  client_id: process.env.GADS_CLIENT_ID || '952336408253-5km5qd6j40qm7mvl03n9eh505pnksqj4.apps.googleusercontent.com',
  client_secret: process.env.GADS_CLIENT_SECRET || '',
  refresh_token: process.env.GADS_REFRESH_TOKEN || '',
  developer_token: process.env.GADS_DEV_TOKEN || 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
};

async function getAccessToken() {
  const postData = new URLSearchParams({
    client_id: CONFIG.client_id,
    client_secret: CONFIG.client_secret,
    refresh_token: CONFIG.refresh_token,
    grant_type: 'refresh_token',
  }).toString();
  const res = await new Promise((resolve) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.end(postData);
  });
  return res.access_token;
}

async function test() {
  const token = await getAccessToken();
  
  // Test 1: searchStream (newline-delimited JSON)
  const query1 = 'SELECT campaign.name, metrics.impressions FROM campaign WHERE segments.date DURING LAST_7_DAYS LIMIT 3';
  const body1 = JSON.stringify({ query: query1 });
  
  console.log('Testing searchStream...');
  const res1 = await new Promise((resolve) => {
    https.request(
      `https://googleads.googleapis.com/v18/customers/6457701262/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': CONFIG.developer_token,
          'login-customer-id': CONFIG.mcc_id,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body1),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, raw: data.substring(0, 2000) }));
      }
    ).end(body1);
  });
  
  console.log('searchStream status:', res1.status);
  console.log('searchStream raw (first 2000 chars):');
  console.log(res1.raw);
  
  // Test 2: search (single JSON response)
  console.log('\n\nTesting search (non-stream)...');
  const res2 = await new Promise((resolve) => {
    https.request(
      `https://googleads.googleapis.com/v18/customers/6457701262/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': CONFIG.developer_token,
          'login-customer-id': CONFIG.mcc_id,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body1),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, raw: data.substring(0, 2000) }); }
        });
      }
    ).end(body1);
  });
  
  console.log('search status:', res2.status);
  if (res2.data && res2.data.results) {
    console.log('Results count:', res2.data.results.length);
    console.log('First result:', JSON.stringify(res2.data.results[0], null, 2));
  } else {
    console.log('Raw:', res2.raw || 'no data');
  }
  
  // Test 3: Conversion actions
  console.log('\n\nTesting conversion_action...');
  const query3 = 'SELECT conversion_action.name, conversion_action.type FROM conversion_action LIMIT 5';
  const body3 = JSON.stringify({ query: query3 });
  const res3 = await new Promise((resolve) => {
    https.request(
      `https://googleads.googleapis.com/v18/customers/6457701262/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'developer-token': CONFIG.developer_token,
          'login-customer-id': CONFIG.mcc_id,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body3),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, raw: data.substring(0, 2000) }); }
        });
      }
    ).end(body3);
  });
  
  console.log('conversion status:', res3.status);
  if (res3.data && res3.data.results) {
    console.log('Conversion actions:', res3.data.results.map(r => r.conversionAction?.name));
  }
}

test().catch(e => console.error(e));