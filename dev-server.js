// Serveur local : sert public/ et les fonctions api/ comme le fait Vercel.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      try {
        const mod = await import(`./api/${name}.js`);
        return mod.default(req, res);
      } catch (e) {
        res.statusCode = 404;
        return res.end(String(e));
      }
    }
    const file = path.join('public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    try {
      const data = await fs.readFile(file);
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
