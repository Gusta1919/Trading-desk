/*
 * The preview's stand-in for the local server (see scripts/preview/build.ts).
 *
 * It runs before the app and answers every /api call from the snapshot baked into
 * the page, so the real app runs unchanged. What would need the server or the outside
 * feeds is filled in here instead:
 *  - the briefing is moved to the day the page is opened, so it always counts as today's;
 *  - gold candles are synthetic, drawn around the briefing's spot;
 *  - the news week is a small sample, its releases on this week's days (next week's at
 *    the weekend, like the Calendar's week strip), with two skip days in it.
 * Check-ins, open items and rulebook edits save in memory for the visit, so the
 * changelog fills as you edit; trades are refused with a message, since their maths and
 * flags live in the server.
 */
(function () {
  var S = window.__PREVIEW__;
  var MIN = 60000;
  var DAY = 1440 * MIN;

  function dayIn(zone, d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }

  /* The UTC instant of a New York wall-clock time on a day, DST included. */
  function ny(day, hh, mm) {
    var guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hh + 4, mm);
    var shown = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(guess));
    return new Date(+shown === hh ? guess : guess + 60 * MIN).toISOString();
  }

  var today = dayIn("Europe/Amsterdam", new Date());
  var shift = Date.parse(today + "T00:00:00Z") - Date.parse(S.builtDay + "T00:00:00Z");

  function move(v) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(Date.parse(v) + shift).toISOString();
    if (Array.isArray(v)) return v.map(move);
    if (v && typeof v === "object") {
      var o = {};
      for (var k in v) o[k] = move(v[k]);
      return o;
    }
    return v;
  }

  var bias = S.bias.found ? Object.assign(move(S.bias), { data: Object.assign(move(S.bias.data), { date: today }) }) : S.bias;
  var spot = (bias.data && bias.data.spot) || 4150;

  /* ── Synthetic candles: a calm walk around spot ending now ───────────── */

  function candles(tf) {
    var step = { "5m": 5, "15m": 15, "1h": 60 }[tf] * MIN;
    var end = Math.floor(Date.now() / step) * step;
    var seed = 7 + step / MIN;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    var vol = 1.6 * Math.sqrt(step / (15 * MIN));
    var out = [];
    var price = spot - 6;
    for (var i = 95; i >= 0; i--) {
      var o = price;
      var c = o + (rand() - 0.5) * 2 * vol + (spot - o) * 0.06;
      var h = Math.max(o, c) + rand() * vol * 0.6;
      var l = Math.min(o, c) - rand() * vol * 0.6;
      out.push({ t: end - i * step, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2) });
      price = c;
    }
    return { tf: tf, source: "Preview · synthetic candles", candles: out, fetchedAt: Date.now(), stale: false };
  }

  /* ── A sample news week on the current week's days ───────────────────── */

  function calendar() {
    var d = new Date(today + "T12:00:00Z");
    var wd = d.getUTCDay();
    var monday = new Date(d.getTime() + (wd === 6 ? 2 : wd === 0 ? 1 : 1 - wd) * DAY);
    var on = function (n) {
      return new Date(monday.getTime() + n * DAY).toISOString().slice(0, 10);
    };
    var rows = [
      [0, 10, 0, "ISM Manufacturing PMI", "USD", "High", "49.2", "48.7"],
      [1, 10, 0, "JOLTS Job Openings", "USD", "High", "7.18M", "7.23M"],
      [1, 4, 30, "RBA Rate Statement", "AUD", "Medium", "", ""],
      [2, 8, 15, "ADP Non-Farm Employment Change", "USD", "High", "52K", "54K"],
      [2, 10, 30, "Crude Oil Inventories", "USD", "Low", "-1.2M", "1.8M"],
      [2, 14, 0, "Federal Funds Rate", "USD", "High", "4.00%", "4.25%"],
      [3, 7, 0, "BOE Monetary Policy Summary", "GBP", "High", "", ""],
      [3, 8, 30, "Core PCE Price Index m/m", "USD", "High", "0.2%", "0.2%"],
      [3, 8, 30, "Unemployment Claims", "USD", "Medium", "232K", "229K"],
      [4, 8, 30, "Non-Farm Employment Change", "USD", "High", "51K", "22K"],
      [4, 8, 30, "Unemployment Rate", "USD", "High", "4.3%", "4.3%"],
      [4, 10, 0, "Revised UoM Consumer Sentiment", "USD", "Medium", "55.4", "55.4"],
    ];
    var events = rows.map(function (r, i) {
      return {
        id: "preview-" + i,
        title: r[3],
        currency: r[4],
        impact: r[5],
        at: ny(on(r[0]), r[1], r[2]),
        allDay: false,
        forecast: r[6],
        previous: r[7],
        url: "",
      };
    });
    return { events: events, total: events.length, fetchedAt: new Date().toISOString(), stale: false };
  }

  function headlines() {
    var ago = function (m) {
      return new Date(Date.now() - m * MIN).toISOString();
    };
    var items = [
      ["Sample headline: dollar slips as traders wait for US inflation data", 25],
      ["Sample headline: Treasury yields edge lower ahead of PCE", 70],
      ["Sample headline: central bank gold buying stays strong, survey shows", 160],
      ["Sample headline: oil rises on supply worries", 240],
    ].map(function (h, i) {
      return { id: "preview-h" + i, title: h[0], summary: "Placeholder text for the preview; the real wire fills this on your Mac.", source: "Preview sample", url: "", at: ago(h[1]) };
    });
    return { items: items, fetchedAt: new Date().toISOString(), stale: false };
  }

  /* ── Routing ──────────────────────────────────────────────────────────── */

  var checkins = S.checkins.slice();
  var openItems = S.openItems.slice();
  var READ_ONLY = "This preview doesn't save trades. Run the desk on your Mac to log one.";

  /* Rulebook versions, newest first; an edit adds one, as the server would. */
  var current = S.rulebook;
  var versions = S.versions.slice();
  function nextVersion(v, bump) {
    var m = /^(\d+)\.(\d+)$/.exec(v) || [0, "1", "0"];
    return bump === "major" ? Number(m[1]) + 1 + ".0" : m[1] + "." + (Number(m[2]) + 1);
  }
  function addVersion(doc, reason, bump) {
    var version = nextVersion(current.version, bump);
    current = { version: version, reason: reason, createdAt: new Date().toISOString(), doc: Object.assign({}, doc, { version: version }) };
    S.versionDocs[version] = current;
    versions.unshift({ version: version, reason: reason, createdAt: current.createdAt });
    return current;
  }

  function reply(status, body) {
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status: status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  function answer(path, query, method, body) {
    if (method === "GET") {
      if (path === "/api/trades") return reply(200, S.trades);
      if (path === "/api/limits") return reply(200, current.doc.limits);
      if (path === "/api/rulebook") return reply(200, current);
      if (path === "/api/rulebook/versions") return reply(200, versions);
      var v = path.match(/^\/api\/rulebook\/versions\/(.+)$/);
      if (v) {
        var doc = S.versionDocs[decodeURIComponent(v[1])];
        return doc ? reply(200, doc) : reply(404, { error: "Not found" });
      }
      if (path === "/api/open-items") return reply(200, openItems);
      if (path === "/api/checkins") return reply(200, checkins);
      if (path === "/api/bias") return reply(200, bias);
      if (path === "/api/candles") return reply(200, candles(query.get("tf") || "15m"));
      if (path === "/api/news/rules") return reply(200, current.doc.news);
      if (path === "/api/news/calendar") return reply(200, calendar());
      if (path === "/api/news/headlines") return reply(200, headlines());
      if (path === "/api/health") return reply(200, { ok: true });
      return reply(404, { error: "Not in the preview" });
    }
    var c = path.match(/^\/api\/checkins\/(\d{4}-\d{2}-\d{2})$/);
    if (c && method === "PUT") {
      var saved = Object.assign({ answers: {}, note: "", score: 0, verdict: "caution", reflection: "" }, body, {
        date: c[1],
        createdAt: new Date().toISOString(),
      });
      checkins = [saved].concat(checkins.filter(function (x) { return x.date !== c[1]; }));
      return reply(200, saved);
    }
    if (path === "/api/rulebook" && method === "PUT") {
      if (!String(body.reason || "").trim()) return reply(400, { error: "Every change needs a one-line reason" });
      return reply(200, addVersion(body.doc, String(body.reason).trim(), body.bump));
    }
    if (path === "/api/limits" && method === "PUT") {
      var reason = String(body.reason || "").trim();
      if (!reason) return reply(400, { error: "Every change needs a one-line reason" });
      var limits = Object.assign({}, body);
      delete limits.reason;
      addVersion(Object.assign({}, current.doc, { limits: limits }), reason, "minor");
      return reply(200, limits);
    }
    var o = path.match(/^\/api\/open-items\/(.+)$/);
    if (o && method === "PUT") {
      var item = null;
      openItems = openItems.map(function (x) {
        if (x.id !== o[1]) return x;
        item = Object.assign({}, x, { done: !!body.done, doneAt: body.done ? new Date().toISOString() : null });
        return item;
      });
      return item ? reply(200, item) : reply(404, { error: "Not found" });
    }
    return reply(403, { error: READ_ONLY });
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var i = url.pathname.indexOf("/api/");
    if (i === -1) return realFetch(input, init);
    var method = ((init && init.method) || "GET").toUpperCase();
    var body = {};
    try {
      body = init && init.body ? JSON.parse(init.body) : {};
    } catch (e) {}
    return answer(url.pathname.slice(i), url.searchParams, method, body);
  };
})();
