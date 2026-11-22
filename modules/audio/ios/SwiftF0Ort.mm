// SwiftF0 (https://github.com/lars76/swift-f0, MIT) on iOS through ONNX Runtime's C++ API.
//
// PitchTrack.cpp decodes and resamples the stem and cuts it into SwiftF0's windows; this only
// runs the model on each window, then C++ segments the notes and returns JSON. (Android does
// the same in SwiftF0Runner.kt with the onnxruntime-android AAR.) The C++ API is used instead
// of the onnxruntime-objc pod, whose archives are no longer downloadable (see vendor/).

#include <onnxruntime/onnxruntime_cxx_api.h>

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "engine_c_api.h"

namespace {

std::mutex gMu;
std::unique_ptr<Ort::Env> gEnv;
std::unique_ptr<Ort::Session> gSession;
std::string gModelPath;

char* dup(const std::string& s) {
    char* p = static_cast<char*>(std::malloc(s.size() + 1));
    if (p) std::memcpy(p, s.c_str(), s.size() + 1);
    return p;
}

std::string failJson(const std::string& why) {
    std::string o = "{\"ok\":0,\"reason\":\"";
    for (char c : why) {
        if (c == '"' || c == '\\') {
            o += '\\';
            o += c;
        } else if (static_cast<unsigned char>(c) < 0x20) {
            o += ' ';
        } else {
            o += c;
        }
    }
    return o + "\"}";
}

Ort::Session& session(const char* modelPath) {
    if (!gSession || gModelPath != modelPath) {
        if (!gEnv) gEnv = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "swiftf0");
        Ort::SessionOptions opts;
        // A 14k-parameter model: two threads are plenty and leave cores for the audio thread.
        opts.SetIntraOpNumThreads(2);
        opts.AddConfigEntry("session.intra_op.allow_spinning", "0");
        gSession = std::make_unique<Ort::Session>(*gEnv, modelPath, opts);
        gModelPath = modelPath;
    }
    return *gSession;
}

}  // namespace

// The notes in one stem MP3, as JSON ({"ok":0,"reason":…} on failure). Free with free().
extern "C" char* arrangerbox_f0_find_notes_ort(const char* modelPath, const char* path, float fmin, float fmax, float holdMs) {
    std::lock_guard<std::mutex> lock(gMu);
    char report[256] = {0};
    const int id = arrangerbox_f0_open(path, report, static_cast<int>(sizeof report));
    if (id == 0) return dup(report[0] ? std::string(report) : failJson("The stem could not be read."));
    try {
        Ort::Session& s = session(modelPath);
        Ort::MemoryInfo mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        float lo = fmin, hi = fmax;
        const char* inNames[] = {"audio", "fmin", "fmax"};
        const char* outNames[] = {"pitch", "confidence"};
        std::vector<float> buf;
        const int windows = arrangerbox_f0_windows(id);
        for (int w = 0; w < windows; ++w) {
            const int n = arrangerbox_f0_window_size(id, w);
            if (n <= 0) continue;
            buf.resize(static_cast<size_t>(n));
            if (arrangerbox_f0_window(id, w, buf.data(), n) != n) continue;
            const int64_t shape[2] = {1, n};
            std::vector<Ort::Value> in;
            in.push_back(Ort::Value::CreateTensor<float>(mem, buf.data(), buf.size(), shape, 2));
            in.push_back(Ort::Value::CreateTensor<float>(mem, &lo, 1, nullptr, 0));
            in.push_back(Ort::Value::CreateTensor<float>(mem, &hi, 1, nullptr, 0));
            auto out = s.Run(Ort::RunOptions{nullptr}, inNames, in.data(), in.size(), outNames, 2);
            const size_t np = out[0].GetTensorTypeAndShapeInfo().GetElementCount();
            const size_t nc = out[1].GetTensorTypeAndShapeInfo().GetElementCount();
            arrangerbox_f0_put(id, w, out[0].GetTensorData<float>(), out[1].GetTensorData<float>(), static_cast<int>(std::min(np, nc)));
        }
        char* r = arrangerbox_f0_finish(id, holdMs);  // finishes and releases the job
        if (!r) return dup(failJson("SwiftF0 returned no result."));
        std::string json(r);
        arrangerbox_f0_free(r);
        return dup(json);
    } catch (const std::exception& e) {
        arrangerbox_f0_close(id);
        return dup(failJson(std::string("SwiftF0 failed: ") + e.what()));
    }
}
