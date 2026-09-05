# Synap encryption model

Synap stores a person's daily conversations. This document states plainly what
is protected, what is not, and who can read what — including us.

## The short version

Every piece of conversation content is sealed with **AES-256-GCM** under a
**per-user data encryption key (DEK)**. That DEK is never stored in the clear:
it is wrapped by a **Cloud KMS customer-managed key (CMEK)** and only the
wrapped form is persisted. Plaintext DEKs exist in the backend's memory, for at
most five minutes at a time.

```
conversation content
   ↓ AES-256-GCM, per-user DEK, per-record IV, bound to its location
sealed record  ────────────────────────────►  Firestore / Cloud Storage
   ↑
per-user DEK (32 bytes)
   ↓ Cloud KMS encrypt
wrapped DEK  ──────────────────────────────►  users/{uid}.key.wrappedDek
```

## What each layer buys

**Envelope encryption (the DEK).** A leaked Firestore export, a mis-scoped
bucket read, a stolen backup — none of them yield readable audio, transcripts,
summaries or people's names. They yield ciphertext plus a wrapped key that
cannot be unwrapped without KMS permission on the KEK, which the storage layer
does not have.

**Per-user keys.** There is no master key that opens everyone's memories. A
compromise scoped to one user's data stays scoped to one user.

**AAD binding.** Every ciphertext is bound to the exact place it lives:
`user + scope + field`. Moving a sealed blob from one user's document to
another's, or from `transcript` into `summary`, fails authentication instead of
silently decrypting. This closes the class of bug where a query mixes up
document IDs and quietly serves one person's conversation to another.

**CMEK on the bucket.** Cloud Storage encrypts objects with a key we control,
underneath our own envelope layer. Belt and braces, and it means revoking the
storage key alone bricks raw audio without touching derived memory.

**Deletion as key destruction.** Account deletion drops the wrapped DEK. Every
derived record becomes permanently unreadable at that moment, including anything
already replicated into backups or point-in-time recovery. This is much stronger
than deleting rows and hoping every copy is found.

## What is deliberately not encrypted

The system has to filter, sort and count on some fields, so these stay
plaintext:

| Field | Why | What it reveals |
| --- | --- | --- |
| `day`, `startedAt`, `durationMs` | daily brief, date filtering | that a recording happened, when, how long |
| `state`, `progress` | processing status UI | pipeline stage |
| `sha256`, `bytes` | idempotent uploads | nothing about content |
| `personIds`, `topicKeys` | retrieval prefilters | that two conversations share a person or topic — not who or what |
| `embedding` | Firestore computes vector distance server-side | coarse topical similarity |

The embedding is the one worth thinking hard about. It is derived from a
conversation summary, and while it is not invertible to text, it does leak
topical structure to anyone who can read the collection. Set
`SYNAP_DISABLE_VECTOR_INDEX=1` to stop storing vectors; retrieval falls back to
recency plus structured filters, which is weaker but leaks less.

Nothing in the plaintext set is conversation content. Adding a field to that set
is a decision worth arguing about, not a convenience.

## What this is not

**This is not end-to-end encryption.** The backend decrypts audio to send it to
Gemini for transcription, and decrypts transcripts to extract memory. During
those seconds the content is plaintext in the backend's memory.

That is a real tradeoff, made deliberately. True E2EE would mean the server
could never read a transcript, which would rule out server-side transcription,
retrieval, the daily brief and Ask Synap — every feature that makes this a
second brain rather than an encrypted voice recorder. The alternative would be
doing all inference in the browser, which a phone cannot sustain for an hour of
audio.

So the honest statement is: **Google Cloud cannot read your conversations, and
neither can anyone holding a database dump. The Synap backend can, while it is
processing them.** If a deployment needs stronger guarantees than that, the
options are a hybrid model where raw audio and verbatim transcripts are
client-encrypted and only derived summaries are server-readable, or a
confidential-computing deployment where the processing itself is attested.

## Data sent to Gemini

Audio segments and transcripts are sent to the Gemini AI Studio API for
transcription and memory extraction. Every request sets `store: false`, so no
server-side copy of the interaction state is retained. The API key lives in
Secret Manager and is never sent to the browser.

Before relying on this in production, confirm the current data-use terms for the
AI Studio API tier you are on — free and paid tiers have historically differed
on whether content may be used to improve the service. If that distinction
matters for your users, Vertex AI offers contractual guarantees the AI Studio
API does not.

## Key rotation

The KEK rotates every 90 days by default. Rotation rewraps 32-byte DEKs and
never touches user payloads, so it is cheap and safe to do often. Old key
versions stay enabled so previously wrapped DEKs keep opening; disable them only
after a rewrap pass.

`Keyring.rewrap()` implements the rewrap. There is no rewrap cron in this
version — DEKs stay valid under old KEK versions indefinitely, so this is a
hygiene task rather than an availability one.

## Logs

`util/log.ts` maintains a denylist and redacts any field named `transcript`,
`summary`, `text`, `answer`, `query`, `name`, `email`, `note`, `task`, `quote`,
`audio` or `data`. Infrastructure logs are the easiest place for a second brain
to leak: they are retained longer and replicated more widely than the encrypted
store, and they are readable by anyone with Logs Viewer. Log identifiers and
counts, never content.

## Threat model summary

| Adversary | Outcome |
| --- | --- |
| Reads a Firestore backup or GCS bucket | Ciphertext only |
| Compromises the storage layer's IAM | Ciphertext only; no KMS access |
| Compromises the running backend container | Can decrypt data for as long as they hold it; cannot extract a portable key |
| Google infrastructure insider | Ciphertext, unless they also hold KMS decrypt on the KEK |
| Steals a user's refresh token (XSS on the PWA) | Full access to that user's memories until sign-out; bump `tokenGeneration` to revoke |
| Has the user's unlocked phone | Everything, as with any signed-in app |
