# -*- coding: utf-8 -*-
"""
Build script for QCMS respondent-portal predefined theme palettes.
Holds every token value, computes real WCAG 2.2 contrast ratios, verifies the
critical pairs against their targets, and emits tokens.css + THEMES.md so the
published numbers cannot drift from the actual token values.

Run:  python build.py
"""
import os, re, json
from fonts_config import FONTS, GROUP_ORDER

OUT = os.path.dirname(os.path.abspath(__file__))
SERIF_KEYS = {"merriweather", "lora", "ptserif", "librebaskerville", "ibmplexserif"}

def font_fallback(key):
    return 'Georgia, "Times New Roman", serif' if key in SERIF_KEYS \
        else 'ui-sans-serif, system-ui, sans-serif'

# ---------------------------------------------------------------------------
# WCAG relative-luminance + contrast
# ---------------------------------------------------------------------------
def _srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

def hex_to_rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def luminance(hex_color):
    r, g, b = hex_to_rgb(hex_color)
    return 0.2126 * _srgb_to_lin(r) + 0.7152 * _srgb_to_lin(g) + 0.0722 * _srgb_to_lin(b)

def contrast(fg, bg):
    l1, l2 = luminance(fg), luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)

def cr(fg, bg):
    return round(contrast(fg, bg), 2)

# ---------------------------------------------------------------------------
# small color helpers to derive hover/active states deterministically
# ---------------------------------------------------------------------------
def clamp(x): return max(0, min(255, int(round(x))))

def rgb_to_hex(r, g, b):
    return '#%02x%02x%02x' % (clamp(r), clamp(g), clamp(b))

def mix(a, b, t):
    """mix a toward b by t (0..1)."""
    ar, ag, ab = hex_to_rgb(a); br, bg_, bb = hex_to_rgb(b)
    return rgb_to_hex(ar + (br-ar)*t, ag + (bg_-ag)*t, ab + (bb-ab)*t)

def darken(h, t): return mix(h, '#000000', t)
def lighten(h, t): return mix(h, '#ffffff', t)

# ---------------------------------------------------------------------------
# Token key list (the exact contract)
# ---------------------------------------------------------------------------
COLOR_KEYS = [
    'color-primary','color-primary-hover','color-primary-active','color-primary-foreground',
    'color-secondary','color-secondary-hover','color-secondary-active','color-secondary-foreground',
    'color-danger','color-danger-hover','color-danger-active','color-danger-foreground',
    'color-danger-subtle','color-danger-fg',
    'color-ghost','color-ghost-hover','color-ghost-active',
    'color-info','color-info-subtle','color-info-fg',
    'color-success','color-success-subtle','color-success-fg',
    'color-warning','color-warning-subtle','color-warning-fg',
    'color-text','color-text-muted','color-border','color-border-strong',
    'color-background','color-background-muted','color-surface','color-surface-hover',
    'color-focus-ring','color-overlay',
]

FONT_PORTAL = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

# ---------------------------------------------------------------------------
# Helper to assemble a full mode dict from core anchors + auto-derived states.
# core keys required: primary, primary_fg, secondary, secondary_fg,
#   danger, danger_fg_on_btn, danger_subtle, danger_fg,
#   info, info_subtle, info_fg, success, success_subtle, success_fg,
#   warning, warning_subtle, warning_fg,
#   text, text_muted, border, border_strong,
#   background, background_muted, surface, surface_hover,
#   focus_ring, overlay, ghost_hover, ghost_active
# `dark` flag flips hover/active direction (dark themes lighten on hover).
# ---------------------------------------------------------------------------
def build_mode(c, dark=False):
    def hov(x): return lighten(x, 0.12) if dark else darken(x, 0.10)
    def act(x): return lighten(x, 0.22) if dark else darken(x, 0.20)
    t = {}
    t['color-primary'] = c['primary']
    t['color-primary-hover'] = c.get('primary_hover', hov(c['primary']))
    t['color-primary-active'] = c.get('primary_active', act(c['primary']))
    t['color-primary-foreground'] = c['primary_fg']
    t['color-secondary'] = c['secondary']
    t['color-secondary-hover'] = c.get('secondary_hover', hov(c['secondary']))
    t['color-secondary-active'] = c.get('secondary_active', act(c['secondary']))
    t['color-secondary-foreground'] = c['secondary_fg']
    t['color-danger'] = c['danger']
    t['color-danger-hover'] = c.get('danger_hover', hov(c['danger']))
    t['color-danger-active'] = c.get('danger_active', act(c['danger']))
    t['color-danger-foreground'] = c['danger_fg_on_btn']
    t['color-danger-subtle'] = c['danger_subtle']
    t['color-danger-fg'] = c['danger_fg']
    t['color-ghost'] = 'transparent'
    t['color-ghost-hover'] = c['ghost_hover']
    t['color-ghost-active'] = c['ghost_active']
    t['color-info'] = c['info']
    t['color-info-subtle'] = c['info_subtle']
    t['color-info-fg'] = c['info_fg']
    t['color-success'] = c['success']
    t['color-success-subtle'] = c['success_subtle']
    t['color-success-fg'] = c['success_fg']
    t['color-warning'] = c['warning']
    t['color-warning-subtle'] = c['warning_subtle']
    t['color-warning-fg'] = c['warning_fg']
    t['color-text'] = c['text']
    t['color-text-muted'] = c['text_muted']
    t['color-border'] = c['border']
    t['color-border-strong'] = c['border_strong']
    t['color-background'] = c['background']
    t['color-background-muted'] = c['background_muted']
    t['color-surface'] = c['surface']
    t['color-surface-hover'] = c['surface_hover']
    t['color-focus-ring'] = c['focus_ring']
    t['color-overlay'] = c['overlay']
    return t

# ===========================================================================
# THEME DEFINITIONS
# ===========================================================================
THEMES = {}   # THEMES[theme][mode] = token dict
RATIONALE = {} # RATIONALE[theme][mode] = text

# ---- SLATE (shipped default) ----------------------------------------------
slate_light = build_mode(dict(
    primary='#2c6e63', primary_hover='#245a51', primary_active='#1e4a43', primary_fg='#ffffff',
    secondary='#4f5b70', secondary_fg='#ffffff',
    danger='#c0271f', danger_fg_on_btn='#ffffff', danger_subtle='#f9e7e5', danger_fg='#8f1d18',
    info='#2456c6', info_subtle='#e9effb', info_fg='#1b44a0',
    success='#1e7a46', success_subtle='#e4f1ea', success_fg='#16603a',
    warning='#8a5a00', warning_subtle='#f6eeda', warning_fg='#6e4700',
    text='#0f1729', text_muted='#55617a', border='#dde2ea', border_strong='#838ca4',
    background='#fbfcfd', background_muted='#eef1f6', surface='#ffffff', surface_hover='#f4f6fa',
    focus_ring='#2456c6', overlay='rgb(0 0 0 / 0.5)',
    ghost_hover='#eef1f6', ghost_active='#e4e8ef',
))
slate_dark = build_mode(dict(
    primary='#5fb8ac', primary_fg='#0b0f1a',
    secondary='#97a2b8', secondary_fg='#0b0f1a',
    danger='#ff7b80', danger_fg_on_btn='#0b0f1a', danger_subtle='#2b1615', danger_fg='#ffb3b5',
    info='#7aa2ff', info_subtle='#16233a', info_fg='#a9c4ff',
    success='#46c08a', success_subtle='#132a20', success_fg='#8fe0bd',
    warning='#e0a93b', warning_subtle='#2a2110', warning_fg='#f0cd85',
    text='#e6eaf2', text_muted='#97a2b8', border='#262e3d', border_strong='#626c88',
    background='#0b0f1a', background_muted='#10151f', surface='#141a26', surface_hover='#1b2230',
    focus_ring='#7aa2ff', overlay='rgb(0 0 0 / 0.6)',
    ghost_hover='#1b2230', ghost_active='#232c3c',
), dark=True)
# Slate high-contrast: near-black on white, deep teal accent kept only where it clears AAA.
slate_hc = build_mode(dict(
    primary='#0b453d', primary_hover='#063730', primary_active='#032823', primary_fg='#ffffff',
    secondary='#1c2433', secondary_fg='#ffffff',
    danger='#8a0f0a', danger_fg_on_btn='#ffffff', danger_subtle='#ffecea', danger_fg='#6b0b07',
    info='#0a3ea8', info_subtle='#e6efff', info_fg='#08337d',
    success='#0a5c30', success_subtle='#e2f4e9', success_fg='#064023',
    warning='#5a3b00', warning_subtle='#fbf0d6', warning_fg='#4a3000',
    text='#000000', text_muted='#22262e', border='#5a616e', border_strong='#000000',
    background='#ffffff', background_muted='#f2f3f5', surface='#ffffff', surface_hover='#eceef1',
    focus_ring='#0a3ea8', overlay='rgb(0 0 0 / 0.7)',
    ghost_hover='#eceef1', ghost_active='#dfe2e7',
))
THEMES['slate'] = {'light': slate_light, 'dark': slate_dark, 'hc': slate_hc}

