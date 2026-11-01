// Diagnostic only: no app, models, library, external requests or CI skip.
// Related upstream fix: https://commits.webkit.org/323630@main
import { createServer } from 'node:http';
import { webkit } from '@playwright/test';

const serve = process.argv.slice(2);
if (serve.length && (serve.length !== 1 || serve[0] !== '--serve'))
  throw new Error('Usage: node scripts/reproduce-webkit-teardown.mjs [--serve]');

const worker = `onmessage = async ({data: mode}) => {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) { postMessage('unavailable'); return; }
    const device = await adapter.requestDevice();
    if (mode === 'attribute') device.onuncapturederror = () => {};
    if (mode === 'listener') device.addEventListener('uncapturederror', () => {});
    postMessage('ready');
  } catch (error) { postMessage('error: ' + error.message); }
};`;
const html = `<!doctype html><meta charset="utf-8">
<title>Isolated WebGPU worker teardown</title>
<h1>WebGPU worker teardown</h1>
<p>Diagnostic only. An affected browser may crash this tab. No models or saved files are used.</p>
<button data-mode="none">No listener</button>
<button data-mode="attribute">Property handler</button>
<button data-mode="listener">Event listener</button>
<pre id="result">Ready</pre>
<script>
window.round = async mode => {
  result.textContent = mode + ': running';
  for (let i = 0; i < 2; i++) {
    const worker = new Worker('/worker.js');
    try {
      const state = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker timeout')), 10000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = event => { clearTimeout(timer); reject(Error(event.message)); };
        worker.postMessage(mode);
      });
      if (state !== 'ready') throw Error(state);
    } finally { worker.terminate(); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  result.textContent = mode + ': survived';
  return result.textContent;
};
document.querySelectorAll('button').forEach(button => button.onclick = () =>
  round(button.dataset.mode).catch(error => { result.textContent = error.message; }));
</script>`;
const server = createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/worker.js'].includes(request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', request.url === '/' ? 'text/html' : 'text/javascript');
  response.end(request.url === '/' ? html : worker);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(serve.length ? 4476 : 0, '127.0.0.1', resolve);
});
const url = `http://127.0.0.1:${server.address().port}`;
if (serve.length) {
  console.log(`Open ${url} in the browser being diagnosed, with its inspector connected.`);
} else {
  const results = [];
  try {
    for (const mode of ['none', 'attribute', 'listener']) {
      let browser;
      let crashed = false;
      try {
        browser = await webkit.launch();
        const page = await browser.newPage();
        page.on('crash', () => {
          crashed = true;
        });
        await page.goto(url);
        const outcome = await page.evaluate((mode) => window.round(mode), mode);
        await page.reload();
        results.push({ mode, version: browser.version(), outcome, reloaded: true, crashed });
      } catch (error) {
        results.push({ mode, version: browser?.version(), error: error.message, crashed });
      } finally {
        await browser?.close();
      }
    }
    console.log(JSON.stringify(results, null, 2));
    // Unavailable GPU, timeouts and crashes are failures, never passing controls.
    if (results.some((result) => result.error || result.crashed)) process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
