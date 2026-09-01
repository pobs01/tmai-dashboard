// Netlify Function: get-pacing
// Reads pacing data from Google Sheets using service account (no npm deps)
const https = require('https');
const crypto = require('crypto');

const SA_KEY = {
  client_email: "tmai-pacing-reader@hermes-tmai.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDhZ1WaX9/zmD15\nNe1bxAwJkeFiTEjSXsrwjtZyBCNDxCFMz6qTSUmMXrjTI2whzaEdH9YJqdaw2P2v\nSo7wmLC3oL3CY3ksE5YVmEvhHyc5FFJR2a7p7aqRFTH74g/S2EofVLrafkRmSTVV\nOBWpTS1eTC9eMfJQUtdJpZjFl4zhWUarbvhKyW8CAFi+Vt56Ww9a9lqq0FUJ7zwp\nLRQ1HgTExSCJpAbuHJ151zMuRUEflKTyhIsEKfx26tSmWM4K3mEljNved9Xvy0yG\nRZc6eBba0tMQnXa3CVcu/Y9+ba9yMDdvfHSJzeaMmh2+zOxOTKQAZQTsmkgN3sw0\nwhMuRUt9AgMBAAECggEARZmfXLJDGFhHjyCAQOg54VCa3Dv69n6PwpUQkZdGflvW\n/n1XSfCE1eO/xW54Kr3whGo6sLQxV11BhDmNBqzXUHRBc/88QMhxfQyQTZzNgzoL\nqzuA37nkA7WcQA9PXIct6BvFMMdxfnYXkk9lnOf4XNhAfiEFFhlmYdbQ5B6GQWS3\noaI0Ikanph+KDnT1pwykUQF0SOWHgE7rkjdJDrxB3QJH7MD+9JslvAgYTGkQKfZA\nXbtNntVMvI8q7GTwSFBOBQK+4J2RTJnY5iT3LqH8duySkkboxicS3fttAv/Pd9OM\ncKEyFxoHd6rK0OQYqFs2EWAq7HssoHs1z5GKpP4mbwKBgQD/zHPKSJqxjtYTbyJI\nmV9V9BSHaDdJq6VNGpg6tzp/NARSjXxoPNKPpfYZgwJnIam5vQMCB+XjsK88fmDO\nYFeBkld0GpHc7sqeNHeRUyOQ2sMG18JFO3jR+I3iETvKFMHFDLg6PlY/qQNH2DQg\n5C9TyYpzkb8KCtn7Umj0IIHNEwKBgQDhlMHJqm3qyRC6L8M65z9zK9h3cgOP6KDb\nNovAHwAZByPiKxN9jbIwGGih8GqV5Pc+EcQ2ANpQLBn2pcdf5qJYhyZAZh8dmxH0\nf2+/glo73rb6sf2OtyTAU8mtybwiOw3Boc1B3/zt7mVL+JY7dbQ1V/0RaCNawgRJ\nik2bUxpnLwKBgFAEj/AmWCXVDciUij/1omoL6WQWSL1F8Xa2LAqqCKWECxob4l/l\nLuT6wIpofhbu494Tb15yRAq+2YJt8jB82MLSmYLbUOew1zc4KHMQc967YCjC06W+\nnePpAdFHHNHxPlA602J835QYdctCqcPkPZ3TPPk8DWvBy0CgHe7IQHJ7AoGBALE7\n8kHjILc+QGE4k5hdBhIUGeBG+RuBN5jkM0rAUJBZds0E8SxNPvngw5ywSt34ZnUi\n+lk/tEcXT1Llj07+4wDRNrGUStA0/RdvZLo/zWuKoZM4czJFHJ/rdOKRRLpUUYuX\n96/RL2U1T+svpcGTygG7Xv7lJhnxo/KvsifeVDlLAoGAL+3I2mqt9WbGq7wFQHyj\nphA/legWmurCvrxdN8KHG/0on7kEtN+41chtf2fcYcJyYVCFk9YPYkHuriuTVbr3\nTP8fQMWbfcFZOo2Za7V5bwaOb/SAUu+Fc3AWr1gQGpmo9RdtEAPQZRtN4Jqbvh2z\n88OWCWKjjFuWZiGvfM4YZ3g=\n-----END PRIVATE KEY-----\n`,
};

const SPREADSHEET_ID = '1XBOost3vCYxbcUi6ac0ElJxDryYXp_jmLJKPAmfhl9w';

const SHEETS_BY_MONTH = {
  'june26': "Tshepo's Pacing Doc | June26",
  'july26': "Tshepo's Pacing Doc | July26",
};

