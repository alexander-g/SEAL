#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <format>
#include <print>
#include <string>
#include <vector>

#include <libmseed.h>




#define OK                         0;
#define MSTL3_INIT_FAILED       -201;
#define MSTL3_READBUFFER_FAILED -202;
#define NO_TRACES_IN_FILE       -203;
#define TOO_MANY_TRACES_IN_FILE -204;
#define INVALID_NUMBER_OF_SEGMENTS  -205
#define SID2NSLC_FAILED             -206;
#define SAMPLETYPE_NOT_IMPLEMENTED  -207;
#define MSEED_WRITE_FAILED          -301;
#define MSEED_CODE_PARSE_FAILED     -302;
#define MSEED_INVALID_SAMPLE_COUNT  -303;
#define MSEED_ALLOC_FAILED          -304;
#define MSEED_ENCODING_NOT_IMPLEMENTED -305;
#define MSEED_RECORD_INIT_FAILED    -306;
#define MSEED_SEGMENT_NOT_FOUND     -307;


#define float64_t double

/** Parse NSLC code into components. */
static bool split_mseed_code(
    const std::string& code,
    std::string* network,
    std::string* station,
    std::string* location,
    std::string* channel
) {
    const size_t first = code.find('.');
    if(first == std::string::npos)
        return false;
    const size_t second = code.find('.', first + 1);
    if(second == std::string::npos)
        return false;
    const size_t third = code.find('.', second + 1);
    if(third == std::string::npos)
        return false;
    if(code.find('.', third + 1) != std::string::npos)
        return false;

    *network = code.substr(0, first);
    *station = code.substr(first + 1, second - first - 1);
    *location = code.substr(second + 1, third - second - 1);
    *channel = code.substr(third + 1);

    if(network->empty() || station->empty() || channel->empty())
        return false;

    return true;
}

/** Append a packed record to an output buffer. */
static void append_mseed_record(
    char* record,
    int reclen,
    void* handlerdata
) {
    std::vector<uint8_t>* output =
        static_cast<std::vector<uint8_t>*>(handlerdata);
    if(output != nullptr)
        output->insert(
            output->end(),
            reinterpret_cast<uint8_t*>(record),
            reinterpret_cast<uint8_t*>(record) + reclen
        );
}

/** Read MiniSEED bytes into a trace list. */
static int32_t read_mseed_to_trace_list(
    const char* buffer,
    uint64_t bufferlength,
    bool unpack_data,
    MS3TraceList** out_trace_list
) {
    if(out_trace_list == nullptr)
        return MSTL3_INIT_FAILED;

    uint32_t flags = 0;
    flags |= MSF_VALIDATECRC;
    if(unpack_data)
        flags |= MSF_UNPACKDATA;

    MS3TraceList* trace_list = mstl3_init(NULL);
    if(trace_list == nullptr)
        return MSTL3_INIT_FAILED;

    const int64_t records = mstl3_readbuffer(
        &trace_list,
        buffer,
        bufferlength,
        /*splitversion = */ 0,
        flags,
        /*tolerance = */ NULL,
        /*verbose   = */ false
    );
    if(records < 0) {
        mstl3_free(&trace_list, false);
        return MSTL3_READBUFFER_FAILED;
    }

    if(trace_list->numtraceids == 0) {
        mstl3_free(&trace_list, false);
        return NO_TRACES_IN_FILE;
    }

    *out_trace_list = trace_list;
    return OK;
}

/** Build NSLC code string from a trace SID. */
static int32_t build_trace_code(
    const MS3TraceID* trace,
    std::string* out_code
) {
    if(trace == nullptr || out_code == nullptr)
        return SID2NSLC_FAILED;

    char network[8] = {0};
    char station[8] = {0};
    char location[8] = {0};
    char channel[8] = {0};
    const int rc = ms_sid2nslc_n(
        trace->sid,
        network,
        sizeof(network),
        station,
        sizeof(station),
        location,
        sizeof(location),
        channel,
        sizeof(channel)
    );
    if(rc < 0)
        return SID2NSLC_FAILED;

    *out_code =
        std::format("{}.{}.{}.{}", network, station, location, channel);
    return OK;
}

