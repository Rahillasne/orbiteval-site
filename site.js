// Orbit site — no framework, no build step.

// Paste a Calendly / Cal.com link here to route every "Book a demo" button to it.
// Leave empty to use email.
const DEMO_URL = "";

const MAILTO =
  "mailto:rahil@orbiteval.com" +
  "?subject=" + encodeURIComponent("Book a demo — Orbit verification") +
  "&body=" + encodeURIComponent(
    "Hi Rahil,\n\nI'd like a 30-minute demo.\n\nCompany:\nWhat the robot does:\nWhat it's claimed to achieve:\nA time that works for me:\n"
  );

document.querySelectorAll("[data-demo]").forEach((a) => {
  a.href = DEMO_URL || MAILTO;
  if (DEMO_URL) { a.target = "_blank"; a.rel = "noopener"; }
});

// Mark the current page in the nav.
const here = location.pathname.split("/").pop() || "index.html";
document.querySelectorAll(".nav__links a").forEach((a) => {
  if ((a.getAttribute("href") || "").split("#")[0] === here) a.setAttribute("aria-current", "page");
});

// Copy the mailto address on click for people whose browser has no mail app.
document.querySelectorAll("[data-copy]").forEach((el) => {
  el.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(el.dataset.copy); el.textContent = "Copied"; setTimeout(() => (el.textContent = el.dataset.copy), 1400); }
    catch { location.href = "mailto:" + el.dataset.copy; }
  });
});
