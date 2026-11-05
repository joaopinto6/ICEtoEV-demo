// Servidor local mínimo para testar a app (o microfone exige http://localhost ou https).
// Uso:  node serve.js   →  abre http://localhost:5174
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = Number(process.argv[2] || 5174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : path.normalize(u));
  if (!p.startsWith(root + path.sep) && p !== root) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  });
}).listen(port, '127.0.0.1', () => console.log(`Simulador em http://localhost:${port}`));
