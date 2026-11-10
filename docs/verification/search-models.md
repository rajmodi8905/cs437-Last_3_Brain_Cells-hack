# Search models: why EmbeddingGemma stays the only built-in model (S16)

Issue #52 (class 22 usability exchange, Nischay Bhutoria) asked to choose the embedding model "as per use case". Before writing S16 we measured whether a smaller model could be offered as a vetted second choice. None could, so S16 keeps EmbeddingGemma as the only built-in model and lets a student add their own model as an experimental option.

## Method

- Text came from the real extraction pipeline (OCR, PDF, speech) over the frozen 30-item corpus, so every model saw the same input.
- Each model's threshold was chosen on `tests/fixtures/calibration.json` only, with EmbeddingGemma's grid rule: try 0.00 to 0.90, reject any threshold that admits a negative, keep the one that finds the most targets in the top three, and prefer the higher threshold on ties.
- Then the frozen corpus's text targets (R1–R6, R9–R11) and its three unrelated queries were checked once, with the app's document rule (a note whose title is its first line gets no title).
- The frozen corpus is already "consumed" (see `retrieval-freeze.json`), so these are regression measurements, not independent held-out evidence.

## Results (10 November 2026, q8 ONNX, Node)

| Model                           | Calibration | Frozen corpus text targets      | Unrelated queries with results |
| ------------------------------- | ----------- | ------------------------------- | ------------------------------ |
| EmbeddingGemma (default)        | 8/8         | all found (existing acceptance) | 0 of 3                         |
| bge-small-en-v1.5, mean pooling | 8/8 at 0.52 | R4 missed (0.501)               | 0 of 3                         |
| bge-small-en-v1.5, CLS pooling  | 7/8         | R4 missed                       | 0 of 3                         |
| bge-base-en-v1.5                | 8/8 at 0.45 | R4 missed                       | 2 of 3                         |
| gte-small                       | 8/8 at 0.83 | R4 missed                       | 0 of 3                         |
| snowflake-arctic-embed-xs       | 5/8         | R4 and R6 missed                | 3 of 3                         |
| snowflake-arctic-embed-s        | 7/8         | R6 missed                       | 2 of 3                         |
| snowflake-arctic-embed-m-v1.5   | 7/8         | R4 and R6 missed                | 0 of 3                         |
| mxbai-embed-xsmall-v1           | 7/8         | R4 missed                       | 0 of 3                         |
| e5-small-v2                     | 6/8         | R4 missed                       | 1 of 3                         |

R4 ("Where is our adviser appointment?" against "Meet the mentor at the north library entrance…") is the paraphrase with no shared words that S9 requires. An early bge-small measurement that appeared to pass had repeated each note's first line as its title, which the app deliberately does not do. With the app's real rule it misses R4, which the first real-model acceptance run confirmed before bge-small was removed.

## What S16 ships instead

A student can add any public text embedding model from Hugging Face with an ONNX export, up to 400 MB. The app:

- pins the exact commit and every file's SHA-256 when the model is added;
- downloads and verifies those files like EmbeddingGemma's;
- calibrates a threshold on this device with the same calibration set and grid rule, and refuses a model that finds fewer than 6 of 8 calibration questions;
- labels the model experimental, searches text only with it, never syncs its index, and makes no S9 promise.

In the acceptance run, `Xenova/bge-small-en-v1.5` added with its documented query instruction found 8 of 8 calibration questions at 0.47. On the frozen corpus it found every text target at rank 1, but two of the three unrelated queries returned one result each. That is why a student's own model is experimental, and why EmbeddingGemma remains the default.

## Review changes (Nakshatra, PR #54)

**A stricter gate.** EmbeddingGemma's three calibration negatives are far from campus life, so they barely tested false positives. bge-small passed them and still matched two of the three unrelated corpus queries. A student's model is now also checked against campus questions:

- Five campus-style negatives join the threshold choice.
- Eight more unrelated campus questions, never used to choose the threshold, are searched against the eight calibration notes plus twelve other campus notes.

Settings shows "found N of 8 sample questions and wrongly matched M of 8 unrelated ones". A model that matches more than half (5 or more) is refused. I set that limit after seeing the Node numbers below, where it bound no model. In the browser it does bind one setup: `Xenova/bge-small-en-v1.5` with mean pooling chose a lower threshold there (0.47; the WASM numbers differ slightly from Node's) and wrongly matched 6 of 8, so it was refused. With CLS pooling, which its model card specifies, it found 7 of 8, wrongly matched 3 of 8 at 0.56, and is the setup the acceptance test uses. Node measurements (q8):

| Model                     | Found         | Wrongly matched |
| ------------------------- | ------------- | --------------- |
| bge-small-en-v1.5, mean   | 7/8           | 3/8             |
| bge-small-en-v1.5, CLS    | 7/8           | 3/8             |
| bge-base-en-v1.5, CLS     | 8/8           | 2/8             |
| gte-small                 | 7/8           | 2/8             |
| all-MiniLM-L6-v2          | 7/8           | 2/8             |
| e5-small-v2               | 5/8 (refused) | 0/8             |
| snowflake-arctic-embed-xs | 3/8 (refused) | 0/8             |

Against only the eight calibration notes, almost no model matched the unrelated questions. The false matches appear once the pool is larger, as in the frozen corpus.

**Settings read from the model.** When a repository publishes sentence-transformers settings (`1_Pooling/config.json`, and prompts in `config_sentence_transformers.json`), they are used automatically. The form's fields are optional overrides. With nothing published, mean pooling and no prefixes are used.

**A real Hugging Face run.** In Chromium against a production build, with the real network, `BAAI/bge-small-en-v1.5` was added through Settings in 33 seconds:

- Its revision was pinned and the full-precision ONNX file (133 MB) downloaded from `huggingface.co` and `us.aws.cdn.hf.co`.
- CLS pooling was detected automatically.
- It found 7 of 8 sample questions and wrongly matched 2 of 8 unrelated ones.
- After the switch, two notes were re-indexed. "When can I eat dinner?" and "Where do I meet my mentor?" each returned one result, and "How do I renew my passport?" returned none.

Hugging Face's API and file responses carry `access-control-allow-origin` for the pilot origin, and the live Content-Security-Policy already allows `huggingface.co` and `*.hf.co`.

## EmbeddingGemma is unchanged

Every file listed in `retrieval-freeze.json` is byte-identical to `main`. The student's model runs in its own worker (`src/engine/custom-model.worker.ts`). Its ranking (`src/engine/modelRanking.ts`) calls the frozen `rankSegments` whenever EmbeddingGemma's thresholds are in use, and a test checks that the explicit-threshold path gives identical results. The asset manifest and EmbeddingGemma's readiness marker are unchanged, so devices that are already set up stay ready.
