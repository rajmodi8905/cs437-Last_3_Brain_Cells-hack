## Cost of running a WhatsApp bot in India (late 2026)

### Headline: replies are no longer free since 1 October 2026

The premise that user-initiated service replies and in-window utility templates are free is out of date. According to Meta's developer pricing page, Meta "resumed charging, on a per-message basis, for messages that were previously free" on 1 October 2026. This covers service messages, which had been free since 1 November 2024, and utility templates sent inside an open customer service window, which had been free since 1 July 2025 [Meta – Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: High, tier: Primary). To soften the change, Meta now gives each business phone number a free tier of 1,000 delivered service messages per month. The tier resets monthly by Messaging-account timezone and does not roll over, and Meta charges "as of the 1,001st service message for each business phone number" (same source). Several sources confirm the change, the 1,000-message tier and the India rate: [Beebom](https://gadgets.beebom.com/news/whatsapp-stopping-messages-from-select-business-accounts-starting-october-2026) (published 2026-10-01, accessed 2026-11-10, confidence: High, tier: Established), [MyOperator](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026) (updated 2026-10-29, accessed 2026-11-10, confidence: High, tier: Low, vendor blog), and the BSP rate cards of [Interakt](https://www.interakt.shop/pricing) and [AiSensy](https://aisensy.com/pricing) (accessed 2026-11-10, tier: Low, vendor).

The 1,000-message tier covers service messages only. Meta's page says the warning "only applies to service messages", and no source says utility templates are included. Utility templates sent in the window are now charged from the first message. This suggests the bot should reply with free-form (non-template) messages, not utility templates. In-window replies need no template, so this costs no functionality.

The pricing model itself is unchanged since 1 July 2025. Meta charges per delivered message, by category (marketing, utility, authentication, service, Meta Business Agent) and by the recipient's country calling code. Messages from users to the business are never charged [Meta – Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: High, tier: Primary). Non-template messages, which include text, image and interactive replies, can only be sent while the 24-hour customer service window is open. Each user message opens or resets that window. The only other free case is the free entry point window, which opens only when a user arrives from a Click-to-WhatsApp ad, so it does not apply to Campus Recall.

### India rate card (effective 1 October 2026)

I downloaded Meta's official INR and USD list-rate cards from the pricing page; they are xlsx files despite the `.csv` link label. They give these per-delivered-message rates for recipients with a +91 number:

| Category (India market) | INR list rate | USD list rate |
| --- | --- | --- |
| Marketing | ₹0.8631 | $0.0118 |
| Utility | ₹0.115 | $0.0014 |
| Authentication | ₹0.115 | $0.0014 |
| Authentication-International | ₹2.4971 | $0.0304 |
| Service (after 1,000 free per number per month) | ₹0.115 | $0.0014 |
| Meta Business Agent | $2.00 per 1M tokens | $2.00 per 1M tokens |