# ---- HARBOR (calm corporate blue) -----------------------------------------
harbor_light = build_mode(dict(
    primary='#1f5eb8', primary_fg='#ffffff',
    secondary='#4a5a75', secondary_fg='#ffffff',
    danger='#c0271f', danger_fg_on_btn='#ffffff', danger_subtle='#f9e7e5', danger_fg='#8f1d18',
    info='#1f5eb8', info_subtle='#e8f0fb', info_fg='#184a94',
    success='#1e7a46', success_subtle='#e4f1ea', success_fg='#16603a',
    warning='#8a5a00', warning_subtle='#f6eeda', warning_fg='#6e4700',
    text='#0e1626', text_muted='#495777', border='#c8d4e7', border_strong='#6b7996',
    background='#e8eef6', background_muted='#dce5f1', surface='#f4f8fd', surface_hover='#e8eff8',
    focus_ring='#1f5eb8', overlay='rgb(0 0 0 / 0.5)',
    ghost_hover='#dce5f1', ghost_active='#d0dcec',
))
harbor_dark = build_mode(dict(
    primary='#6fa8ff', primary_fg='#08111f',
    secondary='#96a3bd', secondary_fg='#08111f',
    danger='#ff7b80', danger_fg_on_btn='#08111f', danger_subtle='#2b1615', danger_fg='#ffb3b5',
    info='#6fa8ff', info_subtle='#152238', info_fg='#a9c8ff',
    success='#46c08a', success_subtle='#122a1f', success_fg='#8fe0bd',
    warning='#e0a93b', warning_subtle='#2a2010', warning_fg='#f0cd85',
    text='#e6ecf6', text_muted='#96a3bd', border='#242d3e', border_strong='#606c88',
    background='#08111f', background_muted='#0d1626', surface='#111c2e', surface_hover='#18243a',
    focus_ring='#6fa8ff', overlay='rgb(0 0 0 / 0.6)',
    ghost_hover='#18243a', ghost_active='#1f2c46',
), dark=True)
harbor_hc = build_mode(dict(
    primary='#0a3a8a', primary_hover='#052e73', primary_active='#03235c', primary_fg='#ffffff',
    secondary='#182234', secondary_fg='#ffffff',
    danger='#8a0f0a', danger_fg_on_btn='#ffffff', danger_subtle='#ffecea', danger_fg='#6b0b07',
    info='#0a3a8a', info_subtle='#e6efff', info_fg='#082e6e',
    success='#0a5c30', success_subtle='#e2f4e9', success_fg='#064023',
    warning='#5a3b00', warning_subtle='#fbf0d6', warning_fg='#4a3000',
    text='#000000', text_muted='#1f2733', border='#565f6e', border_strong='#000000',
    background='#ffffff', background_muted='#f1f3f6', surface='#ffffff', surface_hover='#e9edf2',
    focus_ring='#0a3a8a', overlay='rgb(0 0 0 / 0.7)',
    ghost_hover='#e9edf2', ghost_active='#dce1e9',
))
THEMES['harbor'] = {'light': harbor_light, 'dark': harbor_dark, 'hc': harbor_hc}

# ---- SAND (warm neutral, muted terracotta primary) ------------------------
sand_light = build_mode(dict(
    primary='#a24e2c', primary_fg='#ffffff',
    secondary='#6d6152', secondary_fg='#ffffff',
    danger='#bb2a20', danger_fg_on_btn='#ffffff', danger_subtle='#f8e7e3', danger_fg='#8c1f18',
    info='#2456c6', info_subtle='#eaeffb', info_fg='#1b44a0',
    success='#1e7a46', success_subtle='#e6f1e8', success_fg='#16603a',
    warning='#8a5a00', warning_subtle='#f7edd6', warning_fg='#6e4700',
    text='#231a12', text_muted='#655847', border='#ddd0ba', border_strong='#8d7d66',
    background='#f7f1e6', background_muted='#efe5d4', surface='#fdf9f1', surface_hover='#f2eadd',
    focus_ring='#2456c6', overlay='rgb(0 0 0 / 0.5)',
    ghost_hover='#efe5d4', ghost_active='#e7dcc7',
))
sand_dark = build_mode(dict(
    primary='#e08a5f', primary_fg='#1a120b',
    secondary='#b6a894', secondary_fg='#1a120b',
    danger='#ff7b80', danger_fg_on_btn='#1a120b', danger_subtle='#2c1613', danger_fg='#ffb3b5',
    info='#7aa2ff', info_subtle='#17233a', info_fg='#a9c4ff',
    success='#46c08a', success_subtle='#13291d', success_fg='#8fe0bd',
    warning='#e0a93b', warning_subtle='#2b2110', warning_fg='#f0cd85',
    text='#f0e9df', text_muted='#b6a894', border='#332a20', border_strong='#7a6c58',
    background='#17120c', background_muted='#1e1811', surface='#241d15', surface_hover='#2d251b',
    focus_ring='#e08a5f', overlay='rgb(0 0 0 / 0.6)',
    ghost_hover='#2d251b', ghost_active='#382e22',
), dark=True)
sand_hc = build_mode(dict(
    primary='#7a3717', primary_hover='#642c10', primary_active='#4f2109', primary_fg='#ffffff',
    secondary='#33291d', secondary_fg='#ffffff',
    danger='#8a0f0a', danger_fg_on_btn='#ffffff', danger_subtle='#ffeae7', danger_fg='#6b0b07',
    info='#0a3ea8', info_subtle='#e8efff', info_fg='#08337d',
    success='#0a5c30', success_subtle='#e4f3e7', success_fg='#064023',
    warning='#5a3b00', warning_subtle='#fbf0d6', warning_fg='#4a3000',
    text='#000000', text_muted='#2a2114', border='#6b5f4d', border_strong='#000000',
    background='#fffdf9', background_muted='#f4eee2', surface='#fffdf9', surface_hover='#efe8da',
    focus_ring='#0a3ea8', overlay='rgb(0 0 0 / 0.7)',
    ghost_hover='#efe8da', ghost_active='#e6ddcb',
))
THEMES['sand'] = {'light': sand_light, 'dark': sand_dark, 'hc': sand_hc}

# ---- PLUM (deep violet) ---------------------------------------------------
plum_light = build_mode(dict(
    primary='#6d28a8', primary_fg='#ffffff',
    secondary='#5f5470', secondary_fg='#ffffff',
    danger='#c0271f', danger_fg_on_btn='#ffffff', danger_subtle='#f9e7e5', danger_fg='#8f1d18',
    info='#2456c6', info_subtle='#eaeffb', info_fg='#1b44a0',
    success='#1e7a46', success_subtle='#e5f1ea', success_fg='#16603a',
    warning='#8a5a00', warning_subtle='#f6eeda', warning_fg='#6e4700',
    text='#1a1226', text_muted='#584c6a', border='#ddd0ec', border_strong='#7f7098',
    background='#f2ecf9', background_muted='#e9def4', surface='#faf6fe', surface_hover='#efe7fa',
    focus_ring='#6d28a8', overlay='rgb(0 0 0 / 0.5)',
    ghost_hover='#e9def4', ghost_active='#e0d3f0',
))
plum_dark = build_mode(dict(
    primary='#c08cf0', primary_fg='#150a22',
    secondary='#a898bd', secondary_fg='#150a22',
    danger='#ff7b80', danger_fg_on_btn='#150a22', danger_subtle='#2b1518', danger_fg='#ffb3b5',
    info='#a99cff', info_subtle='#1f1a3a', info_fg='#c9c1ff',
    success='#46c08a', success_subtle='#132a20', success_fg='#8fe0bd',
    warning='#e0a93b', warning_subtle='#2a2110', warning_fg='#f0cd85',
    text='#ece6f4', text_muted='#a898bd', border='#2d2340', border_strong='#756891',
    background='#150a22', background_muted='#1c1030', surface='#22163a', surface_hover='#2a1d46',
    focus_ring='#c08cf0', overlay='rgb(0 0 0 / 0.6)',
    ghost_hover='#2a1d46', ghost_active='#332553',
), dark=True)
plum_hc = build_mode(dict(
    primary='#54148f', primary_hover='#450f77', primary_active='#360a5f', primary_fg='#ffffff',
    secondary='#241a33', secondary_fg='#ffffff',
    danger='#8a0f0a', danger_fg_on_btn='#ffffff', danger_subtle='#ffeaea', danger_fg='#6b0b07',
    info='#0a3ea8', info_subtle='#ecebff', info_fg='#08337d',
    success='#0a5c30', success_subtle='#e4f3e9', success_fg='#064023',
    warning='#5a3b00', warning_subtle='#fbf0d6', warning_fg='#4a3000',
    text='#000000', text_muted='#241a2f', border='#5f5670', border_strong='#000000',
    background='#fffdff', background_muted='#f3edf8', surface='#fffdff', surface_hover='#ece2f3',
    focus_ring='#0a3ea8', overlay='rgb(0 0 0 / 0.7)',
    ghost_hover='#ece2f3', ghost_active='#e2d5ee',
))
THEMES['plum'] = {'light': plum_light, 'dark': plum_dark, 'hc': plum_hc}

# ---------------------------------------------------------------------------
# HIGH-CONTRAST is a MODE-LAYER, not a per-theme palette.
# One universal HC palette (pure #000 on #fff, AAA semantics, universal focus)
# lives in :root.hc; a theme contributes ONLY its accent (--color-primary*).
# slate_hc was already authored as pure black-on-white, so it is the universal
# base; each theme's HC accent is the deep AAA primary already picked above.
# ---------------------------------------------------------------------------
HC_ACCENT_KEYS = ('color-primary','color-primary-hover','color-primary-active','color-primary-foreground')
HC_ACCENTS = {
    'slate':  {k: slate_hc[k]  for k in HC_ACCENT_KEYS},   # #0b453d - lives in bare :root.hc
    'harbor': {k: harbor_hc[k] for k in HC_ACCENT_KEYS},   # #0a3a8a
    'sand':   {k: sand_hc[k]   for k in HC_ACCENT_KEYS},   # #7a3717
    'plum':   {k: plum_hc[k]   for k in HC_ACCENT_KEYS},   # #54148f
}
# Universal HC palette = slate_hc's tokens (already pure #fff / #000, focus #0a3ea8),
# carrying the slate accent as the default for bare :root.hc.
HC_UNIVERSAL = dict(slate_hc)
# Rebuild each theme's hc = universal + that theme's accent (verification + docs).
for _th in THEMES:
    _d = dict(HC_UNIVERSAL); _d.update(HC_ACCENTS[_th]); THEMES[_th]['hc'] = _d

