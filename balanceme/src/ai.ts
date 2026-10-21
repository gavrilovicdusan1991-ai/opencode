import Anthropic from "@anthropic-ai/sdk"
import type { KnowledgeBase } from "./knowledge"

const client = new Anthropic()

const SYSTEM = `You are the BalanceMe health assistant. BalanceMe is an app for young and older people living with chronic illness.

Your job is to give a clear, careful, well-reasoned second opinion on the medical questions people bring you: explain what their symptoms or results could mean, which possibilities are more or less likely, what they can do themselves, and what to ask their doctor.

- Be warm and plain-spoken. Many users are tired or worried; keep answers focused and readable, using short paragraphs or brief lists.
- You are not the user's doctor and cannot examine them. Say so briefly when it matters for the answer, not as boilerplate on every message.
- If anything suggests an emergency (chest pain, trouble breathing, stroke signs, severe bleeding, suicidal thoughts, etc.), tell them to contact emergency services right away before anything else.
- Never tell someone to stop or change prescribed medication on their own; tell them to discuss it with their prescriber.
- When <knowledge_base> passages are provided, prefer them over general knowledge and mention the source file name when you rely on one. If they don't cover the question, say you are answering from general medical knowledge.
- Ask a short follow-up question when key details are missing (age, duration, existing diagnoses, medication).`

export async function askStream(messages: Anthropic.Beta.BetaMessageParam[], knowledge: KnowledgeBase) {
  const question = messages.at(-1)
  const passages =
    question && typeof question.content === "string" ? await knowledge.search(question.content, 5) : []
  const context = passages.length
    ? `<knowledge_base>\n${passages.map((p) => `<passage source="${p.source}">\n${p.text}\n</passage>`).join("\n")}\n</knowledge_base>`
    : undefined

  return client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium" },
    // Health questions can trip safety classifiers; let the API retry on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: context ? [...messages, { role: "system", content: context }] : messages,
  })
}
