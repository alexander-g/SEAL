cmake_minimum_required(VERSION 3.12)
project(tremor-ui-wasm)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE on)


# set(CMAKE_BUILD_TYPE Debug)
set(CMAKE_BUILD_TYPE Release)




set(BUILD_SHARED_LIBS OFF)
add_subdirectory(./libmseed EXCLUDE_FROM_ALL)



if(DEFINED CMAKE_TOOLCHAIN_FILE AND CMAKE_TOOLCHAIN_FILE MATCHES "emscripten" OR DEFINED ENV{EMSCRIPTEN})
  set(RUNNING_EMSCRIPTEN TRUE)
else()
  set(RUNNING_EMSCRIPTEN FALSE)
endif()



if(RUNNING_EMSCRIPTEN)
    add_library(wasm-mseed STATIC 
        src/wasm-mseed.cpp
    )
    target_link_libraries(wasm-mseed PRIVATE mseed_static)
    target_compile_options(wasm-mseed PRIVATE -msimd128)
    target_compile_options(mseed_static PRIVATE -msimd128)


    add_custom_target(wasm-mseed-js ALL
        COMMAND ${CMAKE_COMMAND} -E echo "Running emcc"
        BYPRODUCTS ${CMAKE_BINARY_DIR}/wasm-mseed.js
        COMMAND emcc 
        libwasm-mseed.a
        libmseed/libmseed.a
            -sEXPORT_ES6 
            -sMODULARIZE=1 
            -sSINGLE_FILE=1 
            -sEXPORT_NAME="wasm_mseed" 
            -sEXPORTED_RUNTIME_METHODS=addFunction,Asyncify
            -sEXPORTED_FUNCTIONS=_read_mseed,_write_mseed,_malloc,_free
            -sENVIRONMENT=web 
            -sALLOW_TABLE_GROWTH 
            -sALLOW_MEMORY_GROWTH=1
            -sWASM_BIGINT 
            -fexceptions
            -sASYNCIFY 
            -O3
            -o wasm-mseed.js
        #COMMAND 
        #    ../deno.sh task bundle
        #DEPENDS wasm_big_image
    )
endif()
