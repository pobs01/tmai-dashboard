const http = require('http');
const path = require('path');
const fs = require('fs');

const functionsDir = path.join(__dirname, 'functions');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

const PORT = process.env.PORT || 8080;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health') {
    return json(res, 200, { ok: true, time: new Date().toISOString() });
  }

  // SPA routes
  if (pathname === '/report') return serveStatic('report.html', res);
  if (pathname === '/prompts') return serveStatic('prompts.html', res);

  // Netlify function emulation
  if (pathname.startsWith('/.netlify/functions/')) {
    const fnName = pathname.replace('/.netlify/functions/', '');
    await emulateFunction(fnName, req, res);
    return;
  }

  // Redirect root to prompts
  if (pathname === '/') {
    res.writeHead(302, { Location: '/prompts' });
    return res.end();
  }

  // Static assets
  if (pathname.startsWith('/assets/') || pathname.startsWith('/agency/')) {
    return serveStatic(pathname.slice(1), res);
  }

  // Default
  serveStatic('index.html', res);
});

function serveStatic(filename, res) {
  const filePath = path.join(__dirname, filename);
  const ext = path.extname(filePath).toLowerCase();
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function emulateFunction(fnName, req, res) {
  const fnPath = path.join(functionsDir, fnName + '.js');

  if (!fs.existsSync(fnPath)) {
    return json(res, 404, { error: 'Function not found: ' + fnName });
  }

  // Read request body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  // Build Netlify-style event object
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body: body || undefined,
    queryStringParameters: urlParse(req.url),
    path: req.url,
  };

  // Build context object
  const context = {
    getLambdaAuthorization: () => null,
    clientContext: {},
  };

  try {
    const fnModule = require(fnPath);
    const handler = fnModule.handler || fnModule.default;

    if (!handler || typeof handler !== 'function') {
      return json(res, 500, { error: 'No valid handler in ' + fnName });
    }

    const result = await handler(event, context);

    // Netlify function returns { statusCode, headers, body }
    if (result && typeof result === 'object' && 'statusCode' in result) {
      const status = result.statusCode || 200;
      const headers = result.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';

      // Set CORS if present
      if (headers['Access-Control-Allow-Origin']) {
        // keep it
      }

      res.writeHead(status, headers);
      res.end(result.body || '');
    } else if (result) {
      // Maybe it already wrote directly (legacy)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(typeof result === 'string' ? result : JSON.stringify(result));
    }
  } catch (err) {
    console.error(`Function error [${fnName}]:`, err.message, err.stack);
    return json(res, 500, { error: err.message });
  }
}

function urlParse(url) {
  const q = url.split('?')[1];
  if (!q) return {};
  return q.split('&').reduce((acc, pair) => {
    const [k, v] = pair.split('=');
    acc[decodeURIComponent(k)] = decodeURIComponent(v || '');
    return acc;
  }, {});
}

server.listen(PORT, () => {
  console.log(`TMAI Dashboard server listening on port ${PORT}`);
});