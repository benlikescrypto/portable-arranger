cmake_minimum_required(VERSION 3.22.1)
project(arranger_engine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(arranger_engine SHARED
        jni_bridge.cpp
        Engine.cpp
        Factory.cpp
        Arranger.cpp
        Sampler.cpp)

find_library(log-lib log)
find_library(android-lib android)
find_package(oboe REQUIRED CONFIG)

target_link_libraries(arranger_engine
        oboe::oboe
        ${android-lib}
        ${log-lib})

target_include_directories(arranger_engine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
