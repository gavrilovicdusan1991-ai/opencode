import Anthropic from "@anthropic-ai/sdk"
import path from "node:path"
import { askStream } from "./ai"
import { createComment, createPost, getPost, likePost, listPosts } from "./db"
import { localKnowledgeBase } from "./knowledge"

const knowledge = localKnowledgeBase(process.env.KNOWLEDGE_DIR ?? "./knowledge")
const PUBLIC = path.resolve(import.meta.dir, "../public")
const TOPICS = ["General", "Pain", "Fatigue", "Mental health", "Medication", "Everyday life"]

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 255,
  routes: {
    "/api/topics": () => Response.json(TOPICS),

    "/api/ask": {
      POST: async (req) => {
        const messages = readConversation(await req.json().catch(() => undefined))
        if (!messages) return error("Send { messages: [{ role, content }] } ending with a user message.")
        const stream = await askStream(messages, knowledge)
        return sse(stream)
      },
    },

    "/api/posts": {
      GET: (req) => Response.json(listPosts(new URL(req.url).searchParams.get("topic") ?? undefined)),
      POST: async (req) => {
        const body = await req.json().catch(() => ({}))
        const author = text(body.author, 40)
        const title = text(body.title, 140)
        const content = text(body.body, 4000)
        const topic = TOPICS.includes(body.topic) ? body.topic : "General"
        if (!author || !title || !content) return error("Name, title and text are required.")
        return Response.json(createPost({ author, topic, title, body: content }), { status: 201 })
      },
    },

    "/api/posts/:id": (req) => {
      const post = getPost(Number(req.params.id))
      if (!post) return error("Post not found.", 404)
      return Response.json(post)
    },

    "/api/posts/:id/comments": {
      POST: async (req) => {
        const id = Number(req.params.id)
        if (!getPost(id)) return error("Post not found.", 404)
        const body = await req.json().catch(() => ({}))
        const author = text(body.author, 40)
        const content = text(body.body, 2000)
        if (!author || !content) return error("Name and comment are required.")
        return Response.json(createComment({ post_id: id, author, body: content }), { status: 201 })
      },
    },

    "/api/posts/:id/like": {
      POST: (req) => {
        const result = likePost(Number(req.params.id))
        if (!result) return error("Post not found.", 404)
        return Response.json(result)
      },
    },
  },

  async fetch(req) {
    const pathname = new URL(req.url).pathname
    const file = Bun.file(path.join(PUBLIC, path.normalize(pathname === "/" ? "/index.html" : pathname)))
    if (await file.exists()) return new Response(file)
    return new Response(Bun.file(path.join(PUBLIC, "index.html")))
  },
})

console.log(`BalanceMe running at ${server.url}`)

function readConversation(input: unknown) {
  if (!input || typeof input !== "object" || !("messages" in input) || !Array.isArray(input.messages)) return
  const messages = input.messages
    .slice(-30)
    .filter(
      (m): m is Anthropic.Beta.BetaMessageParam =>
        (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
    )
    .map((m) => ({ role: m.role, content: (m.content as string).slice(0, 8000) }))
  if (messages.length === 0 || messages[0].role !== "user" || messages.at(-1)?.role !== "user") return
  return messages
}

function sse(stream: Awaited<ReturnType<typeof askStream>>) {
  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, event: string, data: unknown) =>
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send(controller, "text", event.delta.text)
            }
          }
          const final = await stream.finalMessage()
          if (final.stop_reason === "refusal") {
            send(controller, "refusal", "I can't help with that question. Please talk to your doctor or clinic.")
          }
          send(controller, "done", {})
        } catch (err) {
          console.error(err)
          send(controller, "error", err instanceof Anthropic.AnthropicError ? err.message : "The AI service is unavailable.")
        }
        controller.close()
      },
      cancel() {
        stream.abort()
      },
    }),
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
  )
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}
