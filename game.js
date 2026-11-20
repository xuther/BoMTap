(() => {
  "use strict";

  const ROUNDS = 5;
  const MIN_WORDS = 100;
  const MAX_WORDS = 200;
  // Points follow 100 * e^(-(d / CURVE_SCALE)^CURVE_SHAPE), where d = verses between guess and
  // passage. A higher shape holds scores up longer near the passage, then drops more steeply.
  // Tuned so 75% of the book (~4,950 of 6,604 verses) off scores 7:
  // 30 verses off ≈ 98, 100 ≈ 95, 300 ≈ 85, 1000 ≈ 58, 3000 ≈ 20, 4950 ≈ 7.
  const CURVE_SCALE = 1863;
  const CURVE_SHAPE = 1;
  // Landing in the right chapter or book guarantees at least this much
  const SAME_CHAPTER_FLOOR = 90;
  const SAME_BOOK_FLOOR = 70;
  const EPOCH = Date.UTC(2026, 10, 20); // puzzle #1
  const STORAGE_PREFIX = "bomtap:v3:"; // bump when the daily passage picker changes

  const ABBR = {
    "1 Nephi": "1 Ne", "2 Nephi": "2 Ne", "Jacob": "Jacob", "Enos": "Enos", "Jarom": "Jarom",
    "Omni": "Omni", "Words of Mormon": "WoM", "Mosiah": "Mosiah", "Alma": "Alma",
    "Helaman": "Hel", "3 Nephi": "3 Ne", "4 Nephi": "4 Ne", "Mormon": "Morm",
    "Ether": "Ether", "Moroni": "Moro",
  };

  // ---------- Data: flatten every verse onto one global index ----------

  const books = window.BOM_DATA;
  const verses = []; // { b, c, v, text }
  books.forEach((book, b) => {
    book.start = verses.length;
    book.chStart = [];
    book.chapters.forEach((ch, c) => {
      book.chStart.push(verses.length);
      ch.forEach((text, v) => verses.push({ b, c, v, text }));
    });
    book.end = verses.length - 1;
  });
  const N = verses.length;

  const words = (i) => verses[i].text.split(/\s+/);
  const ref = (i) => {
    const x = verses[i];
    return `${books[x.b].name} ${x.c + 1}:${x.v + 1}`;
  };
  // Passages never cross chapters, so a range only varies by verse
  const rangeRef = (s, e) => (s === e ? ref(s) : `${ref(s)}–${verses[e].v + 1}`);
  const chapterRange = (i) => {
    const { b, c } = verses[i];
    const s = books[b].chStart[c];
    return [s, s + books[b].chapters[c].length - 1];
  };

  // ---------- Seeded randomness so everyone gets the same daily set ----------

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Grow a passage around verse g until it has MIN_WORDS, staying inside the chapter.
  function passageRange(g) {
    const [cs, ce] = chapterRange(g);
    let start = g, end = g, count = words(g).length;
    while (count < MIN_WORDS && end < ce) count += words(++end).length;
    while (count < MIN_WORDS && start > cs) count += words(--start).length;
    return [start, end];
  }

  // The passage for verse g, with the displayed text cut at MAX_WORDS
  function makeExcerpt(g) {
    const [start, end] = passageRange(g);
    const paras = [];
    let budget = MAX_WORDS, shownEnd = start;
    for (let i = start; i <= end && budget > 0; i++) {
      const w = words(i);
      paras.push(w.length > budget ? w.slice(0, budget).join(" ") + " …" : verses[i].text);
      budget -= w.length;
      shownEnd = i;
    }
    return { start, end: shownEnd, paras };
  }

  // ---------- Difficulty ramp: one passage per tier, easiest first ----------
  // Fame comes from how often General Conference talks cite each verse (data/fame.js).

  // Doctrinal / Scripture Mastery verses join the most-cited verses in the first round's pool
  const MASTERY = [
    "1 Nephi 3:7", "1 Nephi 19:23", "2 Nephi 2:25", "2 Nephi 2:27", "2 Nephi 9:28", "2 Nephi 25:23",
    "2 Nephi 26:33", "2 Nephi 28:30", "2 Nephi 31:19", "2 Nephi 32:3", "2 Nephi 32:8", "Mosiah 2:17",
    "Mosiah 2:41", "Mosiah 3:19", "Mosiah 4:9", "Mosiah 4:30", "Mosiah 18:8", "Alma 7:11", "Alma 32:21",
    "Alma 34:9", "Alma 34:32", "Alma 37:6", "Alma 37:35", "Alma 39:9", "Alma 41:10", "Helaman 5:12",
    "3 Nephi 11:10", "3 Nephi 12:48", "3 Nephi 18:15", "3 Nephi 27:20", "Ether 12:6", "Ether 12:27",
    "Moroni 7:16", "Moroni 7:45", "Moroni 10:4", "Moroni 10:32",
  ];
  const TOP_CITED = 50;

  const cites = window.BOM_CITES;
  const verseAt = (r) => {
    const [, name, c, v] = r.match(/^(.+) (\d+):(\d+)$/);
    return books.find((b) => b.name === name).chStart[c - 1] + (v - 1);
  };
  const sum = (a, b) => cites.slice(a, b + 1).reduce((t, x) => t + x, 0);

  // A passage is as famous as its most-cited verse, nudged by how cited the passage and its
  // chapter are overall (which also orders the many passages nobody quotes)
  function fame(g) {
    const [s, e] = passageRange(g), [cs, ce] = chapterRange(g);
    const peak = Math.max(...cites.slice(s, e + 1));
    return peak + (0.5 * sum(s, e)) / (e - s + 1) + (0.1 * sum(cs, ce)) / (ce - cs + 1);
  }
  const byFame = verses.map((_, g) => [g, fame(g)]).sort((a, b) => b[1] - a[1]).map(([g]) => g);

  const classics = [...new Set([
    ...verses.map((_, g) => g).sort((a, b) => cites[b] - cites[a]).slice(0, TOP_CITED),
    ...MASTERY.map(verseAt),
  ])];
  const pickFrom = (rng, list) => list[Math.floor(rng() * list.length)];
  // A random passage start from a band of the fame ranking, as fractions from most to least famous
  const band = (lo, hi) => (rng) => byFame[Math.floor((lo + rng() * (hi - lo)) * N)];

  const TIERS = [
    { label: "Well-known verse", verse: (rng) => pickFrom(rng, classics) },
    { label: "Familiar", verse: band(0.03, 0.12) },
    { label: "Moderate", verse: band(0.12, 0.35) },
    { label: "Hard", verse: band(0.35, 0.65) },
    { label: "Deep cut", verse: band(0.75, 1) },
  ];

  function pickExcerpts(rng) {
    const usedChapters = new Set();
    return TIERS.map((tier) => {
      for (;;) {
        const g = tier.verse(rng);
        const key = chapterRange(g)[0];
        if (usedChapters.has(key)) continue;
        usedChapters.add(key);
        return { ...makeExcerpt(g), tier: tier.label };
      }
    });
  }

  const distance = (guess, ex) =>
    guess < ex.start ? ex.start - guess : guess > ex.end ? guess - ex.end : 0;
  const sameChapter = (guess, ex) => chapterRange(guess)[0] === chapterRange(ex.start)[0];
  const sameBook = (guess, ex) => verses[guess].b === verses[ex.start].b;
  function pointsFor(guess, ex) {
    const curve = 100 * Math.exp(-((distance(guess, ex) / CURVE_SCALE) ** CURVE_SHAPE));
    const floor = sameChapter(guess, ex) ? SAME_CHAPTER_FLOOR : sameBook(guess, ex) ? SAME_BOOK_FLOOR : 0;
    return Math.round(Math.max(curve, floor));
  }
  const emojiFor = (p) => (p === 100 ? "🎯" : p >= 80 ? "🟩" : p >= 50 ? "🟨" : p >= 20 ? "🟧" : "🟥");

  // ---------- Dates & storage ----------

  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function dayNumber(key) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 864e5) + 1;
  }
  function load(key) {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function save(key, guesses) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(guesses)); } catch { /* private mode */ }
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    intro: $("intro"), round: $("round"), summary: $("summary"),
    dayLabel: $("day-label"), roundLabel: $("round-label"), scoreLabel: $("score-label"),
    tier: $("tier"), passage: $("passage"), readoutLabel: $("readout-label"), readoutRef: $("readout-ref"),
    overview: $("overview"), ovBooks: $("ov-books"), ovView: $("ov-view"), ovGuess: $("ov-guess"),
    ovAnswer: $("ov-answer"), tape: $("tape"), tapeCanvas: $("tape-canvas"), needle: $("needle"), hint: $("hint"),
    pickers: $("pickers"), pickBook: $("pick-book"), pickChapter: $("pick-chapter"), pickVerse: $("pick-verse"),
    result: $("result"), resultPoints: $("result-points"), resultDetail: $("result-detail"),
    startBtn: $("start-btn"), guessBtn: $("guess-btn"), nextBtn: $("next-btn"),
    summaryTitle: $("summary-title"), summaryTotal: $("summary-total"), summaryList: $("summary-list"),
    shareBtn: $("share-btn"), practiceBtn: $("practice-btn"), nextIn: $("next-in"),
  };

  const state = {
    mode: "daily",
    dateKey: todayKey(),
    excerpts: [],
    guesses: [],
    guess: null,
    revealed: false,
  };

  // ---------- Overview bar: one segment per book, sized by verse count ----------

  books.forEach((book) => {
    const seg = document.createElement("div");
    seg.className = "ov-book";
    seg.style.width = `${((book.end - book.start + 1) / N) * 100}%`;
    seg.title = book.name;
    seg.dataset.label = ABBR[book.name] || book.name;
    el.ovBooks.appendChild(seg);
  });
  function labelSegments() {
    for (const seg of el.ovBooks.children) {
      seg.textContent = seg.offsetWidth >= seg.dataset.label.length * 6 + 6 ? seg.dataset.label : "";
    }
  }
  el.tape.setAttribute("aria-valuemax", String(N - 1));

  books.forEach((book, b) => el.pickBook.add(new Option(book.name, b)));

  function syncPickers(i) {
    const { b, c, v } = verses[i];
    if (el.pickBook.value !== String(b) || el.pickChapter.dataset.book !== String(b)) {
      el.pickBook.value = b;
      el.pickChapter.replaceChildren(...books[b].chapters.map((_, ci) => new Option(`Ch. ${ci + 1}`, ci)));
      el.pickChapter.dataset.book = b;
      el.pickVerse.dataset.chapter = "";
    }
    el.pickChapter.value = c;
    const chKey = `${b}:${c}`;
    if (el.pickVerse.dataset.chapter !== chKey) {
      el.pickVerse.replaceChildren(...books[b].chapters[c].map((_, vi) => new Option(`v. ${vi + 1}`, vi)));
      el.pickVerse.dataset.chapter = chKey;
    }
    el.pickVerse.value = v;
  }

  // ---------- Zoomed tape ----------
  // Verse i spans [i, i + 1) in tape coordinates; tape.pos is the coordinate under the needle.

  const PX = 6; // pixels per verse
  const tape = { pos: N / 2, w: 0, h: 0, anim: 0 };
  const ctx = el.tapeCanvas.getContext("2d");
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ["book-a", "book-b", "text", "muted", "guess", "answer"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
  }
  readColors();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); draw(); });

  function resizeTape() {
    const r = el.tape.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    tape.w = r.width;
    tape.h = r.height;
    el.tapeCanvas.width = Math.round(r.width * dpr);
    el.tapeCanvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelSegments();
    render();
  }
  new ResizeObserver(resizeTape).observe(el.tape);

  function draw() {
    const { w, h, pos } = tape;
    if (!w) return;
    const X = (c) => w / 2 + (c - pos) * PX;
    const first = Math.max(0, Math.floor(pos - w / 2 / PX) - 1);
    const last = Math.min(N - 1, Math.ceil(pos + w / 2 / PX) + 1);
    ctx.clearRect(0, 0, w, h);

    for (let b = verses[first].b; b <= verses[last].b; b++) {
      ctx.fillStyle = b % 2 ? colors["book-b"] : colors["book-a"];
      const x0 = Math.max(0, X(books[b].start)), x1 = Math.min(w, X(books[b].end + 1));
      ctx.fillRect(x0, 0, x1 - x0, h);
    }

    const ex = state.revealed ? state.excerpts[state.guesses.length - 1] : null;
    if (ex) {
      ctx.fillStyle = colors.answer;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(X(ex.start), 0, (ex.end - ex.start + 1) * PX, h);
      ctx.globalAlpha = 1;
    }

    // Verse ticks (taller every 5th, numbered), chapter boundary lines
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let i = first; i <= last; i++) {
      const { v } = verses[i];
      if (v === 0) {
        ctx.fillStyle = colors.text;
        ctx.fillRect(Math.round(X(i)) - 1, 0, 2, h);
      }
      const x = Math.round(X(i + 0.5));
      ctx.fillStyle = colors.muted;
      if ((v + 1) % 5 === 0) {
        ctx.fillRect(x, h - 14, 1, 14);
        ctx.fillText(String(v + 1), x, h - 18);
      } else {
        ctx.fillRect(x, h - 6, 1, 6);
      }
    }

    // Chapter labels; the one for the chapter at the left edge sticks until the next pushes it off
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = colors.text;
    const label = (i) => `${books[verses[i].b].name} ${verses[i].c + 1}`;
    const leftStart = chapterRange(first)[0];
    const nextStart = chapterRange(first)[1] + 1;
    const stickyW = ctx.measureText(label(leftStart)).width;
    const stickyX = Math.min(Math.max(X(leftStart) + 5, 5), nextStart < N ? X(nextStart) - stickyW - 10 : Infinity);
    ctx.fillText(label(leftStart), stickyX, 16);
    for (let i = first + 1; i <= last; i++) {
      if (verses[i].v === 0 && i !== leftStart) ctx.fillText(label(i), X(i) + 5, 16);
    }

    if (ex) {
      const g = state.guesses[state.guesses.length - 1].guess;
      ctx.fillStyle = colors.guess;
      ctx.fillRect(Math.round(X(g + 0.5)) - 1.5, 0, 3, h);
    }
  }

  function render() {
    draw();
    const visible = tape.w / PX;
    el.ovView.style.left = `${(tape.pos / N) * 100}%`;
    el.ovView.style.width = `${(visible / N) * 100}%`;
  }

  // Move the tape. When the player is driving it before the reveal, the needle sets the guess.
  function moveTo(p, user) {
    tape.pos = Math.max(0.5, Math.min(N - 0.5, p));
    if (user && !state.revealed) setGuess(Math.floor(tape.pos));
    render();
  }

  function stopAnim() {
    cancelAnimationFrame(tape.anim);
    tape.anim = 0;
  }

  function animateTo(target, user, ms = 280) {
    stopAnim();
    const from = tape.pos, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      moveTo(from + (target - from) * (1 - (1 - k) ** 3), user);
      tape.anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    tape.anim = requestAnimationFrame(step);
  }

  const snap = (user) => animateTo(Math.floor(tape.pos) + 0.5, user, 120);

  // Flick: keep gliding with friction, then settle on a verse center
  function glide(pxPerMs, user) {
    stopAnim();
    let vel = -pxPerMs / PX, prev = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      moveTo(tape.pos + vel * dt, user);
      vel *= Math.pow(0.996, dt);
      const atEdge = tape.pos <= 0.5 || tape.pos >= N - 0.5;
      if (Math.abs(vel) < 0.004 || atEdge) snap(user);
      else tape.anim = requestAnimationFrame(step);
    };
    tape.anim = requestAnimationFrame(step);
  }

  function setGuess(i) {
    if (state.revealed) return;
    i = Math.max(0, Math.min(N - 1, i));
    if (state.guess === i) return;
    state.guess = i;
    el.needle.classList.remove("idle");
    el.ovGuess.hidden = false;
    el.ovGuess.style.left = `${((i + 0.5) / N) * 100}%`;
    el.readoutRef.textContent = ref(i);
    el.tape.setAttribute("aria-valuenow", String(i));
    el.tape.setAttribute("aria-valuetext", ref(i));
    el.guessBtn.disabled = false;
    syncPickers(i);
  }

  // Jump straight to a verse (pickers, keys)
  const jumpTo = (i) => { stopAnim(); moveTo(i + 0.5, true); };

  // Tape: drag to slide, flick for momentum, tap a spot to bring it under the needle
  const capture = (node, e) => { try { node.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } };

  let drag = null;
  el.tape.addEventListener("pointerdown", (e) => {
    stopAnim();
    capture(el.tape, e);
    drag = { x0: e.clientX, p0: tape.pos, moved: false, samples: [{ x: e.clientX, t: e.timeStamp }] };
  });
  el.tape.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) moveTo(drag.p0 - dx / PX, true);
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 80) drag.samples.shift();
  });
  el.tape.addEventListener("pointerup", (e) => {
    if (!drag) return;
    if (!drag.moved) {
      const r = el.tape.getBoundingClientRect();
      animateTo(Math.floor(tape.pos + (e.clientX - r.left - tape.w / 2) / PX) + 0.5, true);
    } else {
      const a = drag.samples[0], b = drag.samples[drag.samples.length - 1];
      const v = b.t > a.t && e.timeStamp - b.t < 60 ? (b.x - a.x) / (b.t - a.t) : 0;
      Math.abs(v) > 0.2 ? glide(v, true) : snap(true);
    }
    drag = null;
  });
  el.tape.addEventListener("pointercancel", () => { drag = null; snap(true); });

  let wheelTimer = 0;
  el.tape.addEventListener("wheel", (e) => {
    e.preventDefault();
    stopAnim();
    moveTo(tape.pos + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / PX, true);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => snap(true), 150);
  }, { passive: false });

  el.tape.addEventListener("keydown", (e) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -100, PageUp: 100 };
    if (e.key in steps) {
      e.preventDefault();
      jumpTo(Math.floor(tape.pos) + steps[e.key] * (e.shiftKey ? 10 : 1));
    } else if (e.key === "Home") { e.preventDefault(); jumpTo(0); }
    else if (e.key === "End") { e.preventDefault(); jumpTo(N - 1); }
    else if (e.key === "Enter") lockIn();
  });

  // Overview: tap or drag anywhere on the whole-book bar to jump there
  const overviewPos = (e) => {
    const r = el.overview.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * N;
  };
  el.overview.addEventListener("pointerdown", (e) => {
    stopAnim();
    capture(el.overview, e);
    moveTo(overviewPos(e), true);
  });
  el.overview.addEventListener("pointermove", (e) => {
    if (el.overview.hasPointerCapture(e.pointerId)) moveTo(overviewPos(e), true);
  });
  el.overview.addEventListener("pointerup", () => snap(true));

  el.pickBook.addEventListener("change", () => jumpTo(books[+el.pickBook.value].start));
  el.pickChapter.addEventListener("change", () =>
    jumpTo(books[+el.pickBook.value].chStart[+el.pickChapter.value]));
  el.pickVerse.addEventListener("change", () =>
    jumpTo(books[+el.pickBook.value].chStart[+el.pickChapter.value] + +el.pickVerse.value));
  el.pickers.querySelectorAll(".step").forEach((btn) =>
    btn.addEventListener("click", () => jumpTo(Math.floor(tape.pos) + +btn.dataset.step)));

  // ---------- Screens ----------

  function show(section) {
    for (const s of [el.intro, el.round, el.summary]) s.hidden = s !== section;
    if (section === el.round) resizeTape();
  }

  function updateHeader() {
    el.dayLabel.textContent = state.mode === "daily" ? `#${dayNumber(state.dateKey)}` : "Practice";
    const done = state.guesses.length;
    const n = state.revealed ? done : done + 1;
    el.roundLabel.textContent = el.summary.hidden && n <= ROUNDS ? `${n}/${ROUNDS}` : "";
    const total = state.guesses.reduce((sum, g) => sum + g.points, 0);
    el.scoreLabel.textContent = `${total} pts`;
  }

  function startRound() {
    const ex = state.excerpts[state.guesses.length];
    state.guess = null;
    state.revealed = false;
    stopAnim();
    tape.pos = N / 2;

    el.passage.replaceChildren(...ex.paras.map((t) => {
      const p = document.createElement("p");
      p.textContent = t;
      return p;
    }));
    el.passage.scrollTop = 0;
    el.tier.textContent = ex.tier;

    el.readoutLabel.textContent = "Your guess";
    el.readoutRef.textContent = "Slide to choose";
    el.needle.classList.add("idle");
    el.needle.hidden = false;
    el.hint.hidden = false;
    el.ovGuess.hidden = true;
    el.ovAnswer.hidden = true;
    el.result.hidden = true;
    el.guessBtn.hidden = false;
    el.guessBtn.disabled = true;
    el.nextBtn.hidden = true;
    for (const c of el.pickers.querySelectorAll("select, button")) c.disabled = false;
    el.pickBook.value = "";
    el.pickChapter.replaceChildren();
    el.pickChapter.dataset.book = "";
    el.pickVerse.replaceChildren();
    el.pickVerse.dataset.chapter = "";

    updateHeader();
    show(el.round);
  }

  function lockIn() {
    if (state.guess === null || state.revealed) return;
    const ex = state.excerpts[state.guesses.length];
    const d = distance(state.guess, ex);
    const points = pointsFor(state.guess, ex);
    state.guesses.push({ guess: state.guess, distance: d, points });
    state.revealed = true;
    if (state.mode === "daily") save(state.dateKey, state.guesses);
    reveal(ex, state.guesses[state.guesses.length - 1]);
    updateHeader();
  }

  function reveal(ex, g) {
    el.ovAnswer.hidden = false;
    el.ovAnswer.style.left = `${(ex.start / N) * 100}%`;
    el.ovAnswer.style.width = `${((ex.end - ex.start + 1) / N) * 100}%`;
    el.needle.hidden = true;
    el.hint.hidden = true;
    // Frame both the guess and the answer on the tape if they fit; otherwise show the answer
    const mid = (ex.start + ex.end + 1) / 2;
    const both = (Math.min(g.guess, ex.start) + Math.max(g.guess + 1, ex.end + 1)) / 2;
    const fits = (Math.max(g.guess + 1, ex.end + 1) - Math.min(g.guess, ex.start)) * PX < tape.w - 40;
    animateTo(fits ? both : mid, false, 500);

    el.readoutLabel.textContent = "Answer";
    el.readoutRef.textContent = rangeRef(ex.start, ex.end);
    el.result.hidden = false;
    el.resultPoints.textContent = `${emojiFor(g.points)} ${g.points}`;
    const near = sameChapter(g.guess, ex) ? " (right chapter)" : sameBook(g.guess, ex) ? " (right book)" : "";
    el.resultDetail.innerHTML = "";
    el.resultDetail.append(`You guessed ${ref(g.guess)} — `);
    const strong = document.createElement("strong");
    strong.textContent = g.distance === 0 ? "right on it!"
      : `${g.distance.toLocaleString()} verse${g.distance === 1 ? "" : "s"} away${near}`;
    el.resultDetail.append(strong);

    el.guessBtn.hidden = true;
    el.nextBtn.hidden = false;
    el.nextBtn.textContent = state.guesses.length < ROUNDS ? "Next passage" : "See results";
    el.nextBtn.focus();
    for (const c of el.pickers.querySelectorAll("select, button")) c.disabled = true;
  }

  function showSummary() {
    const total = state.guesses.reduce((sum, g) => sum + g.points, 0);
    el.summaryTitle.textContent = state.mode === "daily"
      ? `BoM Tap #${dayNumber(state.dateKey)}` : "Practice round";
    el.summaryTotal.textContent = `${total} / ${ROUNDS * 100}`;
    el.summaryList.replaceChildren(...state.guesses.map((g, i) => {
      const ex = state.excerpts[i];
      const li = document.createElement("li");
      const pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = `${emojiFor(g.points)} ${g.points}`;
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = `${ex.tier} · ${rangeRef(ex.start, ex.end)} · you guessed ${ref(g.guess)}`;
      li.append(pts, ` — ${g.distance === 0 ? "exact" : `${g.distance.toLocaleString()} verses off`}`, sub);
      return li;
    }));
    el.shareBtn.hidden = state.mode !== "daily";
    el.practiceBtn.textContent = state.mode === "daily" ? "Practice round" : "Another practice round";
    show(el.summary);
    updateHeader();
    tickCountdown();
  }

  function tickCountdown() {
    if (el.summary.hidden || state.mode !== "daily") { el.nextIn.textContent = ""; return; }
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((midnight - now) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    el.nextIn.textContent = `Next puzzle in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    if (s === 0) location.reload();
  }
  setInterval(tickCountdown, 1000);

  function shareText() {
    const total = state.guesses.reduce((sum, g) => sum + g.points, 0);
    return [
      `BoM Tap #${dayNumber(state.dateKey)} — ${total}/${ROUNDS * 100}`,
      state.guesses.map((g) => emojiFor(g.points)).join(""),
      state.guesses.map((g) => g.points).join(" · "),
      location.href.split(/[?#]/)[0],
    ].join("\n");
  }

  el.shareBtn.addEventListener("click", async () => {
    const text = shareText();
    try {
      await navigator.clipboard.writeText(text);
      el.shareBtn.textContent = "Copied!";
      setTimeout(() => (el.shareBtn.textContent = "Copy result"), 1500);
    } catch {
      window.prompt("Copy your result:", text);
    }
  });

  el.guessBtn.addEventListener("click", lockIn);
  el.nextBtn.addEventListener("click", () => (state.guesses.length < ROUNDS ? startRound() : showSummary()));
  el.startBtn.addEventListener("click", startRound);
  el.practiceBtn.addEventListener("click", () => {
    state.mode = "practice";
    state.excerpts = pickExcerpts(mulberry32((Math.random() * 2 ** 32) >>> 0));
    state.guesses = [];
    startRound();
  });

  // ---------- Boot ----------

  state.excerpts = pickExcerpts(mulberry32(hashStr(STORAGE_PREFIX + state.dateKey)));
  state.guesses = load(state.dateKey).slice(0, ROUNDS);
  updateHeader();
  if (state.guesses.length >= ROUNDS) showSummary();
  else if (state.guesses.length > 0) startRound();
  else show(el.intro);
})();
