# Campus Recall

**Team:** Raj Modi, Chaitanya, Nakshatra — IIT Gandhinagar  
**Course:** CS437 Vibe Coding Hackathon, 2026–27, Semester 1

## Our user

### Suhani

- **Who:** Suhani, a third-year BTech student at IITGN and Raj's friend and classmate.
- **When/how:** Raj interviewed her in person near Acadamic Block 1 on 7 October 2026.
- **They said:**
  - “i started looking for it in multiple whatsapp grps.”
  - “not that often but it cost some time and i barely missed the registration.”
  - “i usually star the particular message or information on whatsapp and it’s convenient to look for it but when ur in a hurry..it kinda gets annoying to look for it.”
- **Changed:** Our initial plan focused on PDFs. Her experience with a photographed banner led us to include photos and screenshots, using local OCR to extract their text and create searchable embeddings. The app should retrieve the original image without requiring her to remember its filename or WhatsApp chat.
- **Evidence:** [U01: interview notes and responses](docs/user/U01.md). Suhani agreed to inclusion in the project documentation. Here is a selfie after the interview with Suhani
![proof](docs/user/interview_proof/image.png)


### Bhavya Shah

- **Who:** Bhavya Shah, a third-year Chemical Engineering student at IITGN and Raj's friend.
- **When/how:** She responded over WhatsApp on 9 October 2026.
- **They said:**
  - “I just share it to my personal no. It doesn't work well because again I keep on scrolling”
  - “it would help only when all the info is there in it already.”
  - “I would never know whether I really saved my work over there”
- **Changed:** Add a clear “Saved locally” confirmation after successful storage and a recent-saves view. Keep storage confirmation separate from indexing status so she can see what was saved even while it is processing. These changes address uncertainty about saving; students still need to import the information they want to retrieve.
- **Evidence:** [U02: WhatsApp interview responses](docs/user/U02.md). Bhavya agreed to inclusion in the project documentation. Here is the screenshot of her chat 
![chat_proof](docs/user/interview_proof/IMG_6515.PNG)

### 1. Who, exactly?

Suhani and Bhavya Shah are our specific users. Our intended users are IITGN students who save academic or campus information in photos, screenshots, documents, notes, links, and chats, then remember its topic but struggle to find the original. Suhani's experience concerns an event photo; Bhavya's concerns academic information and uncertainty about maintaining a separate saved-information library.

### 2. The last time

Suhani saw a badminton-team tryouts banner, photographed it, and shared it with someone on WhatsApp. Later, she forgot which chat contained it and searched multiple WhatsApp groups. She remembered the event but not where she had saved its details.

Bhavya described a recent incident as “semstore( a week ago)”. She searched study-related WhatsApp groups, scrolled through messages, and tried WhatsApp search. The meaning of “semstore” and whether she ultimately recovered the information have not been clarified. 

### 3. What it costs them

Suhani reported time lost and said she “barely missed the registration.” Her account connects difficulty finding the announcement with the badminton registration deadline; the precise registration outcome remains unclear. 

Bhavya reported spending approximately 10 minutes looking. She said this happens more frequently when academic load increases, especially during exams, when that time is particularly valuable.

### 4. What already exists

**WhatsApp is the existing alternative for both students.** Suhani stars important messages, while Bhavya forwards information to her own number. These methods help retain information, but both still described scrolling or checking chats to locate it. WhatsApp's standard chat search is keyword-based rather than semantic: it searches for entered words instead of matching the meaning of a remembered description. It offers media/document filters, but its documented workflow does not provide semantic retrieval across the extracted contents of saved images and PDFs. Remembering the topic without the original wording can therefore make lookup difficult. 

Our solutions aims to address this by extracting text from deliberately imported photos, screenshots, PDFs, notes, and saved webpages and searching their meaning in one local library. Students can describe what they remember and open the matching original. It cannot recover a WhatsApp message or file that was never imported.

Our market research also found products that solve parts of this problem:

| Existing product | What it solves | Limitation for our use case | How Campus Recall aims to address it |
| --- | --- | --- | --- |
| **Pixel Screenshots** | Finds saved screenshots using natural-language search. | Its documented retrieval workflow focuses on screenshots, and availability is restricted to supported Pixel phones with an eligible Google Account. It does not establish a general PDF/notes/webpage library. | Search supported images, PDFs, notes, and webpage snapshots together, without an account. Target students' Android phones beyond the supported Pixel range, with compatibility verified during testing. |
| **Siftlee** | Captures mixed content on iPhone, organizes it, and retrieves information with source references. | Its privacy policy allows submitted content and metadata to be processed by its service and third-party AI providers; this does not meet our requirement for entirely on-phone retrieval. | Run OCR, embedding creation, query matching, and original-file retrieval locally, with free core search and no cloud AI service or API key. |

### 5. Who has to say yes?

We dont need any permissions from any admistrative organisation from IITGN as we are for the students by the students

### 6. Where it grows

Three possible extensions, proposed by the team rather than requested by either respondent:

1. Visual image search from appearance, such as “the blue poster,” beyond OCR text clues.
2. Local audio/video transcription with results opened at matching timestamps.
3. User-controlled encrypted library export/restore for moving between devices.

Based on the interviews and our team discussion, we define the problem as follows:

