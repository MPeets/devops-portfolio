// Hero terminal: each command button reveals its pre-rendered output.
(function () {
  "use strict";

  const term = document.querySelector("[data-terminal]");
  if (!term) return;

  const buttons = Array.from(term.querySelectorAll("[data-cmd]"));
  const outputs = Array.from(term.querySelectorAll("[data-out]"));
  const cwd = term.querySelector("[data-term-cwd]");
  const line = term.querySelector("[data-term-line]");
  const running = term.querySelector("[data-term-running]");
  let timer = null;

  function delay() {
    const set = term.getAttribute("data-delay");
    if (set !== null) return Number(set);
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduce ? 0 : 450;
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-cmd");
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      cwd.textContent = btn.getAttribute("data-cwd");
      line.textContent = btn.textContent;
      outputs.forEach((out) => {
        out.hidden = true;
      });
      clearTimeout(timer);

      const show = () => {
        running.hidden = true;
        const out = term.querySelector('[data-out="' + id + '"]');
        if (out) out.hidden = false;
      };

      const wait = delay();
      if (wait === 0) {
        show();
        return;
      }
      running.hidden = false;
      timer = setTimeout(show, wait);
    });
  });
})();
