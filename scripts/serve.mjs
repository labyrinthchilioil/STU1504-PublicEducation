import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pagesPreview = process.argv.includes('--pages');
const root = path.resolve(fileURLToPath(new URL(pagesPreview ? '../_site/' : '../web/', import.meta.url)));
const basePath = pagesPreview ? '/STU1504-PublicEducation/' : '/';
const port = Number(process.env.PORT || (pagesPreview ? 4174 : 4173));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'};
const server = http.createServer(async (req,res)=>{
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const requestPath = decodeURIComponent(requestUrl.pathname);
    if (pagesPreview && requestPath === basePath.slice(0, -1)) {
      res.writeHead(308, { Location: basePath + requestUrl.search }).end(); return;
    }
    if (!requestPath.startsWith(basePath)) { res.writeHead(404).end('Not found'); return; }
    const file = path.resolve(root, requestPath.slice(basePath.length) || 'index.html');
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch(error) { res.writeHead(error.code==='ENOENT'?404:400).end('Not found'); }
});
server.on('error', error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Public Education: http://127.0.0.1:${port}${basePath}`));
