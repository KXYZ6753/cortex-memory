import assert from "node:assert/strict"
import test from "node:test"
import {
    detectHeaderAt,
    headerText,
    isoDate,
    messageText,
    readableName,
    reassemble,
    segmentBody,
    withIsoDate,
    withReadableName,
} from "../../benchmarks/premise2/segment.js"

// Asserts the documented invariant: segmentation tiles the body exactly, so
// reassembling never drops or duplicates a byte of the original.
const losslessCheck = (body) => assert.equal(reassemble(segmentBody(body)), body)

// ---------------------------------------------------------------------------
// segmentBody: one fixture per header style
// ---------------------------------------------------------------------------

test("segmentBody: Outlook '-----Original Message-----' block", () => {
    const body = `Sounds good, let's proceed.

-----Original Message-----
From: Bob Jones
Sent: Monday, May 10, 2001 9:28 AM
To: Alice Smith
Cc: Carol White
Subject: Re: Budget approval

Please review the attached numbers before the call.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].kind, "top")
    assert.equal(messages[1].kind, "outlook")
    assert.deepEqual(messages[1].fields, {
        from: "Bob Jones",
        sent: "Monday, May 10, 2001 9:28 AM",
        to: "Alice Smith",
        cc: "Carol White",
        subject: "Re: Budget approval",
    })
})

test("segmentBody: Lotus two-line 'Name@ECT' / date / To:/cc:/Subject: block", () => {
    const body = `Thanks, will do.

John Doe@ECT
05/10/2001 09:28 AM

To: Jane Smith@ECT
cc: Bob Jones@ECT
Subject: Two-line lotus header test

Original content follows.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].kind, "lotus-two-line")
    assert.deepEqual(messages[1].fields, {
        from: "John Doe@ECT",
        sent: "05/10/2001 09:28 AM",
        to: "Jane Smith@ECT",
        cc: "Bob Jones@ECT",
        subject: "Two-line lotus header test",
    })
})

test("segmentBody: Lotus '---------------------- Forwarded by X on date ----------------------' block", () => {
    const body = `FYI, see below.

---------------------- Forwarded by X/HOU/ECT on 05/10/2001 09:28 AM ---------------------------

Please handle this by Friday.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].kind, "lotus-forward")
    assert.deepEqual(messages[1].fields, { forwardedBy: "X/HOU/ECT", forwardedOn: "05/10/2001 09:28 AM" })
})

test("segmentBody: Lotus 'X on date' reply line", () => {
    const body = `Noted.

Kay Mann on 05/10/2001 09:28:31 AM
To: Jeff Skilling
Subject: Re: something

I will follow up.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].kind, "lotus-reply")
    assert.deepEqual(messages[1].fields, {
        from: "Kay Mann",
        sent: "05/10/2001 09:28:31 AM",
        to: "Jeff Skilling",
        subject: "Re: something",
    })
})

test("segmentBody: bare 'From:' header with no marker line", () => {
    const body = `See thread below.

From: bob@example.com
Sent: Monday, May 10, 2001 9:28 AM
To: alice@example.com
Subject: Bare from test

Body of the bare-from message.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].kind, "outlook-bare")
    assert.deepEqual(messages[1].fields, {
        from: "bob@example.com",
        sent: "Monday, May 10, 2001 9:28 AM",
        to: "alice@example.com",
        subject: "Bare from test",
    })
})

test("segmentBody: headers with leading '> ' quote prefixes are still detected, verbatim", () => {
    const body = `Reply text.

> -----Original Message-----
> From: Bob Jones
> Sent: Monday, May 10, 2001 9:28 AM
> To: Alice Smith
> Subject: Quoted header test
>
> Body text here quoted.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].kind, "outlook")
    assert.deepEqual(messages[1].fields, {
        from: "Bob Jones",
        sent: "Monday, May 10, 2001 9:28 AM",
        to: "Alice Smith",
        subject: "Quoted header test",
    })
    // The '>' prefixes are detection-only normalisation; the rendered header/body
    // text must keep them, since rendering always reads the original line.
    assert.match(headerText(segmentBody(body), segmentBody(body).messages[1]), /^> -----Original Message-----/)
})

