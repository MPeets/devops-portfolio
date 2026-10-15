// Lab case study: alert simulator built on the repo's real rules.
// The offline install stepper is the shared one in common.js.
(function () {
  "use strict";

  const flat = (value, n) => Array.from({ length: n }, () => value);
  const countdown = (from, n) => Array.from({ length: n }, (_, i) => from - i);

  // Rules are copied from prometheus/rules/alerts.yml. The series are made up.
  const SCENARIOS = {
    target: {
      alert: "TargetDown",
      rule: 'alert: TargetDown\nexpr: up{job!~"blackbox-(http|icmp|tls)"} == 0\nfor: 2m\nlabels:\n  severity: critical',
      metric: 'up{job="node"}',
      series: flat(1, 13).concat(flat(0, 11)),
      min: -0.2,
      max: 1.2,
      threshold: 0.5,
      thresholdText: "fires at 0",
      format: (v) => String(v),
      start: "-12m",
      forDuration: "2m",
      route: "oncall",
      note: "Probe jobs are excluded on purpose. ProbeFailed covers those, so one failure never raises two alerts.",
    },
    disk: {
      alert: "HostDiskAlmostFull",
      rule: "alert: HostDiskAlmostFull\nexpr: instance_mountpoint:filesystem_avail:ratio < 0.05\nfor: 5m\nlabels:\n  severity: critical",
      metric: "filesystem available",
      series: [38, 38, 37, 37, 36, 36, 35, 35, 34, 34, 33, 33, 29, 23, 17, 11, 7, 4, 3, 3, 2, 2, 2, 2],
      min: 0,
      max: 45,
      threshold: 5,
      thresholdText: "fires below 5%",
      format: (v) => v + "%",
      start: "-3h",
      forDuration: "5m",
      route: "oncall",
      note: "Its sibling HostDiskWillFillIn24h would have warned hours earlier. It runs predict_linear over 6 hours of history to say when the disk runs out, not just that it is low.",
    },
    cert: {
      alert: "TLSCertExpiringSoon",
      rule: "alert: TLSCertExpiringSoon\nexpr: (probe_ssl_earliest_cert_expiry - time()) / 86400 < 30\nfor: 15m\nlabels:\n  severity: warning",
      metric: "days until expiry",
      series: countdown(46, 24),
      min: 0,
      max: 50,
      threshold: 30,
      thresholdText: "fires under 30 days",
      format: (v) => v + " days",
      start: "-24d",
      forDuration: "15m",
      route: "team",
      note: "The lab runs its own CA and a tls-demo endpoint, so this watches a real certificate. Under 7 days, TLSCertExpiryCritical takes over and goes to oncall.",
    },
    probe: {
      alert: "ProbeFailed",
      rule: "alert: ProbeFailed\nexpr: probe_success == 0\nfor: 2m\nlabels:\n  severity: critical",
      metric: "probe_success",
      series: flat(1, 14).concat(flat(0, 10)),
      min: -0.2,
      max: 1.2,
      threshold: 0.5,
      thresholdText: "fires at 0",
      format: (v) => String(v),
      start: "-12m",
      forDuration: "2m",
      route: "oncall",
      note: "Probed from the outside, the way a user would hit it. Catches a dead service even when its host looks perfectly healthy.",
    },
  };

  const breaches = {
    target: (v) => v === 0,
    disk: (v) => v < 5,
    cert: (v) => v < 30,
    probe: (v) => v === 0,
  };

  const STATE = ["INACTIVE", "PENDING", "FIRING", "FIRING · NOTIFIED"];
  const PILL = ["pill-ok", "pill-warn", "pill-bad", "pill-bad"];
  const DOT = ["#7fb8d6", "#f2a93b", "#ff6b5b", "#ff6b5b"];
  const W = 640;
  const H = 220;
  const PAD_X = 12;
  const PAD_Y = 16;

  const sim = document.querySelector("[data-sim]");
  if (sim) initSimulator(sim);

  function initSimulator(root) {
    const $ = (sel) => root.querySelector(sel);
    const buttons = Array.from(root.querySelectorAll("[data-scen]"));
    const steps = Array.from(root.querySelectorAll("[data-lc]"));
    const trigger = $("[data-sim-trigger]");
    const reset = $("[data-sim-reset]");
    let scenario = "target";
    let phase = 0;
    let timers = [];

    const xAt = (i) => PAD_X + (i * (W - 2 * PAD_X)) / 23;
    const yAt = (v, s) => PAD_Y + (1 - (v - s.min) / (s.max - s.min)) * (H - 2 * PAD_Y);

    function clearTimers() {
      timers.forEach((t) => clearTimeout(t));
      timers = [];
    }

    function speed() {
      return Number(root.getAttribute("data-speed") || 1);
    }

    function render() {
      const s = SCENARIOS[scenario];
      const cross = s.series.findIndex(breaches[scenario]);
      const visible = [12, Math.min(24, cross + 2), Math.min(24, cross + 6), 24][phase];
      const points = s.series.slice(0, visible);
      const last = points[points.length - 1];
      const thresholdY = yAt(s.threshold, s).toFixed(1);

      $("[data-sim-path]").setAttribute(
        "d",
        points.map((v, i) => (i ? "L " : "M ") + xAt(i).toFixed(1) + " " + yAt(v, s).toFixed(1)).join(" ")
      );
      const dot = $("[data-sim-dot]");
      dot.setAttribute("cx", xAt(points.length - 1).toFixed(1));
      dot.setAttribute("cy", yAt(last, s).toFixed(1));
      dot.setAttribute("fill", DOT[phase]);
      const line = $("[data-sim-thrline]");
      line.setAttribute("y1", thresholdY);
      line.setAttribute("y2", thresholdY);
      $("[data-sim-chart]").setAttribute("aria-label", s.metric + " over simulated time, now " + s.format(last));

      $("[data-sim-alert]").textContent = s.alert;
      $("[data-sim-rule]").textContent = s.rule;
      $("[data-sim-metric]").textContent = s.metric;
      $("[data-sim-now]").textContent = s.format(last);
      $("[data-sim-thr]").textContent = s.thresholdText;
      $("[data-sim-start]").textContent = s.start;
      $("[data-sim-note]").textContent = s.note;

      const pill = $("[data-sim-state]");
      pill.textContent = STATE[phase];
      pill.className = "pill " + PILL[phase];

      const descs = [
        "Expression is false. Nothing to do.",
        "Condition is true. Waiting out for: " + s.forDuration + " so a blip never pages anyone.",
        "Still true after " + s.forDuration + ". Prometheus sends it to Alertmanager.",
        "Routed to " + s.route + " and delivered to webhook-logger.",
      ];
      steps.forEach((li, k) => {
        li.setAttribute("data-state", k < phase ? "done" : k === phase ? "current" : "next");
        li.querySelector(".lc-desc").textContent = descs[k];
      });

      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-scen") === scenario)));
      trigger.disabled = phase > 0;
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        clearTimers();
        scenario = btn.getAttribute("data-scen");
        phase = 0;
        render();
      });
    });

    trigger.addEventListener("click", () => {
      if (phase > 0) return;
      clearTimers();
      phase = 1;
      render();
      const k = speed();
      timers.push(setTimeout(() => { phase = 2; render(); }, 1800 * k));
      timers.push(setTimeout(() => { phase = 3; render(); }, 3400 * k));
    });

    reset.addEventListener("click", () => {
      clearTimers();
      phase = 0;
      render();
    });

    render();
  }
})();