/** Build SID from NSLC code. */
static int32_t build_sid_from_code(
    const std::string& code,
    char* out_sid,
    size_t out_sid_size
) {
    if(out_sid == nullptr || out_sid_size == 0)
        return MSEED_CODE_PARSE_FAILED;

    std::string network;
    std::string station;
    std::string location;
    std::string channel;
    if(!split_mseed_code(
        code,
        &network,
        &station,
        &location,
        &channel
    ))
        return MSEED_CODE_PARSE_FAILED;

    const int sid_rc = ms_nslc2sid(
        out_sid,
        out_sid_size,
        0,
        network.c_str(),
        station.c_str(),
        location.c_str(),
        channel.c_str()
    );
    if(sid_rc < 0)
        return MSEED_CODE_PARSE_FAILED;
    return OK;
}

/** Find largest trace in list by first-segment sample count. */
static const MS3TraceID* find_largest_trace(
    const MS3TraceList* trace_list
) {
    if(trace_list == nullptr)
        return nullptr;

    const MS3TraceID* trace = nullptr;
    int64_t largest_sample_count = -1;
    for(int32_t trace_index = 0;
        trace_index < trace_list->numtraceids;
        trace_index++) {
        const MS3TraceID* current = trace_list->traces.next[trace_index];
        if(current == nullptr || current->first == nullptr)
            continue;

        const int64_t sample_count = current->first->samplecnt;
        if(sample_count > largest_sample_count) {
            trace = current;
            largest_sample_count = sample_count;
        }
    }

    return trace;
}

/** Find largest segment within a trace. */
static const MS3TraceSeg* find_largest_segment(const MS3TraceID* trace) {
    if(trace == nullptr)
        return nullptr;

    const MS3TraceSeg* segment = nullptr;
    int64_t largest_sample_count = -1;
    for(const MS3TraceSeg* current = trace->first;
        current != nullptr;
        current = current->next) {
        if(current->samplecnt > largest_sample_count) {
            segment = current;
            largest_sample_count = current->samplecnt;
        }
    }

    return segment;
}

/** Find segment matching code and exact start time. */
static int32_t find_segment_by_code_and_starttime(
    const MS3TraceList* trace_list,
    const std::string& code,
    uint64_t starttime,
    const MS3TraceID** out_trace,
    const MS3TraceSeg** out_segment
) {
    if(trace_list == nullptr || out_trace == nullptr || out_segment == nullptr)
        return MSEED_SEGMENT_NOT_FOUND;

    char query_sid[LM_SIDLEN];
    const int32_t query_sid_rc =
        build_sid_from_code(code, query_sid, sizeof(query_sid));
    if(query_sid_rc != 0)
        return query_sid_rc;

    for(int32_t trace_index = 0;
        trace_index < trace_list->numtraceids;
        trace_index++) {
        const MS3TraceID* current_trace = trace_list->traces.next[trace_index];
        if(current_trace == nullptr)
            continue;

        if(std::strncmp(current_trace->sid, query_sid, LM_SIDLEN) != 0)
            continue;

        for(const MS3TraceSeg* current_segment = current_trace->first;
            current_segment != nullptr;
            current_segment = current_segment->next) {
            const uint64_t current_starttime =
                static_cast<uint64_t>(current_segment->starttime);
            const uint64_t current_endtime =
                static_cast<uint64_t>(current_segment->endtime);
            const uint64_t current_starttime_millis =
                current_starttime / 1000000ULL;
            const uint64_t current_endtime_millis =
                current_endtime / 1000000ULL;
            const uint64_t requested_starttime_millis =
                starttime / 1000000ULL;

            const bool within_segment_millis =
                requested_starttime_millis >= current_starttime_millis &&
                requested_starttime_millis <= current_endtime_millis;

            if(current_starttime == starttime ||
               current_starttime_millis == requested_starttime_millis ||
               within_segment_millis) {
                *out_trace = current_trace;
                *out_segment = current_segment;
                return OK;
            }
        }
    }

    return MSEED_SEGMENT_NOT_FOUND;
}

