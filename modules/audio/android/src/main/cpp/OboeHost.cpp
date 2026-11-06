#include "engine_c_api.h"
#include "Engine.h"

#include <android/log.h>
#include <oboe/Oboe.h>

#include <memory>
#include <mutex>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "ArrangerBoxAudio", __VA_ARGS__)

namespace {

class OboeHost : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
public:
    bool start() {
        stop();
        engine = arrangerbox_live_engine();
        if (!engine) {
            LOGI("No live engine");
            return false;
        }
        if (!open(oboe::SharingMode::Exclusive) && !open(oboe::SharingMode::Shared)) {
            LOGI("Failed to open Oboe stream");
            return false;
        }
        const float sr = static_cast<float>(stream->getSampleRate());
        engine->prepare(sr);
        const auto burst = stream->getFramesPerBurst();
        engine->setLatencyMs((burst * 2.0f / sr) * 1000.0f);
        const auto req = stream->requestStart();
        LOGI("Oboe start sr=%d burst=%d %s", (int)sr, burst, oboe::convertToText(req));
        return req == oboe::Result::OK;
    }

    void stop() {
        if (stream) {
            stream->stop();
            stream->close();
            stream.reset();
        }
    }

    oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* data, int32_t numFrames) override {
        if (engine && data && numFrames > 0) {
            engine->render(static_cast<float*>(data), numFrames);
        }
        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(oboe::AudioStream*, oboe::Result) override { start(); }

private:
    bool open(oboe::SharingMode mode) {
        oboe::AudioStreamBuilder b;
        b.setDirection(oboe::Direction::Output);
        b.setPerformanceMode(oboe::PerformanceMode::LowLatency);
        b.setSharingMode(mode);
        b.setFormat(oboe::AudioFormat::Float);
        b.setChannelCount(2);
        b.setSampleRate(48000);
        b.setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Best);
        b.setDataCallback(this);
        b.setErrorCallback(this);
        return b.openStream(stream) == oboe::Result::OK && stream != nullptr;
    }

    pa::Engine* engine = nullptr;
    std::shared_ptr<oboe::AudioStream> stream;
};

OboeHost gHost;
std::mutex gHostMu;

}  // namespace

extern "C" {

int arrangerbox_audio_start(void) {
    std::lock_guard<std::mutex> lock(gHostMu);
    return gHost.start() ? 1 : 0;
}

void arrangerbox_audio_stop(void) {
    std::lock_guard<std::mutex> lock(gHostMu);
    gHost.stop();
}

}
