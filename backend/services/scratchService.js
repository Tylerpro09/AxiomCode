const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.woff':'font/woff', '.woff2':'font/woff2', '.wasm':'application/wasm'};
class ScratchService {
  constructor(app, extensionRoot) {
    this.root = path.resolve(extensionRoot);
    this.cache = path.join(app.getPath('userData'), 'scratch-assets');
    this.prefix = '/' + crypto.randomBytes(24).toString('hex') + '/';
  }
  async start() {
    await fsp.mkdir(this.cache, {recursive:true});
    this.server = http.createServer((req, res) => this.serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }));
    // Some Windows systems allocate port 0 from a range containing Chromium's
    // blocked service ports (e.g. 6697). Use the high dynamic range explicitly.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          this.server.once('error', reject);
          this.server.listen(crypto.randomInt(49152,65535), '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
        });
        break;
      } catch (error) { if (!['EADDRINUSE','EACCES'].includes(error.code) || attempt === 19) throw error; }
    }
    this.url = `http://127.0.0.1:${this.server.address().port}${this.prefix}editor.html`;
    return this.url;
  }
  async serve(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!['GET','HEAD'].includes(req.method) || !url.pathname.startsWith(this.prefix)) { res.writeHead(404); return res.end(); }
    const relative = decodeURIComponent(url.pathname.slice(this.prefix.length));
    let file;
    const asset = /^assets\/([a-f0-9]{32}\.(?:svg|png|jpg|wav|mp3))$/.exec(relative);
    if (asset) {
      file = path.join(this.root, 'official/library-assets', asset[1]);
      if (!fs.existsSync(file)) {
        file = path.join(this.cache, asset[1]);
        if (!fs.existsSync(file)) {
          const response = await fetch(`https://assets.scratch.mit.edu/internalapi/asset/${asset[1]}/get/`, {signal:AbortSignal.timeout(20000)});
          if (!response.ok) { res.writeHead(502); return res.end(); }
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 20_000_000) throw new Error('Asset too large');
          await fsp.writeFile(file, bytes);
        }
      }
    } else {
      const base = ['editor.html','editor.js','axiom3d.js','axiompower.js'].includes(relative) ? this.root : path.join(this.root, 'official');
      file = path.resolve(base, relative);
      if (!file.startsWith(path.resolve(base) + path.sep)) { res.writeHead(404); return res.end(); }
    }
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', (mime[path.extname(file)] || 'application/octet-stream') + (['.html','.js','.css'].includes(path.extname(file)) ? '; charset=utf-8' : ''));
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (relative === 'editor.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://assets.scratch.mit.edu; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self' data: blob: https://*.scratch.mit.edu https://*.scratch.org wss://device-manager.scratch.mit.edu:20110 https://translate-service.scratch.mit.edu https://synthesis-service.scratch.mit.edu;");
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  close() { this.server?.close(); }
}
module.exports = { ScratchService };