# ===========================================================================
# VERIFICATION
# ===========================================================================
TARGETS = {
    'light': {'body': 4.5, 'large': 3.0, 'ui': 3.0},
    'dark':  {'body': 4.5, 'large': 3.0, 'ui': 3.0},
    'hc':    {'body': 7.0, 'large': 4.5, 'ui': 3.0},
}

def critical_pairs(t, mode):
    """return list of (label, fg, bg, target_key)"""
    pairs = [
        ('text / background',            t['color-text'],        t['color-background'], 'body'),
        ('text / surface',               t['color-text'],        t['color-surface'],    'body'),
        ('text-muted / background',      t['color-text-muted'],  t['color-background'], 'body'),
        ('text-muted / surface',         t['color-text-muted'],  t['color-surface'],    'body'),
        ('primary-fg / primary',         t['color-primary-foreground'], t['color-primary'], 'body'),
        ('secondary-fg / secondary',     t['color-secondary-foreground'], t['color-secondary'], 'body'),
        ('danger-fg-btn / danger',       t['color-danger-foreground'], t['color-danger'], 'body'),
        ('danger-fg / danger-subtle',    t['color-danger-fg'],   t['color-danger-subtle'], 'body'),
        ('info-fg / info-subtle',        t['color-info-fg'],     t['color-info-subtle'], 'body'),
        ('success-fg / success-subtle',  t['color-success-fg'],  t['color-success-subtle'], 'body'),
        ('warning-fg / warning-subtle',  t['color-warning-fg'],  t['color-warning-subtle'], 'body'),
        ('border-strong / surface',      t['color-border-strong'], t['color-surface'],  'ui'),
        ('border-strong / background',   t['color-border-strong'], t['color-background'], 'ui'),
        ('focus-ring / background',      t['color-focus-ring'],  t['color-background'], 'ui'),
        ('focus-ring / surface',         t['color-focus-ring'],  t['color-surface'],    'ui'),
        ('primary / surface (link/UI)',  t['color-primary'],     t['color-surface'],    'ui'),
    ]
    return pairs

def verify_all():
    problems = []
    for theme in THEMES:
        for mode in ('light','dark','hc'):
            t = THEMES[theme][mode]
            tg = TARGETS[mode]
            for label, fg, bg, key in critical_pairs(t, mode):
                if fg == 'transparent' or bg == 'transparent':
                    continue
                ratio = contrast(fg, bg)
                target = tg[key]
                if ratio < target - 0.005:
                    problems.append((theme, mode, label, round(ratio,2), target, fg, bg))
    return problems

# ===========================================================================
# RATIONALE TEXT
# ===========================================================================
RATIONALE = {
 'slate': "Slate Teal is the shipped QCMS default: a muted blue-green primary over cool "
          "slate neutrals, professional and brand-neutral so adopters can re-skin cleanly. "
          "Light and dark are the production values, carried unchanged. High-contrast is "
          "designed here: near-black text on white, neutrals flattened, the teal accent "
          "deepened to a forest tone (#0b453d) that still clears AAA behind white button text.",
 'harbor': "Harbor is a calm corporate blue. The primary is a confident mid-blue (#1f5eb8) "
           "and info reuses the same hue so links and info banners read as one family. Neutrals "
           "are shifted cool (a faint blue cast in text/border/background) to harmonise with the "
           "accent. Danger/success/warning stay in their conventional red/green/amber lanes so "
           "meaning is never carried by hue alone.",
 'sand':  "Sand is a warm neutral: warm greys (a faint brown cast) with a muted terracotta "
          "primary (#a24e2c light). It reads editorial and low-glare. Info stays blue and success "
          "green for semantic recognisability, but their subtle backgrounds are nudged warm to sit "
          "in the palette. The terracotta is darkened for AAA in high-contrast.",
 'plum':  "Plum is a deep violet. The primary is a rich purple (#6d28a8 light) over cool "
          "violet-tinted neutrals. Info stays blue to remain distinct from the violet primary. In "
          "dark mode the primary lifts to a soft lilac (#c08cf0); in high-contrast it deepens to "
          "#54148f, kept only because it still clears AAA behind white button text.",
}
MODE_NOTE = {
 'light': "Light mode: every text/background pair meets WCAG 2.2 AA (>=4.5:1 body, >=3:1 large/UI).",
 'dark':  "Dark mode: inverted neutrals, accents lightened and desaturated so they stay >=4.5:1 on "
          "the dark surface; button foregrounds flip to near-black. Meets AA.",
 'hc':    "High-contrast mode (a distinct respondent choice, NOT dark): body text targets AAA "
          "(>=7:1), large/secondary text >=4.5:1, separators use border-strong at full contrast, "
          "and the focus ring is a heavy saturated blue. Brand accent is kept only where it still "
          "clears AAA.",
}

# ===========================================================================
# EMIT tokens.css
# ===========================================================================
def selector_for(theme, mode):
    base = ':root' if theme == 'slate' else ':root[data-theme="%s"]' % theme
    if mode == 'light':
        return base
    return base + '.' + mode

def css_block(theme, mode):
    t = THEMES[theme][mode]
    sel = selector_for(theme, mode)
    lines = ['%s {' % sel]
    for k in COLOR_KEYS:
        lines.append('  --%s: %s;' % (k, t[k]))
    if mode == 'light':
        lines.append('  --font-portal: %s;' % FONT_PORTAL)
    lines.append('}')
    return '\n'.join(lines)

def emit_tokens_css():
    out = []
    out.append("/* ==========================================================================")
    out.append("   QCMS respondent portal - predefined theme tokens (issue #26)")
    out.append("   Generated by build.py. All values WCAG 2.2-verified; see THEMES.md.")
    out.append("")
    out.append("   SELECTOR CONVENTION")
    out.append("   -------------------")
    out.append("   * MODE is a class on the <html> (:root) element:")
    out.append("       (none) = Light   .dark = Dark   .hc = High-contrast")
    out.append("   * THEME is the data-theme attribute on :root:")
    out.append("       (absent) or \"slate\" = default Slate Teal")
    out.append("       \"harbor\" | \"sand\" | \"plum\" = alternates")
    out.append("   * The default theme (slate) lives in bare :root / :root.dark / :root.hc.")
    out.append("     Alternates override under :root[data-theme=\"x\"] (+ .dark / .hc).")
    out.append("     Alternate selectors always out-specify the defaults, so setting")
    out.append("     data-theme is sufficient to switch; removing it (or =\"slate\") restores")
    out.append("     the default. --font-portal is theme-independent and set once per mode-root")
    out.append("     in the light block; override at runtime for the visibility fonts.")
    out.append("   ========================================================================== */")
    out.append("")
    for theme in ('slate','harbor','sand','plum'):
        out.append("/* ---------- %s (light + dark) ---------- */" % theme.upper())
        for mode in ('light','dark'):
            out.append(css_block(theme, mode))
            out.append("")
    # ---- HIGH-CONTRAST: one universal mode-layer + accent-only overrides ----
    out.append("/* ==========================================================================")
    out.append("   HIGH-CONTRAST - universal mode-layer (theme-agnostic)")
    out.append("   HC is ONE palette for every theme: pure #000 text/border on #fff, fixed AAA")
    out.append("   semantics, universal focus ring #0a3ea8. A theme contributes ONLY its accent")
    out.append("   (--color-primary*), which links / primary UI pick up - the 'whisper of brand'.")
    out.append("   Emitted AFTER the light/dark blocks so :root.hc (0,1,1) wins over a theme's")
    out.append("   light block (also 0,1,1) by source order; the accent overrides (0,2,1) win for")
    out.append("   --color-primary*. A NEW theme gets HC for free by adding one AAA-safe accent")
    out.append("   override here - no full HC palette needed.")
    out.append("   ========================================================================== */")
    lines = [':root.hc {']
    for k in COLOR_KEYS:
        lines.append('  --%s: %s;' % (k, HC_UNIVERSAL[k]))
    lines.append('}')
    out.append('\n'.join(lines))
    out.append("")
    out.append("/* theme accent in HC (accent tokens ONLY; everything else stays universal above).")
    out.append("   slate is the default accent and lives in the bare :root.hc block above. */")
    for theme in ('harbor','sand','plum'):
        acc = HC_ACCENTS[theme]
        lines = [':root[data-theme="%s"].hc {' % theme]
        for k in HC_ACCENT_KEYS:
            lines.append('  --%s: %s;' % (k, acc[k]))
        lines.append('}')
        out.append('\n'.join(lines))
        out.append("")
    # visibility-font helper classes (theme/mode independent)
    out.append("/* ---------- respondent-selectable fonts (runtime override of --font-portal) ----")
    out.append("   'System default' is the absence of any of these classes (the OS stack above) and")
    out.append("   must always remain an available choice - the accessibility escape hatch.")
    out.append("   Each family is open-licensed and self-hostable; ship as self-hosted woff2 via")
    out.append("   @font-face in production - NO CDN hotlink under CSP (the showcase embeds them as")
    out.append("   base64 data URIs). Grouped by purpose (registry ships many; admin curates).")
    out.append("   -------------------------------------------------------------------------------- */")
    for g in GROUP_ORDER:
        rows = [f for f in FONTS if f["group"] == g]
        if not rows:
            continue
        out.append("/* %s */" % g)
        for f in rows:
            out.append(':root.font-%s { --font-portal: "%s", %s; }  /* %s */'
                       % (f["key"], f["family"], font_fallback(f["key"]), f["license"]))
    out.append("")
    out.append("/* ---------- corners / border-radius (THEME-level; admin brand character) -----")
    out.append("   NOT a respondent control - it sets brand character, so it is grouped with the")
    out.append("   theme selector ('Corners') in the showcase. Subtle = base :root; swap with a root")
    out.append("   class (.radius-sharp / .radius-rounded / .radius-pill). Composes with")
    out.append("   theme x mode x font x density. No contrast impact (geometry only).")
    out.append("     --radius-control  buttons / inputs / selects")
    out.append("     --radius-card     step card / panels / banners")
    out.append("     --radius-sm       checkboxes / radios / chips")
    out.append("   -------------------------------------------------------------------------------- */")
    out.append(":root { --radius-control: 6px; --radius-card: 10px; --radius-sm: 4px; }        /* Subtle (default) */")
    out.append(":root.radius-sharp   { --radius-control: 0;     --radius-card: 0;    --radius-sm: 0; }")
    out.append(":root.radius-rounded { --radius-control: 10px;  --radius-card: 16px; --radius-sm: 6px; }")
    out.append(":root.radius-pill    { --radius-control: 999px; --radius-card: 20px; --radius-sm: 8px; }")
    out.append("")
    out.append("/* ---------- density (respondent runtime spacing axis) ------------------------")
    out.append("   Independent of theme / mode / font. Comfortable = base :root; swap with a root")
    out.append("   class (.density-compact / .density-spacious), same mechanism as mode & font.")
    out.append("   Density changes CHROME spacing ONLY (padding / gaps / heights / rhythm). It NEVER")
    out.append("   touches the text-spacing floors (line-height 1.5, letter-spacing .12em, word-")
    out.append("   spacing .16em) and NEVER drops an interactive target below 24px (WCAG 2.5.8) -")
    out.append("   --space-control-h stays >=36px in Compact.")
    out.append("     --space-control-h    control height (input / button / select)")
    out.append("     --space-control-pad-x  horizontal padding inside controls")
    out.append("     --space-field-gap    vertical gap between questions")
    out.append("     --space-section-pad  step-card padding")
    out.append("     --space-stack        label-to-input gap / option row padding")
    out.append("   -------------------------------------------------------------------------------- */")
    out.append(":root {")
    out.append("  --space-control-h: 44px;")
    out.append("  --space-control-pad-x: 0.9rem;")
    out.append("  --space-field-gap: 2em;")
    out.append("  --space-section-pad: 2.25rem;")
    out.append("  --space-stack: 0.5rem;")
    out.append("}")
    out.append(":root.density-compact {   /* ~30% tighter on paddings/gaps; height 36px > 24px min */")
    out.append("  --space-control-h: 36px;")
    out.append("  --space-control-pad-x: 0.6rem;")
    out.append("  --space-field-gap: 1.3em;")
    out.append("  --space-section-pad: 1.5rem;")
    out.append("  --space-stack: 0.35rem;")
    out.append("}")
    out.append(":root.density-spacious {  /* ~15-25% more generous */")
    out.append("  --space-control-h: 52px;")
    out.append("  --space-control-pad-x: 1.1rem;")
    out.append("  --space-field-gap: 2.5em;")
    out.append("  --space-section-pad: 2.9rem;")
    out.append("  --space-stack: 0.7rem;")
    out.append("}")
    out.append("")
    with open(os.path.join(OUT,'tokens.css'),'w',encoding='utf-8') as f:
        f.write('\n'.join(out))

