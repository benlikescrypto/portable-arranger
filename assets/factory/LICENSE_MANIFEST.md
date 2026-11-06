# ArrangerBox factory license manifest

No third-party PCM, SoundFont, or manufacturer ROM is shipped in this repository.

| Instrument / style | Original library | Source URL | License | Redistribution | Attribution | Modifications |
| --- | --- | --- | --- | --- | --- | --- |
| All factory patches in `modules/audio/cpp/Factory.cpp` | ArrangerBox modeled ROM | this repository | Proprietary ArrangerBox (original synthesis) | Yes, with the app | None required | Original models |
| All factory styles in `modules/audio/cpp/FactoryStyles.cpp` | ArrangerBox original MIDI arrangements | this repository | Proprietary ArrangerBox | Yes, with the app | None required | Original patterns |

## Approved external sources (not bundled here)

These may be ingested later through the SFZ loader. Do not copy them into the app until the files are actually added and this table is updated with the exact files.

| Library | URL | License | Redistribution in a commercial app |
| --- | --- | --- | --- |
| Versilian Community Sample Library (VCSL) | https://github.com/sgossner/VCSL | CC0 1.0 | Yes |
| VSCO 2 Community Edition | https://github.com/sgossner/VSCO-2-CE | CC0 1.0 | Yes (credit requested, not required by CC0) |
| ConvertWithMoss | https://github.com/git-moss/ConvertWithMoss | GPL-3.0 | **No** — format documentation only |

## Forbidden without authorization

Korg PA-series factory PCM/PCG/STY, Yamaha Expansion / SFF factory styles, Roland factory SRX/ZEN-Core libraries, and any ripped keyboard ROM.
