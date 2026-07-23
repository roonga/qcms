# -*- coding: utf-8 -*-
"""
Shared font registry - the single source of truth for fetch_fonts.py and build.py.
key must be a CSS-class-safe token (used as :root.font-<key> and the <select> value).
weights: which static weights to embed. Accessibility fonts get 400+700 (weight
matters for legibility); Popular / Playful get 400 only to keep file size sane.
'src': 'google' -> fonts.gstatic.com via css2; 'opendyslexic' -> official OFL repo.
"""
FONTS = [
    # --- Accessibility (regular + bold) ---
    dict(key="atkinson",     family="Atkinson Hyperlegible", weights=[400, 700], group="Accessibility",  license="OFL-1.1",    src="google",
         note="designed for low vision"),
    dict(key="lexend",       family="Lexend",                weights=[400, 700], group="Accessibility",  license="OFL-1.1",    src="google",
         note="tuned for reading proficiency"),
    dict(key="opendyslexic", family="OpenDyslexic",          weights=[400, 700], group="Accessibility",  license="OFL-1.1",    src="opendyslexic",
         note="weighted letterforms for dyslexia"),
    # --- Popular (regular only) ---
    dict(key="inter",        family="Inter",       weights=[400], group="Popular", license="OFL-1.1",   src="google", note=""),
    dict(key="roboto",       family="Roboto",      weights=[400], group="Popular", license="Apache-2.0", src="google", note=""),
    dict(key="opensans",     family="Open Sans",   weights=[400], group="Popular", license="OFL-1.1",   src="google", note=""),
    dict(key="lato",         family="Lato",        weights=[400], group="Popular", license="OFL-1.1",   src="google", note=""),
    dict(key="poppins",      family="Poppins",     weights=[400], group="Popular", license="OFL-1.1",   src="google", note=""),
    dict(key="montserrat",   family="Montserrat",  weights=[400], group="Popular", license="OFL-1.1",   src="google", note=""),
    # --- Playful & Kids (regular only) ---
    dict(key="andika",       family="Andika",       weights=[400], group="Playful & Kids", license="OFL-1.1", src="google", note="SIL, early-reader literacy"),
    dict(key="fredoka",      family="Fredoka",      weights=[400], group="Playful & Kids", license="OFL-1.1", src="google", note="rounded, friendly"),
    dict(key="baloo2",       family="Baloo 2",      weights=[400], group="Playful & Kids", license="OFL-1.1", src="google", note="chunky, playful"),
    dict(key="comicneue",    family="Comic Neue",   weights=[400], group="Playful & Kids", license="OFL-1.1", src="google", note="open Comic-Sans alternative"),
    dict(key="patrickhand",  family="Patrick Hand", weights=[400], group="Playful & Kids", license="OFL-1.1", src="google", note="casual handwriting"),
    # --- Traditional & Corporate (regular only) ---
    dict(key="merriweather",     family="Merriweather",     weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="professional serif"),
    dict(key="lora",             family="Lora",             weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="balanced serif"),
    dict(key="ptserif",          family="PT Serif",         weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="traditional serif"),
    dict(key="librebaskerville", family="Libre Baskerville", weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="formal Baskerville serif"),
    dict(key="ibmplexserif",     family="IBM Plex Serif",   weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="corporate serif"),
    dict(key="publicsans",       family="Public Sans",      weights=[400], group="Traditional & Corporate", license="OFL-1.1", src="google", note="US gov design-system neutral sans"),
]

# display order of optgroups
GROUP_ORDER = ["Accessibility", "Popular", "Playful & Kids", "Traditional & Corporate"]

def by_key(k):
    for f in FONTS:
        if f["key"] == k:
            return f
    return None
