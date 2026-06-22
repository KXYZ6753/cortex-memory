import { processText } from './ollama.js'

const sample = `Confirming the dentist next Tuesday at 3pm.
Also car insurance is due Friday.`

const result = await processText(sample)
console.log(result)