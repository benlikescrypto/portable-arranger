# TinySoundFont

Vendored from https://github.com/schellingb/TinySoundFont (`tsf.h`, MIT).

`TsfHost.cpp` compiles the implementation. Factory GM playback loads
`modules/audio/factory/GeneralUser-GS.sf2` at audio start. Imported Korg/SFZ
instruments stay on the sampler path in `Engine.cpp`.