# ===========================================================================
# EMIT THEMES.md
# ===========================================================================
def emit_themes_md():
    L = []
    w = L.append
    w("# QCMS respondent portal - predefined theme palettes\n")
    w("Design deliverable for managed theming (issue #26) and the respondent mode switcher.\n")
    w("Four brand-neutral themes. **Light and Dark are per-theme palettes; High-contrast is a single "
      "shared, theme-agnostic mode-layer** (documented once below) - a theme contributes only its "
      "accent to HC. Every colour value below is defined in `tokens.css`; every contrast ratio is "
      "computed from those exact values with the WCAG 2.2 relative-luminance formula (sRGB, "
      "`(L1+0.05)/(L2+0.05)`) by `build.py`, so the numbers cannot drift from the tokens.\n")
    w("## Targets\n")
    w("| Mode | Body text | Large / secondary text | UI / borders / focus |")
    w("|---|---|---|---|")
    w("| Light | 4.5:1 (AA) | 3:1 | 3:1 |")
    w("| Dark | 4.5:1 (AA) | 3:1 | 3:1 |")
    w("| High-contrast | **7:1 (AAA)** | 4.5:1 | 3:1 |\n")
    w("## Typography\n")
    w("- `--font-portal` default: `%s`.\n" % FONT_PORTAL)
    w("- **Font is a respondent runtime control** (a grouped `<select>` in the header, next to the "
      "colour-mode and density switchers). This models the three-layer registry: **the registry ships "
      "many fonts grouped by purpose; the admin curates which are offered; System default is always "
      "on** as the accessibility escape hatch so a respondent is never trapped in a shipped face.")
    w("- Switching overrides `--font-portal` via a root class (`:root.font-<key>`). Every font below is "
      "**embedded in `showcase.html` as a base64 `woff2` data URI** (fetched at build time by "
      "`fetch_fonts.py`), so the page renders each for real with **no runtime network request** "
      "(CSP-safe). In production, self-host the same `woff2` via `@font-face`.")
    # generated registry table
    w("")
    w("| Group | Font | Weights | Licence | Build source |")
    w("|---|---|---|---|---|")
    w("| System | System default (OS stack) | - | n/a | not embedded (device font) |")
    fonts_json = {}
    _fp = os.path.join(OUT, '_fonts_b64.json')
    if os.path.exists(_fp):
        with open(_fp, encoding='utf-8') as _f:
            fonts_json = json.load(_f)
    embedded_keys = set(fonts_json.keys())
    for g in GROUP_ORDER:
        for f in [x for x in FONTS if x["group"] == g]:
            e = fonts_json.get(f["key"], {})
            wts = "+".join(str(w) for w in f["weights"])
            src = e.get("source", "NOT EMBEDDED") if f["key"] in embedded_keys else "NOT FETCHED"
            note = (" - " + f["note"]) if f["note"] else ""
            w("| %s | %s%s | %s | %s | %s |" % (g, f["family"], note, wts, f["license"], src))
    w("")
    missing = [f["key"] for f in FONTS if f["key"] not in embedded_keys]
    if missing:
        w("- **Honesty note:** these could NOT be fetched at build time and are omitted from the "
          "picker (not faked): `%s`.\n" % "`, `".join(missing))
    else:
        w("- **All %d web fonts fetched and embedded successfully** (Accessibility group carries "
          "regular + bold; Popular / Playful / Traditional carry regular only to bound file size). "
          "Total embedded payload is large by design for this showcase.\n" % len(FONTS))
    w("- Serif families fall back to `Georgia, \"Times New Roman\", serif`; the rest to "
      "`ui-sans-serif, system-ui, sans-serif`. Accessibility faces have distinct `I` / `l` / `1` and "
      "non-mirrored `b` / `d`.")
    w("- **The WCAG 1.4.12 type-scale floors below apply to whichever font is selected** - the sample "
      "sets them on the content region, so no embedded face can drop below them:")
    w("- **Type-scale floors (WCAG 1.4.12, applied to the sample and mandated for the portal):**")
    w("  - Body text >= **16px** (input text never smaller).")
    w("  - Line-height >= **1.5**.")
    w("  - Letter-spacing >= **0.12em**.")
    w("  - Word-spacing >= **0.16em**.")
    w("  - Paragraph spacing >= **2em**.")
    w("  - Step heading ~1.75-1.875rem; labels 1rem; hint text 0.875rem (>=14px), never the sole "
      "carrier of meaning.\n")
    w("## Density (spacing axis)\n")
    w("- A **fourth respondent runtime control** (in the header alongside colour-mode and font), "
      "modelled on Outlook / Gmail density: **Compact / Comfortable (default) / Spacious**. It is "
      "independent of theme x mode x font and composes freely with them.")
    w("- Implemented as a named spacing-token group swapped by a root class "
      "(`.density-compact` / `.density-spacious`; Comfortable = base `:root`) - the same mechanism "
      "as mode and font. The sample's form consumes these tokens, so switching visibly re-spaces it.")
    w("")
    w("| Token | Comfortable (base) | Compact | Spacious | Used for |")
    w("|---|---|---|---|---|")
    w("| `--space-control-h` | 44px | 36px | 52px | input / button / select height |")
    w("| `--space-control-pad-x` | 0.9rem | 0.6rem | 1.1rem | horizontal padding in controls |")
    w("| `--space-field-gap` | 2em | 1.3em | 2.5em | gap between questions |")
    w("| `--space-section-pad` | 2.25rem | 1.5rem | 2.9rem | step-card padding |")
    w("| `--space-stack` | 0.5rem | 0.35rem | 0.7rem | label-to-input gap / option padding |")
    w("")
    w("- **Density changes CHROME spacing only** - padding, gaps, control heights, rhythm. **Hard "
      "constraints hold in every level, including Compact:**")
    w("  - Body text stays >= **16px**, line-height >= **1.5**, letter-spacing >= **0.12em**, "
      "word-spacing >= **0.16em** (the WCAG 1.4.12 floors above are never altered by density).")
    w("  - Interactive targets stay >= **24px** (WCAG 2.5.8): `--space-control-h` bottoms out at "
      "**36px** in Compact (still comfortably above 24px, and Comfortable/Spacious sit at ~44px+ "
      "for touch). Option rows, being text + padding, exceed this at every level.")
    w("- Contrast is unaffected - spacing tokens carry no colour, so all ratios below are identical "
      "across the three densities.\n")
    w("## Corners (border-radius) - theme-level\n")
    w("- Unlike mode / font / density (respondent runtime controls), **Corners is a theme / admin-level "
      "setting** - it sets brand character, so the showcase groups it with the theme selector "
      "('Corners'), not with the respondent controls in the header.")
    w("- A `--radius-*` token group swapped by a root class (`.radius-sharp` / `.radius-rounded` / "
      "`.radius-pill`; **Subtle = base `:root`**). It **composes with theme x mode x font x density** "
      "and is applied across inputs, buttons, selects, option rows, the step card, and banners, so "
      "switching visibly re-rounds the whole sample. **No contrast impact** (geometry only).")
    w("")
    w("| Token | Sharp | Subtle (default) | Rounded | Pill | Used for |")
    w("|---|---|---|---|---|---|")
    w("| `--radius-control` | 0 | 6px | 10px | 999px | buttons / inputs / selects |")
    w("| `--radius-card` | 0 | 10px | 16px | 20px | step card / panels / banners |")
    w("| `--radius-sm` | 0 | 4px | 6px | 8px | checkboxes / radios / chips |")
    w("\n---\n")
    for theme in ('slate','harbor','sand','plum'):
        w("## %s - %s\n" % (theme, theme_title(theme)))
        w(RATIONALE[theme] + "\n")
        for mode in ('light','dark'):
            t = THEMES[theme][mode]
            tg = TARGETS[mode]
            w("### %s / %s\n" % (theme, mode))
            w(MODE_NOTE[mode] + "\n")
            # contrast table
            w("**Critical contrast pairs**\n")
            w("| Pair | Foreground | Background | Ratio | Target | Result |")
            w("|---|---|---|---:|---:|:--:|")
            for label, fg, bg, key in critical_pairs(t, mode):
                if fg == 'transparent' or bg == 'transparent':
                    continue
                ratio = contrast(fg, bg)
                target = tg[key]
                ok = 'PASS' if ratio >= target - 0.005 else 'FAIL'
                w("| %s | `%s` | `%s` | %.2f | %.1f | %s |" % (label, fg, bg, ratio, target, ok))
            w("")
            # full token values
            w("<details><summary>Full token values (%s / %s)</summary>\n" % (theme, mode))
            w("| Token | Value |")
            w("|---|---|")
            for k in COLOR_KEYS:
                w("| `--%s` | `%s` |" % (k, t[k]))
            if mode == 'light':
                w("| `--font-portal` | `%s` |" % FONT_PORTAL)
            w("\n</details>\n")
        w("HC for this theme = the shared High-contrast mode-layer below, with only its accent "
          "swapped to `%s`.\n" % HC_ACCENTS[theme]['color-primary'])
        w("---\n")

    # ---- High-contrast mode-layer (documented once) ----
    emit_hc_modelayer_md(w)

    with open(os.path.join(OUT,'THEMES.md'),'w',encoding='utf-8') as f:
        f.write('\n'.join(L))

