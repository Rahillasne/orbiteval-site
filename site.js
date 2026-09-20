// Orbit site — no framework, no build step.
document.documentElement.classList.add("js");

// Paste a Calendly / Cal.com link here to send every "Book a demo" button straight to it.
// Leave it empty and the buttons go to demo.html, whose form composes an email.
const DEMO_URL = "";

document.querySelectorAll("[data-demo]").forEach((a) => {
  if (DEMO_URL) { a.href = DEMO_URL; a.target = "_blank"; a.rel = "noopener"; }
});

// Mark the current page in the nav.
const here = location.pathname.split("/").pop() || "index.html";
document.querySelectorAll(".pill__links a, .mnav a").forEach((a) => {
  if ((a.getAttribute("href") || "").split("#")[0] === here) a.setAttribute("aria-current", "page");
});

// Mobile menu.
const menuBtn = document.querySelector(".pill__menu");
const mnav = document.getElementById("mnav");
if (menuBtn && mnav) {
  const set = (open) => {
    menuBtn.setAttribute("aria-expanded", String(open));
    mnav.hidden = !open;
    document.body.classList.toggle("menu-open", open);
  };
  menuBtn.addEventListener("click", () => set(menuBtn.getAttribute("aria-expanded") !== "true"));
  mnav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => set(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
}

// Reveal blocks as they scroll into view.
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const toReveal = document.querySelectorAll("[data-reveal]");
if (reduce || !("IntersectionObserver" in window)) {
  toReveal.forEach((el) => el.classList.add("is-in"));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  toReveal.forEach((el) => io.observe(el));
}

// The four steps: click to choose one; otherwise they advance on their own.
document.querySelectorAll("[data-steps]").forEach((root) => {
  const items = [...root.querySelectorAll(".feat__item")];
  const panels = [...root.querySelectorAll(".panel")];
  const dwell = parseInt(root.dataset.dwell || "5200", 10);
  let i = 0, timer = null;
  const show = (n) => {
    i = n;
    items.forEach((it, k) => { it.classList.toggle("is-on", k === n); it.querySelector("button").setAttribute("aria-expanded", String(k === n)); });
    panels.forEach((p, k) => p.classList.toggle("is-on", k === n));
  };
  items.forEach((it, k) => it.querySelector("button").addEventListener("click", () => {
    clearInterval(timer); root.classList.add("feat--manual"); show(k);
  }));
  show(0);
  if (!reduce) timer = setInterval(() => show((i + 1) % items.length), dwell);
});

// Copy an address on click for people whose browser has no mail app.
document.querySelectorAll("[data-copy]").forEach((el) => {
  el.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(el.dataset.copy); el.textContent = "Copied"; setTimeout(() => (el.textContent = el.dataset.copy), 1400); }
    catch { location.href = "mailto:" + el.dataset.copy; }
  });
});