/** Copy samples from a trace segment into target buffer. */
static int32_t copy_segment_samples(
    const MS3TraceSeg* segment,
    float* samplebuffer,
    int32_t samplebuffersize
) {
    if(segment == nullptr)
        return INVALID_NUMBER_OF_SEGMENTS;
    if(samplebuffer == nullptr || samplebuffersize <= 0)
        return OK;

    int64_t n_samples = samplebuffersize;
    if(n_samples > segment->samplecnt)
        n_samples = segment->samplecnt;

    if(segment->sampletype == 'i') {
        const int32_t* src = static_cast<const int32_t*>(segment->datasamples);
        for(int64_t i = 0; i < n_samples; i++)
            samplebuffer[i] = static_cast<float>(src[i]);
    } else if(segment->sampletype == 'f') {
        const float* src = static_cast<const float*>(segment->datasamples);
        for(int64_t i = 0; i < n_samples; i++)
            samplebuffer[i] = src[i];
    } else if(segment->sampletype == 'd') {
        const double* src = static_cast<const double*>(segment->datasamples);
        for(int64_t i = 0; i < n_samples; i++)
            samplebuffer[i] = static_cast<float>(src[i]);
    } else {
        return SAMPLETYPE_NOT_IMPLEMENTED;
    }

    return OK;
}

/** Fill metadata output buffers for selected trace segment. */
static int32_t write_segment_outputs(
    const MS3TraceID* trace,
    const MS3TraceSeg* segment,
    uint64_t* starttime,
    uint64_t* endtime,
    uint64_t* nsamples,
    float64_t* samplerate,
    char* code,
    float* samplebuffer,
    int32_t samplebuffersize
) {
    if(trace == nullptr || segment == nullptr)
        return INVALID_NUMBER_OF_SEGMENTS;

    *starttime = segment->starttime;
    *endtime = segment->endtime;
    *nsamples = segment->samplecnt;
    *samplerate = segment->samprate;

    std::string code_string;
    const int32_t code_rc = build_trace_code(trace, &code_string);
    if(code_rc != 0)
        return code_rc;
    std::memcpy(code, code_string.data(), code_string.size());

    return copy_segment_samples(segment, samplebuffer, samplebuffersize);
}



