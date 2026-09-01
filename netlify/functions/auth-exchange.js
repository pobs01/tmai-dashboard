// netlify/functions/auth-exchange.js
// Exchange Google auth code for access token (no external deps)
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { code, redirect_uri } = JSON.parse(event.body || '{}');
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing code' }) };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured — check env vars' }) };
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return { statusCode: 401, body: JSON.stringify({ error: 'Token exchange failed', detail: tokenData }) };
    }

    // Fetch user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
        user
      })
    };
  } catch (err) {
    console.error('Auth exchange error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Token exchange failed', detail: err.message })
    };
  }
};