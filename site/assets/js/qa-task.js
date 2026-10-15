// Take-home case study: findings filter, and the sleep-vs-poll comparison.
// The journey stepper is the shared one in common.js.
(function () {
  "use strict";

  function initFilter(root) {
    const buttons = Array.from(root.querySelectorAll("[data-filter]"));
    const cards = Array.from(root.querySelectorAll("[data-area]"));
    const count = root.querySelector("[data-filter-count]");

    function apply(area) {
      let shown = 0;
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === area)));
      cards.forEach((card) => {
        const match = area === "all" || card.getAttribute("data-area") === area;
        card.hidden = !match;
        if (match) shown += 1;
      });
      if (count) count.textContent = shown + " of " + cards.length;
    }

    buttons.forEach((b) => b.addEventListener("click", () => apply(b.getAttribute("data-filter"))));
    apply("all");
  }

  // Same values as BaseApiTest: poll every 250ms, give up after 10s.
  const RUNS = 30;
  const POLL_MS = 250;
  const POLL_TIMEOUT_MS = 10000;

  // Small seeded PRNG so a given seed always produces the same 30 lags,
  // which keeps the sleep and poll rows comparable and the tests stable.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Simulated replication lag: a quarter readable at once, most within a few
  // hundred ms, the odd one past a second.
  function lagsFor(seed) {
    const rand = mulberry32(seed);
    return Array.from({ length: RUNS }, () => {
      if (rand() < 0.25) return 0;
      return Math.min(3500, Math.round(-Math.log(1 - rand()) * 400));
    });
  }

  function sleepRun(lag, sleepMs) {
    return { lag, wait: sleepMs, ok: lag <= sleepMs, gets: 1 };
  }

  function pollRun(lag) {
    const checks = Math.ceil(lag / POLL_MS);
    const wait = checks * POLL_MS;
    if (wait > POLL_TIMEOUT_MS) {
      return { lag, wait: POLL_TIMEOUT_MS, ok: false, gets: POLL_TIMEOUT_MS / POLL_MS + 1 };
    }
    return { lag, wait, ok: true, gets: checks + 1 };
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const W = 720;
  const H = 120;
  const BASE = 112;
  const TOP = 8;
  const PAD = 4;

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach((k) => node.setAttribute(k, String(attrs[k])));
    return node;
  }

  // Bar with rounded top corners, flat on the baseline.
  function barPath(x, top, w) {
    const h = BASE - top;
    const r = Math.min(3, w / 2, h);
    return [
      "M", x, BASE, "V", top + r,
      "Q", x, top, x + r, top,
      "H", x + w - r,
      "Q", x + w, top, x + w, top + r,
      "V", BASE, "Z",
    ].join(" ");
  }

  const seconds = (ms) => (ms / 1000).toFixed(1) + "s";

  function drawChart(svg, runs, yMax, name) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const slot = (W - 2 * PAD) / runs.length;
    const bw = Math.min(14, slot - 4);
    const y = (ms) => BASE - (ms / yMax) * (BASE - TOP);

    svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: BASE + 1, y2: BASE + 1, stroke: "#3a454c", "stroke-width": 1 }));

    runs.forEach((run, i) => {
      const x = PAD + i * slot + (slot - bw) / 2;
      const top = Math.min(y(run.wait), BASE - 2);
      const g = svgEl("g", {});
      const title = svgEl("title", {});
      title.textContent =
        "Run " + (i + 1) + ": readable after " + run.lag + "ms, waited " + run.wait + "ms, " +
        (run.ok ? "passed" : "failed, GET still 404");
      g.appendChild(title);
      // Hover target is the whole column, not just the thin bar.
      g.appendChild(svgEl("rect", { x: PAD + i * slot, y: 0, width: slot, height: H, fill: "transparent" }));
      g.appendChild(
        svgEl("path", run.ok
          ? { d: barPath(x, top, bw), fill: "#5fd08f" }
          : { d: barPath(x, top, bw), fill: "none", stroke: "#ff6b5b", "stroke-width": 1.5 })
      );
      const ty = y(run.lag);
      g.appendChild(svgEl("line", { x1: x - 3, x2: x + bw + 3, y1: ty, y2: ty, stroke: "#eceae4", "stroke-width": 2, "stroke-linecap": "round" }));
      svg.appendChild(g);
    });

    const failed = runs.filter((r) => !r.ok).length;
    svg.setAttribute("aria-label", name + ": " + failed + " of " + runs.length + " runs failed");
  }

  function summarise(runs) {
    return {
      failed: runs.filter((r) => !r.ok).length,
      wait: runs.reduce((sum, r) => sum + r.wait, 0),
      gets: runs.reduce((sum, r) => sum + r.gets, 0),
    };
  }

  function initRace(root) {
    const select = root.querySelector("[data-sleep]");
    const runBtn = root.querySelector("[data-race-run]");
    const sleepLabel = root.querySelector("[data-sleep-label]");
    const scale = root.querySelector("[data-scale]");
    const verdict = root.querySelector("[data-race-verdict]");
    const rows = {
      sleep: root.querySelector('[data-row="sleep"]'),
      poll: root.querySelector('[data-row="poll"]'),
    };

    function seed() {
      return Number(root.getAttribute("data-seed") || 1);
    }

    function fill(row, stats) {
      row.querySelector("[data-sum-failed]").textContent = String(stats.failed);
      row.querySelector("[data-sum-wait]").textContent = seconds(stats.wait);
      row.querySelector("[data-sum-gets]").textContent = String(stats.gets);
    }

    function render() {
      const sleepMs = Number(select.value);
      const lags = lagsFor(seed());
      const sleepRuns = lags.map((lag) => sleepRun(lag, sleepMs));
      const pollRuns = lags.map(pollRun);

      const peak = Math.max(sleepMs, ...lags, ...pollRuns.map((r) => r.wait));
      const yMax = Math.max(500, Math.ceil(peak / 500) * 500);

      sleepLabel.textContent = select.options[select.selectedIndex].textContent;
      scale.textContent = "scale 0 to " + yMax / 1000 + "s, same for both";
      drawChart(rows.sleep.querySelector("[data-chart]"), sleepRuns, yMax, "Fixed sleep");
      drawChart(rows.poll.querySelector("[data-chart]"), pollRuns, yMax, "Polling");

      const s = summarise(sleepRuns);
      const p = summarise(pollRuns);
      fill(rows.sleep, s);
      fill(rows.poll, p);

      let text;
      let tone;
      if (s.failed > 0 && p.wait < s.wait) {
        text = "Polling passed all 30 and still spent " + seconds(s.wait - p.wait) + " less time waiting.";
        tone = "ok";
      } else if (s.failed > 0) {
        text = "The short sleep is quicker overall, but " + s.failed + " of 30 runs failed for no real reason.";
        tone = "bad";
      } else if (p.wait < s.wait) {
        text = "No failures this time, but every run paid the full sleep. Polling waited " + seconds(s.wait - p.wait) + " less.";
        tone = "ok";
      } else {
        text = "No failures this time. Polling waited " + seconds(p.wait) + " in total, the sleep " + seconds(s.wait) + ".";
        tone = "idle";
      }
      verdict.textContent = text;
      verdict.setAttribute("data-tone", tone);
    }

    select.addEventListener("change", render);
    runBtn.addEventListener("click", () => {
      root.setAttribute("data-seed", String(seed() + 1));
      render();
    });
    render();
  }

  // Start last: the constants above are not usable until their lines have run.
  const findings = document.querySelector("[data-findings]");
  if (findings) initFilter(findings);

  const race = document.querySelector("[data-race]");
  if (race) initRace(race);
})();
