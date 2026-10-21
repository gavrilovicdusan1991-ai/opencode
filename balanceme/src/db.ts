import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"

mkdirSync("data", { recursive: true })

const db = new Database("data/balanceme.sqlite", { create: true, strict: true })
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA foreign_keys = ON")
db.run(`CREATE TABLE IF NOT EXISTS post (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`)
db.run(`CREATE TABLE IF NOT EXISTS comment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)

export type Post = {
  id: number
  author: string
  topic: string
  title: string
  body: string
  likes: number
  created_at: number
  comment_count: number
}

export type Comment = {
  id: number
  post_id: number
  author: string
  body: string
  created_at: number
}

const POST_COLUMNS = `post.*, (SELECT COUNT(*) FROM comment WHERE comment.post_id = post.id) AS comment_count`

export function listPosts(topic?: string) {
  if (topic) {
    return db
      .query<Post, [string]>(`SELECT ${POST_COLUMNS} FROM post WHERE topic = ? ORDER BY created_at DESC LIMIT 100`)
      .all(topic)
  }
  return db.query<Post, []>(`SELECT ${POST_COLUMNS} FROM post ORDER BY created_at DESC LIMIT 100`).all()
}

export function getPost(id: number) {
  const post = db.query<Post, [number]>(`SELECT ${POST_COLUMNS} FROM post WHERE id = ?`).get(id)
  if (!post) return
  const comments = db
    .query<Comment, [number]>("SELECT * FROM comment WHERE post_id = ? ORDER BY created_at ASC")
    .all(id)
  return { ...post, comments }
}

export function createPost(input: { author: string; topic: string; title: string; body: string }) {
  return db
    .query<{ id: number }, [string, string, string, string, number]>(
      "INSERT INTO post (author, topic, title, body, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .get(input.author, input.topic, input.title, input.body, Date.now())!
}

export function createComment(input: { post_id: number; author: string; body: string }) {
  return db
    .query<Comment, [number, string, string, number]>(
      "INSERT INTO comment (post_id, author, body, created_at) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .get(input.post_id, input.author, input.body, Date.now())!
}

export function likePost(id: number) {
  return db.query<{ likes: number }, [number]>("UPDATE post SET likes = likes + 1 WHERE id = ? RETURNING likes").get(id)
}
