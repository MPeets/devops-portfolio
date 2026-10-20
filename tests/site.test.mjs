// Loads each page in jsdom, runs its real scripts and drives the interactive
// parts the way a visitor would. No browser, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdom from "jsdom";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const PAGES = ["index.html", "ot.html", "platform.html", "lab.html", "qa-task.html", "404.html"];
const CASE_STUDIES = ["ot.html", "platform.html", "lab.html", "qa-task.html"];

// Load local scripts and styles, answer anything on the network (fonts) with
// an empty response so the tests never leave the machine.
const localOnly = requestInterceptor((request) => {
  if (!request.url.startsWith("file:")) return new Response("", { headers: { "Content-Type": "text/css" } });
  return undefined;
});

async function open(page) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    // Only real script errors count. jsdom's CSS parser not knowing a modern
    // property, or a missing browser API stub, is not a bug in the page.
    if (err.type === "unhandled-exception") errors.push(err);
  });
  const dom = await JSDOM.fromFile(path.join(SITE, page), {
    runScripts: "dangerously",
    resources: { interceptors: [localOnly] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = undefined;
    },
  });
  const { document } = dom.window;
  if (document.readyState !== "complete") {
    await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  }
  // close() also fails the test if any script threw along the way, including
  // inside timers and click handlers.
  const close = () => {
    dom.window.close();
    assert.deepEqual(errors.map((e) => e.message), [], "script errors");
  };
  return { window: dom.window, document, errors, close };
}

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition not met within " + ms + "ms");
}

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

for (const page of PAGES) {
  test(`${page}: loads cleanly with the basics in place`, async () => {
    const { document, errors, close } = await open(page);
    assert.deepEqual(errors.map((e) => e.message), [], "script errors");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(document.querySelectorAll("h1").length, 1, "exactly one h1");
    assert.ok(document.querySelector('meta[name="description"]')?.content, "meta description");

    const ids = Array.from(document.querySelectorAll("[id]"), (el) => el.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");

    for (const btn of document.querySelectorAll("button")) {
      assert.ok(btn.textContent.trim() || btn.getAttribute("aria-label"), "every button has a name");
    }
    close();
  });
}

test("internal links point at pages and anchors that exist", async () => {
  for (const page of PAGES.filter((p) => p !== "404.html")) {
    const { document, close } = await open(page);
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (/^(https?:|mailto:)/.test(href)) continue;
      if (href.includes("TODO")) continue;
      const [file, hash] = href.split("#");
      const target = file || page;
      assert.ok(fs.existsSync(path.join(SITE, target)), `${page}: ${href} points at a missing file`);
      if (hash) {
        const html = fs.readFileSync(path.join(SITE, target), "utf8");
        assert.ok(html.includes(`id="${hash}"`), `${page}: ${href} points at a missing anchor`);
      }
    }
    close();
  }
});

test("home: each terminal command shows only its own output", async () => {
  const { document, close } = await open("index.html");
  const term = document.querySelector("[data-terminal]");
  term.setAttribute("data-delay", "0");
  for (const btn of term.querySelectorAll("[data-cmd]")) {
    click(btn);
    const id = btn.getAttribute("data-cmd");
    const visible = Array.from(term.querySelectorAll("[data-out]")).filter((o) => !o.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].getAttribute("data-out"), id);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(
      term.querySelector("[data-term-line]").textContent,
      btn.getAttribute("data-line") || btn.textContent
    );
    const source = term.querySelector("[data-term-source]").textContent;
    assert.match(source, btn.getAttribute("data-source") === "captured" ? /CAPTURED/ : /REPRESENTATIVE/);
    assert.ok(btn.querySelector(".cmd-repo").textContent.trim(), "every sample names its repo");
  }
  close();
});

