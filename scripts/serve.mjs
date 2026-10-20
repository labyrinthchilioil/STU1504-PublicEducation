import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'};
const server = http.createServer(async (req,res)=>{
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (requestPath === '/' ? '/index.html' : requestPath));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch(error) { res.writeHead(error.code==='ENOENT'?404:400).end('Not found'); }
});
server.on('error', error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Public Education: http://127.0.0.1:${port}`));
