"""Write one static SVG badge per deployment from app-data.json.
Run from the repo root: python3 build/badges.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((root / "app-data.json").read_text())
STATUS = {"current": ("Current", "#4fc98a"), "insufficient": ("Insufficient data", "#e3b341"), "revoked": ("Revoked", "#f47a72")}
for d in data["deployments"]:
    label, colour = STATUS[d["status"]]
    last = d["checks"][-1]
    measured = "—" if d["status"] == "insufficient" else f'{last["measured"]:.1f}%'
    left = "Orbit specimen" if d.get("specimen") else "Orbit verified"
    text = f'{d["id"]} · {measured} · {label}'
    w_left, w_right = 26 + 7 * len(left) + 10, 10 + 7 * len(text) + 10
    w = w_left + w_right
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="28" role="img" aria-label="{left}: {text}">
<title>{left}: {text}</title>
<rect width="{w}" height="28" rx="14" fill="#1c2320"/>
<rect width="{w_left + 14}" height="28" rx="14" fill="#0e1311"/>
<rect x="{w_left - 14}" width="14" height="28" fill="#0e1311"/>
<circle cx="14" cy="14" r="5.5" fill="none" stroke="#eef2ef" stroke-width="1.4"/>
<circle cx="18" cy="10" r="1.8" fill="{colour}"/>
<g font-family="IBM Plex Mono, ui-monospace, Menlo, monospace" font-size="11.5">
<text x="26" y="18" fill="#eef2ef">{left}</text>
<text x="{w_left + 10}" y="18" fill="{colour}">{text}</text>
</g>
</svg>'''
    (root / "badge" / f'{d["id"]}.svg').write_text(svg)
    print("badge", d["id"], w)
