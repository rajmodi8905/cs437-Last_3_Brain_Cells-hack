// Run while the acceptance preview/test asset servers are running.
import { chromium } from '@playwright/test';
import { prepare } from '../tests/acceptance/helpers.ts';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await prepare(page, context);
  const report = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const info = adapter?.info;
    const models = new window.harness.ModelClient();
    const start = performance.now();
    const embedding = await models.query('A student reading a book in the library');
    const image = await models.image(await (await fetch('/tests/fixtures/cal-chair.png')).blob());
    const result = {
      adapter: !!adapter,
      gpu: info
        ? {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
          }
        : null,
      device: models.device,
      dimensions: embedding.length,
      imageDimensions: image.length,
      elapsedMs: performance.now() - start,
      userAgent: navigator.userAgent,
    };
    await models.dispose();
    return result;
  });
  console.log(JSON.stringify(report, null, 2));
  await writeFile('docs/verification/webgpu-probe.json', JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser.close();
}
