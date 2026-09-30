/**
 * The Gmail pick-up touches a real mailbox, so what it will and won't accept is
 * pinned down here: only exact briefing subjects, and a JSON body recovered from
 * however the draft happens to be encoded.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefingDate, briefingText, checkGapMs, extractJson } from "../server/gmailBias";

describe("briefingDate", () => {
  it("reads the date from an exact briefing subject", () => {
    assert.equal(briefingDate("[Trading Desk] Daily Bias 2026-10-01"), "2026-10-01");
  });

  it("refuses anything that only resembles one", () => {
    // IMAP's subject search is a substring match, so these can come back from Gmail.
    assert.equal(briefingDate("Re: [Trading Desk] Daily Bias 2026-10-01"), null);
    assert.equal(briefingDate("[Trading Desk] Daily Bias 2026-10-01 (copy)"), null);
    assert.equal(briefingDate("[Trading Desk] Daily Bias"), null);
    assert.equal(briefingDate("Fwd: daily bias"), null);
    assert.equal(briefingDate(undefined), null);
  });
});

describe("extractJson", () => {
  it("drops text around the object, such as a signature", () => {
    assert.equal(extractJson('Hi\n{"date":"2026-10-01"}\n--\nSent from Gmail'), '{"date":"2026-10-01"}');
  });

  it("returns null when there's no object", () => {
    assert.equal(extractJson("no briefing here"), null);
  });
});

describe("briefingText", () => {
  const json = '{"date":"2026-10-01","tldr":"Watch <2640> & the Asian low"}';

  it("prefers the plain-text part", () => {
    assert.equal(briefingText({ text: json, html: false }), json);
  });

  it("recovers the JSON from an HTML-only draft without wrapping it", () => {
    const html = `<div dir="ltr">{&quot;date&quot;:&quot;2026-10-01&quot;,&quot;tldr&quot;:&quot;Watch &lt;2640&gt; &amp; the Asian low&quot;}</div>`;
    assert.equal(briefingText({ text: undefined, html }), json);
  });

  it("falls back to the HTML when the plain text is mangled", () => {
    // Escaped the way a real HTML body is: & first, then < > and quotes.
    const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const html = `<p>${escaped}</p>`;
    assert.equal(briefingText({ text: '{"date": broken', html }), json);
  });

  it("still returns unparseable text, so the tab can show it as plain text", () => {
    assert.equal(briefingText({ text: "{not json}", html: false }), "{not json}");
  });
});

describe("checkGapMs", () => {
  it("looks every two minutes once a weekday briefing is due", () => {
    // Thursday 10:30 in Amsterdam (08:30 UTC in October).
    assert.equal(checkGapMs(new Date("2026-10-01T08:30:00Z")), 2 * 60_000);
  });

  it("looks every half hour before the run and at weekends", () => {
    assert.equal(checkGapMs(new Date("2026-10-01T06:00:00Z")), 30 * 60_000);
    assert.equal(checkGapMs(new Date("2026-10-03T10:00:00Z")), 30 * 60_000);
  });
});
