import assert from "node:assert/strict"
import test from "node:test"
import {
    ABSTAIN,
    buildT1,
    buildT1Floor,
    buildT2,
    isAbstain,
    TEMPLATE_HASH,
    tokenUpperBound,
} from "../../benchmarks/premise2/prompts.js"

// copied from V1 premiseBenchmark.js buildAnswerPrompt; must stay identical
// (benchmarks/premiseBenchmark.js, around line 449)
function v1BuildAnswerPrompt(question, emails) {
    const block = emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")
    return `You answer questions about a person's email archive using only the emails below.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- Copy names, dates, numbers and amounts exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: NOT IN EMAILS

Emails:
<<<EMAILS
${block}
EMAILS>>>

Question: ${question}
Answer:`
}

// copied from V1 premiseBenchmark.js buildNoContextPrompt (the V1 floor prompt);
// must stay identical (benchmarks/premiseBenchmark.js, around line 468)
function v1BuildNoContextPrompt(question) {
    return `You answer questions about a person's email archive. You have not been given any emails.

Rules:
- Answer with one short sentence. No preamble, no explanation, no restating the question.
- If you do not know the answer, reply with exactly: NOT IN EMAILS

Question: ${question}
Answer:`
}

// ---------------------------------------------------------------------------
// buildT1 / buildT1Floor must be byte-identical to their V1 counterparts
// ---------------------------------------------------------------------------

test("buildT1 is byte-identical to V1's buildAnswerPrompt across several inputs", () => {
    const cases = [
        ["What is the deadline?", ["Email body one."]],
        ["Who sent the report, and when?", ["Email A content here.", "Email B content here.", "Email C content here."]],
        ["", []],
        ["Special chars: <<<EMAILS>>> and [1]", ["Nested [1]\nEmail with its own brackets."]],
    ]
    for (const [question, emails] of cases) {
        assert.equal(buildT1(question, emails), v1BuildAnswerPrompt(question, emails))
    }
})

test("buildT1Floor is byte-identical to V1's buildNoContextPrompt", () => {
    for (const question of ["What time is the meeting?", "", "Multi\nline question?"]) {
        assert.equal(buildT1Floor(question), v1BuildNoContextPrompt(question))
    }
})

// ---------------------------------------------------------------------------
// buildT2: primary template
// ---------------------------------------------------------------------------

test("buildT2 includes the abstain marker and the question", () => {
    const prompt = buildT2("What is the deadline?", ["Email one."])
    assert.ok(prompt.includes("NOT IN EMAILS"))
    assert.ok(prompt.includes("Question: What is the deadline?"))
    assert.ok(prompt.endsWith("Answer:"))
})

test("buildT2 includes every email's content", () => {
    const prompt = buildT2("Q?", ["First email body.", "Second email body."])
    assert.ok(prompt.includes("First email body."))
    assert.ok(prompt.includes("Second email body."))
})

// ---------------------------------------------------------------------------
// buildT2 'null' variant: differs only in delimiter/label text, never in the
// question or the email content.
// ---------------------------------------------------------------------------

test("buildT2 'null' variant uses different delimiters/labels but the same rules, question and email content", () => {
    const question = "What is the deadline, exactly?"
    const emails = ["First email body with detail A.", "Second email body with detail B."]
    const standard = buildT2(question, emails, "standard")
    const nullVariant = buildT2(question, emails, "null")

    // The intro + rules block (everything up to "Emails:\n") is untouched by the variant.
    const introEnd = standard.indexOf("Emails:\n")
    assert.ok(introEnd > 0)
    assert.equal(standard.slice(0, introEnd), nullVariant.slice(0, introEnd))

    // The "Question: ...\nAnswer:" tail is untouched by the variant.
    const standardTail = standard.slice(standard.indexOf("\nQuestion:"))
    const nullTail = nullVariant.slice(nullVariant.indexOf("\nQuestion:"))
    assert.equal(standardTail, nullTail)

    // Both variants carry the same email content...
    for (const email of emails) {
        assert.ok(standard.includes(email))
        assert.ok(nullVariant.includes(email))
    }
    // ...but the delimiter/label text differs, and only that.
    assert.ok(standard.includes("<<<EMAILS") && standard.includes("[1]\n"))
    assert.ok(!standard.includes("<<<MAILS") && !standard.includes("Email 1:"))
    assert.ok(nullVariant.includes("<<<MAILS") && nullVariant.includes("Email 1:"))
    assert.ok(!nullVariant.includes("<<<EMAILS") && !nullVariant.includes("[1]\n"))
    assert.notEqual(standard, nullVariant)
})

// ---------------------------------------------------------------------------
// tokenUpperBound
// ---------------------------------------------------------------------------

test("tokenUpperBound is always >= chars / 2.2", () => {
    for (const text of ["short", "a".repeat(220), "x".repeat(15_000), ""]) {
        assert.ok(tokenUpperBound(text) >= text.length / 2.2, `tokenUpperBound(${text.length} chars) = ${tokenUpperBound(text)}`)
    }
})

// ---------------------------------------------------------------------------
// isAbstain
// ---------------------------------------------------------------------------

test("isAbstain recognises the exact marker and is tolerant of case/trailing punctuation", () => {
    assert.equal(isAbstain(ABSTAIN), true)
    assert.equal(isAbstain("NOT IN EMAILS"), true)
    assert.equal(isAbstain("not in emails."), true)
    assert.equal(isAbstain("Not In Emails!"), true)
    assert.equal(isAbstain("  NOT IN EMAILS  "), true)
})

test("isAbstain is false for a normal answer", () => {
    assert.equal(isAbstain("The deadline is May 10, 2001."), false)
    assert.equal(isAbstain("NOT IN EMAILS, but here's a guess anyway"), false)
    assert.equal(isAbstain(""), false)
})

// ---------------------------------------------------------------------------
// TEMPLATE_HASH
// ---------------------------------------------------------------------------

test("TEMPLATE_HASH is a stable 64-char hex string", () => {
    assert.equal(typeof TEMPLATE_HASH, "string")
    assert.match(TEMPLATE_HASH, /^[0-9a-f]{64}$/)
})
