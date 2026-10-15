// Shared behaviour: clickable diagrams, live repo status from the GitHub API,
// and the build stamp the deploy job writes to build.json.
(function () {
  "use strict";

  // Diagrams: each .node carries its own description in data attributes,
  // so the page reads fine without JavaScript and the script only swaps text.
  document.querySelectorAll("[data-diagram]").forEach((box) => {
    const nodes = Array.from(box.querySelectorAll(".node"));
    const fields = {};
    box.querySelectorAll("[data-insp]").forEach((el) => {
      fields[el.getAttribute("data-insp")] = el;
    });
    nodes.forEach((node) => {
      node.addEventListener("click", () => {
        nodes.forEach((n) => n.setAttribute("aria-pressed", String(n === node)));
        ["kind", "name", "what", "file"].forEach((key) => {
          if (fields[key]) fields[key].textContent = node.getAttribute("data-" + key) || "";
        });
      });
    });
  });

  // Steppers: buttons [data-step], panels [data-step-detail], Back/Next.
  document.querySelectorAll("[data-stepper]").forEach((root) => {
    const buttons = Array.from(root.querySelectorAll("[data-step]"));
    const details = Array.from(root.querySelectorAll("[data-step-detail]"));
    const prev = root.querySelector("[data-step-prev]");
    const next = root.querySelector("[data-step-next]");
    const last = buttons.length - 1;
    let current = 0;

    function go(i) {
      current = Math.max(0, Math.min(last, i));
      buttons.forEach((b, k) => b.setAttribute("aria-pressed", String(k === current)));
      details.forEach((d, k) => {
        d.hidden = k !== current;
      });
      prev.disabled = current === 0;
      next.disabled = current === last;
    }

    buttons.forEach((b, k) => b.addEventListener("click", () => go(k)));
    prev.addEventListener("click", () => go(current - 1));
    next.addEventListener("click", () => go(current + 1));
    go(0);
  });

  const canFetch = typeof window.fetch === "function";

  // Small session cache so a visitor clicking around doesn't burn through
  // the unauthenticated API limit (60 requests per hour per IP).
  const TTL_MS = 10 * 60 * 1000;

  function cacheGet(key) {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return Date.now() - entry.t < TTL_MS ? entry.d : null;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) {
      // Storage can be full or blocked. The status just won't be cached.
    }
  }

  async function getJSON(url) {
    const res = await window.fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    return res.json();
  }

  async function repoStatus(repo, workflow) {
    const key = "repo-status:" + repo + ":" + workflow;
    const cached = cacheGet(key);
    if (cached) return cached;
    const base = "https://api.github.com/repos/" + repo;
    const [meta, runs] = await Promise.all([
      getJSON(base),
      getJSON(base + "/actions/workflows/" + workflow + "/runs?branch=main&status=completed&per_page=1"),
    ]);
    const run = runs.workflow_runs && runs.workflow_runs[0];
    const status = {
      conclusion: run ? run.conclusion : null,
      pushedAt: meta.pushed_at || null,
    };
    cacheSet(key, status);
    return status;
  }

  function relativeTime(iso) {
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const units = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
    ];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return "just now";
  }

  function showStatus(el, status) {
    const pill = el.querySelector("[data-ci]");
    const pushed = el.querySelector("[data-pushed]");
    if (pill) {
      const tone = { success: ["pill-ok", "CI passing"], failure: ["pill-bad", "CI failing"] }[status.conclusion];
      pill.className = "pill " + (tone ? tone[0] : "pill-muted");
      pill.textContent = tone ? tone[1] : "CI unknown";
    }
    if (pushed && status.pushedAt) pushed.textContent = "pushed " + relativeTime(status.pushedAt);
  }

  if (canFetch) {
    document.querySelectorAll("[data-repo]").forEach((el) => {
      repoStatus(el.getAttribute("data-repo"), el.getAttribute("data-workflow") || "ci.yml")
        .then((status) => showStatus(el, status))
        .catch(() => {
          const pill = el.querySelector("[data-ci]");
          if (pill) pill.hidden = true;
        });
    });

    const build = document.querySelector("[data-build]");
    if (build) {
      window
        .fetch("build.json", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((info) => {
          if (!info || !info.sha) return;
          build.textContent = info.sha.slice(0, 7);
          if (info.run_url) build.href = info.run_url;
        })
        .catch(() => {});
    }
  }
})();