Source: [Meta INR and USD rate cards, linked from the pricing page](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rate-cards-and-volume-tiers) (accessed 2026-11-10, confidence: High, tier: Primary). The ₹0.8631 marketing and ₹0.115 utility, authentication and service rates also appear in [MyOperator](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026) and [Beebom](https://gadgets.beebom.com/news/whatsapp-stopping-messages-from-select-business-accounts-starting-october-2026).

India volume-tier discounts apply only to utility and authentication messages. They start at 25,000,001 utility messages a month, where the rate drops to ₹0.1081, which is far beyond this project's scale (Meta INR volume-tier card, same source). All Meta rates exclude tax. According to [Beebom](https://gadgets.beebom.com/news/whatsapp-stopping-messages-from-select-business-accounts-starting-october-2026), 18% GST makes ₹0.115 about ₹0.136 per message. MyOperator also says the 18% GST applies to Meta charges and BSP fees, and that only GST-registered businesses can claim input tax credit (confidence: Medium, tier: Established/Low). A student team is unlikely to be GST-registered, so this suggests budgeting at the GST-inclusive rate.

Meta changed India rates twice in 2026. On 1 January 2026 the India marketing rate went up. On 1 April 2026 the India authentication-international rate went up. Neither India utility/service nor marketing changed on 1 July or 1 October 2026 [Meta – Pricing, "Prior updates"](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: High, tier: Primary). MyOperator puts the January marketing increase at about 10%, from ₹0.7846 to ₹0.8631 (confidence: Medium, tier: Low). Meta's published pricing calendar says it changes rates only on 1 January, 1 April, 1 July or 1 October, with at least one month's notice for rate changes and six months' notice for model changes (same Primary source). The next possible change is therefore 1 January 2027.

A second India deadline matters for a direct Meta account. Billing localisation for India launched on 1 January 2026. Eligible customers whose Sold-To country in Billing Hub is India must move all Messaging accounts to INR by 31 December 2026. From 1 January 2027 Meta "will no longer deliver the messages of non-INR Messaging accounts of eligible customers" [Meta – Pricing, "Billing localization for India"](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary). This implies that a new Messaging account created by an Indian team should choose INR at creation, since Meta says currency "cannot be changed" except through the Currency Migration API.

### Cloud API hosting and receiving media

No source describes any charge for the Cloud API itself, for hosting, or for receiving inbound media. Meta's pricing page lists only per-message charges on business-sent messages and states that user-to-business messages are not charged [Meta – Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary). Third-party guides describe the Cloud API as having no licence or hosting fee, for example [Go4WhatsUp guide](https://www.go4whatsup.com/guides/whatsapp-cloud-api/) and [Hyperleap](https://hyperleap.ai/whatsapp-business-api/cloud-api) (accessed 2026-11-10, confidence: Low, tier: Low). I conclude that downloading a student's photo or PDF through the Media API costs nothing from Meta. Only the bot's reply is billed.

Extra finding that affects the storage design: Meta's media documentation sets these inbound limits [Meta – Media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media) (accessed 2026-11-10, confidence: Medium, tier: Primary).

- Size caps: images 5 MB, audio and voice notes 16 MB, video 16 MB, documents including PDFs 100 MB.
- Media IDs in webhooks expire after 7 days.
- Media download URLs expire after 5 minutes.

The bot should therefore copy media into Azure storage as soon as the webhook arrives.

### Payment method on the Meta account

A payment method is now effectively required for production use, even if all traffic is service replies. Meta's free-tier section says that without a payment method, "Meta will deliver service messages within the free tier but not deliver them after the free tier has been used." Its 1 October 2026 notice warns that accounts with no payment method by 30 September 2026 would have service messages stopped once they became chargeable [Meta – Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (accessed 2026-11-10, confidence: High, tier: Primary). Beebom reported on 1 October 2026 that service messages were blocked for Business Platform accounts with no payment method on file, which corroborates this (confidence: High, tier: Established).

A team under 1,000 replies a month could run without a card, but message 1,001 onward would silently fail to deliver. Meta's test resources are the exception: the automatically created test business number and test Messaging account "don't require a payment method on file in order to send template messages" [Meta – About the platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform) (accessed 2026-11-10, confidence: Medium, tier: Primary). Meta's older get-started guide, as surfaced in search, limits the test number to "up to 5 recipient phone numbers" [Meta – Cloud API Get Started (legacy URL)](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/) (accessed 2026-11-10, confidence: Low, tier: Primary). I could not find that figure in the current version of the page, so treat it as unconfirmed. Either way, the test number suits a team demo, not 20 to 500 students.

No sources found for which payment instruments Meta Billing Hub accepts for WhatsApp in India, such as UPI, debit card or prepaid. The Meta help article on India billing localisation did not render its body text.

### What Business Solution Providers charge on top

**Twilio.** According to [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing) (accessed 2026-11-10, "pricing current as of September 2026", confidence: Medium, tier: Primary), "Twilio's per-message fee for WhatsApp is $0.005, inbound or outbound." Twilio also passes Meta's per-message fees through, and its calculator footnote mentions the monthly free service tier. Other details from the same page:

- Failed messages cost $0.001 each.
- There is no monthly WhatsApp fee.
- A free trial needs no credit card.

The inbound charge matters for this use case. Every photo or PDF a student sends costs $0.005 on Twilio, while it costs nothing on Meta direct. The pricing page shows no India-specific Meta fee, and its calculator defaulted to US rates. I assume Twilio passes through Meta's India USD rate of $0.0014 (Low confidence, inferred).

**Twilio WhatsApp Sandbox.** [Twilio Sandbox docs](https://www.twilio.com/docs/whatsapp/sandbox) (accessed 2026-11-10, confidence: Medium, tier: Primary) describe these rules:

- Several users can join one sandbox, but each must send `join <sandbox code>` to the shared Twilio-branded number.
- "The Sandbox session expires three days after joining", which is the "72 hours" often quoted, and users must then rejoin.
- The sandbox number can send only "one message every three seconds".
- It can message only users who have joined (error 63015 otherwise).
- It cannot use custom templates.
- Twilio says "don't use it in a production environment."
- Sandbox messages are billed at standard Twilio WhatsApp rates. Trial accounts get 100 free WhatsApp messages.

This suggests the sandbox is fine for a 3 to 5 person team demo. The three-day rejoin and the one-message-per-three-seconds throughput make it unworkable for a cohort of students.

**Gupshup.** According to [Gupshup self-serve pricing](https://www.gupshup.ai/channels/self-serve/whatsapp/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary), Gupshup charges "a standard 0.001 USD per message fee" on template and session messages, including incoming session text, and passes Meta fees through. It notes that the first 1,000 service messages are free of WhatsApp fees. No monthly fee or free credit is stated, and India Meta amounts did not render on the page.

**Interakt.** According to [Interakt pricing](https://www.interakt.shop/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary, India vendor, prices excl. tax), the Growth plan costs ₹2,799 a month and Advanced ₹3,799 a month. Its per-message service and utility rates are ₹0.127 to ₹0.129 and ₹0.140 to ₹0.160, compared with Meta's ₹0.115. The 1,000 free service messages are passed on. Only the Advanced plan lists an "Incoming Messages" webhook, which this bot needs to receive student uploads.

**AiSensy.** According to [AiSensy pricing](https://aisensy.com/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary, vendor), from 1 October 2026 AiSensy charges ₹1.09 for marketing and ₹0.145 for utility, authentication and service messages (service after 1,000 free). It mentions a "Free Forever plan", but card prices and plan-level webhook availability did not render.

**WATI.** According to [WATI pricing](https://www.wati.io/pricing/) (accessed 2026-11-10, confidence: Medium, tier: Primary), plans billed quarterly cost ₹2,699 a month (Growth, no webhooks), ₹5,799 a month (Pro, "limited" webhooks) and ₹16,799 a month (Business). There is a 7-day free trial. India per-message rates are on a separate rate card I did not retrieve.

**360dialog.** According to [360dialog pricing](https://360dialog.com/pricing) (accessed 2026-11-10, confidence: Medium, tier: Primary), licences cost €49 a month per number (Regular), €99 (Premium) or €500 (Scale), with Meta fees billed separately. The page metadata says there is "no markup on Meta fees". No free sandbox or trial is stated on the page.

**Meta direct (Cloud API).** There is no BSP fee or markup. You pay only Meta's rate card plus GST, in INR (sources above). The trade-off is that the team must run its own webhook endpoint and do Meta Business verification and phone-number registration itself. This is analysis, not a sourced cost.

For a bot that must receive inbound media by webhook, the India-focused SaaS BSPs (Interakt, WATI, AiSensy) put that feature in higher-priced tiers costing ₹2,800 to ₹5,800 a month. This suggests their marketing dashboards add cost without adding value for Campus Recall. Meta direct is cheapest, with Gupshup's $0.001 per message the cheapest intermediary.

### Worked monthly cost estimate (my own estimate)

These are my assumptions, not sourced:

- 52/12 weeks per month.
- Every student message gets exactly one non-template service reply.
- All students have +91 numbers.
- No templates are sent.
- One business phone number.

Meta figures use the October 2026 India list rates above. The INR column adds 18% GST. Twilio adds $0.005 on every inbound and outbound message on top of Meta's USD rate. INR conversions of USD use an assumed ₹88 per USD, which I did not source.

| Scenario | Inbound/month | Replies/month | Charged replies (after 1,000 free) | Meta direct (INR, incl. 18% GST) | Meta direct (USD, excl. tax) | Twilio (USD, excl. tax) |
| --- | --- | --- | --- | --- | --- | --- |
| Small: 20 students × 5/week | ~433 | ~433 | 0 | ₹0 | $0 | ~$4.33 (≈₹380) |
| Medium: 100 students × 15/week | ~6,500 | ~6,500 | 5,500 | ~₹746 | ~$7.70 | ~$72.70 (≈₹6,400) |
| Large: 500 students × 30/week | ~65,000 | ~65,000 | 64,000 | ~₹8,685 | ~$89.60 | ~$739.60 (≈₹65,100) |

If the bot sends two replies per upload, say a "saved" confirmation and then a result, the large case roughly doubles. Meta direct becomes about ₹17,500 including GST. Twilio becomes about $975 in Twilio fees plus about $181 in Meta fees, roughly $1,156.

This implies that Twilio's flat $0.005 per message, charged on inbound too, costs about eight times Meta's own India service rate at every scale. Meta direct stays free below about 1,000 replies a month, which is roughly 50 active students at 5 messages a week.

The cheapest designs follow from this:

- Send one reply per user action.
- Batch acknowledgements when a student sends an album, which arrives as several inbound messages.
- Avoid utility templates inside the window, because they are charged from the first message.

### Comparison: Telegram Bot API

According to the [Telegram Bots FAQ](https://core.telegram.org/bots/faq) (accessed 2026-11-10, confidence: Medium, tier: Primary), "by default, bots are able to message their users at no cost." Telegram's paid element is optional "paid broadcasts" above about 30 messages per second, at 0.1 Stars per extra message. Enabling them requires 100,000 Stars and 100,000 monthly active users, which is irrelevant here. The documented rate limits are about one message per second per chat and 20 messages per minute in groups.

The [Telegram Bot API reference](https://core.telegram.org/bots/api) (accessed 2026-11-10, latest changelog Bot API 10.4 dated 9 November 2026, confidence: Medium, tier: Primary) sets these file limits:

- On Telegram's cloud Bot API server, "The maximum file size to download is 20 MB".
- Bots can send files of up to 50 MB (photos 10 MB via upload).
- A self-hosted local Bot API server lets a bot "Download files without a size limit" and "Upload files up to 2000 MB".

For Campus Recall, Telegram costs ₹0 in messaging at any of the scenarios above. Its 20 MB inbound cap on the cloud server is lower than WhatsApp's 100 MB for documents, but a local Bot API server removes it. Weighing reach against cost is a product decision. WhatsApp's reach among Indian students is not covered by this axis.

### Extra finding: AI-provider and general-purpose-assistant policy

Meta's pricing page links an "AI Providers" policy tied to the WhatsApp terms update of 15 January 2026. That policy covers "providers and developers of artificial intelligence or machine learning technologies", including LLM and general-purpose assistant providers. It says AI Providers are "only permitted to offer general-purpose AI assistants" where Meta is legally required to permit this, and they have a separate service-message charging scheme [Meta – AI Providers pricing policy](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers) (accessed 2026-11-10, confidence: Medium, tier: Primary).

Campus Recall is a task-specific save-and-search bot with on-device ranking, so it is most likely not an "AI Provider" (inference, Low confidence). The team should avoid positioning the WhatsApp bot as a general chat assistant.

Meta also exempts eligible government and community non-profit organisations from service charges beyond the free tier until 31 December 2027 (same pricing page). Universities are not listed among eligible organisations. Whether IIT Gandhinagar would qualify is unknown, and no sources were found for that.

> Conflicts noted:
>
> - The task premise and older 2025 blogs say service replies and in-window utility templates are free. Meta's primary pricing page says both became chargeable on 1 October 2026, with 1,000 free service messages per number per month. I used Meta's current figures.
> - For the India service rate, Meta's rate card says ₹0.115, Beebom says ₹0.136 and AiSensy says ₹0.145. Beebom's ₹0.136 is the same rate with 18% GST added. AiSensy's ₹0.145, and Interakt's ₹0.127 to ₹0.129, are reseller prices with markup. I used the Meta list rate.
> - On the Twilio sandbox, "72 hours" in third-party write-ups and "three days" in Twilio's docs mean the same thing.
> - A web-search summary mentioned a guide listing India utility at about ₹0.35 and marketing at about ₹0.90. I could not verify it, and it conflicts with Meta's rate card, so I treated it as outdated and excluded it.
>
> Gaps:
>
> - No sources found for the payment methods (UPI, debit card, prepaid) that Meta Billing Hub accepts for Indian WhatsApp accounts.
> - Twilio's India-specific Meta pass-through rate and whether Twilio charges Indian customers GST could not be confirmed.
> - Gupshup's and WATI's India Meta-fee tables did not render.
> - AiSensy's free plan limits and whether it includes webhooks are not confirmed.
> - Whether a university project qualifies for Meta's non-profit exemption is unknown.
> - The "up to 5 recipients" limit on Meta's test number appears only in the legacy get-started page surfaced by search, not in the current page.
> - All Twilio, BSP and Meta figures are dated 2025 to 2026. No pre-2025 figure is relied on.