def emit_hc_modelayer_md(w):
    w("## High-contrast - universal mode-layer (all themes)\n")
    w("High-contrast is **not a per-theme palette**. One universal palette serves every theme: "
      "pure `#000` text and borders on pure `#fff` surfaces, one muted text, the fixed AAA "
      "semantic colours, and a universal focus ring `#0a3ea8`. It is defined once in `:root.hc`. "
      "A theme contributes **only its accent** (`--color-primary` + hover/active/foreground) via a "
      "tiny `:root[data-theme=\"x\"].hc` override; links and primary UI use `--color-primary`, so "
      "each theme keeps a whisper of brand while everything else stays identical.\n")
    w("A **new theme gets HC for free** by supplying one AAA-safe accent override - no full HC "
      "palette to author or maintain.\n")
    w(MODE_NOTE['hc'] + "\n")
    # Universal critical pairs (accent-independent), computed from HC_UNIVERSAL.
    t = HC_UNIVERSAL; tg = TARGETS['hc']
    w("### Universal HC pairs (identical for every theme)\n")
    w("These pairs contain no theme accent, so they are the same in all four themes:\n")
    w("| Pair | Foreground | Background | Ratio | Target | Result |")
    w("|---|---|---|---:|---:|:--:|")
    accent_labels = ('primary-fg / primary', 'primary / surface (link/UI)')
    for label, fg, bg, key in critical_pairs(t, 'hc'):
        if label in accent_labels:      # accent-dependent -> shown in the per-theme table
            continue
        if fg == 'transparent' or bg == 'transparent':
            continue
        ratio = contrast(fg, bg); target = tg[key]
        ok = 'PASS' if ratio >= target - 0.005 else 'FAIL'
        w("| %s | `%s` | `%s` | %.2f | %.1f | %s |" % (label, fg, bg, ratio, target, ok))
    w("")
    # Per-theme accent table
    w("### Per-theme accent in HC (the only thing that differs)\n")
    w("Each accent is checked against the universal white surface for **primary-fg on primary** "
      "(AAA body 7:1) and **primary as link/UI** (3:1). All four clear AAA behind white foreground.\n")
    w("| Theme | Selector | `--color-primary` | fg | primary-fg / primary (>=7) | primary / #fff surface (>=3) |")
    w("|---|---|---|---|---:|---:|")
    for theme in ('slate','harbor','sand','plum'):
        acc = HC_ACCENTS[theme]
        p = acc['color-primary']; fg = acc['color-primary-foreground']
        sel = ':root.hc (default)' if theme == 'slate' else ':root[data-theme="%s"].hc' % theme
        r_btn = contrast(fg, p)
        r_ui = contrast(p, HC_UNIVERSAL['color-surface'])
        w("| %s | `%s` | `%s` | `%s` | %.2f %s | %.2f %s |" % (
            theme, sel, p, fg,
            r_btn, 'PASS' if r_btn >= 6.995 else 'FAIL',
            r_ui, 'PASS' if r_ui >= 2.995 else 'FAIL'))
    w("")
    w("<details><summary>Full universal HC token values (:root.hc)</summary>\n")
    w("| Token | Value |")
    w("|---|---|")
    for k in COLOR_KEYS:
        note = ''
        if k in HC_ACCENT_KEYS:
            note = '  <!-- slate default; overridden per theme -->'
        w("| `--%s` | `%s` |%s" % (k, HC_UNIVERSAL[k], note))
    w("\n</details>\n")
    w("---\n")

def theme_title(theme):
    return {'slate':'Slate Teal (shipped default)','harbor':'Harbor (corporate blue)',
            'sand':'Sand (warm neutral / terracotta)','plum':'Plum (deep violet)'}[theme]

# ===========================================================================
# EMIT showcase.html  (self-contained; injects the exact token CSS + JSON)
# ===========================================================================
def emit_showcase():
    with open(os.path.join(OUT,'tokens.css'), encoding='utf-8') as f:
        tokens_css = f.read()
    tokens_json = json.dumps(THEMES)
    # embedded fonts (may be empty if fetch not run)
    fonts = {}
    fp = os.path.join(OUT, '_fonts_b64.json')
    if os.path.exists(fp):
        with open(fp, encoding='utf-8') as f:
            fonts = json.load(f)

    # @font-face blocks with base64 data URIs (self-contained, no runtime network)
    ff = ["/* ===== Embedded fonts: base64 woff2 data: URIs - NO runtime network. ====="]
    ff.append("   Fetched at BUILD time by fetch_fonts.py. All OFL-1.1 except Roboto (Apache-2.0).")
    ff.append("   ~20 families; large by design for this showcase. ===== */")
    for f in FONTS:
        e = fonts.get(f["key"])
        if not e:
            continue
        for w, b64 in sorted(e["weights"].items()):
            ff.append("@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
                      "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2');}"
                      % (e["family"], w, b64))
    fontfaces = "\n".join(ff)

    # grouped <select> options: System first, then each embedded group
    opt = ['<optgroup label="System"><option value="system">System default</option></optgroup>']
    for g in ["System"] + GROUP_ORDER:
        if g == "System":
            continue
        rows = [f for f in FONTS if f["group"] == g and f["key"] in fonts]
        if not rows:
            continue
        opt.append('<optgroup label="%s">' % g)
        for f in rows:
            opt.append('<option value="%s">%s</option>' % (f["key"], f["family"]))
        opt.append('</optgroup>')
    font_options = "\n".join(opt)
    font_keys = json.dumps([f["key"] for f in FONTS if f["key"] in fonts])

    html = SHOWCASE_TEMPLATE.replace('/*__TOKENS__*/', tokens_css)
    html = html.replace('/*__TOKENS_JSON__*/', tokens_json)
    html = html.replace('/*__FONTFACES__*/', fontfaces)
    html = html.replace('<!--__FONT_OPTIONS__-->', font_options)
    html = html.replace('/*__FONT_KEYS__*/', font_keys)
    with open(os.path.join(OUT,'showcase.html'),'w',encoding='utf-8') as f:
        f.write(html)

SHOWCASE_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QCMS respondent portal - theme &amp; mode showcase</title>
<link rel="icon" href="data:,">
<style>
/* ===== injected, WCAG-verified design tokens (identical to tokens.css) ===== */
/*__TOKENS__*/

/* ===== page reset / base ===== */
*,*::before,*::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-portal);
  background: var(--color-background);
  color: var(--color-text);
  line-height: 1.5;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
.vh {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; border-radius: 4px; }
a.skip {
  position: absolute; left: .5rem; top: -3rem; background: var(--color-surface);
  color: var(--color-text); padding: .5rem .75rem; border-radius: 8px;
  border: 2px solid var(--color-focus-ring); transition: top .15s; z-index: 30;
}
a.skip:focus { top: .5rem; }

/* chrome spacing + shared control metrics (preview/chrome only - NOT the WCAG
   text-spacing floors and NOT the density tokens) */