for (const page of CASE_STUDIES) {
  test(`${page}: follows the seven-part case study outline`, async () => {
    const { document, close } = await open(page);
    const links = Array.from(document.querySelectorAll("nav.outline a"));
    assert.deepEqual(
      links.map((a) => a.textContent.replace(/^\d+/, "")),
      ["Problem", "Architecture", "Key decisions", "Failure scenarios", "Automated checks", "Trade-offs", "Lessons learned"]
    );
    for (const a of links) {
      assert.ok(document.getElementById(a.getAttribute("href").slice(1)), `${a.getAttribute("href")} exists`);
    }
    const eyebrows = Array.from(document.querySelectorAll(".eyebrow"), (e) => e.textContent.match(/^\/\/ (\d\d)/));
    const numbers = eyebrows.filter(Boolean).map((m) => Number(m[1]));
    assert.deepEqual([...new Set(numbers)], [1, 2, 3, 4, 5, 6, 7], "sections numbered 01 to 07, in order");
    close();
  });
}

for (const [scenario, alert, muted] of [
  ["site-silent", "SiteSilent", "DeviceSilent"],
  ["grid-trip", "PhaseVoltageCritical", "TurbineFault"],
]) {
  test(`ot: the ${scenario} replay ends in one page and one all-clear`, async () => {
    const { document, close } = await open("ot.html");
    const root = document.querySelector("[data-replay]");
    click(root.querySelector(`[data-replay-scenario="${scenario}"]`));
    const step = root.querySelector("[data-replay-step]");
    for (let i = 0; i < 40 && !step.disabled; i++) click(step);
    assert.equal(step.disabled, true, "steps run out at the end");

    const log = root.querySelector("[data-replay-log]").textContent;
    assert.equal((log.match(new RegExp(`FIRING +${alert}`, "g")) || []).length, 1, "paged once");
    assert.equal((log.match(new RegExp(`RESOLVED ${alert}`, "g")) || []).length, 1, "one all-clear");
    assert.ok(!log.includes(muted), `${muted} never reaches the receiver`);
    assert.match(root.querySelector('[data-stage="alertmanager"]').textContent + root.querySelector('[data-stage="receiver"]').textContent, /one all-clear|All-clear sent/i);
    assert.match(root.querySelector("[data-replay-clock]").textContent, /lab time (\d+):(\d\d) of \1:\2/);
    close();
  });
}

test("ot: playing the replay runs on its own to the end", async () => {
  const { document, close } = await open("ot.html");
  const root = document.querySelector("[data-replay]");
  root.setAttribute("data-speed", "0.1");
  const play = root.querySelector("[data-replay-play]");
  click(play);
  assert.equal(play.textContent, "Pause");
  await waitFor(() => root.querySelector("[data-replay-step]").disabled, 5000);
  assert.equal(play.textContent, "Replay");
  assert.match(root.querySelector("[data-replay-log]").textContent, /RESOLVED SiteSilent/);
  close();
});

test("ot: every boundary tab shows one panel, with allowed and denied paths", async () => {
  const { document, close } = await open("ot.html");
  const root = document.querySelector("#boundaries [data-tabs]");
  const tabs = Array.from(root.querySelectorAll("[data-tab]"));
  assert.equal(tabs.length, 5);
  for (const tab of tabs) {
    click(tab);
    const shown = Array.from(root.querySelectorAll("[data-panel]")).filter((p) => !p.hidden);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].getAttribute("data-panel"), tab.getAttribute("data-tab"));
    assert.ok(shown[0].querySelector(".mark-ok"), "an allowed path");
    assert.ok(shown[0].querySelector(".mark-no"), "a denied path");
    assert.equal(tab.getAttribute("aria-pressed"), "true");
  }
  close();
});

test("ot: the scenario explorer has a panel per incident, captured ones with evidence", async () => {
  const { document, close } = await open("ot.html");
  const root = document.querySelector("#failures [data-tabs]");
  const tabs = Array.from(root.querySelectorAll("[data-tab]"));
  assert.equal(tabs.length, 12);
  assert.equal(root.querySelectorAll("[data-panel]").length, 12);
  const visible = () => Array.from(root.querySelectorAll("[data-panel]")).filter((p) => !p.hidden);

  assert.equal(visible().length, 1, "one incident shown at a time");
  for (const tab of tabs) {
    click(tab);
    assert.equal(visible().length, 1);
    const panel = visible()[0];
    assert.equal(panel.getAttribute("data-panel"), tab.getAttribute("data-tab"));
    assert.ok(panel.querySelectorAll(".steps li").length >= 2, "has a timeline");
    if (tab.textContent.includes("captured")) {
      assert.match(panel.querySelector(".evidence pre").textContent, /\[(oncall|team)\] FIRING/);
    }
  }
  close();
});

