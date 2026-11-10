## Technical architecture for server-side ingestion and search

### Starting point in this repository

The local code sets hard limits on what the server can do. All web sources were accessed 2026-11-10. The browser engine (`src/engine/model.worker.ts`) embeds text and images with one model, `onnx-community/embeddinggemma-2-ONNX`. It is pinned to revision `daa72c5…` and runs at `dtype: 'q4'` through `@huggingface/transformers` 4.3.1. Speech uses `onnx-community/whisper-tiny.en` at `q8`, OCR uses `tesseract.js` 7.0.0, and PDF text uses `pdfjs-dist` 6.4.299 (`package.json`). The pilot server runs on `node:24.22.1-bookworm-slim`, which is Debian with glibc, and on PostgreSQL `postgres:17.11-alpine` (`pilot/deploy/Dockerfile`, `pilot/deploy/compose.yaml`). The Azure VM is `Standard_D2as_v4` (2 vCPU, 8 GiB) in `indiasouthcentral` (`pilot/azure/main.bicep`, `docs/pilot/2026-11-04-implementation-plan.md`). The pilot is therefore already on a mid-size 2-vCPU/8 GiB machine, not a B1s/B2s.

According to the [onnx-community model card](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX) (accessed 2026-11-10, confidence: Medium, tier: Primary), EmbeddingGemma 2 has 740M parameters in total. That breaks down into a 270M text model, a 170M vision encoder and a 300M audio encoder. It outputs 768-dimensional vectors in one shared multimodal space, with Matryoshka truncation to 512, 256 or 128. At q4 the files are 175 MB for text and 109 MB for vision. The card gives q4's worst-case cosine similarity to fp32 as 0.975, or 0.988 for text alone, and q8's as 0.9997.

**This implies a hard constraint.** Anything the server embeds, including the text of a bot search query, must come from the same model at the same revision, or the vectors cannot be compared with device-made index bundles. Running q8 on the server while devices run q4 changes scores by roughly 1–2.5% cosine. That can move results across the fixed ranking thresholds, and project rules forbid changing thresholds to make a suite pass. The safest server choice is the same pinned q4 files.

### 1. Server-side embeddings in Node

