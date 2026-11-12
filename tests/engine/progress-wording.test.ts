// Processing progress shown in a library row is written for students: "Getting it ready to
// search (1 of 1)" and "Finishing up", not "Indexing part" or "Saving the search index".
// Uses the real engine loop and repository; the model call is a stub.
import { afterEach, expect, it, vi } from 'vitest';
import { LocalEngine } from '../../src/engine';
import { AnyRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import type { EngineProgress } from '../../src/shared';

const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
afterEach(() => {
  if (locks) Object.defineProperty(navigator, 'locks', locks);
  else delete (navigator as { locks?: unknown }).locks;
});

it('describes each processing step in plain words', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, work: (lock: object) => Promise<void>) =>
        work({}),
    },
  });
  const repository = new DexieLibraryRepository(
    new AnyRecallDatabase(`progress-wording-${crypto.randomUUID()}`),
  );
  const engine = new LocalEngine(repository);
  const vector = new Float32Array(768).fill(1 / Math.sqrt(768));
  vi.spyOn(engine.models, 'documents').mockResolvedValue([{ text: 'Dinner at 7:30', vector }]);
  const events: EngineProgress[] = [];
  engine.subscribeProgress((event) => events.push(event));
  const saved = await repository.save({ kind: 'note', text: 'Dinner at 7:30', title: 'Mess' });
  engine.ready = true;
  await engine.indexItem(saved.id);
  await vi.waitFor(() => expect(events.at(-1)?.stage).toBe('ready'));
  const messages = events.map((event) => event.message);
  expect(messages).toEqual([
    'Getting it ready to search',
    'Getting it ready to search (1 of 1)',
    'Finishing up',
    'Ready to search',
  ]);
  for (const message of messages) expect(message).not.toMatch(/index|part \d|reading the/i);
  await engine.dispose();
});
