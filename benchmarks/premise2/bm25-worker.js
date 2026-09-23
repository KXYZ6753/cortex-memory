// Worker thread for Bm25Pool: one read-only connection, answers search requests.

import { parentPort, workerData } from "node:worker_threads"
import { openBm25 } from "./bm25.js"

const index = openBm25(workerData.dbPath, workerData.options)

parentPort.on("message", ({ id, query, k, user }) => {
    try {
        parentPort.postMessage({ id, results: index.search(query, k, user) })
    } catch (error) {
        parentPort.postMessage({ id, error: error.message })
    }
})
