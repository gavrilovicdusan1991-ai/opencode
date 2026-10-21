# BalanceMe

*Your health · your overview · your everyday.*

BalanceMe is a web app for young and older people living with chronic illness. It has two core features:

1. **Ask AI** – describe symptoms, test results, medication or everyday struggles and get a careful second opinion from Claude, streamed live. Answers can draw on a medical knowledge base (see below).
2. **Community** – people publish posts by topic (Pain, Fatigue, Mental health, Medication, …), comment on each other's posts and leave hearts.

The home screen also has a daily mood check-in (stored only in the browser).

## Running it

Requires [Bun](https://bun.sh) 1.2+ and a Claude API key.

```sh
cd balanceme
bun install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
bun run start          # http://localhost:3000
```

Use `bun run dev` to restart automatically on changes. Community data is stored in `data/balanceme.sqlite`.

## Connecting a medical knowledge base

All retrieval goes through one interface in `src/knowledge.ts`:

```ts
type KnowledgeBase = {
  search(query: string, limit: number): Promise<Passage[]> // { source, text }
}
```

Today `localKnowledgeBase()` does simple keyword matching over the `.md`/`.txt` files in `KNOWLEDGE_DIR`
(default `./knowledge`, which contains one sample file). To connect the institution's knowledge base, write a
`KnowledgeBase` that calls its search API or vector store and pass it in `src/server.ts` instead. The top passages
for each question are given to the model, which prefers them over general knowledge and names the source it used.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Bun HTTP server: static files + JSON API |
| `src/ai.ts` | Claude call (system prompt, knowledge context, streaming) |
| `src/knowledge.ts` | Knowledge-base interface and the local file implementation |
| `src/db.ts` | SQLite storage for posts and comments |
| `public/` | Front end (plain HTML/CSS/JS, no build step) |

### API

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/api/ask` | `{ messages: [{ role, content }] }` → server-sent events `text`, `refusal`, `error`, `done` |
| `GET` | `/api/posts?topic=` | – |
| `POST` | `/api/posts` | `{ author, topic, title, body }` |
| `GET` | `/api/posts/:id` | – (post with comments) |
| `POST` | `/api/posts/:id/comments` | `{ author, body }` |
| `POST` | `/api/posts/:id/like` | – |

## Before going to production

This is a prototype. Before real patients use it, plan for:

- **Accounts and moderation** – anyone can post under any name today; add login, reporting and moderation.
- **Privacy** – health data is sensitive (GDPR special category). Chat history lives only in the user's browser and is sent to the Claude API per question; review data-processing agreements and retention.
- **Medical review** – have clinicians review the system prompt in `src/ai.ts` and the knowledge content.
- **Rate limiting** on `/api/ask` to control cost and abuse.
