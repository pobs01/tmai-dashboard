const https = require('https');

const CONFIG = {
  client_id: '952336408253-5km5qd6j40qm7mvl03n9eh505pnksqj4.apps.googleusercontent.com',
  client_secret: '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',
  refresh_token: '1//090WfwXbFh-1DCgYIARAAGAkSNwF-L9IrbnAxfenvRVY6xGrIruBsqZ7GBZg8cPDKyjHrr38rZyp7oozrYJkKnAGfgcaHDgeeEF8',
  developer_token: 'A-OMf0hY_8TPc_bmUOzHoQ',
  mcc_id: '9060186325',
};

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({
      client_id: CONFIG.client_id,
      client_secret: CONFIG.client_secret,
      refresh_token: CONFIG.refresh_token,
      grant_type: 'refresh_token',
    }).toString();
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function test() {
  const token = await getAccessToken();
  console.log('Token OK');
  
  // Simple test query
  const query = 'SELECT campaign.name FROM campaign LIMIT 3';
  const body = JSON.stringify({ query });
  
  const res = await new Promise((resolve) => {
    https.request(
      `https://googleads.googleapis.com/v23/customers/6457701262/googleAds:search`,
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
      (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d.substring(0, 1000) }));
      }
    ).end(body);
  });
  
  console.log('Status:', res.status);
  console.log('Body:', res.body);
  
  // Also test searchStream
  const res2 = await new Promise((resolve) => {
    https.request(
      `https://googleads.googleapis.com/v23/customers/6457701262/googleAds:searchStream`,
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
      (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d.substring(0, 1000) }));
      }
    ).end(body);
  });
  
  console.log('\nStream Status:', res2.status);
  console.log('Stream Body:', res2.body);
}

test().catch(console.error);