(() => {
  const stage = document.querySelector("[data-demo-stage]");
  const steps = [...document.querySelectorAll("[data-demo-step]")];
  const previous = document.querySelector("[data-demo-prev]");
  const next = document.querySelector("[data-demo-next]");
  const position = document.querySelector("[data-demo-position]");
  if (!stage || !steps.length) return;

  const names = steps.map((step) => step.dataset.demoStep);

  const activate = (name) => {
    stage.dataset.demoActive = name;
    const index = names.indexOf(name);
    if (position && index >= 0) position.textContent = `${index + 1} / ${names.length}`;
    steps.forEach((step) => {
      const active = step.dataset.demoStep === name;
      step.classList.toggle("is-active", active);
      if (active) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  };

  const move = (direction) => {
    const current = names.indexOf(stage.dataset.demoActive);
    const index = (current + direction + names.length) % names.length;
    activate(names[index]);
  };

  previous?.addEventListener("click", () => move(-1));
  next?.addEventListener("click", () => move(1));

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) activate(visible.target.dataset.demoStep);
  }, { rootMargin: "-32% 0px -42% 0px", threshold: [0, .1, .3, .6] });

  steps.forEach((step) => observer.observe(step));
})();
