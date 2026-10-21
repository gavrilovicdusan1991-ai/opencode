import { readdir } from "node:fs/promises"
import path from "node:path"

export type Passage = {
  source: string
  text: string
}

// The single seam for plugging in a medical institution's knowledge base.
// Replace `localKnowledgeBase` with an implementation that queries the
// institution's search API / vector store and returns the most relevant passages.
export type KnowledgeBase = {
  search(query: string, limit: number): Promise<Passage[]>
}

// Naive keyword retrieval over .md/.txt files in KNOWLEDGE_DIR, split into
// paragraphs. Good enough for a prototype; swap it out for real retrieval.
export function localKnowledgeBase(dir: string): KnowledgeBase {
  const passages = loadPassages(dir)
  return {
    async search(query, limit) {
      const terms = tokenize(query)
      if (terms.length === 0) return []
      return (await passages)
        .map((passage) => ({ passage, score: score(terms, passage.text) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.passage)
    },
  }
}

async function loadPassages(dir: string) {
  const files = await readdir(dir).catch(() => [])
  const loaded = await Promise.all(
    files
      .filter((file) => file.endsWith(".md") || file.endsWith(".txt"))
      .map(async (file) => {
        const text = await Bun.file(path.join(dir, file)).text()
        return text
          .split(/\n\s*\n/)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.length > 40)
          .map((chunk) => ({ source: file, text: chunk }))
      }),
  )
  return loaded.flat()
}

function tokenize(text: string) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
}

function score(terms: string[], text: string) {
  const lower = text.toLowerCase()
  return terms.filter((term) => lower.includes(term)).length
}