test("segmentBody: a plain body with no embedded header yields exactly one message", () => {
    const body = `Just a plain message with no embedded headers at all.
Second line of the body.`
    losslessCheck(body)
    const segmented = segmentBody(body)
    assert.equal(segmented.messages.length, 1)
    assert.equal(segmented.messages[0].kind, "top")
    assert.equal(messageText(segmented, segmented.messages[0]), body)
})

test("segmentBody: multiple embedded messages of different kinds are all found, in order", () => {
    const body = `Top level note.

-----Original Message-----
From: Bob Jones
Sent: Monday, May 10, 2001 9:28 AM
To: Alice Smith
Subject: Combined test

Middle body text.

John Doe@ECT
05/10/2001 09:28 AM

To: Jane Smith@ECT
Subject: Two-line lotus header test

Bottom body text.`
    losslessCheck(body)
    const { messages } = segmentBody(body)
    assert.equal(messages.length, 3)
    assert.deepEqual(messages.map((m) => m.kind), ["top", "outlook", "lotus-two-line"])
    assert.deepEqual(messages.map((m) => m.index), [1, 2, 3])
})

// ---------------------------------------------------------------------------
// reassemble: lossless round-trip on a broader sample, including edge cases
// ---------------------------------------------------------------------------

test("reassemble is lossless for an empty body and a body that is only a header block", () => {
    losslessCheck("")
    losslessCheck(`-----Original Message-----
From: Bob Jones
Sent: Monday, May 10, 2001 9:28 AM
To: Alice Smith
Subject: Only a header`)
})

test("detectHeaderAt returns null on an ordinary body line", () => {
    const lines = ["Hi there,", "Just checking in.", "Thanks,", "Bob"]
    assert.equal(detectHeaderAt(lines, 0), null)
    assert.equal(detectHeaderAt(lines, 1), null)
})

// ---------------------------------------------------------------------------
// readableName / withReadableName
// ---------------------------------------------------------------------------

test("readableName: 'Last, First' form", () => {
    assert.equal(readableName("Doe, John"), "John Doe")
})

test("readableName: dotted email-local form", () => {
    assert.equal(readableName("john.q.public@enron.com"), "John Q. Public")
    assert.equal(readableName("jane.doe@enron.com"), "Jane Doe")
})

test("readableName: Lotus 'Name/Org/Enron' form", () => {
    assert.equal(readableName("Kay Mann/Corp/Enron"), "Kay Mann")
})

test("readableName: Lotus 'Name@SERVER' form (no dot in domain)", () => {
    assert.equal(readableName("Kay Mann@ENRON"), "Kay Mann")
})

test("readableName: returns null when nothing recognisable", () => {
    assert.equal(readableName("random text"), null)
    assert.equal(readableName(""), null)
    assert.equal(readableName(null), null)
})

test("withReadableName: appends the readable form in parentheses when it differs", () => {
    assert.equal(withReadableName("Doe, John"), "John Doe (Doe, John)")
})

test("withReadableName: returns the original untouched when no readable name exists", () => {
    assert.equal(withReadableName("random text!!"), "random text!!")
})

// ---------------------------------------------------------------------------
// isoDate / withIsoDate
// ---------------------------------------------------------------------------

test("isoDate: numeric M/D/Y with a time", () => {
    assert.equal(isoDate("05/10/2001 09:28 AM"), "2001-05-10 09:28")
})

test("isoDate: 'Month Day, Year' form", () => {
    assert.equal(isoDate("May 10, 2001"), "2001-05-10")
})

test("isoDate: 'Day Month Year' form", () => {
    assert.equal(isoDate("10 May 2001"), "2001-05-10")
})

test("isoDate: returns null for unparseable text", () => {
    assert.equal(isoDate("gibberish"), null)
    assert.equal(isoDate(""), null)
})

test("withIsoDate: appends the ISO form in parentheses when parseable", () => {
    assert.equal(withIsoDate("05/10/2001 09:28 AM"), "05/10/2001 09:28 AM (2001-05-10 09:28)")
})

test("withIsoDate: returns the original untouched when unparseable", () => {
    assert.equal(withIsoDate("gibberish"), "gibberish")
})