**Problem statement:** IITGN students can remember what saved academic or campus information was about but struggle to locate its original among chats and files. Searching and scrolling take time when the information is needed quickly. A useful personal retrieval tool must let them search from remembered meaning, return the original source, and make successful saving visible.

## Local AI retrieval and what our code controls

Campus Recall will use a local embedding model for semantic search. **No external AI API calls, hosted embedding service, or cloud inference are involved.** The model creates numerical vectors for extracted content and the student's query on the phone. Our code compares those vectors using cosine similarity, ranks matching passages, groups them by original item, and displays relevant excerpts with source references. Embedding creation uses a trained model; similarity comparison is the mathematical matching step. This is a retrieval workflow, with no generated answers in the MVP. 

We mainly test :
- Which original item and PDF page a result references.
- Whether displayed excerpts come from that item's extracted content.
- Whether the app returns no relevant result when all similarity scores fall below a configured threshold.
- Whether extraction, embedding creation, and search remain on the phone.

A similarity score is not a probability that a result is correct. We will select the threshold using calibration examples and freeze it before acceptance testing. A rejected match means there is no sufficiently relevant result, not proof that the student never saved the item. The exact wording of the empty-state message is not an acceptance requirement.

Models may be bundled or downloaded during explicit setup. After setup, importing local files, indexing, searching, and opening saved originals must work offline. Saving a new public webpage requires an explicit network fetch; opening its saved snapshot does not. These web requests are separate from AI processing.

## Five independently testable specification statements

Each statement has its own fixtures and fresh library. Tests verify observable results and source IDs rather than exact generated wording. These are acceptance requirements; implementation and executable tests are still pending.

### S1 — Save supported information locally

**Statement:** A student can save a JPEG/PNG photo or screenshot, PDF, text note, or public static webpage without adding a title or tag. The app shows “Saved locally” only after the original file or snapshot and its item record are stored successfully, and the item remains visible in recent saves after restarting.

**Test:** Independently import each supported type, using a controlled HTTP page for the webpage case. Check that confirmation follows successful storage. Restart and verify the saved entries, original image/PDF byte hashes, note/snapshot text, and source URL. Force a storage failure and verify an error with no success confirmation. If extraction fails after storage, the original must remain visible with Failed status instead of disappearing or appearing Ready.

**Trace:** From Suhani's interview about saving a banner photo and Bhavya's interview about knowing whether information was successfully saved.

### S2 — Extract text and create embeddings on the phone

**Statement:** After model setup, readable supported items are processed locally into extracted text and embeddings. Photos/screenshots use OCR, PDFs retain page references, and an item becomes Ready only after successful indexing. Processing failures produce Failed status with a reason.

**Test:** With networking disabled, import a legible JPEG, PNG, text PDF, scanned PDF, note, and pre-saved webpage snapshot, each with a known phrase. Check extracted phrases, local embeddings, index entries, and the correct PDF page references. Each small fixture must become Ready within 120 seconds on the documented reference phone; this is a target to test. A corrupt image must fail explicitly rather than become Ready.

**Trace:** From Suhani's interview about information inside a photographed banner, with local processing informed by our market research and team decisions.

### S3 — Match remembered meaning and reject weak matches

**Statement:** Using locally created query embeddings and cosine similarity, each query in the fixed six-case, 30-item acceptance corpus returns its expected original among the top three distinct results. Candidates below the configured relevance threshold are excluded; if none qualify, the app returns an empty result list with a no-relevant-result state.

**Test:** Build a fresh library using actual extraction and embeddings. Freeze the model/version, threshold, queries, and expected IDs before testing. Check the expected original in the top three for all six queries, including the paraphrase with no meaningful shared words. Multiple chunks from one PDF must not occupy multiple item slots. Test the threshold decision separately with controlled scores below, at, and above the threshold, and verify the fixed unrelated queries return no results. Check the empty-result state, not its exact wording.

**Trace:** From Suhani's and Bhavya's interviews about struggling to find saved information; rejecting weak matches is our team's reliability requirement.

### S4 — Show excerpts with the exact saved source

**Statement:** Every search result includes an excerpt from its item's extracted text and a reference to that saved original. Selecting the reference opens the corresponding original; PDF results open the page associated with the excerpt. The app must never fabricate a source reference or substitute a different item when a source is unavailable.

**Test:** Seed a fresh library with an image, three-page PDF, note, and webpage snapshot, including two items with identical display titles. Verify each result's item ID, excerpt membership in its extracted text, PDF page mapping, and opened original bytes/text. Remove one original while keeping its index entry and verify an unavailable-source state with no substituted file. No test depends on a generated answer's wording.

**Trace:** From Suhani's interview about finding the original saved photo, with source verification added by our team.

### S5 — Never send private content for remote processing

**Statement:** Campus Recall must never send imported originals, extracted text, embeddings, source metadata, or search queries to a remote service for storage, analytics, or AI processing. After model setup, local-file import, extraction, embedding creation, search, and original viewing must work offline without an external AI API key or account.

**Test:** With models present and networking blocked, import private test files, index them, search, restart, and open originals. Repeat with network monitoring and verify zero app-initiated requests on these core paths. Verify managed originals and indexes are excluded from automatic cloud backup. Test explicit model download and webpage save/open separately: those requests must never attach unrelated library content or search queries. Sharing/exporting an original requires an explicit user action.

**Trace:** From our market research on cloud-processing limitations and our team's decision to keep retrieval private and local to the phone.
