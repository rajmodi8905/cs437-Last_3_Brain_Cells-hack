// S16: calibrates a student's own model on this device. The set is the text part of
// tests/fixtures/calibration.json (a test keeps the two identical), separate from the frozen
// corpus. The grid rule is EmbeddingGemma's: try 0.00 to 0.90, reject any threshold that admits a
// negative, keep the one that finds the most targets in the top three, preferring higher ones.
import { cosine } from './ranking';
import { MAX_UNRELATED_MATCHED, MIN_CALIBRATION_CORRECT } from '../shared/searchModels';

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

/**
 * S16 only, added after review: EmbeddingGemma's three negatives are far from campus life, so a
 * model could pass them and still match unrelated campus questions. Five campus-style negatives
 * join the threshold choice. Then eight more unrelated campus questions, never used to choose the
 * threshold, are searched against the eight calibration notes plus twelve other campus notes, and
 * every match is a false one. The student sees that count.
 */
export const CAMPUS_CHECK = {
  selectionNegatives: [
    'How do I renew my driving licence?',
    'Where can I get my laptop repaired on campus?',
    'When does the gym open on Sunday mornings?',
    'How many credits do I need to graduate?',
    'Where is the nearest ATM inside campus?',
  ],
  notes: [
    'The cafeteria serves dinner from seven to nine thirty on weekdays.',
    "Submit the hostel room change form to the warden's office by Friday.",
    'The robotics club meets every Thursday in the maker space.',
    'Lab coats are mandatory in the chemistry teaching lab.',
    'The shuttle to the city leaves from the main gate at six in the morning.',
    'Library books can be renewed online twice before they must be returned.',
    'The placement cell will hold mock interviews next Wednesday.',
    'Medical leave needs a certificate from the campus health centre.',
    'Cultural fest volunteers should collect their badges from the student council room.',
    'The computer centre is open around the clock during exam week.',
    'Fee payment for the next semester closes on the fifteenth.',
    'Lost items are kept at the security office for one month.',
  ],
  unrelated: [
    'How do I join the campus music band?',
    'Which professor teaches linear algebra this semester?',
    'Where do I post a parcel from campus?',
    'When are the hostel water tanks cleaned?',
    'Who runs the photography club workshops?',
    'How do I get a parking sticker for my scooter?',
    'Where can I buy a new SIM card near campus?',
    'When is the next blood donation camp?',
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

/** Runs the calibration set and the campus check through a model and picks its threshold. */
export async function calibrate(model: Embedder) {
  const embedDocs = async (texts: string[]) => {
    const vectors: Float32Array[] = [];
    for (const text of texts) vectors.push((await model.documents(text, 'none'))[0]!.vector);
    return vectors;
  };
  const similarities = async (queries: string[], vectors: Float32Array[]) => {
    const rows: number[][] = [];
    for (const query of queries) {
      const q = await model.query(query);
      rows.push(vectors.map((v) => cosine(q, v)));
    }
    return rows;
  };
  const vectors = await embedDocs(CALIBRATION_SET.texts.map((item) => item.text));
  const scores = await similarities(
    CALIBRATION_SET.texts.map((item) => item.query),
    vectors,
  );
  const negatives = await similarities(
    [...CALIBRATION_SET.negatives, ...CAMPUS_CHECK.selectionNegatives],
    vectors,
  );
  const best = chooseThreshold(scores, negatives);
  const pool = [...vectors, ...(await embedDocs(CAMPUS_CHECK.notes))];
  const unrelated = await similarities(CAMPUS_CHECK.unrelated, pool);
  return {
    threshold: best.threshold,
    correct: Math.max(0, best.correct),
    total: CALIBRATION_SET.texts.length,
    unrelatedMatched: unrelated.filter((row) => row.some((score) => score >= best.threshold))
      .length,
    unrelatedTotal: CAMPUS_CHECK.unrelated.length,
    dimension: vectors[0]!.length,
  };
}

export type CalibrationResult = Awaited<ReturnType<typeof calibrate>>;

/** Why a calibrated model cannot be used, or undefined when it can. */
export function calibrationProblem(repo: string, result: CalibrationResult) {
  if (result.correct < MIN_CALIBRATION_CORRECT)
    return `${repo} found only ${result.correct} of ${result.total} sample questions, so search with it would be unreliable. Try another model, or check its query and document prefixes.`;
  if (result.unrelatedMatched > MAX_UNRELATED_MATCHED)
    return `${repo} matched ${result.unrelatedMatched} of ${result.unrelatedTotal} unrelated questions, so most searches would show wrong results. Try another model, or check its query and document prefixes.`;
  return undefined;
}
