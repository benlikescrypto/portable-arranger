#import <AudioToolbox/AudioToolbox.h>
#import <AVFoundation/AVFoundation.h>

#include "engine_c_api.h"
#include "Engine.h"

#include <algorithm>
#include <mutex>

namespace {

constexpr int kMaxFrames = 4096;
float gScratch[kMaxFrames * 2];
AudioComponentInstance gAu = nullptr;
std::mutex gMu;
bool gRunning = false;

OSStatus renderCb(void*, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 inNumberFrames,
                  AudioBufferList* ioData) {
    pa::Engine* engine = arrangerbox_live_engine();
    const int frames = static_cast<int>(std::min<UInt32>(inNumberFrames, kMaxFrames));
    if (!engine || !ioData || frames <= 0) return noErr;
    engine->render(gScratch, frames);
    if (ioData->mNumberBuffers >= 2) {
        auto* left = static_cast<float*>(ioData->mBuffers[0].mData);
        auto* right = static_cast<float*>(ioData->mBuffers[1].mData);
        if (!left || !right) return noErr;
        for (int i = 0; i < frames; i++) {
            left[i] = gScratch[i * 2];
            right[i] = gScratch[i * 2 + 1];
        }
    } else if (ioData->mNumberBuffers == 1) {
        auto* interleaved = static_cast<float*>(ioData->mBuffers[0].mData);
        if (!interleaved) return noErr;
        std::copy(gScratch, gScratch + frames * 2, interleaved);
    }
    return noErr;
}

bool openUnit(double sampleRate) {
    AudioComponentDescription desc{};
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_RemoteIO;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp || AudioComponentInstanceNew(comp, &gAu) != noErr) return false;

    AudioStreamBasicDescription format{};
    format.mSampleRate = sampleRate > 1.0 ? sampleRate : 48000.0;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved;
    format.mBytesPerPacket = sizeof(float);
    format.mFramesPerPacket = 1;
    format.mBytesPerFrame = sizeof(float);
    format.mChannelsPerFrame = 2;
    format.mBitsPerChannel = 32;
    if (AudioUnitSetProperty(gAu, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, sizeof(format)) !=
        noErr) {
        return false;
    }

    AURenderCallbackStruct cb{};
    cb.inputProc = renderCb;
    if (AudioUnitSetProperty(gAu, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof(cb)) !=
        noErr) {
        return false;
    }
    return AudioUnitInitialize(gAu) == noErr;
}

}  // namespace

extern "C" {

int arrangerbox_audio_start(void) {
    std::lock_guard<std::mutex> lock(gMu);
    if (!arrangerbox_live_engine()) {
        arrangerbox_engine_create();
    }
    pa::Engine* engine = arrangerbox_live_engine();
    if (!engine) return 0;

    if (!engine->hasSoundfont()) {
        NSString* path = [[NSBundle mainBundle] pathForResource:@"GeneralUser-GS" ofType:@"sf2"];
        if (!path) {
            NSString* bundlePath = [[NSBundle mainBundle] pathForResource:@"ArrangerBoxAudio" ofType:@"bundle"];
            if (bundlePath) {
                NSBundle* extra = [NSBundle bundleWithPath:bundlePath];
                path = [extra pathForResource:@"GeneralUser-GS" ofType:@"sf2"];
            }
        }
        if (path) engine->loadSoundfont(path.fileSystemRepresentation);
    }

    AVAudioSession* session = [AVAudioSession sharedInstance];
    NSError* error = nil;
    [session setCategory:AVAudioSessionCategoryPlayback
                    mode:AVAudioSessionModeDefault
                 options:AVAudioSessionCategoryOptionMixWithOthers
                   error:&error];
    [session setPreferredSampleRate:48000 error:nil];
    [session setPreferredIOBufferDuration:0.005 error:nil];
    [session setActive:YES error:&error];

    if (gAu) {
        AudioOutputUnitStop(gAu);
        AudioUnitUninitialize(gAu);
        AudioComponentInstanceDispose(gAu);
        gAu = nullptr;
    }
    const float sr = static_cast<float>(session.sampleRate > 1 ? session.sampleRate : 48000);
    if (!openUnit(sr)) return 0;
    engine->prepare(sr);
    engine->setLatencyMs(static_cast<float>(session.IOBufferDuration * 1000.0 * 2.0));
    if (AudioOutputUnitStart(gAu) != noErr) return 0;
    gRunning = true;
    return 1;
}

void arrangerbox_audio_stop(void) {
    std::lock_guard<std::mutex> lock(gMu);
    if (gAu) {
        AudioOutputUnitStop(gAu);
        AudioUnitUninitialize(gAu);
        AudioComponentInstanceDispose(gAu);
        gAu = nullptr;
    }
    gRunning = false;
}

}
