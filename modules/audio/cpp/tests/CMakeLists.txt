cmake_minimum_required(VERSION 3.16)
project(arrangerbox_engine_tests CXX)

# The app builds the engine optimized (Android -O3, iOS GCC_OPTIMIZATION_LEVEL 3), so
# test it the same way; load-time checks are meaningless at -O0.
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PA_CPP ${CMAKE_CURRENT_SOURCE_DIR}/..)

set(PA_ENGINE_SRC
        ${PA_CPP}/Engine.cpp
        ${PA_CPP}/Factory.cpp
        ${PA_CPP}/FactoryStyles.cpp
        ${PA_CPP}/Arranger.cpp
        ${PA_CPP}/Sampler.cpp
        ${PA_CPP}/SfzParser.cpp
        ${PA_CPP}/StyleFormat.cpp
        ${PA_CPP}/PcgParser.cpp
        ${PA_CPP}/TsfHost.cpp)

add_executable(test_engine
        test_parsers.cpp
        ${PA_ENGINE_SRC})

add_executable(test_sty_load
        test_sty_load.cpp
        ${PA_CPP}/Pa4xLoader.cpp
        ${PA_ENGINE_SRC})

add_executable(test_set_load
        test_set_load.cpp
        ${PA_CPP}/Pa4xLoader.cpp
        ${PA_ENGINE_SRC})

target_include_directories(test_engine PRIVATE ${PA_CPP})
target_include_directories(test_sty_load PRIVATE ${PA_CPP})
target_include_directories(test_set_load PRIVATE ${PA_CPP})

find_package(ZLIB QUIET)
if(ZLIB_FOUND)
    target_link_libraries(test_engine PRIVATE ZLIB::ZLIB)
    target_link_libraries(test_sty_load PRIVATE ZLIB::ZLIB)
    target_link_libraries(test_set_load PRIVATE ZLIB::ZLIB)
else()
    find_library(Z_LIB z zlib zlibd)
    if(Z_LIB)
        target_link_libraries(test_engine PRIVATE ${Z_LIB})
        target_link_libraries(test_sty_load PRIVATE ${Z_LIB})
        target_link_libraries(test_set_load PRIVATE ${Z_LIB})
    else()
        message(STATUS "zlib not found; building engine tests with ARRANGERBOX_NO_ZLIB (KSF inflate disabled)")
        target_compile_definitions(test_engine PRIVATE ARRANGERBOX_NO_ZLIB)
        target_compile_definitions(test_sty_load PRIVATE ARRANGERBOX_NO_ZLIB)
        target_compile_definitions(test_set_load PRIVATE ARRANGERBOX_NO_ZLIB)
    endif()
endif()