According to the [transformers.js v4 source (onnx backend)](https://app.unpkg.com/@huggingface/transformers@4.2.0/files/src/backends/onnx.js) (accessed 2026-11-10, confidence: Medium, tier: Primary), transformers.js uses `onnxruntime-node` when it runs in Node and `onnxruntime-web` in the browser. "transformers.js vs onnxruntime-node" is therefore not a choice of different engines. transformers.js is the tokenizer, processor and pipeline layer over the native ONNX Runtime CPU execution provider. The [Hugging Face v4 announcement](https://huggingface.co/blog/transformersjs-v4) (accessed 2026-11-10, confidence: Medium, tier: Primary) adds that v4 can run WebGPU in Node, Bun and Deno, and reports a "~4x speedup for BERT-based embedding models" from the MultiHeadAttention operator. It publishes no CPU numbers for Node.

Mozilla's write-up gives the closest evidence for the native-versus-WASM gap. Moving Transformers.js from the WASM build of ONNX Runtime to the native C++ build cut one image-to-text model from 3.5 s to 350 ms on the same hardware ([Mozilla blog](https://blog.mozilla.org/en/firefox/firefox-ai/speeding-up-firefox-local-ai-runtime/), accessed 2026-11-10, confidence: Low, tier: Established; single measurement, browser context). This suggests the same model will run noticeably faster server-side under `onnxruntime-node` than on a student's phone under WASM. The size of the gain on Azure vCPUs is unmeasured.

In practice, reusing transformers.js on the server is the lower-risk route because the browser preprocessing code can be reused unchanged: the `AutoProcessor`, the `max_soft_tokens = 70` image setting, and the task prefixes. Raw `onnxruntime-node` would require re-implementing Gemma tokenisation and image preprocessing exactly, and any mismatch would silently break vector compatibility. **Gap:** the repo patches q4 Gather nodes for WASM (`lowerQuantizedGather` in `src/engine/onnx-q4.ts`). Whether the native CPU execution provider needs the same patch was not found in any source and must be tested.

No published CPU benchmark of EmbeddingGemma 2 was found. For the closely related EmbeddingGemma-300m, the [LiteRT community card](https://huggingface.co/litert-community/embeddinggemma-300m) (accessed 2026-11-10, confidence: Low, tier: Primary; one source, phone CPU) reports these figures on a Samsung S25 Ultra CPU with 4 XNNPACK threads, mixed int4/int8:

| Sequence length | Inference | Peak RSS |
|---|---|---|
| 256 tokens | 66 ms | 110 MB |
| 512 tokens | 169 ms | 123 MB |
| 2048 tokens | 2,455 ms | 333 MB |

[Google's launch post](https://developers.googleblog.com/en/introducing-embeddinggemma/) (accessed 2026-11-10, confidence: Medium, tier: Primary) gives under 15 ms for 256 tokens on EdgeTPU and under 200 MB of RAM when quantised. Google's own model overview says under 22 ms instead.

> Sources disagree: the [Google blog](https://developers.googleblog.com/en/introducing-embeddinggemma/) says <15 ms on EdgeTPU, while [Google's model overview](https://ai.google.dev/gemma/docs/embeddinggemma?hl=pt-br) says <22 ms. Both are accelerator figures and are irrelevant to a CPU VM. The conservative figure is 22 ms.

For BERT-base-class models (about 110M parameters), [Hugging Face/Intel](https://huggingface.co/blog/intel-fast-embedding) (accessed 2026-11-10, confidence: Low, tier: Primary; 22–56 Xeon cores, not comparable to 2 vCPU) reports int8 BGE-base under 10 ms per query. The [Sentence Transformers efficiency guide](https://sbert.net/docs/sentence_transformer/usage/efficiency.html) (accessed 2026-11-10, confidence: Medium, tier: Primary) finds the fastest CPU backend depends on the hardware: OpenVINO int8 wins on an i7-13700K, llama.cpp on HF cloud CPUs, and plain ONNX on non-Intel CPUs. Its advice is to benchmark on the target machine. No CPU latency numbers were found for nomic-embed-text-v1.5 or multilingual-e5-base beyond an unsourced blog estimate of about 100 embeddings/s on a 16-core server ([jacar.es](https://jacar.es/en/nomic-embed-text-competitive-open-embeddings/), accessed 2026-11-10, confidence: Low, tier: **Low**). Switching to any of those models would anyway break compatibility with the existing device index.

**Estimate, confidence Low.** Inferring from the phone CPU figures, the 270M text tower at q4 on 2 AMD EPYC vCPUs would plausibly take about 50–200 ms per 256-token chunk. A 10-page PDF of about 5,000 tokens, or about 20 chunks, would take roughly 1–4 s, and a short search query would take tens of milliseconds. The vision encoder for one photo would probably take under a second. Resident memory for text plus vision at q4 under ONNX Runtime is plausibly 0.5–1 GB including arenas. This must be measured on the VM before committing.

**Operational warning, confidence Low.** A third-party report says the transformers.js feature-extraction pipeline in Node holds intermediate tensors between calls ([MemOS issue mirror](https://raspberrypi.tailbfe349.ts.net/github/MemTensor/MemOS/issues/1863), accessed 2026-11-10, confidence: Low, tier: **Low**). An [onnxruntime issue](https://github.com/microsoft/onnxruntime/issues/24264) (accessed 2026-11-10, confidence: Low, tier: Primary) reports an `onnxruntime-node` 1.21 problem on Ubuntu/Node 22 that was fixed by pinning 1.20.1. A long-running worker should watch RSS and recycle itself periodically. `onnxruntime-node` ships glibc prebuilds, and the musl/Alpine build has known header issues ([ONNX Runtime PR search result](https://github.yxlr123.workers.dev/microsoft/onnxruntime/pull/28249), confidence: Low, tier: **Low**). The existing Debian `bookworm-slim` Node image is therefore the right base for the worker. Do not move it to Alpine.

No source was found for a CLIP or SigLIP image model on a 2–4 vCPU VM. That matters less here because EmbeddingGemma 2's own vision encoder already supplies the image vectors the device uses.

### 2. Server-side OCR, PDF text and transcription

**OCR.** The [tesseract.js performance guide](https://unpkg.com/tesseract.js@6.0.1/docs/performance.md) (accessed 2026-11-10, confidence: Medium, tier: Primary) gives no per-image timings. It says setup (createWorker, language load) can dominate sequential runs and each worker "uses a high amount of memory". It recommends a fixed scheduler pool of reused workers rather than one worker per image. The [workers vs schedulers doc](https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/docs/workers_vs_schedulers.md) (accessed 2026-11-10, confidence: Medium, tier: Primary) confirms the pool pattern.

For native Tesseract, vendor blogs claim 0.3–0.8 s per page in LSTM mode and about 0.82 s per page for Tesseract 5 ([imagetotable.ai](https://imagetotable.ai/blog/ocr-speed-vs-accuracy-tradeoff), accessed 2026-11-10, confidence: Low, tier: **Low**). tesseract.js runs the same engine as WASM and is generally expected to be slower. No controlled Node benchmark was found.

**Estimate, confidence Low.** With one warm worker on a 2-vCPU VM, a phone photo of notes plausibly takes about 1–5 s. A worker pool of 1 on a 2-vCPU machine avoids starving the API.

**PDF text.** pdf.js text extraction needs no model. Several guides recommend the legacy build `pdfjs-dist/legacy/build/pdf.mjs` in Node with `page.getTextContent()`, and warn that browser globals such as DOMMatrix can break server imports ([Nutrient](https://www.nutrient.io/blog/pdfjs-server-side-text-extraction/), [PkgPulse comparison](https://www.pkgpulse.com/guides/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-2026); accessed 2026-11-10, confidence: Low, tier: **Low**). [unpdf](https://github.com/unjs/unpdf) (accessed 2026-11-10, confidence: Medium, tier: Primary) packages PDF.js as a server and serverless build to avoid this.

Analysis: PDF text extraction is milliseconds to a few seconds per document and essentially free. It is the one extraction step that is cheap enough to run on the existing VM in every design. Scanned PDFs still need OCR.

**Transcription.** In the whisper.cpp community benchmark ([ggml-org/whisper.cpp #89](https://github.com/ggml-org/whisper.cpp/issues/89), accessed 2026-11-10, confidence: Medium, tier: Primary), one 30-second encoder pass at 4 threads takes 733–829 ms for **tiny** across a Ryzen 9 3900X, i7-4790K, i7-11800H and Ryzen 5 4500U. For **base** it takes 1,173–2,092 ms. The issue notes that `whisper-bench` is synthetic, measures the encoder plus decoder microbenchmarks, and is "not an end-to-end transcription benchmark".

The official [faster-whisper README](https://github.com/SYSTRAN/faster-whisper) (accessed 2026-11-10, confidence: Medium, tier: Primary) reports the **small** model at int8 transcribing a 13-minute clip in 2 min 4 s with 995 MB of RAM. That run used 8 threads on a Xeon Gold 6226R, which is about 0.16× real time. A secondary guide's estimates of about 8 s for tiny and about 30 s for base per 1-minute file on an unspecified CPU are unmeasured ([theneuralbase](https://theneuralbase.com/faster-whisper/learn/beginner/slower-than-expected-on-cpu/), confidence: Low, tier: **Low**). For transformers.js Whisper in Node, the only figure found is about 1,100 ms on an Apple M3 for an unspecified model and clip ([micdrop.dev](https://micdrop.dev/docs/ai-integration/provided-integrations/whisper), confidence: Low, tier: **Low**).

**Estimate, confidence Low.** A 1-minute voice note is two 30-second windows plus decoding. With whisper-tiny on 2 Azure vCPUs (SMT threads, slower than the desktop cores above), it plausibly takes about 5–15 s, and whisper-base about 10–30 s. For parity with the device index, the server should run the same `whisper-tiny.en` at q8 through transformers.js rather than whisper.cpp. That keeps transcripts and timestamps consistent with what devices produce.

One more concern: WhatsApp voice notes are OGG/Opus. Per the [Cloud API media reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media) (accessed 2026-11-10, confidence: Medium, tier: Primary), audio is OGG with the Opus codec only and mono. The server needs a decoder, such as ffmpeg or an Opus WASM decoder, to produce 16 kHz PCM. The browser's `AudioContext` is not available in Node.

### 3. Vector search in PostgreSQL with pgvector

The [pgvector README](https://github.com/pgvector/pgvector) (accessed 2026-11-10, confidence: High, tier: Primary; corroborated by the [raw README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)) states:

- Search is **exact by default with perfect recall**. HNSW is approximate, with defaults `m=16`, `ef_construction=64` and `hnsw.ef_search=40`.
- Indexes support up to 2,000 dimensions for `vector` and 4,000 for `halfvec`, so 768-d is fine. `halfvec` halves storage to `2*d+8` bytes.
- Unindexed exact queries are sped up by raising `max_parallel_workers_per_gather`.
- With approximate indexes the `WHERE` filter is applied *after* the index scan. A filter matching 10% of rows with `ef_search=40` returns only about 4 rows. Iterative index scans (0.8.0+) mitigate this.
- For multitenancy, it recommends partitioning or separate tables, because a shared approximate index lets one tenant's vectors affect another's recall. Exact search with a B-tree on the filter column works well when the filter matches a small share of rows.
- The current version shown is 0.8.7, and it supports Postgres 13+.

Latency evidence at this scale is thin and mostly vendor- or blog-sourced:

- **Neon**, on 4 vCPU/16 GB with 960-d GIST vectors: an exact sequential scan over 10k rows takes about 36–40 ms. Scans "start to become costly at 50k rows" ([Neon blog](https://neon.com/blog/optimizing-vector-search-performance-with-pgvector), accessed 2026-11-10, confidence: Medium, tier: Established).
- **Supabase**, HNSW at 0.99 accuracy on a 1 GB "Micro" instance: 100k × 384-d vectors give a 17 ms mean and 580 QPS. On a 2 GB "Small" instance, 100k × 960-d give a 40 ms mean, with RAM spilling into swap ([Supabase compute guide](https://supabase.com/docs/guides/ai/choosing-compute-addon), accessed 2026-11-10, confidence: Medium, tier: Primary).
- **A personal benchmark blog**, on a 4-vCPU VPS with random 768-d vectors: HNSW p50 of 1.8 ms at 100k with 96% recall@10. HNSW build plus insert took 48 s. Table plus index came to 820 MB ([dadops](https://dadops-site.pages.dev/blog/vector-search-benchmarks/index.html), accessed 2026-11-10, confidence: Low, tier: **Low**). Its "near-duplicate" copy reports slightly different numbers.

> Conflicts noted: blog copies of the dadops benchmark disagree on build time ("almost a minute" vs 48 s). The Neon and Supabase figures use different dimensions and hardware. No source gives a pgvector exact-scan latency at 768-d/100k on 2 vCPU.

Analysis: Campus Recall's search is always scoped to one student, so each query touches a few hundred to a few thousand chunk vectors even if the table holds 100k. The pgvector README's own guidance then points to **exact search filtered by owner with a B-tree index on `owner_id`, and no HNSW**. That gives perfect recall, avoids the post-filtering pitfall, and should take single-digit to low tens of milliseconds per query. HNSW only becomes worthwhile for cross-user search, which this product does not do. A global HNSW index would *hurt* per-user recall.

**pgvector on `postgres:17-alpine`.** The official image does not include pgvector. pgvector publishes Debian images only: `pgvector/pgvector:pg17`, `pg17-bookworm`, `pg17-trixie` and `0.8.7-pg17` ([pgvector README](https://github.com/pgvector/pgvector), confidence: High, tier: Primary). A community project exists precisely because "the official pgvector image doesn't have an alpine version" ([codeberg arnu515](https://codeberg.org/arnu515/postgres-pgvector-alpine), accessed 2026-11-10, confidence: Low, tier: **Low**). Alpine's own `postgresql-pgvector` package is version 0.6.2 in v3.22 ([Alpine packages](https://pkgs.alpinelinux.org/packages?name=postgresql-pgvector&branch=v3.22), accessed 2026-11-10, confidence: Medium, tier: Primary). That is old, and it targets Alpine's packaged PostgreSQL, whereas the Docker image builds PostgreSQL itself (confidence: Low, inferred and not verified).

There are three realistic options:

1. A small derived Dockerfile, `FROM postgres:17.11-alpine`, that compiles pgvector v0.8.7 with `make && make install`. The README notes `make OPTFLAGS=""` avoids "Illegal instruction" errors when the build machine differs from the run machine.
2. A switch to `pgvector/pgvector:0.8.7-pg17-bookworm`.
3. Skipping pgvector and storing vectors as `bytea`/`real[]`, then brute-forcing cosine similarity in Node over one user's few thousand rows, at about 3 KB per 768-d vector.

Option 2 has a migration trap. Switching an existing data directory from Alpine (musl) to Debian (glibc) changes collation behaviour and the recorded collation versions, so text indexes need `REINDEX` and `ALTER DATABASE … REFRESH COLLATION VERSION` ([makandra cards](https://makandracards.com/makandra/608572-postgres-in-alpine-docker-container-sorting-order-might-differ), [Crunchy Data](https://www.crunchydata.com/blog/glibc-collations-and-data-corruption), [Nuvotex](https://blog.nuvotex.de/postgres-2); accessed 2026-11-10, confidence: Medium, tier: Low/Established). Option 1 or option 3 avoids the trap.

### 4. Alternatives that avoid server inference

**Deferred indexing has strong precedents.** [Ente Photos](https://help.ente.io/photos/features/machine-learning) (accessed 2026-11-10, confidence: High, tier: Primary; corroborated by [ente.com/ml](https://ente.com/ml/)) states that all ML "happens entirely on your device". It also states that indexes are "compressed lossless and encrypted using the file key before being sent to our object storage", and that other clients pull existing indexes rather than recomputing them. Ente recommends running initial indexing on desktop and letting results sync to mobile. [Proton Mail](https://proton.me/blog/engineering-message-content-search) (accessed 2026-11-10, confidence: Medium, tier: Primary) builds its message-content search index client-side in IndexedDB because the server cannot read the mail. Self-hosted [Immich](https://immich.app/docs/features/ml-hardware-acceleration) (accessed 2026-11-10, confidence: Medium, tier: Primary) shows the opposite trade-off. Its server-side ML container must also run for every *text query*, because queries have to be embedded with the same CLIP model as the images.

Campus Recall already follows the Ente pattern: the server stores originals plus device-made index bundles. Applied to WhatsApp, the flow would be:

1. The bot stores the original in Blob and records a row marked `index_pending`.
2. The bot replies "Saved; searchable after you next open Campus Recall".
3. The next time the PWA is open on any of the student's devices, it downloads pending items, runs its existing OCR, transcription and embedding pipeline, and publishes the bundle exactly as it does for local saves.

This adds **zero** model cost to the VM and keeps one vector space.

The weakness is query time, not ingestion. A student asking the bot a question while their phone's PWA is closed cannot be answered semantically unless the server can embed the query. As the Immich example shows, the minimum server-side model for semantic bot search is the **text tower only**: about 270M parameters, 175 MB at q4, and tens of milliseconds per short query (estimate, confidence: Low). The vision and audio encoders and Whisper can stay device-only.

This suggests a hybrid as the best fit: deferred indexing for ingestion, plus a small server-side text-only query embedder that searches the vectors already uploaded in the student's bundles.

**Lexical fallback.** PostgreSQL full-text search (a `tsvector` with a GIN index and `ts_rank`) handles stemming and relevance ranking. `pg_trgm` (`similarity`/`word_similarity` with `gin_trgm_ops`) handles typos and substrings. Several guides describe the two as complementary, and suggest running FTS first and falling back to trigram matching when a query is misspelled ([Aapeli Vuorinen](https://www.aapelivuorinen.com/blog/2021/02/24/postgres-text-search/), [ParadeDB](https://www.paradedb.com/learn/search-in-postgresql/full-text-search); accessed 2026-11-10, confidence: Medium, tier: Low/Established). FTS lacks corpus-wide IDF (`ts_rank` uses no global statistics), which matters little for one student's small corpus.

To combine lexical and vector results, the common pattern is Reciprocal Rank Fusion: `score = Σ 1/(60 + rank)` over both lists, joined with a FULL OUTER JOIN ([Railway guide](https://docs.railway.com/guides/hybrid-search-postgres-pgvector), [Agno docs](https://docs.agno.com/knowledge/concepts/search-and-retrieval/hybrid-search); accessed 2026-11-10, confidence: Medium, tier: Low/Primary). Both `pg_trgm` and FTS ship with PostgreSQL contrib, so no extra image work is needed. Analysis: the lexical index is only as good as the text available server-side. Immediately after a WhatsApp upload, that text is the filename, the WhatsApp caption and, cheaply, pdf.js text for digital PDFs. OCR and transcripts become searchable only after deferred indexing or server OCR/ASR.

### 5. Webhook engineering for the WhatsApp Cloud API

**Acknowledgement and retries.** Per Meta's [create-webhook-endpoint doc](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint) and [webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) (accessed 2026-11-10, confidence: High, tier: Primary):

- Valid requests must get HTTP 200, and any other status triggers retries.
- Delivery "is retried immediately, then a few more times with decreasing frequency over the next 7 days".
- Retries "can result in duplicate webhook notifications", and "your server should handle deduplication".
- Payloads can be up to 3 MB.
- Payloads are signed with HMAC-SHA256 of the raw JSON body using the app secret, in `X-Hub-Signature-256`.
- The endpoint needs a valid CA-issued TLS certificate (Caddy's automatic certificate satisfies this), and self-signed certificates are rejected.
- mTLS is supported and preferred over IP allowlisting because Meta's IPs change.

Meta documents no explicit response deadline. Third-party guides cite 3–10 s ([YCloud](https://www.ycloud.com/blog/whatsapp-webhook-reliability-retries-idempotency), [Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices); confidence: Low, tier: **Low**).

> Sources disagree: the WhatsApp docs say retries run for **7 days**. Meta's generic [Graph API webhooks guide](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) says retries run over **36 hours**, after which unacknowledged updates are dropped, and that batches of up to 1,000 are possible but not guaranteed. A community post claims 8 hours. The likely reason is that the WhatsApp product overrides the Graph default. Design for 7 days, which is the WhatsApp-specific and conservative figure.

**Media.** According to the [Cloud API media reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media) (accessed 2026-11-10, confidence: High, tier: Primary; the 5-minute rule is corroborated by the [Hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)):

- The webhook carries a media ID. A GET on that ID returns a URL that "expire[s] after 5 minutes".
- The download needs the bearer token. On a 404, fetch a fresh URL and retry.
- Media IDs in webhooks expire after 7 days.
- Size limits are 100 MB for documents, 16 MB for audio and video, and 5 MB for images.

> Conflict: Meta's [No-Storage doc](https://developers.facebook.com/documentation/business-messaging/whatsapp/no-storage/) says incoming media is available for only **1 hour** when the No-Storage feature is enabled, while the media reference gives 7 days. The difference is the feature flag. Download promptly either way.

**Recommended pipeline (analysis):**

1. In the HTTP handler, verify the signature on the raw bytes. In one transaction, run `INSERT INTO wa_inbound(wamid, payload) … ON CONFLICT (wamid) DO NOTHING` and insert a job row. Then return 200. Uniqueness is enforced by the database constraint rather than check-then-insert, as YCloud also advises.
2. A worker claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, resolves the media ID to a fresh URL *immediately before* downloading, streams the file into Blob while hashing it with SHA-256 (which deduplicates against the user's existing originals), updates the item row, and sends the reply.
3. Retries use exponential backoff and a dead-letter state. Every side effect, especially the outgoing WhatsApp reply, is keyed by `wamid` so a retried job never double-replies.

**Queue libraries.** [pg-boss](https://github.com/timgit/pg-boss) (accessed 2026-11-10, confidence: High, tier: Primary; corroborated by its [npm page](https://npmjs.com/package/pg-boss)) requires Node 22.12+ and PostgreSQL 13+, both met. It is built on SKIP LOCKED and offers retries with exponential backoff, dead-letter queues with redrive, cron scheduling, and debounce/concurrency policies. [graphile-worker](https://worker.graphile.org/docs/job-key) (accessed 2026-11-10, confidence: Medium, tier: Primary) offers `job_key` deduplication in `replace`, `preserve_run_at` and `unsafe_dedupe` modes, but deletes completed jobs, so it keeps no key history. Analysis: the server deliberately uses plain `node:http` with few dependencies, so a hand-written table of about 50 lines with SKIP LOCKED is also reasonable at pilot volume. pg-boss is the better choice if the team wants backoff and dead-letter queues without writing them. Either way, `wamid` deduplication belongs in the team's own table, not in the queue library.

### 6. Linking a WhatsApp identity to an existing account

**Meta's guidance and identifiers.** Meta's [authentication best practices](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-best-practices/) (accessed 2026-11-10, confidence: High, tier: Primary; corroborated by the Princeton study below) say:

- "WhatsApp does not enforce ownership of the phone number past initial registration."
- A phone number and its WhatsApp account "should not be treated interchangeably".
- "Phone numbers are recycled by mobile providers", and the previous owner may still hold the WhatsApp account.
- Recovery flows should add a challenge beyond the WhatsApp code.
- A WhatsApp channel should be verified "as you would any other new authentication channel", for example while the user is logged in.

The [Princeton recycled-numbers study](https://recyclednumbers.cs.princeton.edu/assets/ecrime2021-lee-slides.pdf), as reported by [Krebs on Security](https://krebsonsecurity.com/2021/05/recycle-your-phone-sure-but-maybe-not-your-number/) and [The Hacker News](https://thehackernews.com/2021/05/new-study-warns-of-security-threats.html) (accessed 2026-11-10, confidence: High, tier: Primary/Established), found that 171 of 259 sampled recycled US numbers were still tied to accounts at popular sites. The study is US-only. No India-specific recycling data was found.

**Identifier changes in 2026.** According to Meta's [Business-scoped user ID doc](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids) and [system-message webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/system) (accessed 2026-11-10, confidence: High, tier: Primary; corroborated by [Kapso](https://kapso.ai/blog/whatsapp-bsuid-usernames-2026) and [8x8](https://developer.8x8.com/connect/docs/whatsapp-business-scoped-user-ids)):

- BSUIDs appear in webhooks (`user_id`) from early April 2026.
- Users who enable WhatsApp usernames, rolling out in 2026, have `wa_id`/`from` *omitted* unless the business interacted with them in the last 30 days.
- A BSUID is "regenerated if a user changes their phone number". A `user_changed_number` system webhook then carries `previous_user_id`.
- Meta says businesses "must support BSUID to avoid losing the ability to process their messages".

Analysis: the link table should key on BSUID and treat the phone number as a nullable, informational field.

**Pattern A: code shown in the app and sent via a prefilled wa.me link.**

1. The logged-in web app generates a short-lived (5–10 min), single-use, rate-limited code.
2. The app shows a `wa.me/<bot>?text=LINK%20483921` button.
3. The student sends the message. The inbound webhook proves control of that WhatsApp account at that moment, and because the user starts the conversation, the bot can reply.

The prefilled text is editable and visible ([Unipile](https://www.unipile.com/de/?p=275019), confidence: Low, tier: **Low**). **Pitfall (analysis):** if the code leaks, for example through a screenshot or a phishing "send me your code" message, an *attacker* can send it from the attacker's own WhatsApp. The attacker's phone is then linked to the victim's library and can search the victim's files through the bot. Mitigation: after the message arrives, require an in-app confirmation that shows the masked number or username. Bind the code to the web session that created it.

**Pattern B: the bot sends a magic link.** The student messages the bot, and the bot replies with a link that completes linking when opened while logged in. **Pitfall (analysis):** this is the account-linking variant of login CSRF. An attacker gets a link for *their own* WhatsApp and sends it to a victim. If the victim opens it while logged in, the victim's library is linked to the attacker's WhatsApp. Mitigation: the confirmation page names the WhatsApp identity being linked and requires an explicit click, links expire in minutes, and the account shows its linked devices with a revoke option.

**Changes over time (analysis, confidence: Low).** Several events can change who controls a linked WhatsApp identity:

- On `user_changed_number`, the safe default is to suspend the link and ask for in-app re-confirmation rather than silently migrating it to the new BSUID.
- To limit recycled-number exposure, expire links after a period of inactivity and re-verify. One industry source says reassignment takes at least 90 days ([Telesign](https://telesign.com/?p=2776), confidence: Low, tier: **Low**). The FCC's US aging period is 45 days per THN.
- A SIM-swap attacker who re-registers the victim's number on WhatsApp may inherit the bot link. The bot should therefore never be able to delete, export or share content without a web confirmation.

Meta's "identity hash" binding for authentication templates detects re-registration, but only on sends of authentication templates. **Gap:** whether a BSUID changes when a recycled number is re-registered by a new person was not documented in any source found.

### 7. Rough Azure cost (estimate)

These are Linux pay-as-you-go prices from Microsoft's [Azure Retail Prices API](https://prices.azure.com/api/retail/prices), queried 2026-11-10 with prices effective 2026-05-01 for `indiasouthcentral`. They are labelled confidence: Low under the two-source rule, but they come straight from Microsoft's own price API (tier: Primary). The Azure [Linux VM pricing page](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/) did not render regional prices for cross-checking. Monthly figures are hourly × 730 and exclude disk, public IP, bandwidth, Blob and backup.

| SKU (vCPU / RAM) | India South Central $/h | ≈ $/month | Central India $/h (reference) |
|---|---|---|---|
| D2as_v4 (2 / 8 GiB), **current** | 0.0909 | 66 | 0.0622 |
| D2als_v6 (2 / 4 GiB) | 0.0804 | 59 | n/q |
| D2as_v6 (2 / 8 GiB) | 0.0954 | 70 | 0.0586 |
| E2as_v6 (2 / 16 GiB) | 0.123 | 90 | n/q |
| D4als_v6 (4 / 8 GiB) | 0.161 | 118 | n/q |
| D4as_v5 (4 / 16 GiB) | 0.182 | 133 | 0.111 |
| D4as_v6 (4 / 16 GiB) | 0.191 | 139 | 0.117 |
| D8as_v5 (8 / 32 GiB) | 0.364 | 266 | 0.222 |
| B1s / B2s / B2ms | not listed | — | 0.0112 / 0.0448 / 0.0896 |

The API returned **no B-series meters for `indiasouthcentral`**. India South Central is also about 45–65% more expensive than Central India for the same SKU. The repo notes that the student subscription's policy allows only `koreacentral`, `malaysiawest`, `eastasia`, `indiasouthcentral` and `indonesiacentral`, so Central India is not an option. Microsoft's [Azure for Students offer](https://azure.microsoft.com/pricing/offers/ms-azr-0170p/) and its [Learn page](https://learn.microsoft.com/azure/education-hub/azure-dev-tools-teaching/azure-students-program) (accessed 2026-11-10, confidence: High, tier: Primary) provide $100 of credit for 12 months.

**Analysis, cost.** If the pilot runs on that credit, the *current* D2as_v4 alone (about $66/month) already exceeds it within about six weeks. Moving to a 4-vCPU/16 GiB D4as_v5/v6 (about $133–139/month) would roughly double the burn. The cheapest credible path is to **keep the current 2-vCPU/8 GiB VM**:

- Run deferred indexing for ingestion.
- Run pdf.js text extraction and Postgres FTS/trigram matching server-side.
- Optionally load only the q4 text tower (about 175 MB on disk, under 1 GB RSS estimated) in a worker container with a CPU cap, such as `cpus: 1`, so query embedding never starves the API.

Full server-side OCR plus Whisper plus image embedding at a concurrency of 1 would probably also fit in 8 GiB at pilot volume, with latencies of tens of seconds per voice note. A 4-vCPU size is justified only if measured queue delay becomes unacceptable.

> **Conflicts noted:**
>
> - Meta webhook retry window: 7 days in the WhatsApp docs, 36 hours in the generic Graph API docs, 8 hours in a community post. Use 7 days.
> - Media availability: 7-day media IDs in the media reference versus 1 hour under No-Storage.
> - EmbeddingGemma on EdgeTPU: <15 ms (blog) versus <22 ms (model overview).
> - The dadops pgvector benchmark copies disagree on build time.
> - Some Central India rows from the price API had two Linux-looking prices; the table uses the Linux "Virtual Machines" product rows only.
>
> **Gaps:**
>
> - No measured CPU latency or RSS for EmbeddingGemma 2 (or EmbeddingGemma-300m, nomic-embed-text-v1.5, multilingual-e5-base, CLIP/SigLIP) on 2–4 Azure vCPUs under `onnxruntime-node`.
> - No controlled tesseract.js-in-Node per-image benchmark.
> - No end-to-end 1-minute transcription benchmark for whisper-tiny/base on 2 vCPUs, in either whisper.cpp or transformers.js.
> - No pgvector exact-scan figure at 768-d on 2 vCPU.
> - No confirmation that the q4 GatherBlockQuantized patch is unnecessary on the native CPU execution provider.
> - No source on whether a recycled number's new owner receives a new BSUID.
> - No India-specific number-recycling data.
> - No regional cross-check for Azure prices beyond the Retail Prices API.
> - Recommended next step: a 30-minute benchmark on the actual D2as_v4, covering text-tower embedding of 256-token chunks, one image, a 60-second Opus note through whisper-tiny.en q8, and one tesseract.js page, recording p50 latency and peak RSS.