:root {
  --ctl-h: 36px;                    /* shared height: selects + segmented controls */
  --chrome-pad-x: clamp(1rem, 4vw, 2rem);
  --chrome-gap: .55rem;             /* within one control group */
  --chrome-gap-x: 1.5rem;           /* between control groups */
}

/* ============================================================
   A. IDENTITY HEADER - the form's title bar (brand + progress).
   Customisation controls live in the appearance bar below; this
   row carries only the portal's identity, never the switchers.
   ============================================================ */
.portal { min-height: 60vh; }
.portal-header {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: .6rem 1.5rem;
  padding: .85rem var(--chrome-pad-x);
  /* subtle brand-tinted band so the accent reads beyond the button */
  background: color-mix(in srgb, var(--color-primary) 8%, color-mix(in srgb, var(--color-surface) 86%, transparent));
  -webkit-backdrop-filter: saturate(160%) blur(10px);
  backdrop-filter: saturate(160%) blur(10px);
  border-bottom: 1px solid var(--color-border);
}
.brand { display: flex; align-items: center; gap: .6rem; min-width: 0; }
.brand .mark {
  width: 34px; height: 34px; border-radius: 10px; flex: none;
  display: grid; place-items: center;
  background: linear-gradient(140deg, var(--color-primary), var(--color-primary-active));
  color: var(--color-primary-foreground); font-size: .82rem; font-weight: 700; letter-spacing: .02em;
}
.brand-text { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.brand-name { font-weight: 680; font-size: 1rem; letter-spacing: .01em; }
.brand-sub { color: var(--color-text-muted); font-weight: 500; font-size: .76rem; }
.progress { display: flex; align-items: center; gap: .7rem; flex: 1 1 200px; max-width: 360px; }
.progress-label { font-size: .78rem; font-weight: 600; color: var(--color-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.progress-track {
  flex: 1; min-width: 72px; height: 7px; border-radius: 999px; overflow: hidden;
  background: var(--color-background-muted); border: 1px solid var(--color-border);
}
.progress-fill { height: 100%; width: 50%; border-radius: 999px; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover)); }

/* ============================================================
   B. APPEARANCE & THEME BAR - one coherent settings area, set
   apart from the title row. Two labelled sub-groups sharing a
   single visual language:
     - Brand & theme (admin)  : Theme + Corners
     - Your view (respondent) : Font + Density + Colour mode
   ============================================================ */
.appearance-bar { background: var(--color-surface); border-bottom: 1px solid var(--color-border); }
.appearance-inner { max-width: 1120px; margin: 0 auto; padding: 0 var(--chrome-pad-x); }
.settings-row { display: flex; align-items: flex-start; gap: 1.25rem; padding: .8rem 0; }
.settings-row + .settings-row { border-top: 1px solid var(--color-border); }
.settings-head { flex: none; width: 8.5rem; padding-top: .35rem; }
.settings-title { display: block; font-weight: 650; font-size: .85rem; letter-spacing: .01em; }
.settings-kind {
  display: inline-block; margin-top: .25rem;
  font-size: .62rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
  padding: .12rem .42rem; border-radius: 999px;
  color: var(--color-text-muted); background: var(--color-background-muted);
}
.settings-row.is-view .settings-kind { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface)); }
.settings-controls { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: .8rem var(--chrome-gap-x); }
.ctl-group { display: flex; align-items: center; gap: var(--chrome-gap); }
.ctl-label { font-weight: 600; font-size: .8rem; color: var(--color-text-muted); white-space: nowrap; }

/* theme switcher: palette cards with a live contrast readout */
.palettes { display: flex; gap: .5rem; flex-wrap: wrap; }
.palette-card {
  display: flex; flex-direction: column; gap: .4rem;
  min-width: 150px; padding: .5rem .6rem;
  border: 1px solid var(--color-border); border-radius: 12px;
  background: var(--color-surface); color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: border-color .12s, box-shadow .12s, background .12s;
}
.palette-card:hover { border-color: var(--color-border-strong); background: var(--color-surface-hover); }
.palette-card[aria-pressed="true"] {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
}
.palette-card .pc-name { font-weight: 650; font-size: .82rem; letter-spacing: .01em; }
.swatches { display: flex; gap: 3px; }
.swatches span { width: 16px; height: 16px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); }
.readout { font-size: .72rem; line-height: 1.45; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.readout strong { color: var(--color-text); font-weight: 650; }

/* selects: Corners + Font share one control style */
select.field-select {
  font: inherit; font-size: .85rem; height: var(--ctl-h);
  padding: 0 2rem 0 .7rem;
  border: 1px solid var(--color-border-strong); border-radius: var(--radius-control);
  background: var(--color-surface); color: var(--color-text);
  appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: right 1rem center, right .7rem center;
  background-size: 6px 6px, 6px 6px; background-repeat: no-repeat;
  transition: border-color .12s;
}
select.field-select:hover { border-color: var(--color-text-muted); }

/* segmented controls: Colour mode + Density (native radios as a pill group) */
.segmented {
  display: inline-flex; align-items: center; gap: 2px; margin: 0; padding: 3px; border: 0;
  height: var(--ctl-h); background: var(--color-background-muted); border-radius: 999px;
}
.segmented input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.segmented label {
  display: inline-flex; align-items: center; gap: .35rem; height: 100%;
  padding: 0 .7rem; border-radius: 999px; cursor: pointer;
  font-size: .82rem; font-weight: 600; color: var(--color-text-muted); line-height: 1; user-select: none;
  transition: background .12s, color .12s;
}
.segmented label .ic { font-size: .95rem; }
.segmented input:checked + label {
  background: var(--color-surface); color: var(--color-text);
  /* selected cue is NOT colour-only: filled pill + elevation + inset accent ring */
  box-shadow: 0 1px 2px rgb(0 0 0 / .12), inset 0 0 0 1.5px var(--color-primary);
}
.segmented input:focus-visible + label { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; }
.segmented.icons label { padding: 0 .55rem; }
.segmented.icons svg { display: block; }

.appearance-note { max-width: 1120px; margin: 0 auto; padding: .55rem var(--chrome-pad-x) .75rem; color: var(--color-text-muted); font-size: .74rem; line-height: 1.5; }
.appearance-note strong { color: var(--color-text); font-weight: 650; }

/* ============================================================
   C. SAMPLE FORM - the respondent step. The WCAG 1.4.12 text-
   spacing floors are set on .portal-main (line-height 1.5,
   letter-spacing .12em, word-spacing .16em, 16px body) and are
   never reduced by density or chrome changes.
   ============================================================ */
.portal-main {
  max-width: 720px; margin: 0 auto;
  padding: var(--space-section-pad) var(--chrome-pad-x) 4rem;
  line-height: 1.5; letter-spacing: 0.12em; word-spacing: 0.16em;   /* text floors */
}
.portal-main h1 { font-size: clamp(1.55rem,3.5vw,1.85rem); line-height: 1.25; font-weight: 700; margin: 0 0 .5em; }
.portal-main p { margin: 0 0 2em; }
.portal-main .lead { color: var(--color-text-muted); max-width: 60ch; }
.link { color: var(--color-primary); font-weight: 650; text-decoration: underline; text-underline-offset: 2px; }
.link:hover { color: var(--color-primary-hover); }

/* error summary (shown in its focused state for the demo) */
.error-summary {
  margin: 0 0 2em; padding: 1rem 1.15rem;
  border: 2px solid var(--color-danger); border-left-width: 6px; border-radius: var(--radius-card);
  background: var(--color-danger-subtle); color: var(--color-danger-fg);
  outline: 3px solid var(--color-focus-ring); outline-offset: 3px;   /* shown focused */
}
.error-summary h2 { margin: 0 0 .5em; font-size: 1.05rem; color: var(--color-danger-fg); }
.error-summary ul { margin: 0; padding-left: 1.2em; }
.error-summary li + li { margin-top: .3em; }
.error-summary a { color: var(--color-danger-fg); font-weight: 650; }

/* status banners */
.banners { display: grid; gap: .6rem; margin: 0 0 2em; }
.banner { display: flex; align-items: flex-start; gap: .55rem; padding: .7rem .85rem; border-radius: var(--radius-card); font-size: .92rem; letter-spacing: .04em; }
.banner.info { background: var(--color-info-subtle); color: var(--color-info-fg); border: 1px solid color-mix(in srgb, var(--color-info) 35%, transparent); }
.banner.success { background: var(--color-success-subtle); color: var(--color-success-fg); border: 1px solid color-mix(in srgb, var(--color-success) 35%, transparent); }
.banner.warning { background: var(--color-warning-subtle); color: var(--color-warning-fg); border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent); }

/* fields (chrome spacing from density tokens; text floors untouched) */
.field { margin: 0 0 var(--space-field-gap); }
.field > label.lbl, .group > legend {
  display: block; font-weight: 650; margin-bottom: var(--space-stack); letter-spacing: .04em;
}
.field .hint { display: block; color: var(--color-text-muted); font-size: .95rem; margin-bottom: var(--space-stack); }
input[type="text"] {
  width: 100%; font: inherit; font-size: 1rem; letter-spacing: .06em;
  min-height: var(--space-control-h); padding: .4em var(--space-control-pad-x);
  color: var(--color-text); background: var(--color-surface);
  border: 1px solid var(--color-border-strong); border-radius: var(--radius-control);
  transition: border-color .12s, box-shadow .12s;
}
input[type="text"]::placeholder { color: var(--color-text-muted); }
input[type="text"]:hover { border-color: var(--color-text-muted); }
input[type="text"][aria-invalid="true"] { border-color: var(--color-danger); box-shadow: 0 0 0 1px var(--color-danger); }
.field .err-msg { display: block; margin-top: .45em; color: var(--color-danger-fg); font-weight: 650; font-size: .9rem; }

