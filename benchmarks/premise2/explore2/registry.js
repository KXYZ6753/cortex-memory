// Variant registry for exploration phase 2: the frozen explore/ variants plus every
// module in explore2/variants/*.js (each exports VARIANTS; ids must be unique).
// explore/ is imported, never edited, so PREREG-EXPLORE.md's code hash still holds.

import { readdirSync } from "node:fs"
import { VARIANTS as BASE } from "../explore/variants.js"

export async function loadVariants() {
    const all = { ...BASE }
    const dir = new URL("./variants/", import.meta.url)
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".js")).sort()) {
        const module = await import(new URL(file, dir))
        for (const [id, variant] of Object.entries(module.VARIANTS ?? {})) {
            if (all[id]) throw new Error(`variant id ${id} in ${file} is already defined`)
            all[id] = { ...variant, file }
        }
    }
    return all
}