for (const [page, nodeName] of [
  ["ot.html", "Alertmanager"],
  ["platform.html", "RDS PostgreSQL"],
  ["lab.html", "Alertmanager"],
]) {
  test(`${page}: clicking a diagram component updates the inspector`, async () => {
    const { document, close } = await open(page);
    const node = Array.from(document.querySelectorAll(".node")).find(
      (n) => n.getAttribute("data-name") === nodeName
    );
    click(node);
    assert.equal(document.querySelector('[data-insp="name"]').textContent, nodeName);
    assert.equal(document.querySelector('[data-insp="what"]').textContent, node.getAttribute("data-what"));
    assert.equal(document.querySelectorAll('.node[aria-pressed="true"]').length, 1);
    close();
  });
}

test("platform: a clean run stops at the approval gate, then deploys once approved", async () => {
  const { document, close } = await open("platform.html");
  const root = document.querySelector("[data-pipeline]");
  root.setAttribute("data-tick", "1");
  const stages = () => Array.from(root.querySelectorAll(".stage"), (s) => s.getAttribute("data-status"));
  const approve = root.querySelector("[data-approve]");

  click(root.querySelector("[data-run]"));
  await waitFor(() => stages().includes("waiting"));
  const gate = stages().indexOf("waiting");
  assert.ok(root.querySelectorAll(".stage")[gate].hasAttribute("data-gate"), "waits at the gated stage");
  assert.ok(stages().slice(0, gate).every((s) => s === "passed"));
  assert.equal(approve.hidden, false);

  click(approve);
  await waitFor(() => stages().every((s) => s === "passed"));
  assert.equal(root.querySelector("[data-banner]").getAttribute("data-tone"), "ok");
  assert.equal(approve.hidden, true);
  close();
});

test("platform: a security finding stops the run before plan and apply", async () => {
  const { document, close } = await open("platform.html");
  const root = document.querySelector("[data-pipeline]");
  root.setAttribute("data-tick", "1");
  root.querySelector("[data-fail-toggle]").checked = true;
  const stages = () => Array.from(root.querySelectorAll(".stage"), (s) => s.getAttribute("data-status"));

  click(root.querySelector("[data-run]"));
  await waitFor(() => stages().includes("failed"));
  const failed = stages().indexOf("failed");
  assert.ok(root.querySelectorAll(".stage")[failed].hasAttribute("data-fail"), "fails at the scan");
  assert.ok(stages().slice(failed + 1).every((s) => s === "skipped"));
  assert.match(root.querySelector("[data-log-text]").textContent, /potential problem/);
  assert.equal(root.querySelector("[data-banner]").getAttribute("data-tone"), "bad");
  close();
});

test("platform: the drift toggle swaps the report", async () => {
  const { document, close } = await open("platform.html");
  const sync = document.querySelector('[data-drift-state="sync"]');
  const drift = document.querySelector('[data-drift-state="drift"]');
  const toggle = document.querySelector("[data-drift-toggle]");
  assert.equal(drift.hidden, true);
  click(toggle);
  assert.equal(sync.hidden, true);
  assert.equal(drift.hidden, false);
  assert.equal(document.querySelector("[data-drift-pill]").textContent, "DRIFT");
  click(toggle);
  assert.equal(drift.hidden, true);
  close();
});

test("lab: triggering a fault walks the alert to notified", async () => {
  const { document, close } = await open("lab.html");
  const root = document.querySelector("[data-sim]");
  root.setAttribute("data-speed", "0");
  const state = () => root.querySelector("[data-sim-state]").textContent;
  const current = () => root.querySelector('[data-lc][data-state="current"]').getAttribute("data-lc");

  assert.equal(state(), "INACTIVE");
  click(root.querySelector("[data-sim-trigger]"));
  await waitFor(() => current() === "3");
  assert.equal(state(), "FIRING · NOTIFIED");
  assert.equal(root.querySelector("[data-sim-trigger]").disabled, true);

  click(root.querySelector("[data-sim-reset]"));
  assert.equal(state(), "INACTIVE");
  assert.equal(current(), "0");
  close();
});