/* radio / checkbox option groups */
.group { border: 0; padding: 0; margin: 0 0 var(--space-field-gap); }
.options { display: grid; gap: var(--space-stack); }
.option {
  display: flex; align-items: flex-start; gap: .65rem;
  padding: calc(var(--space-stack) + .2rem) var(--space-control-pad-x);
  border: 1px solid var(--color-border); border-radius: var(--radius-card);
  background: var(--color-surface); cursor: pointer;
  transition: border-color .12s, background .12s, box-shadow .12s;
}
.option:hover { background: var(--color-surface-hover); }
.option:focus-within { border-color: var(--color-primary); }
.option input { margin-top: .15em; width: 1.15em; height: 1.15em; accent-color: var(--color-primary); flex: none; }
.option .opt-text { font-size: 1rem; }
.option .opt-desc { display: block; color: var(--color-text-muted); font-size: .9rem; letter-spacing: .04em; }
/* accent presence: selected option carries the brand colour (not colour-only: ring + weight) */
.option:has(:checked) {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface));
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
.option:has(:checked) .opt-text { color: var(--color-primary); font-weight: 650; }

/* actions */
.actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: var(--space-field-gap); }
.btn {
  font: inherit; font-size: 1rem; font-weight: 650; letter-spacing: .04em;
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--space-control-h); min-width: 7rem; padding: 0 calc(var(--space-control-pad-x) + .5rem);
  border: 1px solid transparent; border-radius: var(--radius-control);
  cursor: pointer; line-height: 1.2;
  transition: background .12s, border-color .12s, box-shadow .12s;
}
.btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-primary:active { background: var(--color-primary-active); box-shadow: none; }
.btn-secondary { background: var(--color-ghost); color: var(--color-text); border-color: var(--color-border-strong); }
.btn-secondary:hover { background: var(--color-ghost-hover); }
.btn-secondary:active { background: var(--color-ghost-active); }

.foot-note { max-width: 720px; margin: 0 auto; padding: 0 var(--chrome-pad-x) 3rem; color: var(--color-text-muted); font-size: .8rem; line-height: 1.6; }

/* ============================================================
   D. HIGH-CONTRAST MODE-LAYER (structural, theme-agnostic)
   HC is a distinct respondent choice (NOT dark): the token layer
   swaps to pure #000-on-#fff; here we thicken borders, flatten
   surfaces and heavy the focus ring so HC reads as unmistakably
   different from Light at a glance.
   ============================================================ */
:root.hc :focus-visible { outline: 4px solid var(--color-focus-ring); outline-offset: 3px; }
:root.hc .portal-header { background: var(--color-surface); -webkit-backdrop-filter: none; backdrop-filter: none; border-bottom: 3px solid var(--color-border-strong); }
:root.hc .brand .mark { background: var(--color-primary); border: 2px solid var(--color-border-strong); }
:root.hc .progress-track { border: 2px solid var(--color-border-strong); background: var(--color-surface); height: 10px; }
:root.hc .progress-fill { background: var(--color-primary); }
:root.hc .appearance-bar { border-bottom: 2px solid var(--color-border-strong); }
:root.hc .settings-row + .settings-row { border-top: 2px solid var(--color-border-strong); }
:root.hc .palette-card { border: 2px solid var(--color-border-strong); box-shadow: none; }
:root.hc .palette-card[aria-pressed="true"] { border-color: var(--color-primary); box-shadow: inset 0 0 0 3px var(--color-primary); }
:root.hc select.field-select { border: 2px solid var(--color-border-strong); }
:root.hc .segmented { border: 2px solid var(--color-border-strong); background: var(--color-surface); }
:root.hc .segmented input:checked + label { background: var(--color-primary); color: var(--color-primary-foreground); box-shadow: none; border-radius: 999px; }
:root.hc .portal-main { border: 2px solid var(--color-border-strong); border-radius: var(--radius-card); background: var(--color-surface); margin-top: 1.75rem; margin-bottom: 2rem; }
:root.hc .error-summary { border: 3px solid var(--color-danger); border-left-width: 10px; }
:root.hc .banner { border: 2px solid var(--color-border-strong); }
:root.hc input[type="text"] { border: 2px solid var(--color-border-strong); box-shadow: none; }
:root.hc input[type="text"][aria-invalid="true"] { border-color: var(--color-danger); box-shadow: inset 0 0 0 1px var(--color-danger); }
:root.hc .option { border: 2px solid var(--color-border-strong); }
:root.hc .option:hover { background: var(--color-surface); }
:root.hc .option:has(:checked) { background: var(--color-surface); border-color: var(--color-primary); box-shadow: inset 0 0 0 3px var(--color-primary); }
:root.hc .btn { border-width: 2px; box-shadow: none; }
:root.hc .btn-primary { border-color: var(--color-border-strong); }
:root.hc .btn-secondary { background: var(--color-surface); }

/* ============================================================
   E. RESPONSIVE
   ============================================================ */
@media (max-width: 720px) {
  .settings-row { flex-direction: column; gap: .5rem; padding: .7rem 0; }
  .settings-head { width: auto; padding-top: 0; display: flex; align-items: center; gap: .5rem; }
  .settings-kind { margin-top: 0; }
  .settings-controls { gap: .7rem 1rem; }
  .progress { max-width: none; flex-basis: 100%; }
  .palette-card { flex: 1 1 132px; min-width: 132px; }
}
</style>
<style>
/*__FONTFACES__*/
</style>
</head>
<body>
<a class="skip" href="#main">Skip to step content</a>

