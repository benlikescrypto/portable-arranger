# ArrangerBox factory license manifest

| Instrument / style | Original library | Source URL | License | Redistribution | Attribution | Modifications |
| --- | --- | --- | --- | --- | --- | --- |
| Factory GM samples (`modules/audio/factory/GeneralUser-GS.sf2`) | GeneralUser GS 2.0.3 by S. Christian Collins | https://github.com/mrbumpy409/GeneralUser-GS | See `modules/audio/factory/LICENSE.txt` | Yes, bundled with the app and LICENSE.txt | Credit S. Christian Collins | Unmodified SF2 |
| TinySoundFont (`modules/audio/cpp/third_party/tsf.h`) | TinySoundFont | https://github.com/schellingb/TinySoundFont | MIT | Yes | Copyright Bernhard Schelling / SFZero | Vendored header |
| Factory patch names / GM mapping in `Factory.cpp` | ArrangerBox | this repository | Proprietary ArrangerBox | Yes, with the app | None required | Maps UI names onto GeneralUser GS GM programs |
| Factory styles in `FactoryStyles.cpp` | ArrangerBox original MIDI arrangements | this repository | Proprietary ArrangerBox | Yes, with the app | None required | Original patterns |

## Approved external sources (not bundled here)

These may be ingested later through the SFZ loader. Do not copy them into the app until the files are actually added and this table is updated with the exact files.

| Library | URL | License | Redistribution in a commercial app |
| --- | --- | --- | --- |
| Versilian Community Sample Library (VCSL) | https://github.com/sgossner/VCSL | CC0 1.0 | Yes |
| VSCO 2 Community Edition | https://github.com/sgossner/VSCO-2-CE | CC0 1.0 | Yes (credit requested, not required by CC0) |
| ConvertWithMoss | https://github.com/git-moss/ConvertWithMoss | GPL-3.0 | **No** — format documentation only |

## Forbidden without authorization

Korg PA-series factory PCM/PCG/STY, Yamaha Expansion / SFF factory styles, Roland factory SRX/ZEN-Core libraries, and any ripped keyboard ROM.
