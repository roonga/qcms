# -*- coding: utf-8 -*-
"""
Build-time font fetch (runs ONCE at build; NO runtime network - data URIs only).
Downloads real woff2 (latin subset) for every font in fonts_config.FONTS, base64-
encodes them, and writes _fonts_b64.json for build.py to inline as data: URIs.

Sources:
  src='google'       -> fonts.gstatic.com via the css2 API (latin subset per weight)
  src='opendyslexic' -> official OFL repo antijingoist/opendyslexic (via jsdelivr gh)
Fallback for any miss: Fontsource on jsdelivr (the same OFL/Apache fonts, redistributed).
Each font records the source actually used so the embedded-source notice is honest.
Any font that cannot be fetched is reported (never faked).
"""
import os, re, json, base64, subprocess, sys
from fonts_config import FONTS

OUT = os.path.dirname(os.path.abspath(__file__))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

def curl(url, binary=True, headers=None):
    cmd = ["curl", "-sSL", "--fail", "--max-time", "40", "-A", UA]
    for h in (headers or []):
        cmd += ["-H", h]
    cmd += [url]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=60)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")

def is_woff2(b): return bool(b) and b[:4] == b"wOF2"

def google_woff2(family, weights):
    """Return {weight: bytes} for the latin subset from Google Fonts css2."""
    fam = family.replace(" ", "+")
    spec = ";".join(str(w) for w in weights)
    css = curl("https://fonts.googleapis.com/css2?family=%s:wght@%s&display=swap" % (fam, spec),
               binary=False, headers=["Accept: text/css,*/*"])
    if not css:
        return {}
    out = {}
    for block in re.findall(r"@font-face\s*{[^}]*}", css):
        wm = re.search(r"font-weight:\s*(\d+)", block)
        um = re.search(r"unicode-range:\s*([^;]+);", block)
        sm = re.search(r"url\((https://[^)]+\.woff2)\)", block)
        if not (wm and sm):
            continue
        w = int(wm.group(1))
        urange = um.group(1) if um else ""
        if "U+0000-00FF" not in urange:      # keep only the 'latin' subset
            continue
        if w in weights and w not in out:
            d = curl(sm.group(1))
            if is_woff2(d):
                out[w] = d
    return out

FS = "https://cdn.jsdelivr.net/npm/@fontsource"
GH_OD = "https://cdn.jsdelivr.net/gh/antijingoist/opendyslexic/compiled"

def fontsource_slug(family):
    return family.lower().replace(" ", "-")

def try_urls(urls):
    for u in urls:
        d = curl(u)
        if is_woff2(d):
            return d, u
    return None, None

def fetch_one(f):
    """Return (weights_dict{w:bytes}, source_note) or ({}, None)."""
    weights = f["weights"]; fam = f["family"]
    got = {}; source = None
    if f["src"] == "google":
        g = google_woff2(fam, weights)
        for w in weights:
            if w in g:
                got[w] = g[w]; source = "fonts.gstatic.com (Google Fonts)"
    elif f["src"] == "opendyslexic":
        names = {400: "OpenDyslexic-Regular.woff2", 700: "OpenDyslexic-Bold.woff2"}
        for w in weights:
            d, u = try_urls([GH_OD + "/" + names[w]])
            if d:
                got[w] = d; source = "antijingoist/opendyslexic (official OFL)"
    # fallback: Fontsource for any missing weight
    slug = fontsource_slug(fam)
    for w in weights:
        if w not in got:
            d, u = try_urls([FS + "/%s/files/%s-latin-%d-normal.woff2" % (slug, slug, w)])
            if d:
                got[w] = d
                source = (source or "") + (" +Fontsource" if source else "jsdelivr @fontsource (redistribution)")
    return got, source

def main():
    faces = {}; failed = []
    for f in FONTS:
        got, source = fetch_one(f)
        if all(w in got for w in f["weights"]):
            entry = {"family": f["family"], "group": f["group"], "license": f["license"],
                     "note": f.get("note", ""), "source": source, "weights": {}}
            for w in f["weights"]:
                entry["weights"][str(w)] = base64.b64encode(got[w]).decode()
            faces[f["key"]] = entry
            kb = sum(len(got[w]) for w in got) // 1024
            print("OK   %-14s [%-22s] %2dw %3dKB  %s" % (f["key"], f["group"], len(f["weights"]), kb, source))
        else:
            failed.append(f["key"])
            print("FAIL %-14s [%-22s] could not fetch weights %s" % (f["key"], f["group"], f["weights"]))
    with open(os.path.join(OUT, "_fonts_b64.json"), "w") as fh:
        json.dump(faces, fh)
    total = sum(len(e["weights"][w]) * 3 // 4 for e in faces.values() for w in e["weights"]) // 1024
    print("---")
    print("embedded %d/%d fonts, ~%dKB raw woff2 (%dKB base64 in html)"
          % (len(faces), len(FONTS), total, total * 4 // 3))
    if failed:
        print("FAILED:", ", ".join(failed))
    return 0 if not failed else 2

if __name__ == "__main__":
    sys.exit(main())
