cmake_minimum_required(VERSION 3.22.1)
project(arranger_engine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PA_CPP ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp)

add_library(arranger_engine SHARED
        OboeHost.cpp
        jni_bridge.cpp
        ${PA_CPP}/engine_c_api.cpp
        ${PA_CPP}/Engine.cpp
        ${PA_CPP}/Factory.cpp
        ${PA_CPP}/Arranger.cpp
        ${PA_CPP}/Sampler.cpp
        ${PA_CPP}/Pa4xLoader.cpp)

find_library(log-lib log)
find_library(android-lib android)
find_library(z-lib z)
find_package(oboe REQUIRED CONFIG)

target_include_directories(arranger_engine PRIVATE ${PA_CPP} ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(arranger_engine
        oboe::oboe
        ${android-lib}
        ${log-lib}
        ${z-lib})