// Known client section headers (uppercase names)
const CLIENT_HEADERS = ['GEDDES', 'SPIER', 'DELOITTE', 'FUT', 'FUT AFRIQUE', 'TRITOOL', 'TRI TOOL', 'AURA', '1VOUCHER', 'PESALINK', 'ZAPMED'];

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: SA_KEY.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(SA_KEY.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).access_token); }
        catch (e) { reject(new Error('Token failed: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function readSheet(sheetName, token) {
  const range = encodeURIComponent(`'${sheetName}'!A1:L300`);
  return new Promise((resolve, reject) => {
    https.get(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).values || []); }
        catch (e) { reject(new Error('Sheet read failed: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function parseCurrency(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[R,\s]/g, '')) || 0;
}

function platformToChannel(platform, campaign) {
  const p = (platform || '').toLowerCase();
  const c = (campaign || '').toUpperCase();
  if (p.includes('google') || c.includes('SRCH') || c.includes('GC -') || c.includes('DEL -') && c.includes('SRCH')) return 'Google Ads';
  if (p.includes('facebook') || p.includes('meta') || c.includes('FB ')) return 'Meta';
  if (p.includes('linkedin') || c.includes('LINK')) return 'LinkedIn';
  if (p.includes('tiktok') || c.includes('TT ')) return 'TikTok';
  if (p.includes('youtube') || c.includes('YT ')) return 'YouTube';
  return 'Other';
}

function parsePacingData(rows) {
  const clients = [];
  let currentClient = null;

  for (const row of rows) {
    const a = (row[0] || '').trim();
    const b = (row[1] || '').trim();
    const c = (row[2] || '').trim();
    const d = (row[3] || '').trim();
    const j = (row[9] || '').trim();
    const k = (row[10] || '').trim();
    const l = (row[11] || '').trim();

    // Skip header rows
    if (a === 'Client' && b === 'Campaign Name') continue;

    // Client section header (uppercase, no campaign)
    const aUpper = a.toUpperCase();
    if (a && !b && a.length >= 3 && CLIENT_HEADERS.some(h => aUpper.includes(h))) {
      // Normalize client name
      let name = a;
      if (aUpper.includes('GEDDES')) name = 'Geddes Capital';
      else if (aUpper.includes('SPIER')) name = 'Spier';
      else if (aUpper.includes('DELOITTE')) name = 'Deloitte';
      else if (aUpper.includes('FUT')) name = 'Fut Afrique';
      else if (aUpper.includes('TRI') || aUpper.includes('TRITOOL')) name = 'Tri Tool';
      else if (aUpper.includes('AURA')) name = 'AURA SOS';
      else if (aUpper.includes('1VOUCHER')) name = '1Voucher';
      else if (aUpper.includes('PESALINK')) name = 'Pesalink';
      else if (aUpper.includes('ZAPMED')) name = 'Zapmed';

      currentClient = { name, originalName: a, channels: {}, totalTarget: 0, totalActual: 0 };
      clients.push(currentClient);
      continue;
    }

    // Campaign row: has campaign name (B) and platform (C) and target (J)
    if (b && c && j && currentClient) {
      const target = parseCurrency(j);
      const actual = parseCurrency(k);
      const pacing = parseInt((l || '').replace('%', '')) || 0;

      const channel = platformToChannel(c, b);

      if (!currentClient.channels[channel]) {
        currentClient.channels[channel] = { name: channel, target: 0, actual: 0, campaignCount: 0 };
      }
      currentClient.channels[channel].target += target;
      currentClient.channels[channel].actual += actual;
      currentClient.channels[channel].campaignCount++;

      currentClient.totalTarget += target;
      currentClient.totalActual += actual;
    }
  }

  // Convert channels to arrays and calc pacing
  for (const client of clients) {
    client.channels = Object.values(client.channels);
    client.pacing = client.totalTarget > 0
      ? Math.round(((client.totalActual - client.totalTarget) / client.totalTarget) * 100) : 0;
    for (const ch of client.channels) {
      ch.pacing = ch.target > 0
        ? Math.round(((ch.actual - ch.target) / ch.target) * 100) : 0;
    }
  }

  return clients;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const params = new URLSearchParams(event.queryStringParameters || {});
    const month = params.get('month') || 'june26';
    const sheetName = SHEETS_BY_MONTH[month] || SHEETS_BY_MONTH['june26'];

    const token = await getAccessToken();
    const rows = await readSheet(sheetName, token);
    const clients = parsePacingData(rows);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sheet: sheetName,
        clients,
        lastUpdated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
