// Platform case study: pipeline replay with a manual approval gate and an
// optional security finding, plus the drift report toggle.
(function () {
  "use strict";

  const LABEL = {
    queued: "queued",
    running: "running",
    waiting: "waiting for approval",
    passed: "passed",
    failed: "failed",
    skipped: "skipped",
  };

  const pipeline = document.querySelector("[data-pipeline]");
  if (pipeline) initPipeline(pipeline);

  const drift = document.querySelector("[data-drift-demo]");
  if (drift) initDrift(drift);

  function initPipeline(root) {
    const stages = Array.from(root.querySelectorAll(".stage"));
    const failToggle = root.querySelector("[data-fail-toggle]");
    const runBtn = root.querySelector("[data-run]");
    const runLabel = root.querySelector("[data-run-label]");
    const approveBtn = root.querySelector("[data-approve]");
    const banner = root.querySelector("[data-banner]");
    const bannerText = root.querySelector("[data-banner-text]");
    const logTitle = root.querySelector("[data-log-title]");
    const logStatus = root.querySelector("[data-log-status]");
    const logText = root.querySelector("[data-log-text]");

    const FAIL_AT = stages.findIndex((s) => s.hasAttribute("data-fail"));
    const GATE_AT = stages.findIndex((s) => s.hasAttribute("data-gate"));
    const nameOf = (i) => stages[i].querySelector(".stage-name").textContent;

    let status = stages.map(() => "queued");
    let phase = "idle";
    let current = -1;
    let selected = 0;
    let failMode = false;
    let timer = null;

    function tick() {
      return Number(root.getAttribute("data-tick") || 750);
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function logFor(i) {
      const stage = stages[i];
      switch (status[i]) {
        case "failed":
          return stage.getAttribute("data-fail");
        case "passed":
          return stage.getAttribute("data-log");
        case "running":
          return stage.getAttribute("data-log").split("\n")[0] + "\n...";
        case "waiting":
          return "The plan is ready. Apply waits until someone approves it in the production environment.";
        case "skipped":
          return "Skipped. An earlier stage failed.";
        default:
          return phase === "idle" ? "Waiting for a run." : "Queued.";
      }
    }

    function render() {
      stages.forEach((stage, i) => {
        stage.setAttribute("data-status", status[i]);
        stage.setAttribute("aria-pressed", String(i === selected));
        stage.querySelector("[data-status-text]").textContent = LABEL[status[i]];
      });

      logTitle.textContent = "stage " + (selected + 1) + " · " + nameOf(selected);
      logStatus.textContent = LABEL[status[selected]];
      logText.textContent = logFor(selected);

      const total = stages.length;
      const banners = {
        idle: () => ["idle", "Press Run pipeline to replay a run."],
        running: () => ["run", "Running stage " + (current + 1) + " of " + total + ": " + nameOf(current)],
        waiting: () => ["wait", "The plan is ready. Apply waits for approval in the production environment."],
        passed: () => ["ok", "All " + total + " stages passed. Deployed, and the health check is green."],
        failed: () => ["bad", "Stopped at the security scan. Nothing was planned or applied."],
      };
      const [tone, text] = banners[phase]();
      banner.setAttribute("data-tone", tone);
      bannerText.textContent = text;
      approveBtn.hidden = phase !== "waiting";

      runBtn.disabled = phase === "running";
      runLabel.textContent = phase === "running" ? "Running" : phase === "idle" ? "Run pipeline" : "Run again";
    }

    function advance() {
      if (failMode && current === FAIL_AT) {
        status[current] = "failed";
        for (let j = current + 1; j < status.length; j++) status[j] = "skipped";
        phase = "failed";
        selected = current;
        stop();
        render();
        return;
      }

      status[current] = "passed";
      current += 1;

      if (current >= stages.length) {
        phase = "passed";
        selected = stages.length - 1;
        stop();
      } else if (current === GATE_AT) {
        status[current] = "waiting";
        phase = "waiting";
        selected = current;
        stop();
      } else {
        status[current] = "running";
        selected = current;
      }
      render();
    }

    function start() {
      stop();
      failMode = failToggle.checked;
      status = stages.map(() => "queued");
      current = 0;
      status[0] = "running";
      selected = 0;
      phase = "running";
      render();
      timer = setInterval(advance, tick());
    }

    function approve() {
      if (phase !== "waiting") return;
      status[current] = "running";
      phase = "running";
      render();
      timer = setInterval(advance, tick());
    }

    runBtn.addEventListener("click", start);
    approveBtn.addEventListener("click", approve);
    stages.forEach((stage, i) => {
      stage.addEventListener("click", () => {
        selected = i;
        render();
      });
    });

    render();
  }

  function initDrift(root) {
    const btn = root.querySelector("[data-drift-toggle]");
    const pill = root.querySelector("[data-drift-pill]");
    const inSync = root.querySelector('[data-drift-state="sync"]');
    const drifted = root.querySelector('[data-drift-state="drift"]');
    let on = false;

    btn.addEventListener("click", () => {
      on = !on;
      btn.textContent = on ? "Revert the console change" : "Simulate a console change";
      inSync.hidden = on;
      drifted.hidden = !on;
      pill.textContent = on ? "DRIFT" : "IN SYNC";
      pill.className = "pill " + (on ? "pill-bad" : "pill-ok");
    });
  }
})();
