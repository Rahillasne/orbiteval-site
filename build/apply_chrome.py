"""Write the shared header and footer (build/partials/) into every page that carries them.

    python3 build/apply_chrome.py          # rewrite pages in place
    python3 build/apply_chrome.py --check  # exit 1 if any page differs
"""
import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent
PAGES = ["index", "eu-check", "record", "claims", "decision", "real", "demo",
         "release-check", "calibration", "method"]
HEADER = re.compile(r'<header class="topbar" id="top">.*?</header>', re.S)
FOOTER = re.compile(r'<footer class="footer">.*?</footer>', re.S)


def main(argv):
    head = (SITE / "build" / "partials" / "nav.html").read_text(encoding="utf-8").strip()
    foot = (SITE / "build" / "partials" / "footer.html").read_text(encoding="utf-8").strip()
    changed = []
    for name in PAGES:
        f = SITE / (name + ".html")
        s = f.read_text(encoding="utf-8")
        if len(HEADER.findall(s)) != 1 or len(FOOTER.findall(s)) != 1:
            raise SystemExit("{}: expected exactly one header and one footer".format(f.name))
        new = FOOTER.sub(lambda m: foot, HEADER.sub(lambda m: head, s))
        if new != s:
            changed.append(f.name)
            if "--check" not in argv:
                f.write_text(new, encoding="utf-8")
    if "--check" in argv:
        if changed:
            print("chrome differs: " + ", ".join(changed))
            return 1
        print("chrome: all {} pages match".format(len(PAGES)))
        return 0
    print("chrome: rewrote " + (", ".join(changed) if changed else "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
