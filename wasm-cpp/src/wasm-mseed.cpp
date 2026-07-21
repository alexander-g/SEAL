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
    const bool metadata_only = (samplebuffer == nullptr || samplebuffersize == 0);

    uint32_t flags = 0;
    flags |= MSF_VALIDATECRC;
    if(!metadata_only)
        flags |= MSF_UNPACKDATA;
    //flags |= MSF_RECORDLIST;

    MS3TraceList *mstl = NULL;
    mstl = mstl3_init(NULL);
    if(!mstl)
        return MSTL3_INIT_FAILED;
    
    const int64_t records = mstl3_readbuffer (
        &mstl, 
        buffer, 
        bufferlength,
        /*splitversion = */ 0, 
        flags, 
        /*tolerance = */ NULL, 
        /*verbose   = */ false
    );
    if(records < 0) 
        return MSTL3_READBUFFER_FAILED;

    if(mstl->numtraceids == 0)
        return NO_TRACES_IN_FILE;

    // NOTE: for now, if there are multiple traces, using the largest only
    const MS3TraceID* trace = nullptr;
    int64_t largest_sample_count = -1;
    for(int32_t trace_index = 0; trace_index < mstl->numtraceids; trace_index++) {
        const MS3TraceID* current = mstl->traces.next[trace_index];
        if(current == nullptr || current->first == nullptr)
            continue;

        const int64_t sample_count = current->first->samplecnt;
        if(sample_count > largest_sample_count) {
            trace = current;
            largest_sample_count = sample_count;
        }
    }

    if(trace == nullptr)
        // should not happen
        return NO_TRACES_IN_FILE;

    const MS3TraceSeg* segment = nullptr;
    largest_sample_count = -1;
    for(const MS3TraceSeg* current = trace->first; current != nullptr;
        current = current->next) {
        if(current->samplecnt > largest_sample_count) {
            segment = current;
            largest_sample_count = current->samplecnt;
        }
    }

    if(segment == nullptr)
        return INVALID_NUMBER_OF_SEGMENTS;

    *starttime  = trace->earliest;
    *endtime    = trace->latest;
    *nsamples   = segment->samplecnt;
    *samplerate = segment->samprate;

    char network[8] = {0}, station[8] = {0}, location[8] = {0}, channel[8] = {0};
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

        
    const std::string codestring = 
        std::format("{}.{}.{}.{}", network, station, location, channel);
    std::memcpy(code, codestring.data(), codestring.size());


    if(!metadata_only) {
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
    }

    return OK;
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
