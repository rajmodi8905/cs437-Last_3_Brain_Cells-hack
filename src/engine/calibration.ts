// S16: calibrates a student's own model on this device. The set is the text part of
// tests/fixtures/calibration.json (a test keeps the two identical), separate from the frozen
// corpus. The grid rule is EmbeddingGemma's: try 0.00 to 0.90, reject any threshold that admits a
// negative, keep the one that finds the most targets in the top three, preferring higher ones.
import { cosine } from './ranking';

export const CALIBRATION_SET = {
  texts: [
    {
      text: 'Collect the field trip permission slip from the geography department office.',
      query: 'Where do I pick up the excursion authorization form?',
    },
    {
      text: 'The swimming pool closes at eight in the evening.',
      query: 'When does the pool shut?',
    },
    {
      text: 'Dormitory residents must return room keys to the housing counter.',
      query: 'Where should residents hand back their keys?',
    },
    {
      text: 'Safety spectacles must be worn before entering rooms with active lasers.',
      query: 'What is the rule for protecting our eyes?',
    },
    {
      text: 'A receipt is required when asking for repayment of travel expenses.',
      query: 'What do I need for a reimbursement?',
    },
    {
      text: 'The chair suggested moving the meeting to the early part of next week.',
      query: 'When is the rescheduled discussion?',
    },
    {
      text: 'All written requests to change module registration need signatures from the instructor and programme office.',
      query: 'Who must approve the switch?',
    },
    {
      text: 'Participants may be absent from two lectures during the term.',
      query: 'How many sessions can I skip?',
    },
  ],
  negatives: [
    'How do I repair a diesel tractor?',
    'Show the ski lift ticket for the Swiss Alps.',
    'Find my recipe for chocolate souffle.',
  ],
};

/** scores[j][i]: similarity of question j to document i; negatives[k][i] likewise. */
export function chooseThreshold(scores: number[][], negatives: number[][]) {
  let best = { threshold: -1, correct: -1 };
  for (let i = 0; i <= 90; i++) {
    const threshold = i / 100;
    if (negatives.some((row) => row.some((score) => score >= threshold))) continue;
    let correct = 0;
    for (let j = 0; j < scores.length; j++) {
      const top = scores[j]!.map((score, index) => ({ score, index }))
        .filter((x) => x.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (top.some((x) => x.index === j)) correct++;
    }
    if (correct >= best.correct) best = { threshold, correct };
  }
  return best;
}

export interface Embedder {
  documents(text: string, title: string): Promise<Array<{ vector: Float32Array }>>;
  query(text: string): Promise<Float32Array>;
}

/** Runs the calibration set through a model and picks its threshold. */
export async function calibrate(model: Embedder) {
  const vectors: Float32Array[] = [];
  for (const item of CALIBRATION_SET.texts)
    vectors.push((await model.documents(item.text, 'none'))[0]!.vector);
  const scores: number[][] = [];
  for (const item of CALIBRATION_SET.texts) {
    const q = await model.query(item.query);
    scores.push(vectors.map((v) => cosine(q, v)));
  }
  const negatives: number[][] = [];
  for (const query of CALIBRATION_SET.negatives) {
    const q = await model.query(query);
    negatives.push(vectors.map((v) => cosine(q, v)));
  }
  const best = chooseThreshold(scores, negatives);
  return {
    threshold: best.threshold,
    correct: Math.max(0, best.correct),
    total: CALIBRATION_SET.texts.length,
    dimension: vectors[0]!.length,
  };
}
