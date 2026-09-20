import { createInterface } from 'node:readline/promises'
import { styleText } from 'node:util'
import { createEntry } from './entries.js'
import { search } from './search.js'

const dim = s => styleText('dim', s)
const bold = s => styleText('bold', s)

const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.on('SIGINT', () => rl.close())

console.log(`${bold('cortex')} ${dim('— type to search, "add <text>" to save, ctrl-c to quit ("exit" or "quit")')}`)

while (true) {
    let line
    try { line = (await rl.question(styleText('cyan', '\n› '))).trim() }
    catch { break }                       // ctrl-c / EOF
    if (!line) continue
    if (line === 'exit' || line === 'quit') break

    try {
        if (line.startsWith('add ')) {
            const entry = await createEntry({ content: line.slice(4).trim(), source: 'cli' })
            console.log(styleText('green', '✓ saved ') + dim('#' + entry.id))
        } else {
            const hits = await search(line)
            if (!hits.length) { console.log(dim('  no matches')); continue }
            for (const h of hits) {
                const stars = '★'.repeat(h.importance) + dim('☆'.repeat(5 - h.importance))
                console.log(`${stars}  ${bold(h.summary)}`)
                console.log(dim(`   ${h.source} · ${h.tags.join(', ')} · ${h.distance.toFixed(3)}`))
            }
        }
    } catch (err) {
        console.log(styleText('red', '  ✗ ' + err.message))
    }
}
rl.close()
process.exit(0)
