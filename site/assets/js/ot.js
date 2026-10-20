// OT case study: replays one incident through the pipeline, stage by stage.
// Timings follow the lab's own settings: collector every 10 s, the rules'
// "for" and keep_firing_for, Alertmanager's 30 s group_wait and 5 min
// group_interval. Receiver lines are the ones captured from the lab.
(function () {
  "use strict";

  const STAGES = ["devices", "collector", "prometheus", "alertmanager", "receiver"];

  const START = {
    devices: ["ok", "All seven devices answering."],
    collector: ["ok", "Reading every device through the gateway, every 10 s."],
    prometheus: ["ok", "Scraping the collector. Nothing pending."],
    alertmanager: ["idle", "Nothing to route."],
    receiver: ["idle", "Quiet, apart from the Watchdog."],
  };

  const SITE_FIRING = "[oncall] FIRING   SiteSilent severity=critical site=wind-a: No data from any device at wind-a";
  const SITE_RESOLVED = "[oncall] RESOLVED SiteSilent severity=critical site=wind-a: No data from any device at wind-a";
  const VOLT_FIRING = "[oncall] FIRING   PhaseVoltageCritical severity=critical device=wt-01 phase=l1 site=wind-a: L1 at wt-01 is 0.800 pu, outside ±10%";
  const VOLT_RESOLVED = "[oncall] RESOLVED PhaseVoltageCritical severity=critical device=wt-01 phase=l1 site=wind-a: L1 at wt-01 is 0.800 pu, outside ±10%";

  const SCENARIOS = {
    "site-silent": {
      total: 480,
      events: [
        { t: 0, stage: "devices", tone: "silent", text: "Wind park A drops off the network: wt-01, wt-02 and wt-03 stop answering." },
        { t: 10, stage: "collector", tone: "wait", text: "Reads from the three turbines time out. Their gather counters stop; the other four keep counting." },
        { t: 60, stage: "prometheus", tone: "wait", text: "The turbines show as no data, purple on the dashboards. SiteSilent and three DeviceSilent alerts go pending." },
        { t: 120, stage: "prometheus", tone: "bad", text: "SiteSilent and DeviceSilent ×3 are firing and go to Alertmanager." },
        { t: 120, stage: "alertmanager", tone: "wait", text: "DeviceSilent ×3 muted: SiteSilent already covers wind-a. SiteSilent waits 30 s for related alerts." },
        { t: 150, stage: "alertmanager", tone: "bad", text: "SiteSilent is critical, so it goes to on-call." },
        { t: 150, stage: "receiver", tone: "bad", text: "On-call is paged once, for the site.", log: SITE_FIRING, cls: "page" },
        { t: 180, stage: "devices", tone: "ok", text: "The link comes back. All seven devices answer again." },
        { t: 190, stage: "collector", tone: "ok", text: "Every gather counter is moving again." },
        { t: 210, stage: "prometheus", tone: "ok", text: "The turbines are reachable. SiteSilent and DeviceSilent resolve." },
        { t: 210, stage: "alertmanager", tone: "wait", text: "Resolved. The all-clear waits for the group's next interval, 5 min after the page. DeviceSilent was never sent, so it gets no all-clear either." },
        { t: 450, stage: "alertmanager", tone: "ok", text: "All-clear sent to on-call." },
        { t: 450, stage: "receiver", tone: "ok", text: "One page and one all-clear, for the site. Nothing about the three turbines.", log: SITE_RESOLVED, cls: "ok" },
      ],
    },
    "grid-trip": {
      total: 450,
      events: [
        { t: 0, stage: "devices", tone: "wait", text: "Phase L1 at wt-01 drops to 0.80 pu, under the turbine's trip setting." },
        { t: 10, stage: "prometheus", tone: "wait", text: "PhaseVoltageCritical goes pending for wt-01, L1." },
        { t: 30, stage: "devices", tone: "bad", text: "wt-01's grid protection trips it. It stops producing and turns red." },
        { t: 30, stage: "collector", tone: "ok", text: "Still reading wt-01. It answers, it just isn't producing: no output, not no data." },
        { t: 40, stage: "prometheus", tone: "wait", text: "PhaseVoltageCritical pending. TurbineFault pending too, for its 2 minutes." },
        { t: 90, stage: "prometheus", tone: "bad", text: "PhaseVoltageCritical is firing and goes to Alertmanager. TurbineFault is still pending." },
        { t: 90, stage: "alertmanager", tone: "wait", text: "PhaseVoltageCritical waits 30 s for related alerts." },
        { t: 120, stage: "alertmanager", tone: "bad", text: "PhaseVoltageCritical is critical, so it goes to on-call." },
        { t: 120, stage: "receiver", tone: "bad", text: "On-call is paged once, for the voltage.", log: VOLT_FIRING, cls: "page" },
        { t: 160, stage: "prometheus", tone: "bad", text: "TurbineFault fires too and goes to Alertmanager." },
        { t: 160, stage: "alertmanager", tone: "mute", text: "TurbineFault muted: the voltage alert on the same device already says why wt-01 stopped." },
        { t: 240, stage: "devices", tone: "wait", text: "The voltage is back. wt-01 waits 60 s before it reconnects." },
        { t: 250, stage: "prometheus", tone: "wait", text: "The voltage is fine, but PhaseVoltageCritical keeps firing for 2 more minutes to cover the reconnect." },
        { t: 300, stage: "devices", tone: "ok", text: "wt-01 reconnects and produces again." },
        { t: 300, stage: "alertmanager", tone: "mute", text: "TurbineFault resolves while still muted, so its all-clear is never sent either." },
        { t: 370, stage: "prometheus", tone: "ok", text: "PhaseVoltageCritical resolves." },
        { t: 370, stage: "alertmanager", tone: "wait", text: "Resolved. The all-clear waits for the group's next interval, 5 min after the page." },
        { t: 420, stage: "alertmanager", tone: "ok", text: "All-clear sent to on-call." },
        { t: 420, stage: "receiver", tone: "ok", text: "One page and one all-clear, for the voltage. Nothing about a turbine fault.", log: VOLT_RESOLVED, cls: "ok" },
      ],
    },
  };

  const clockText = (t) => {
    const s = Math.max(0, Math.round(t));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  function initReplay(root) {
    const buttons = Array.from(root.querySelectorAll("[data-replay-scenario]"));
    const play = root.querySelector("[data-replay-play]");
    const step = root.querySelector("[data-replay-step]");
    const restart = root.querySelector("[data-replay-restart]");
    const clock = root.querySelector("[data-replay-clock]");
    const fill = root.querySelector("[data-replay-fill]");
    const log = root.querySelector("[data-replay-log]");
    const cards = {};
    STAGES.forEach((id) => {
      const card = root.querySelector(`[data-stage="${id}"]`);
      cards[id] = { card, state: card.querySelector("[data-stage-state]") };
    });

    let name = "site-silent";
    let t = -1;
    let next = 0;
    let timer = null;

    const scenario = () => SCENARIOS[name];
    // Milliseconds of real time per second of lab time.
    const speed = () => Number(root.getAttribute("data-speed") || 40);

    function setStage(id, tone, text, flash) {
      const { card, state } = cards[id];
      card.setAttribute("data-tone", tone);
      state.textContent = text;
      if (flash) {
        card.classList.remove("changed");
        void card.offsetWidth;
        card.classList.add("changed");
      }
    }

    function renderClock() {
      const s = scenario();
      clock.textContent = "lab time " + clockText(Math.max(t, 0)) + " of " + clockText(s.total);
      fill.style.width = (Math.max(t, 0) / s.total) * 100 + "%";
    }

    function apply(event) {
      setStage(event.stage, event.tone, event.text, true);
      if (event.log) {
        if (log.getAttribute("data-empty") === "true") {
          log.textContent = "";
          log.setAttribute("data-empty", "false");
        }
        const line = document.createElement("span");
        line.className = event.cls || "";
        line.textContent = clockText(event.t) + "  " + event.log + "\n";
        log.appendChild(line);
      }
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      play.textContent = t >= scenario().total ? "Replay" : "Play";
    }

    function finished() {
      return next >= scenario().events.length && t >= scenario().total;
    }

    function advanceTo(target) {
      const events = scenario().events;
      t = Math.min(target, scenario().total);
      while (next < events.length && events[next].t <= t) {
        apply(events[next]);
        next += 1;
      }
      renderClock();
      step.disabled = finished();
      if (finished()) stop();
    }

    function reset() {
      stop();
      t = -1;
      next = 0;
      STAGES.forEach((id) => setStage(id, START[id][0], START[id][1], false));
      log.textContent = "Press Play, or Step through it one change at a time.";
      log.setAttribute("data-empty", "true");
      step.disabled = false;
      play.textContent = "Play";
      renderClock();
    }

    play.addEventListener("click", () => {
      if (timer) {
        stop();
        return;
      }
      if (finished()) reset();
      play.textContent = "Pause";
      const tick = 100;
      timer = setInterval(() => advanceTo((t < 0 ? 0 : t) + tick / speed()), tick);
      if (t < 0) advanceTo(0);
    });

    step.addEventListener("click", () => {
      stop();
      const events = scenario().events;
      if (next < events.length) {
        // Jump to the next moment something changes, applying everything at that moment.
        advanceTo(events[next].t);
      } else {
        advanceTo(scenario().total);
      }
    });

    restart.addEventListener("click", reset);

    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        name = b.getAttribute("data-replay-scenario");
        buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        reset();
      });
    });

    reset();
  }

  document.querySelectorAll("[data-replay]").forEach(initReplay);
})();
