const app = document.getElementById("app")

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`balanceme:${key}`)) ?? fallback
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`balanceme:${key}`, JSON.stringify(value))
    } catch {}
  },
}

const routes = [
  [/^#?\/?$/, "home", renderHome],
  [/^#\/ask$/, "ask", renderAsk],
  [/^#\/community$/, "community", renderCommunity],
  [/^#\/community\/(\d+)$/, "community", renderPost],
]

function route() {
  const hash = location.hash
  const [pattern, tab, render] = routes.find(([pattern]) => pattern.test(hash)) ?? routes[0]
  document.querySelectorAll("[data-tab]").forEach((link) => link.classList.toggle("active", link.dataset.tab === tab))
  app.replaceChildren()
  render(...(hash.match(pattern)?.slice(1) ?? []))
  window.scrollTo(0, 0)
}

window.addEventListener("hashchange", route)
route()

function mount(id) {
  app.append(document.getElementById(id).content.cloneNode(true))
}

// ---------- Home ----------

function renderHome() {
  mount("home")
  const notes = {
    great: "Wonderful! Enjoy the good energy today.",
    good: "Glad to hear it. Remember to pace yourself.",
    okay: "An okay day is still a day. Be gentle with yourself.",
    low: "Sorry it's a tough day. The community is here if you want to talk.",
    bad: "That sounds hard. If something worries you, ask the AI or contact your doctor.",
  }
  const today = new Date().toISOString().slice(0, 10)
  const saved = store.get("mood", {})
  const note = app.querySelector(".mood-note")
  const select = (mood) => {
    app.querySelectorAll(".faces button").forEach((b) => b.classList.toggle("selected", b.dataset.mood === mood))
    note.textContent = notes[mood] ?? ""
  }
  if (saved.date === today) select(saved.mood)
  app.querySelectorAll(".faces button").forEach((button) =>
    button.addEventListener("click", () => {
      store.set("mood", { date: today, mood: button.dataset.mood })
      select(button.dataset.mood)
    }),
  )
}

// ---------- Ask AI ----------

function renderAsk() {
  mount("ask")
  const list = app.querySelector("#messages")
  const form = app.querySelector("#ask-form")
  const input = form.elements.q
  const send = form.querySelector("button")
  const suggestions = app.querySelector("#suggestions")
  let history = store.get("chat", [])

  const bubble = (role, text) => {
    const el = document.createElement("div")
    el.className = `msg ${role}`
    el.innerHTML = format(text)
    list.append(el)
    return el
  }

  const draw = () => {
    list.replaceChildren()
    if (history.length === 0) {
      bubble("assistant", "Hi! I'm your BalanceMe assistant. Tell me what's on your mind – symptoms, test results, medication or everyday struggles – and I'll do my best to help you understand it.")
    }
    history.forEach((m) => bubble(m.role, m.content))
    suggestions.hidden = history.length > 0
  }
  draw()

  const ask = async (question) => {
    history.push({ role: "user", content: question })
    store.set("chat", history)
    draw()
    const answer = bubble("assistant", "")
    answer.classList.add("typing")
    answer.scrollIntoView({ behavior: "smooth", block: "end" })
    send.disabled = true

    let text = ""
    let failed = ""
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed")
      for await (const { event, data } of readEvents(res)) {
        if (event === "text") text += data
        if (event === "refusal" || event === "error") failed = data
        answer.classList.toggle("typing", text === "")
        answer.innerHTML = format(text)
      }
    } catch (err) {
      failed = err.message
    }
    send.disabled = false
    answer.classList.remove("typing")

    if (failed && !text) {
      history.pop()
      store.set("chat", history)
      answer.classList.add("error")
      answer.textContent = failed
      return
    }
    history.push({ role: "assistant", content: text })
    store.set("chat", history)
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault()
    const question = input.value.trim()
    if (!question || send.disabled) return
    input.value = ""
    autosize()
    ask(question)
  })
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  const autosize = () => {
    input.style.height = "auto"
    input.style.height = `${input.scrollHeight}px`
  }
  input.addEventListener("input", autosize)
  suggestions.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => ask(b.textContent)))
  app.querySelector("#new-chat").addEventListener("click", () => {
    history = []
    store.set("chat", history)
    draw()
  })
}

async function* readEvents(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    const parts = buffer.split("\n\n")
    buffer = parts.pop()
    for (const part of parts) {
      const event = part.match(/^event: (.*)$/m)?.[1]
      const data = part.match(/^data: (.*)$/m)?.[1]
      if (event && data) yield { event, data: JSON.parse(data) }
    }
  }
}

