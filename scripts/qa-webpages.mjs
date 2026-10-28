// Loopback-only synthetic webpages for manual QA. No file access, uploads or model mirror.
import { createServer } from 'node:http';
const requestedPort = Number(process.env.QA_WEB_PORT ?? 4181);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)
  throw Error('QA_WEB_PORT must be an integer between 0 and 65535.');
let probeRequests = 0;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('No uploads. This server only serves fixed synthetic QA pages.');
    return;
  }
  if (request.headers.cookie || request.headers.authorization) {
    response.writeHead(400);
    response.end('QA capture requests must omit credentials.');
    return;
  }
  if (request.url !== '/blocked') response.setHeader('Access-Control-Allow-Origin', '*');
  const root = `http://127.0.0.1:${server.address().port}`;
  const html = (content) =>
    `<title>Synthetic QA notice</title><main>${content}<script>window.qaImportedScript=true;fetch('${root}/probe')</script><img src="${root}/probe" onerror="window.qaImportedScript=true"></main>`;
  switch (request.url) {
    case '/':
      response.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' });
      response.end(
        `Synthetic webpage fixtures. Use Campus Recall Add > Webpage to capture ${root}/allowed, /large, /blocked, /error and /unsupported. /blocked intentionally has no CORS header. This server is desktop loopback only; Ctrl+C stops it.`,
      );
      break;
    case '/allowed':
    case '/blocked':
      response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      response.end(html('<p>Robotics induction is on Saturday at the north workshop.</p>'));
      break;
    case '/large':
      response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      response.end(html(`<p>${'Synthetic long workshop notice. '.repeat(1000)}</p>`));
      break;
    case '/error':
      response.writeHead(503, { 'Content-Type': 'text/plain;charset=utf-8' });
      response.end('Deliberate synthetic website failure.');
      break;
    case '/unsupported':
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end('Deliberate non-webpage content.');
      break;
    case '/probe':
      if (request.method === 'GET') probeRequests++;
      response.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' });
      response.end('Synthetic imported-resource probe.');
      break;
    case '/probe-count':
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ requests: probeRequests }));
      break;
    default:
      response.writeHead(404);
      response.end('No such synthetic fixture.');
  }
});
server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`Synthetic QA webpages: http://127.0.0.1:${server.address().port}`);
  console.log(
    'Use the app capture/fallback flow. Directly opening a fixture page intentionally executes its probe, so restart the server before an inert-import check.',
  );
});
