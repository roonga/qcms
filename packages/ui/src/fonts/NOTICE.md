# Self-hosted font notices (`@qcms/ui`)

Generated from `src/font-registry.ts` by `pnpm --filter @qcms/ui fonts:generate`.

Every typeface QCMS ships is open-licensed and redistributable under QCMS's MIT
terms, and every binary in this directory is committed to the repository: a portal
serves fonts from its own origin and makes **zero external requests** for a
typeface. There is no CDN and no build-time download, so nothing here can make a
deployment or CI depend on a third-party host.

The license texts the notices below refer to sit beside the binaries, which is what
OFL-1.1 (section 2) and Apache-2.0 (section 4a) each require of a redistribution:
`LICENSE-OFL-1.1.txt` and `LICENSE-Apache-2.0.txt`.

The files are the **Latin** `woff2` subsets, so text outside Latin falls back
glyph-by-glyph through each entry's fallback stack. A designed multi-script
fallback baseline is issue #27 and is not covered here.

## System

| Family         | Key      | Weights | License          | Bytes |
| -------------- | -------- | ------- | ---------------- | ----- |
| System default | `system` | none    | n/a (no webfont) | 0     |

## Accessibility

| Family                | Key            | Weights  | License | Bytes   |
| --------------------- | -------------- | -------- | ------- | ------- |
| Atkinson Hyperlegible | `atkinson`     | 400, 700 | OFL-1.1 | 34,732  |
| Lexend                | `lexend`       | 400, 700 | OFL-1.1 | 39,680  |
| OpenDyslexic          | `opendyslexic` | 400, 700 | OFL-1.1 | 235,636 |

**Atkinson Hyperlegible** (OFL-1.1)

> Copyright 2020 Braille Institute of America, Inc.

**Lexend** (OFL-1.1)

> Copyright 2018 The Lexend Project Authors (https://github.com/googlefonts/lexend), with Reserved Font Name RevReading Lexend.

**OpenDyslexic** (OFL-1.1)

> Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es|support@abbiecod.es), with Reserved Font Name OpenDyslexic.

## Popular

| Family     | Key          | Weights | License               | Bytes  |
| ---------- | ------------ | ------- | --------------------- | ------ |
| Inter      | `inter`      | 400     | OFL-1.1               | 23,664 |
| Roboto     | `roboto`     | 400     | OFL-1.1 OR Apache-2.0 | 21,884 |
| Open Sans  | `opensans`   | 400     | OFL-1.1               | 18,640 |
| Lato       | `lato`       | 400     | OFL-1.1               | 23,580 |
| Poppins    | `poppins`    | 400     | OFL-1.1               | 7,884  |
| Montserrat | `montserrat` | 400     | OFL-1.1               | 18,780 |

**Inter** (OFL-1.1)

> Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)

**Roboto** (OFL-1.1 OR Apache-2.0)

> Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic)

**Open Sans** (OFL-1.1)

> Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)

**Lato** (OFL-1.1)

> Copyright (c) 2010-2014 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato"

**Poppins** (OFL-1.1)

> Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)

**Montserrat** (OFL-1.1)

> Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git)

## Playful & Kids

| Family       | Key           | Weights | License | Bytes  |
| ------------ | ------------- | ------- | ------- | ------ |
| Andika       | `andika`      | 400     | OFL-1.1 | 19,208 |
| Fredoka      | `fredoka`     | 400     | OFL-1.1 | 16,076 |
| Baloo 2      | `baloo2`      | 400     | OFL-1.1 | 18,920 |
| Comic Neue   | `comicneue`   | 400     | OFL-1.1 | 19,572 |
| Patrick Hand | `patrickhand` | 400     | OFL-1.1 | 23,944 |

**Andika** (OFL-1.1)

> Copyright (c) 2004-2022 SIL International (http://www.sil.org/) with Reserved Font Names "Andika" and "SIL".

**Fredoka** (OFL-1.1)

> Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One)

**Baloo 2** (OFL-1.1)

> Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2)

**Comic Neue** (OFL-1.1)

> Copyright 2014 The Comic Neue Project Authors (https://github.com/crozynski/comicneue)

**Patrick Hand** (OFL-1.1)

> Copyright (c) 2010-2012 Patrick Wagesreiter (mail@patrickwagesreiter.at)

## Traditional & Corporate

| Family            | Key                | Weights | License | Bytes  |
| ----------------- | ------------------ | ------- | ------- | ------ |
| Merriweather      | `merriweather`     | 400     | OFL-1.1 | 49,168 |
| Lora              | `lora`             | 400     | OFL-1.1 | 21,148 |
| PT Serif          | `ptserif`          | 400     | OFL-1.1 | 33,116 |
| Libre Baskerville | `librebaskerville` | 400     | OFL-1.1 | 20,108 |
| IBM Plex Serif    | `ibmplexserif`     | 400     | OFL-1.1 | 19,580 |
| Public Sans       | `publicsans`       | 400     | OFL-1.1 | 14,632 |

**Merriweather** (OFL-1.1)

> Copyright 2020 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4) with Reserved Font Name "Merriweather".

**Lora** (OFL-1.1)

> Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora".

**PT Serif** (OFL-1.1)

> Copyright (c) 2010, ParaType Ltd. (http://www.paratype.com/public), with Reserved Font Names "PT Sans", "PT Serif" and "ParaType".

**Libre Baskerville** (OFL-1.1)

> Copyright 2012 The Libre Baskerville Project Authors (https://github.com/impallari/Libre-Baskerville) with Reserved Font Name Libre Baskerville.

**IBM Plex Serif** (OFL-1.1)

> Copyright (c) 2017 IBM Corp. with Reserved Font Name "Plex"

**Public Sans** (OFL-1.1)

> Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)

## Monospace

| Family         | Key             | Weights | License | Bytes  |
| -------------- | --------------- | ------- | ------- | ------ |
| JetBrains Mono | `jetbrainsmono` | 400     | OFL-1.1 | 21,168 |
| Geist Mono     | `geistmono`     | 400     | OFL-1.1 | 9,864  |

**JetBrains Mono** (OFL-1.1)

> Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

**Geist Mono** (OFL-1.1)

> Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)

Total committed font payload: **710,984 bytes** across 24 files (25 declared faces; a variable font's weights share one file).
