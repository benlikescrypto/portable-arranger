# ONNX Runtime 1.30.0 for iOS (runs SwiftF0 for AI Learn), taken from Microsoft's signed
# Microsoft.ML.OnnxRuntime NuGet package and pinned by SHA-256.
#
# Why not the CocoaPods trunk pod: since 2026-11-21 its archive host (download.onnxruntime.ai)
# serves a wrong certificate and 404s, so `pod install` fails. The NuGet package carries the
# same static onnxruntime.xcframework the pod used to ship (device, simulator, Catalyst).
# Linked from the app's Podfile through expo-build-properties `ios.extraPods` (app.json).
Pod::Spec.new do |s|
  s.name     = 'onnxruntime-c'
  s.version  = '1.30.0'
  s.summary  = 'ONNX Runtime C/C++ (iOS xcframework from the Microsoft.ML.OnnxRuntime NuGet package)'
  s.homepage = 'https://onnxruntime.ai'
  s.license  = { :type => 'MIT', :file => 'LICENSE' }
  s.authors  = { 'ONNX Runtime' => 'onnxruntime@microsoft.com' }
  s.source   = {
    :http => "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/#{s.version}/microsoft.ml.onnxruntime.#{s.version}.nupkg",
    :type => 'zip',
    :sha256 => '30df119bd9164eaa187666d93147448fdd4a9a1a3caf83f1505daf7af2d1c5d2'
  }
  s.platforms = { :ios => '15.1' }
  # The package holds every platform's runtime (~150 MB); keep the iOS framework and licences.
  s.prepare_command = <<-CMD
    set -e
    unzip -q -o runtimes/ios/native/onnxruntime.xcframework.zip
    find . -mindepth 1 -maxdepth 1 ! -name onnxruntime.xcframework ! -name LICENSE ! -name ThirdPartyNotices.txt -exec rm -rf {} +
  CMD
  s.vendored_frameworks = 'onnxruntime.xcframework'
  s.static_framework = true
  s.weak_frameworks = 'CoreML'
  s.frameworks = 'CoreFoundation', 'Foundation', 'Network', 'Security', 'SystemConfiguration', 'UIKit'
  s.libraries = 'c++'
end
