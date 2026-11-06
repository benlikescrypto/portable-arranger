require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ArrangerBoxAudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'ArrangerBox'
  s.homepage       = 'https://github.com/arrangerbox'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'AudioToolbox', 'AVFoundation', 'Accelerate'
  s.libraries      = 'z'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/cpp"'
  }
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -lz'
  }
  s.source_files = 'ios/**/*.{h,m,mm,swift}', 'cpp/*.{h,hpp,c,cpp}'
  s.private_header_files = 'cpp/*.{h,hpp}'
  s.exclude_files = 'cpp/tests/**/*'
end