extern "C" {

int32_t read_mseed(
    const char* buffer, 
    uint64_t bufferlength,
    
    // outputs
    uint64_t*  starttime,
    uint64_t*  endtime,
    uint64_t*  nsamples,
    float64_t* samplerate,
    // at least 32 bytes!
    char*      code,

    // optional outputs
    // buffer for waveform samples, can be null
    float*     samplebuffer,
    // size of samplebuffer in number of samples (i.e. x4 bytes)
    int32_t    samplebuffersize
) {
    const bool metadata_only =
        (samplebuffer == nullptr || samplebuffersize == 0);

    MS3TraceList* trace_list = nullptr;
    const int32_t read_rc = read_mseed_to_trace_list(
        buffer,
        bufferlength,
        !metadata_only,
        &trace_list
    );
    if(read_rc != 0)
        return read_rc;

    const MS3TraceID* trace = find_largest_trace(trace_list);
    const MS3TraceSeg* segment = find_largest_segment(trace);
    if(trace == nullptr || segment == nullptr) {
        mstl3_free(&trace_list, false);
        return INVALID_NUMBER_OF_SEGMENTS;
    }

    const int32_t output_rc = write_segment_outputs(
        trace,
        segment,
        starttime,
        endtime,
        nsamples,
        samplerate,
        code,
        samplebuffer,
        samplebuffersize
    );
    mstl3_free(&trace_list, false);
    return output_rc;
}

int32_t read_mseed_segment(
    const char* buffer,
    uint64_t bufferlength,
    const char* code_filter,
    uint64_t code_filter_length,
    uint64_t segment_starttime,

    // outputs
    uint64_t* starttime,
    uint64_t* endtime,
    uint64_t* nsamples,
    float64_t* samplerate,
    char* code,

    // optional outputs
    float* samplebuffer,
    int32_t samplebuffersize
) {
    const bool metadata_only =
        (samplebuffer == nullptr || samplebuffersize == 0);
    if(code_filter == nullptr || code_filter_length == 0)
        return MSEED_CODE_PARSE_FAILED;

    std::string code_string(
        code_filter,
        static_cast<size_t>(code_filter_length)
    );
    const size_t null_index = code_string.find('\0');
    if(null_index != std::string::npos)
        code_string = code_string.substr(0, null_index);
    if(code_string.empty())
        return MSEED_CODE_PARSE_FAILED;

    MS3TraceList* trace_list = nullptr;
    const int32_t read_rc = read_mseed_to_trace_list(
        buffer,
        bufferlength,
        !metadata_only,
        &trace_list
    );
    if(read_rc != 0)
        return read_rc;

    const MS3TraceID* trace = nullptr;
    const MS3TraceSeg* segment = nullptr;
    const int32_t find_rc = find_segment_by_code_and_starttime(
        trace_list,
        code_string,
        segment_starttime,
        &trace,
        &segment
    );
    if(find_rc != 0) {
        mstl3_free(&trace_list, false);
        return find_rc;
    }

    const int32_t output_rc = write_segment_outputs(
        trace,
        segment,
        starttime,
        endtime,
        nsamples,
        samplerate,
        code,
        samplebuffer,
        samplebuffersize
    );
    mstl3_free(&trace_list, false);
    return output_rc;
}

/** Write MiniSEED data to a heap buffer. */
int32_t write_mseed(
    const float* samples,
    uint64_t     samplecount,
    float64_t    samplerate,
    uint64_t     starttime,
    const char*  code,
    uint64_t     codelength,
    int32_t      reclen,
    int32_t      encoding,
    uint32_t*    output_buffer_p,
    uint64_t*    output_length
) {
    if(samples == nullptr || samplecount == 0)
        return MSEED_INVALID_SAMPLE_COUNT;
    if(code == nullptr || codelength == 0)
        return MSEED_CODE_PARSE_FAILED;
    if(output_buffer_p == nullptr || output_length == nullptr)
        return MSEED_WRITE_FAILED;

    std::string code_string(code, static_cast<size_t>(codelength));
    const size_t null_index = code_string.find('\0');
    if(null_index != std::string::npos)
        code_string = code_string.substr(0, null_index);

    std::string network;
    std::string station;
    std::string location;
    std::string channel;
    if(!split_mseed_code(
        code_string,
        &network,
        &station,
        &location,
        &channel
    ))
        return MSEED_CODE_PARSE_FAILED;

    char sid[LM_SIDLEN];
    const int sid_rc = ms_nslc2sid(
        sid,
        sizeof(sid),
        0,
        network.c_str(),
        station.c_str(),
        location.c_str(),
        channel.c_str()
    );
    if(sid_rc < 0)
        return MSEED_CODE_PARSE_FAILED;

    MS3Record* msr = msr3_init(NULL);
    if(msr == nullptr)
        return MSEED_RECORD_INIT_FAILED;

    std::strncpy(msr->sid, sid, sizeof(msr->sid) - 1);
    msr->sid[sizeof(msr->sid) - 1] = '\0';
    msr->reclen = (reclen > 0) ? reclen : MS_PACK_DEFAULT_RECLEN;
    msr->formatversion = 2;
    msr->pubversion = 1;
    msr->starttime = static_cast<nstime_t>(starttime);
    msr->samprate = samplerate;

    if(encoding <= 0)
        encoding = DE_FLOAT32;
    if(encoding != DE_FLOAT32) {
        msr3_free(&msr);
        return MSEED_ENCODING_NOT_IMPLEMENTED;
    }

    msr->encoding = encoding;
    msr->numsamples = static_cast<int64_t>(samplecount);
    msr->samplecnt = static_cast<int64_t>(samplecount);
    msr->sampletype = 'f';
    msr->datasamples = const_cast<float*>(samples);
    msr->datasize = samplecount * sizeof(float);

    uint32_t flags = 0;
    flags |= MSF_FLUSHDATA;

    int64_t packed_samples = 0;
    std::vector<uint8_t> output;
    const int64_t rc = msr3_pack(
        msr,
        append_mseed_record,
        &output,
        &packed_samples,
        flags,
        0
    );
    msr->datasamples = NULL;
    msr3_free(&msr);
    if(rc < 0)
        return MSEED_WRITE_FAILED;
    if(output.empty())
        return MSEED_WRITE_FAILED;

    uint8_t* out_buffer =
        static_cast<uint8_t*>(std::malloc(output.size()));
    if(out_buffer == nullptr)
        return MSEED_ALLOC_FAILED;

    std::memcpy(out_buffer, output.data(), output.size());

    *output_buffer_p =
        static_cast<uint32_t>(reinterpret_cast<uintptr_t>(out_buffer));
    *output_length = static_cast<uint64_t>(output.size());

    return OK;
}

} // extern "C"
