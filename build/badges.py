"""Write one static SVG badge per deployment from app-data.json.
Run from the repo root: python3 build/badges.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((root / "app-data.json").read_text())
STATUS = {"current": ("Current", "#1E7A47"), "insufficient": ("Insufficient data", "#946000"), "revoked": ("Revoked", "#B23A30")}
for d in data["deployments"]:
    label, colour = STATUS[d["status"]]
    last = d["checks"][-1]
    measured = "—" if d["status"] == "insufficient" else f'{last["measured"]:.1f}%'
    left = "Orbit specimen" if d.get("specimen") else "Orbit verified"
    text = f'{d["id"]} · {measured} · {label}'
    w_left, w_right = 26 + 7 * len(left) + 16, 12 + 7 * len(text) + 12
    w = w_left + w_right
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="28" role="img" aria-label="{left}: {text}">
<title>{left}: {text}</title>
<rect width="{w}" height="28" rx="14" fill="#F0EEE6"/>
<rect x="0.5" y="0.5" width="{w-1}" height="27" rx="13.5" fill="none" stroke="#D9D6CC"/>
<rect width="{w_left + 14}" height="28" rx="14" fill="#141413"/>
<rect x="{w_left - 14}" width="14" height="28" fill="#141413"/>
<circle cx="14" cy="14" r="5.5" fill="none" stroke="#FAF9F5" stroke-width="1.4"/>
<circle cx="18" cy="10" r="1.8" fill="#D4744F"/>
<g font-family="IBM Plex Mono, ui-monospace, Menlo, monospace" font-size="11.5">
<text x="26" y="18" fill="#FAF9F5">{left}</text>
<text x="{w_left + 12}" y="18" fill="{colour}">{text}</text>
</g>
</svg>'''
    (root / "badge" / f'{d["id"]}.svg').write_text(svg)
    print("badge", d["id"], w)
