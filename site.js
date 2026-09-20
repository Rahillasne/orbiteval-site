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
  const set = (open) => { menuBtn.setAttribute("aria-expanded", String(open)); mnav.hidden = !open; document.body.classList.toggle("menu-open", open); };
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

// Open a collapsed section when a link points at it.
const openHash = () => { const el = location.hash && document.getElementById(location.hash.slice(1)); if (el && el.tagName === "DETAILS") el.open = true; };
openHash(); addEventListener("hashchange", openHash);

// Copy an address on click for people whose browser has no mail app.
document.querySelectorAll("[data-copy]").forEach((el) => {
  el.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(el.dataset.copy); el.textContent = "Copied"; setTimeout(() => (el.textContent = el.dataset.copy), 1400); }
    catch { location.href = "mailto:" + el.dataset.copy; }
  });
});
