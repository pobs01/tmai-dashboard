const http = require('http');
const path = require('path');
const fs = require('fs');

const functionsDir = path.join(__dirname, 'functions');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pathname = url.pathname;

  // CORS + preflight (needed for cross-origin calls that carry the x-tmi-key header)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tmi-key');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (pathname === '/health') return json(res, 200, { ok: true, time: new Date().toISOString() });
  if (pathname === '/report') return serveStatic('report.html', res);
  if (pathname === '/prompts') return serveStatic('prompts.html', res);

  if (pathname.startsWith('/.netlify/functions/')) {
    emulateFunction(pathname.slice(20), req, res);
    return;
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: '/prompts' });
    return res.end();
  }
  serveStatic('index.html', res);
});

function serveStatic(filename, res) {
  const filePath = path.join(__dirname, filename);
  const ext = path.extname(filePath).toLowerCase();
  try {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function emulateFunction(fnName, req, res) {
  // API key gate: every function call must present x-tmi-key matching TMI_API_KEY (fail closed)
  const expected = process.env.TMI_API_KEY || '';
  const provided = req.headers['x-tmi-key'] || '';
  if (!expected || provided !== expected) {
    return json(res, 401, { error: 'Unauthorized: missing or invalid x-tmi-key' });
  }
  const fnPath = path.join(functionsDir, fnName + '.js');
  if (!fs.existsSync(fnPath)) return json(res, 404, { error: 'Function not found: ' + fnName });

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const event = { httpMethod: req.method, headers: req.headers, body: body || undefined };
      const context = { getLambdaAuthorization: function() { return null; }, clientContext: {} };
      const fnModule = require(fnPath);
      const handler = fnModule.handler || fnModule.default;
      if (!handler) return json(res, 500, { error: 'No handler in ' + fnName });
      const result = await handler(event, context);
      if (result && result.statusCode) {
        res.writeHead(result.statusCode, result.headers || {});
        res.end(result.body || '');
      } else if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    } catch (err) {
      console.error('Function error:', fnName, err.message);
      json(res, 500, { error: err.message });
    }
  });
}

server.listen(PORT, () => { console.log('Server listening on port ' + PORT); });