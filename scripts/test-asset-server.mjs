// Test-only mirror of checksum-addressed public assets. Never receives library content.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/capture-')) {
    if (req.url === '/capture-blocked') res.removeHeader('Access-Control-Allow-Origin');
    if (req.headers.cookie) {
      res.writeHead(400);
      res.end('Credentials must be omitted');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      `<title>Synthetic public fixture</title><main>${req.url === '/capture-large' ? 'Public workshop note. '.repeat(1500) : '<p>Robot workshop registration opens on Thursday.</p>'}<img src="https://example.test/never-load-imported-image"><script>window.executedImport=true</script></main>`,
    );
    return;
  }
  if (req.url === '/') {
    res.writeHead(200);
    res.end('public test assets');
    return;
  }
  const name = req.url?.slice(1);
  if (!name || !/^[a-f0-9]{64}$/.test(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const file = await stat(`.models/${name}`);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size });
    createReadStream(`.models/${name}`).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(4180, '127.0.0.1', () => console.log('Public test asset mirror on 127.0.0.1:4180'));
