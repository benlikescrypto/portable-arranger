# TinySoundFont

Vendored from https://github.com/schellingb/TinySoundFont (`tsf.h`, MIT).

`TsfHost.cpp` compiles the implementation. Factory GM playback loads
`modules/audio/factory/GeneralUser-GS.sf2` at audio start. Imported Korg/SFZ
instruments stay on the sampler path in `Engine.cpp`.

# dr_mp3

Vendored from https://github.com/mackron/dr_libs (`dr_mp3.h` v0.7.3, commit
5690d4671d7ad07ae6021756d7222eb159745f06; public domain or MIT-0). `StemPlayer.cpp` compiles the implementation
to decode the AI stems (MP3) for playback.
