(() => {
  const stage = document.querySelector("[data-demo-stage]");
  const steps = [...document.querySelectorAll("[data-demo-step]")];
  if (!stage || !steps.length) return;

  const activate = (name) => {
    stage.dataset.demoActive = name;
    steps.forEach((step) => {
      const active = step.dataset.demoStep === name;
      step.classList.toggle("is-active", active);
      if (active) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  };

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) activate(visible.target.dataset.demoStep);
  }, { rootMargin: "-32% 0px -42% 0px", threshold: [0, .1, .3, .6] });

  steps.forEach((step) => observer.observe(step));
})();
