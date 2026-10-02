// Gera kom-media-kit.pdf a partir do site (layout de impressão), usando o Chrome do GitHub Actions.
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { extname, join } from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const PDF = join(ROOT, 'kom-media-kit.pdf');
const HASH = join(ROOT, '.pdf-hash');

// Só regenera se o site ou os dados mudaram (ignora a data de atualização, que muda todo dia)
let data = readFileSync(join(ROOT, 'data.json'), 'utf-8');
try { const d = JSON.parse(data); delete d.updated; data = JSON.stringify(d); } catch (e) { /* usa o texto bruto */ }
const hash = createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).update(data).digest('hex');
if (existsSync(PDF) && existsSync(HASH) && readFileSync(HASH, 'utf-8').trim() === hash && !process.env.FORCE) {
  console.log('Nada mudou, PDF mantido.');
  process.exit(0);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0);
await new Promise(r => server.once('listening', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:' + port + '/index.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(
    () => { const el = document.getElementById('ig-live'); return el && el.innerText.includes('Principais cidades'); },
    { timeout: 15000 }
  ).catch(() => console.log('Aviso: dados ao vivo não carregaram, usando o conteúdo fixo.'));
  await page.evaluate(() => document.fonts.ready);
  // carrega todas as imagens (as dos vídeos são preguiçosas e ficariam vazias no PDF)
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach(i => { i.loading = 'eager'; });
    await Promise.all(imgs.map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))));
  });
  await page.emulateMediaType('print');
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  writeFileSync(PDF, pdf);
  writeFileSync(HASH, hash + '\n');
  console.log('PDF gerado:', Math.round(pdf.length / 1024), 'KB');
} finally {
  await browser.close();
  server.close();
}
