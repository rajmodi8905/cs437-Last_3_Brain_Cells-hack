import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('independent calibration scores text and visual matches using real embeddings', async ({
  page,
  context,
}) => {
  test.setTimeout(600000);
  const { external } = await prepare(page, context);
  const dataset = JSON.parse(await readFile('tests/fixtures/calibration.json', 'utf8'));
  const report = await page.evaluate(async (data) => {
    const { ModelClient, cosine } = (window as any).harness;
    const models = new ModelClient();
    const vectors = [];
    for (const item of data.texts)
      vectors.push((await models.documents(item.text, 'none'))[0].vector);
    const text = [];
    for (const item of data.texts) {
      const q = await models.query(item.query);
      text.push(vectors.map((v) => cosine(q, v)));
    }
    const visuals = [];
    for (const item of data.visuals) {
      const blob = await (await fetch(`/tests/fixtures/${item.file}`)).blob();
      visuals.push(await models.image(blob));
    }
    const visual = [];
    for (const item of data.visuals) {
      const q = await models.query(item.query);
      visual.push(visuals.map((v) => cosine(q, v)));
    }
    const negatives: Array<{ text: number[]; visual: number[] }> = [];
    for (const query of data.negatives) {
      const q = await models.query(query);
      negatives.push({
        text: vectors.map((v) => cosine(q, v)),
        visual: visuals.map((v) => cosine(q, v)),
      });
    }
    await models.dispose();
    function choose(scores: number[][], kind: 'text' | 'visual') {
      let best = { threshold: -1, correct: -1 };
      for (let i = 0; i <= 90; i++) {
        const threshold = i / 100;
        if (negatives.some((n) => n[kind].some((score: number) => score >= threshold))) continue;
        let correct = 0;
        for (let j = 0; j < scores.length; j++) {
          const ranking = scores[j]
            .map((score: number, index: number) => ({ score, index }))
            .filter((x: any) => x.score >= threshold)
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 3);
          if (ranking.some((x: any) => x.index === j)) correct++;
        }
        if (correct >= best.correct) best = { threshold, correct };
      }
      return best;
    }
    return {
      text,
      visual,
      negatives,
      selected: { text: choose(text, 'text'), visual: choose(visual, 'visual') },
      device: models.device,
    };
  }, dataset);
  console.log('CALIBRATION', JSON.stringify(report));
  await writeFile('test-results/calibration.json', JSON.stringify(report, null, 2));
  expect(external).toEqual([]);
  expect(report.selected.text.correct).toBe(dataset.texts.length);
  expect(report.selected.visual.correct).toBe(dataset.visuals.length);
});