<div class="portal">

  <!-- ============ A. IDENTITY HEADER: brand + progress (the form's title bar) ============ -->
  <header class="portal-header" role="banner">
    <div class="brand">
      <span class="mark" aria-hidden="true">QC</span>
      <span class="brand-text">
        <span class="brand-name">Brand mark</span>
        <span class="brand-sub">Respondent portal</span>
      </span>
    </div>
    <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="6" aria-valuenow="3"
         aria-valuetext="Step 3 of 6" aria-label="Survey progress">
      <span class="progress-label" aria-hidden="true">Step 3 of 6</span>
      <span class="progress-track"><span class="progress-fill"></span></span>
    </div>
  </header>

  <!-- ============ B. APPEARANCE & THEME SETTINGS (distinct area, set apart from the title) ====
       Brand & theme (admin: theme + corners) vs Your view (respondent: font, density, mode),
       one shared visual language. Preview chrome - not submitted. ============ -->
  <div class="appearance-bar" role="region" aria-label="Appearance and theme settings">
    <div class="appearance-inner">

      <!-- admin / brand-level: theme palette + corners -->
      <section class="settings-row is-brand" aria-labelledby="grp-brand">
        <div class="settings-head">
          <span class="settings-title" id="grp-brand">Brand &amp; theme</span>
          <span class="settings-kind">Admin</span>
        </div>
        <div class="settings-controls">
          <div class="ctl-group" role="group" aria-labelledby="theme-lbl">
            <span class="ctl-label" id="theme-lbl">Theme</span>
            <div class="palettes" id="palettes"></div>
          </div>
          <div class="ctl-group">
            <label class="ctl-label" for="corners-select">Corners</label>
            <select id="corners-select" class="field-select" title="Border radius (theme-level brand character)">
              <option value="sharp">Sharp</option>
              <option value="subtle" selected>Subtle</option>
              <option value="rounded">Rounded</option>
              <option value="pill">Pill</option>
            </select>
          </div>
        </div>
      </section>

      <!-- respondent runtime: font + density + colour mode -->
      <section class="settings-row is-view" aria-labelledby="grp-view">
        <div class="settings-head">
          <span class="settings-title" id="grp-view">Your view</span>
          <span class="settings-kind">You</span>
        </div>
        <div class="settings-controls">
          <div class="ctl-group">
            <label class="ctl-label" for="font-select">Font</label>
            <select id="font-select" class="field-select" aria-describedby="font-note">
              <!--__FONT_OPTIONS__-->
            </select>
          </div>
          <div class="ctl-group">
            <span class="ctl-label" aria-hidden="true">Density</span>
            <fieldset class="segmented icons" id="density-switch">
              <legend class="vh">Density (spacing)</legend>
              <input type="radio" name="density" id="density-compact" value="compact">
              <label for="density-compact" title="Compact - tightly spaced">
                <svg width="19" height="19" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="14" height="2" rx="1"/><rect x="3" y="7" width="14" height="2" rx="1"/><rect x="3" y="11" width="14" height="2" rx="1"/><rect x="3" y="15" width="14" height="2" rx="1"/></svg>
                <span class="vh">Compact</span></label>
              <input type="radio" name="density" id="density-comfortable" value="comfortable" checked>
              <label for="density-comfortable" title="Comfortable - default spacing">
                <svg width="19" height="19" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="14" height="2" rx="1"/><rect x="3" y="10" width="14" height="2" rx="1"/><rect x="3" y="16" width="14" height="2" rx="1"/></svg>
                <span class="vh">Comfortable</span></label>
              <input type="radio" name="density" id="density-spacious" value="spacious">
              <label for="density-spacious" title="Spacious - airy spacing">
                <svg width="19" height="19" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="14" height="2" rx="1"/><rect x="3" y="16" width="14" height="2" rx="1"/></svg>
                <span class="vh">Spacious</span></label>
            </fieldset>
          </div>
          <div class="ctl-group">
            <span class="ctl-label" aria-hidden="true">Mode</span>
            <fieldset class="segmented" id="mode-switch">
              <legend class="vh">Colour mode (defaults to your system; your choice is remembered)</legend>
              <input type="radio" name="mode" id="mode-light" value="light">
              <label for="mode-light"><span class="ic" aria-hidden="true">&#9728;</span> Light</label>
              <input type="radio" name="mode" id="mode-dark" value="dark">
              <label for="mode-dark"><span class="ic" aria-hidden="true">&#9789;</span> Dark</label>
              <input type="radio" name="mode" id="mode-hc" value="hc">
              <label for="mode-hc"><span class="ic" aria-hidden="true">&#9681;</span> High&nbsp;contrast</label>
            </fieldset>
          </div>
        </div>
      </section>

    </div>
    <p class="appearance-note">
      <strong>Brand &amp; theme</strong> (theme palette, corners) are admin / theme-level settings that set brand character.
      <strong>Your view</strong> (font, density, colour mode) are the respondent's own runtime choices -
      <strong>System default</strong> font is always available. Nothing here is submitted.
    </p>
    <p id="font-note" class="vh">System default is always available and uses your own device font.</p>
  </div>

  <!-- ============ C. PRODUCT: sample respondent portal step ============ -->
  <main class="portal-main" id="main">
    <form novalidate>
      <div class="error-summary" role="alert" tabindex="-1" id="errsum">
        <h2>There is a problem</h2>
        <ul>
          <li><a href="#full-name">Enter your full name</a></li>
          <li><a href="#contact-pref">Choose how we should contact you</a></li>
        </ul>
      </div>

      <h1>How would you like us to keep in touch?</h1>
      <p class="lead">Your answers help us tailor the rest of this survey. You can change your
        colour mode or font at any time using the controls above - nothing is submitted until you
        select Continue. Read our <a class="link" href="#">privacy notice</a> before you begin.</p>

      <div class="banners" aria-hidden="false">
        <p class="banner info"><span class="b-ic" aria-hidden="true">&#9432;</span> Your progress is saved automatically on this device.</p>
        <p class="banner success"><span class="b-ic" aria-hidden="true">&#10003;</span> The previous section was completed.</p>
        <p class="banner warning"><span class="b-ic" aria-hidden="true">&#9888;</span> This survey closes in 3 days.</p>
      </div>

      <div class="field">
        <label class="lbl" for="full-name">Full name</label>
        <span class="hint" id="full-name-hint">As it appears on your record.</span>
        <input type="text" id="full-name" name="full-name" aria-describedby="full-name-hint full-name-err"
               aria-invalid="true" autocomplete="name" placeholder="e.g. Alex Taylor">
        <span class="err-msg" id="full-name-err"><span aria-hidden="true">&#9888; </span>Enter your full name</span>
      </div>

      <fieldset class="group" id="contact-pref">
        <legend>How should we contact you?</legend>
        <div class="options">
          <label class="option"><input type="radio" name="contact" value="email">
            <span><span class="opt-text">Email</span><span class="opt-desc">Replies usually within one working day.</span></span></label>
          <label class="option"><input type="radio" name="contact" value="phone">
            <span><span class="opt-text">Phone call</span><span class="opt-desc">Weekdays, 9am to 5pm.</span></span></label>
          <label class="option"><input type="radio" name="contact" value="sms">
            <span><span class="opt-text">Text message</span><span class="opt-desc">Short updates only.</span></span></label>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>Which topics may we contact you about? (Select all that apply)</legend>
        <div class="options">
          <label class="option"><input type="checkbox" name="topic" value="results" checked>
            <span class="opt-text">Survey results</span></label>
          <label class="option"><input type="checkbox" name="topic" value="followup">
            <span class="opt-text">Follow-up studies</span></label>
          <label class="option"><input type="checkbox" name="topic" value="news">
            <span class="opt-text">Programme news</span></label>
        </div>
      </fieldset>

      <div class="actions">
        <button type="button" class="btn btn-secondary">Back</button>
        <button type="submit" class="btn btn-primary">Continue</button>
      </div>
    </form>
  </main>
</div>

<p class="foot-note">
  Preview note: the <strong>colour-mode switcher</strong>, <strong>font picker</strong> and
  <strong>density</strong> control (under <em>Your view</em>) are the respondent's own runtime controls -
  density (Compact / Comfortable / Spacious, like Outlook or Gmail) re-spaces the chrome only and never
  changes the text-spacing floors or drops a target below 24px. Colour mode defaults to the operating
  system's <code>prefers-color-scheme</code> plus <code>prefers-contrast: more</code>, then persists the
  respondent's explicit choice. <strong>System default</strong> is always offered as a font so a respondent
  is never trapped in a shipped face (the accessibility escape hatch); the font list is a grouped picker
  (Accessibility / Popular / Playful &amp; Kids / Traditional &amp; Corporate). The <strong>theme</strong>
  and <strong>Corners</strong> controls (under <em>Brand &amp; theme</em>) are admin / theme-level settings
  (issue #26): theme decides which palettes are available; Corners sets border-radius brand character.
  Every web font is embedded as a base64 <code>woff2</code> data URI (OFL-1.1, except Roboto Apache-2.0) -
  the page makes no runtime network request; self-host the same woff2 in production.
</p>

<script>
"use strict";
var TOKENS = /*__TOKENS_JSON__*/;
var FONT_KEYS = /*__FONT_KEYS__*/;
var THEME_ORDER = ["slate","harbor","sand","plum"];
var THEME_LABEL = { slate:"Slate Teal", harbor:"Harbor", sand:"Sand", plum:"Plum" };

/* --- WCAG relative luminance / contrast (ported from build.py) --- */
function lin(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
function hexRgb(h){ h=h.replace('#',''); if(h.length===3){h=h.split('').map(function(x){return x+x;}).join('');}
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function lum(hex){ var r=hexRgb(hex); return 0.2126*lin(r[0])+0.7152*lin(r[1])+0.0722*lin(r[2]); }
function contrast(fg,bg){ var a=lum(fg),b=lum(bg); var hi=Math.max(a,b),lo=Math.min(a,b); return (hi+0.05)/(lo+0.05); }
function isHex(v){ return typeof v==="string" && v.charAt(0)==="#"; }

var state = { theme:"slate", mode:"light", font:"system", density:"comfortable", radius:"subtle" };
var root = document.documentElement;

function applyRoot(){
  var rm = ["dark","hc","density-compact","density-spacious",
            "radius-sharp","radius-rounded","radius-pill"];
  FONT_KEYS.forEach(function(k){ rm.push("font-"+k); });
  root.classList.remove.apply(root.classList, rm);
  if(state.mode!=="light") root.classList.add(state.mode);
  if(state.font!=="system") root.classList.add("font-"+state.font);
  if(state.density!=="comfortable") root.classList.add("density-"+state.density);
  if(state.radius!=="subtle") root.classList.add("radius-"+state.radius);
  if(state.theme==="slate") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.theme);
  renderPalettes();
}

/* build the palette cards (theme switcher + live contrast readout) */
function renderPalettes(){
  var host = document.getElementById("palettes");
  host.innerHTML = "";
  THEME_ORDER.forEach(function(th){
    var tok = TOKENS[th][state.mode];
    var textBg = contrast(tok["color-text"], tok["color-background"]);
    var btn = contrast(tok["color-primary-foreground"], tok["color-primary"]);
    var target = state.mode==="hc" ? 7 : 4.5;
    var card = document.createElement("button");
    card.type = "button";
    card.className = "palette-card";
    card.setAttribute("aria-pressed", th===state.theme ? "true" : "false");
    card.innerHTML =
      '<span class="pc-name">'+THEME_LABEL[th]+'</span>'+
      '<span class="swatches" aria-hidden="true">'+
        '<span style="background:'+tok["color-primary"]+'"></span>'+
        '<span style="background:'+tok["color-surface"]+'"></span>'+
        '<span style="background:'+tok["color-text"]+'"></span>'+
        '<span style="background:'+tok["color-danger"]+'"></span>'+
      '</span>'+
      '<span class="readout">text/bg <strong>'+textBg.toFixed(1)+':1</strong> &middot; btn <strong>'+
        btn.toFixed(1)+':1</strong><br>'+
        '<span>'+(state.mode==="hc"?"HC target 7:1":"AA target 4.5:1")+
        ' &mdash; '+((textBg>=target-0.005&&btn>=4.495)?"pass":"check")+'</span></span>';
    card.addEventListener("click", function(){ state.theme=th; applyRoot(); });
    host.appendChild(card);
  });
}

/* mode switcher */
["light","dark","hc"].forEach(function(m){
  document.getElementById("mode-"+m).addEventListener("change", function(){
    state.mode=m; applyRoot();
  });
});
/* font select */
document.getElementById("font-select").addEventListener("change", function(e){
  state.font=e.target.value; applyRoot();
});
/* density switcher (segmented icon toggle) */
["compact","comfortable","spacious"].forEach(function(d){
  document.getElementById("density-"+d).addEventListener("change", function(){
    state.density=d; applyRoot();
  });
});
/* corners / radius (theme-level) */
document.getElementById("corners-select").addEventListener("change", function(e){
  state.radius=e.target.value; applyRoot();
});

/* initial mode from OS preference (respondent default before explicit choice) */
(function init(){
  var initial="light";
  try{
    if(window.matchMedia("(prefers-contrast: more)").matches) initial="hc";
    else if(window.matchMedia("(prefers-color-scheme: dark)").matches) initial="dark";
  }catch(e){}
  state.mode=initial;
  document.getElementById("mode-"+initial).checked=true;
  applyRoot();
})();
</script>
</body>
</html>
"""

if __name__ == '__main__':
    problems = verify_all()
    if problems:
        print("FAILURES:")
        for p in problems:
            print("  %-7s %-5s %-28s %.2f < %.1f   fg=%s bg=%s" % p)
    else:
        print("ALL CRITICAL PAIRS PASS")
    print("total themes:", len(THEMES))
    # dump json for reuse
    with open(os.path.join(OUT,'_tokens.json'),'w') as f:
        json.dump(THEMES, f, indent=1)
    emit_tokens_css()
    emit_themes_md()
    emit_showcase()
    print("wrote tokens.css, THEMES.md, showcase.html")
