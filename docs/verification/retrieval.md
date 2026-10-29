# Local retrieval and compatibility

## Frozen model and processing policy

EmbeddingGemma 2 ONNX is pinned to `daa72c51243991dfcaf9f9137d2c573d8f7790c0`. Whisper tiny.en is pinned to `2575352d61be1bf7225cf8f8b268a4678025fc58`. Actual URLs, sizes and hashes are checked into `scripts/model-assets.json`.

Questions and remembered descriptions use `task: search result | query: {query}`. Documents use `title: {title} | text: {content}`. When a note’s title is merely its automatically derived first content line, the embedding title is `none`, so the same content is not duplicated. A separate user-provided title remains useful input. Text chunks contain at most 256 actual tokenizer tokens with 48-token overlap, without crossing a source page. Vectors are finite, nonzero, normalized and 768-dimensional. Visual processing uses 70 soft tokens per image on both backends; originals and OCR input remain intact. Video samples are at 0, 5, 10 seconds and so on below duration.

Index version: `gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrwords1-v8`. Incompatible indexes are queued for rebuilding instead of mixed into results. Candidate eligibility requires raw cosine similarity of at least **0.70 for text** or **0.69 for visual**. Eligible text gets a lexical boost bounded by 0.08 using exact, deduplicated Unicode query tokens. Results group by original UUID, keep the strongest matching location, and return at most five distinct items. Similarity is not shown as a probability.

## Independent calibration

`tests/fixtures/calibration.json` contains eight text targets, three visual targets and three unrelated queries, separate from the 30-item held-out corpus. The initial visual descriptions were broadened before the final freeze to reflect remembered use or appearance rather than exact object labels. Threshold selection used only calibration scores. The original held-out evaluation was then consumed: it returned 11/12 targets at rank one, missed R4, and rejected all three negatives. That failure led to diagnosing duplicated note input. Question-task and query-variant trials were not retained. Reruns of the original corpus are regression evidence, not fresh independent held-out validation.

The deterministic grid evaluates 0.00 through 0.90 at 0.01 steps, rejects settings that admit any calibration negative, maximizes correct top-three targets, and breaks ties toward the higher threshold. The retained single-query calibration retrieves 8/8 text and 3/3 visual targets while rejecting all calibration negatives. Complete measured scores are in `calibration.json`. Earlier exploratory measurements are explicitly labelled baseline/intermediate.

A 280-token image baseline took about three minutes for its calibration scenario. The intermediate 70-token scenario took 46 seconds, and the final broader calibration took 54 seconds while another WebGPU probe was running. These are whole-test times, not per-image benchmarks or phone measurements. Different timing conditions are not a controlled speed comparison.

`retrieval-freeze.json` records the current implementation/corpus freeze; `retrieval-first-freeze.json` records the initial pre-evaluation freeze. The first freeze and failed evaluation are preserved separately. A question-only strategy was rejected after calibration retrieved only 7/8 text targets. The variant strategy also passed calibration, but did not solve the observed failure and added query work. The final implementation retains the original prefix and thresholds, with redundant note-title removal. The isolated consumed R4 regression then matched at cosine 0.74246. Subsequent changes to the current freeze require reviewing and recording why. Held-out failures must be reported rather than adjusting expected IDs or thresholds to hide them.

## WASM q4 lookup lowering

The pinned graph uses `com.microsoft::GatherBlockQuantized` for text embeddings and two visual position tables. The distributed ORT Web WASM runtime lacks that operator's kernel. It fails to create a session without a compatibility transformation.

`src/engine/onnx-q4.ts` replaces only the supported UINT8-packed, block-32, 4-bit lookup with standard Gather, Cast, Mod, Div, Floor, Unsqueeze, Concat, Reshape, Sub and Mul operations. It gathers requested packed rows, unpacks low/high nibbles, unpacks per-block zero points, and computes `(quantized - zero_point) * scale`. Original external tensor data and precision are unchanged. Only selected rows are dequantized; the entire embedding table is not expanded. Unrecognized configurations fail explicitly. WebGPU uses the original graph.

An independent deterministic five-row toy graph was evaluated with ONNX Runtime native CPU 1.30.0 and the lowered graph. Maximum absolute error was **0.0**. `q4-gather-expected.json` records native outputs. The browser acceptance test runs the lowered graph on actual WASM and compares every output against that reference. It passed. The main model also passed actual 768-dimensional text inference and positive/negative retrieval on WASM. The optional native check can be repeated with `python scripts/verify-q4-reference.py` after installing its documented Python dependencies; npm/browser acceptance uses the checked native reference without requiring Python.

Operator semantics: https://github.com/microsoft/onnxruntime/blob/main/docs/ContribOperators.md#commicrosoftgatherblockquantized . Model prefix/dtype documentation: https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/blob/daa72c51243991dfcaf9f9137d2c573d8f7790c0/README.md .

## WebGPU and worker lifecycle

The worker requests a GPU adapter before selecting WebGPU. If model initialization or inference fails there, the bridge terminates that worker, creates a fresh WASM worker and replays pending pure inference requests once. This avoids reusing poisoned runtime initialization state. A WASM failure is reported; there is no remote inference fallback.

An actual headful Chromium 156 probe on the available Apple M4, macOS 27.0.1, 16 GB found an Apple Metal-3 adapter and completed text and image inference with 768-dimensional outputs on WebGPU in 10.521 seconds total on the pre-PR rerun. See `webgpu-probe.json`. This is a smoke measurement, not a phone benchmark or proof of Safari support.

## Extraction evidence

Actual OCR recovered the badminton announcement from the synthetic JPEG and its scanned-PDF version. PDF.js returned the group-size rule from page 2 of the three-page PDF. Single-thread ffmpeg decoded the MP3 to 16 kHz mono PCM. Actual Whisper returned timestamped chess-orientation speech. Near-silent edges are trimmed with 100 ms context, then their original-sample offset is added back to every transcript location. This fixes the observed zero-start timestamp on a recording with three seconds of leading silence. Fully near-silent audio returns no transcript. A silent seven-second H.264 video produced visual locations [0,5000] and [5000,7000] milliseconds without requiring an audio stream.

The core's ffprobe wrapper can return a nonzero sentinel even when it successfully writes valid probe JSON. Extraction validates that fresh output file, duration and stream codecs instead of trusting that wrapper sentinel. Missing/invalid output still fails safely with the original retained.

## Limits of this evidence

The held-out 30-item evaluation and final production network/offline checks have their own report. Calibration and smoke tests do not establish all S1–S15 statements. Physical iPhone, Android, Safari and installed-PWA checks remain separate requirements. No claim is made that every ordinary phone meets the 120-second processing target.