// Minimal, safe formatting for AI answers: escape HTML, then **bold** and headings.
function format(text) {
  return escape(text)
    .replace(/^#{1,4} (.*)$/gm, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
}

// ---------- Community ----------

async function renderCommunity() {
  mount("community")
  const form = app.querySelector("#post-form")
  const topicsEl = app.querySelector("#topics")
  const postsEl = app.querySelector("#posts")
  const topics = await api("/api/topics")
  let active = ""

  form.elements.topic.append(...topics.map((t) => new Option(t, t)))
  form.elements.author.value = store.get("name", "")

  const chip = (label, value) => {
    const b = document.createElement("button")
    b.textContent = label
    b.classList.toggle("active", value === active)
    b.addEventListener("click", () => {
      active = value
      topicsEl.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b))
      load()
    })
    return b
  }
  topicsEl.append(chip("All", ""), ...topics.map((t) => chip(t, t)))

  const load = async () => {
    const posts = await api(`/api/posts${active ? `?topic=${encodeURIComponent(active)}` : ""}`)
    if (posts.length === 0) {
      postsEl.innerHTML = `<div class="empty"><p class="script big">Be the first to share ♡</p><p>No posts here yet.</p></div>`
      return
    }
    postsEl.replaceChildren(
      ...posts.map((p) => {
        const a = document.createElement("a")
        a.className = "post-card"
        a.href = `#/community/${p.id}`
        a.innerHTML = `
          <div class="meta"><span class="topic">${escape(p.topic)}</span><span>${escape(p.author)} · ${ago(p.created_at)}</span></div>
          <h3>${escape(p.title)}</h3>
          <p>${escape(p.body)}</p>
          <div class="meta stats"><span>♡ ${p.likes}</span><span>💬 ${p.comment_count} comment${p.comment_count === 1 ? "" : "s"}</span></div>`
        return a
      }),
    )
  }
  load()

  app.querySelector("#new-post-btn").addEventListener("click", () => {
    form.hidden = !form.hidden
    if (!form.hidden) form.elements.title.focus()
  })

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(form))
    store.set("name", data.author)
    const created = await api("/api/posts", { method: "POST", body: data })
    location.hash = `#/community/${created.id}`
  })
}

async function renderPost(id) {
  mount("post")
  const body = app.querySelector("#post-body")
  const comments = app.querySelector("#comments")
  const form = app.querySelector("#comment-form")
  form.elements.author.value = store.get("name", "")

  const post = await api(`/api/posts/${id}`).catch(() => undefined)
  if (!post) {
    body.innerHTML = `<p class="empty">This post doesn't exist anymore.</p>`
    form.hidden = true
    return
  }

  const liked = store.get("liked", [])
  body.innerHTML = `
    <div class="meta"><span class="topic">${escape(post.topic)}</span><span>${escape(post.author)} · ${ago(post.created_at)}</span></div>
    <h1>${escape(post.title)}</h1>
    <p>${escape(post.body)}</p>
    <button class="like ${liked.includes(post.id) ? "liked" : ""}">♡ <span>${post.likes}</span></button>`
  const like = body.querySelector(".like")
  like.addEventListener("click", async () => {
    if (store.get("liked", []).includes(post.id)) return
    const result = await api(`/api/posts/${post.id}/like`, { method: "POST" })
    like.querySelector("span").textContent = result.likes
    like.classList.add("liked")
    store.set("liked", [...store.get("liked", []), post.id])
  })

  const comment = (c) => {
    const el = document.createElement("div")
    el.className = "comment"
    el.innerHTML = `<div class="meta"><strong>${escape(c.author)}</strong><span>${ago(c.created_at)}</span></div><p>${escape(c.body)}</p>`
    return el
  }
  const drawEmpty = () => {
    if (comments.children.length === 0) comments.innerHTML = `<p class="muted">No comments yet – share your thoughts or experience.</p>`
  }
  comments.replaceChildren(...post.comments.map(comment))
  drawEmpty()

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(form))
    store.set("name", data.author)
    const created = await api(`/api/posts/${post.id}/comments`, { method: "POST", body: data })
    comments.querySelector("p.muted")?.remove()
    comments.append(comment(created))
    form.elements.body.value = ""
  })
}

// ---------- helpers ----------

async function api(url, options = {}) {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) {
    if (options.method) alert(data.error ?? "Something went wrong.")
    throw new Error(data.error)
  }
  return data
}

function escape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
