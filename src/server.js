import express from 'express'
import { createEntry } from './entries.js'
import { search } from './search.js'

const app = express()
app.use(express.json())

// --- Live endpoints -------------------------------------------------------

// Cloud health checks hit this.
app.get('/health', (req, res) => res.json({ ok: true }))

// Save a new memory. Body is passed straight to createEntry (see its
// "connector contract" in entries.js — only `content` is required).
app.post('/entries', async (req, res) => {
    if (!req.body?.content) return res.status(400).json({ error: 'content is required' })
    const entry = await createEntry(req.body)
    res.status(201).json(entry)
})

// Semantic search: /search?q=dentist&k=5
app.get('/search', async (req, res) => {
    const { q, k, method } = req.query
    if (!q) return res.status(400).json({ error: 'q is required' })
    res.json(await search(q, Number(k) || 5, method || 'embedding'))
})

// --- Your turn: stubs to fill in -----------------------------------------
// Use the shared prisma client: import { prisma } from './db/client.js'

// GET /entries  — list entries. TODO: add pagination (prisma take/skip or cursor).
// app.get('/entries', async (req, res) => { ... })

// GET /entries/:id — one entry (include events). TODO: 404 when missing.
// app.get('/entries/:id', async (req, res) => { ... })

// GET /events — upcoming events. TODO: where date >= now, orderBy date asc.
// app.get('/events', async (req, res) => { ... })

// DELETE /entries/:id — remove an entry. TODO: delete its events too (or cascade).
// app.delete('/entries/:id', async (req, res) => { ... })

// --- Error handler --------------------------------------------------------
// Express 5 forwards rejected async handlers here automatically, so routes
// above need no try/catch. ponytail: single catch-all, 500 for everything.
app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).json({ error: err.message })
})

// PORT from env + 0.0.0.0 bind = deployable to any PaaS with no code change.
// TODO (optional): handle SIGTERM -> prisma.$disconnect() for clean shutdown.
const port = process.env.PORT || 3000
app.listen(port, '0.0.0.0', () => console.log(`cortex api listening on 0.0.0.0:${port}`))
