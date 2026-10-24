# Third-party notices

Campus Recall uses local open-source components and publicly downloaded models. Model weights and runtime binaries are excluded from Git. `scripts/model-assets.json` pins model URLs, SHA-256 hashes and byte lengths. `scripts/prepare-assets.mjs` derives runtime hashes from the locked npm packages. Preserve these notices when distributing the application.

| Component | Use | License / source |
| --- | --- | --- |
| React / React DOM | Interface | MIT, https://github.com/facebook/react |
| Dexie | IndexedDB storage | Apache-2.0, https://github.com/dexie/Dexie.js |
| fflate | Backup ZIP archives | MIT, https://github.com/101arrowz/fflate |
| Lucide | SVG icons | ISC, https://github.com/lucide-icons/lucide |
| Transformers.js | Browser inference | Apache-2.0, https://github.com/huggingface/transformers.js |
| ONNX Runtime Web | WASM/WebGPU inference | MIT, https://github.com/microsoft/onnxruntime |
| EmbeddingGemma 2 ONNX | 768-dimensional text/vision embeddings | Pinned model card declares Apache-2.0: https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/tree/daa72c51243991dfcaf9f9137d2c573d8f7790c0 ; original model: https://huggingface.co/google/embeddinggemma-2 |
| Whisper tiny.en ONNX | English transcription | Apache-2.0 conversion, MIT upstream Whisper: https://huggingface.co/onnx-community/whisper-tiny.en/tree/2575352d61be1bf7225cf8f8b268a4678025fc58 and https://github.com/openai/whisper |
| Tesseract.js / Tesseract core | English OCR | Apache-2.0, https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core |
| English trained data | OCR language data | Apache-2.0, https://github.com/naptha/tessdata |
| PDF.js | PDF extraction and viewing | Apache-2.0, https://github.com/mozilla/pdf.js |
| ffmpeg.wasm wrapper | Media worker bridge | MIT, https://github.com/ffmpegwasm/ffmpeg.wasm |
| ffmpeg.wasm core | Media decoding | GPL-2.0-or-later build, https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build |
| Vite / vite-plugin-pwa / Workbox | Build and offline shell | MIT and Apache-2.0, see locked package license files |

The ffmpeg core is a separately loaded worker runtime. Its build scripts and corresponding source references are available through the upstream project above. Runtime distribution includes the upstream package license files in `runtime/licenses/`; application builds copy them from installed packages. No license compatibility or security certification is claimed.

## Fixture provenance

All announcements, dates and course rules in `tests/fixtures/` are synthetic. Images are drawings authored in `scripts/create-fixtures.mjs`, rendered using Sharp. Speech uses macOS Samantha for reproducible test recordings. Videos combine those drawings or solid backgrounds with synthetic speech using local ffmpeg. They are not evidence from Suhani or Bhavya and are not actual IITGN announcements. `corpus.json` records original hashes and expected source mappings before evaluation.