test("lab: switching scenario shows that rule and resets the lifecycle", async () => {
  const { document, close } = await open("lab.html");
  const root = document.querySelector("[data-sim]");
  click(root.querySelector('[data-scen="cert"]'));
  assert.equal(root.querySelector("[data-sim-alert]").textContent, "TLSCertExpiringSoon");
  assert.match(root.querySelector("[data-sim-rule]").textContent, /86400 < 30/);
  assert.match(root.querySelector('[data-lc="3"] .lc-desc').textContent, /team/);
  assert.match(root.querySelector("[data-sim-path]").getAttribute("d"), /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
  close();
});

test("take-home: the findings filter shows only the chosen area", async () => {
  const { document, close } = await open("qa-task.html");
  const root = document.querySelector("[data-findings]");
  const visible = () => Array.from(root.querySelectorAll("[data-area]")).filter((c) => !c.hidden);
  const total = root.querySelectorAll("[data-area]").length;

  for (const area of ["api", "ui", "ci"]) {
    click(root.querySelector(`[data-filter="${area}"]`));
    assert.ok(visible().length > 0, `${area} has findings`);
    assert.ok(visible().every((c) => c.getAttribute("data-area") === area));
    assert.equal(root.querySelector("[data-filter-count]").textContent, `${visible().length} of ${total}`);
  }
  click(root.querySelector('[data-filter="all"]'));
  assert.equal(visible().length, total);
  close();
});

test("take-home: polling never fails, and a longer sleep fails less", async () => {
  const { window, document, close } = await open("qa-task.html");
  const root = document.querySelector("[data-race]");
  root.setAttribute("data-seed", "7");
  const select = root.querySelector("[data-sleep]");
  const failed = (row) => Number(root.querySelector(`[data-row="${row}"] [data-sum-failed]`).textContent);
  const pick = (value) => {
    select.value = value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  };

  pick("250");
  const short = failed("sleep");
  assert.ok(short > 0, "a 250ms sleep loses some runs");
  assert.equal(failed("poll"), 0);
  assert.equal(root.querySelectorAll('[data-row="sleep"] [data-chart] g').length, 30);
  assert.equal(root.querySelectorAll('[data-row="poll"] [data-chart] g').length, 30);

  pick("2000");
  assert.ok(failed("sleep") <= short);
  assert.equal(failed("poll"), 0);
  assert.equal(root.querySelector("[data-sleep-label]").textContent, "2s");

  const hollow = root.querySelectorAll('[data-row="sleep"] path[fill="none"]').length;
  assert.equal(hollow, failed("sleep"), "every failed run is drawn hollow");

  click(root.querySelector("[data-race-run]"));
  assert.equal(root.getAttribute("data-seed"), "8");
  assert.equal(failed("poll"), 0);
  close();
});

test("take-home: the journey stepper walks all six steps", async () => {
  const { document, close } = await open("qa-task.html");
  const root = document.querySelector("#journey [data-stepper]");
  const shown = () => Array.from(root.querySelectorAll("[data-step-detail]")).filter((d) => !d.hidden);
  const next = root.querySelector("[data-step-next]");

  for (let i = 0; i < 5; i++) click(next);
  assert.equal(shown().length, 1);
  assert.equal(shown()[0].getAttribute("data-step-detail"), "5");
  assert.equal(next.disabled, true);

  click(root.querySelector('[data-step="2"]'));
  assert.equal(shown()[0].getAttribute("data-step-detail"), "2");
  assert.equal(root.querySelector('[data-step="2"]').getAttribute("aria-pressed"), "true");
  close();
});

test("lab: the install stepper moves forward and back within bounds", async () => {
  const { document, close } = await open("lab.html");
  const root = document.querySelector("[data-stepper]");
  const prev = root.querySelector("[data-step-prev]");
  const next = root.querySelector("[data-step-next]");
  const shown = () => Array.from(root.querySelectorAll("[data-step-detail]")).filter((d) => !d.hidden);

  assert.equal(prev.disabled, true);
  for (let i = 0; i < 10; i++) click(next);
  assert.equal(next.disabled, true);
  assert.equal(shown().length, 1);
  assert.equal(shown()[0].getAttribute("data-step-detail"), "4");
  click(prev);
  assert.equal(shown()[0].getAttribute("data-step-detail"), "3");
  close();
});
