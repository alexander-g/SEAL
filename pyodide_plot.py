import datetime as dt
import typing as tp

import matplotlib

matplotlib.use('AGG')

import matplotlib.dates as mdates
import matplotlib.figure
import matplotlib.pyplot as plt
import numpy as np
import numpy.typing as npt
import scipy
from scipy.signal import stft, resample, butter, lfilter



def _slice_bounds(i0: int, i1: int, n_samples: int) -> tuple[int, int]:
    if n_samples <= 0:
        return 0, 0

    start: int = max(0, min(i0, n_samples))
    stop: int = max(start, min(i1, n_samples))
    return start, stop


def plot_data(
    data: npt.NDArray[np.float32],
    i0: int,
    i1: int,
    start_timestamp_s: float,
    sample_rate_hz: float,
    title: str,
    output_path: tp.Optional[str],
) -> None:
    """Plot a time slice and optionally save it to a PNG file."""
    # NOTE: data is a memoryview when called from JS, making sure its numpy
    data = np.asarray(data, dtype=np.float32)
    start: int
    stop: int
    start, stop = _slice_bounds(i0, i1, data.size)

    start_time = dt.datetime.fromtimestamp(start_timestamp_s, tz=dt.timezone.utc)

    sliced_data: npt.NDArray[np.float32] = data[start:stop]
    time_axis: list[dt.datetime] = [
        start_time + dt.timedelta(seconds=float(idx) / sample_rate_hz)
            for idx in range(start, stop)
    ]

    fig: matplotlib.figure.Figure
    ax: matplotlib.axes.Axes
    fig, ax = plt.subplots()
    ax.plot(time_axis, sliced_data)  # type: ignore [arg-type]
    ax.set_xlabel('Time (UTC)')
    ax.set_ylabel('Amplitude')
    ax.set_title(title)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M:%S'))
    
    # Ensure y-axis range is at least std(data)
    data_std: float = float(np.std(data))
    data_min: float = float(np.min(sliced_data))
    data_max: float = float(np.max(sliced_data))
    data_range: float = data_max - data_min
    min_range: float = data_std
    if data_range < min_range:
        center: float = (data_min + data_max) / 2.0
        y_min: float = center - min_range / 2.0
        y_max: float = center + min_range / 2.0
        ax.set_ylim(y_min, y_max)
    
    fig.autofmt_xdate()
    plt.tight_layout()

    if output_path is not None:
        fig.savefig(output_path)
    
    plt.close(fig)




class Spectrogram(tp.NamedTuple):
    f_axis: npt.NDArray[np.float64]
    t_axis: npt.NDArray[np.float64]
    data:   npt.NDArray[np.complex128]
    n_per_segment: int


class SpectrogramDataDict(tp.TypedDict):
    t_axis: npt.NDArray[np.float32]
    f_axis: npt.NDArray[np.float32]
    power:  npt.NDArray[np.float32]
    rows:   int
    cols:   int


class ModulationPowerSpectrum(tp.NamedTuple):
    spectral_axis: npt.NDArray[np.float64]  # 1/Hz
    temporal_axis: npt.NDArray[np.float64]  # Hz
    data:          npt.NDArray[np.float64]


def create_spectrogram(
    signal:     npt.NDArray[np.float32],
    frequency:  float,
    frequency_resolution = 0.5,
    step:       tp.Optional[int] = None,
) -> Spectrogram:
    assert signal.ndim == 1, 'Expected 1D input'


    n_samples: int     = int(signal.size)
    n_per_segment: int = int( round(frequency / frequency_resolution) )
    n_per_segment = max(1, min(n_per_segment, n_samples))
    if step is None:
        step = n_per_segment // 4
    noverlap   = n_per_segment - step
    if noverlap >= n_per_segment:
        noverlap = n_per_segment - 1
    
    f_axis, t_axis, Z = stft(
        signal,
        fs = frequency,
        nperseg  = n_per_segment,
        noverlap = noverlap,
        boundary = None,
        padded   = False,
        return_onesided = True,
        detrend  = False,
        axis     = -1,
    )
    return Spectrogram(f_axis, t_axis, Z, n_per_segment)





def normalize_spectrogram(
    spectrogram: npt.NDArray[np.floating], 
    db_res: float = 50.0
) -> npt.NDArray[np.floating]:
    maxdata = spectrogram.max()
    mindata = maxdata - db_res
    s_norm = np.copy(spectrogram)
    s_norm[s_norm < mindata] = mindata
    s_norm -= s_norm.mean()
    s_norm /= s_norm.std()
    return s_norm


def scale_spectrogram_to_range(
    spectrogram: npt.NDArray[np.floating],
    vmin: tp.Optional[float] = None,
    vmax: tp.Optional[float] = None,
) -> npt.NDArray[np.float32]:
    if vmin is None:
        vmin = float(spectrogram.min()) if spectrogram.size > 0 else 0.0
    if vmax is None:
        vmax = float(spectrogram.max()) if spectrogram.size > 0 else 0.0
    if vmax <= vmin:
        return np.zeros_like(spectrogram, dtype=np.float32)

    normalized: npt.NDArray[np.float32] = (
        (spectrogram - vmin) / (vmax - vmin)
    ).astype(np.float32)
    return normalized


def pad_spectrogram(
    s: npt.NDArray[np.floating], 
    n: int, 
    value: float
) -> npt.NDArray[np.floating]:
    left  = np.ones((s.shape[0], n), dtype=s.dtype) * value
    right = np.ones((s.shape[0], n), dtype=s.dtype) * value
    return np.concatenate([left, s, right], axis=1)

def gaussian_weights(
    n_points: int, 
    nstd: float = 6
) -> npt.NDArray[np.floating]:
    x = np.linspace(-nstd, nstd, n_points)
    w = np.exp( -(x**2) / 2 )
    return w / w.sum()

def compute_mps2d(
    spectrogram: npt.NDArray[np.floating],
    f_axis:      npt.NDArray[np.floating],
    t_axis:      npt.NDArray[np.floating]
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    mps2d = np.fft.fftshift(np.fft.fft2(spectrogram))
    mps_power = np.abs(mps2d) ** 2
    nf, nt = spectrogram.shape
    df = f_axis[1] - f_axis[0] if len(f_axis) > 1 else 1.0
    dt = t_axis[1] - t_axis[0] if len(t_axis) > 1 else 1.0
    spectral_mod = np.fft.fftshift(np.fft.fftfreq(nf, df))
    temporal_mod = np.fft.fftshift(np.fft.fftfreq(nt, dt))
    return spectral_mod, temporal_mod, mps_power

def resample_to_freq(signal: npt.NDArray, og_fs:float, target_fs:float):
    duration_s = len(signal) / og_fs
    target_len = int( round(duration_s * target_fs) )
    return resample(signal, target_len)

def create_modulation_power_spectrum(
    signal:    npt.NDArray[np.float32],
    frequency: float,
    normalize: bool = True
) -> ModulationPowerSpectrum:
    '''Modulation power spectrum using overlapp and add method'''
    db_res = 50.0
    step   = 1
    # clipping sample rate due to memory issues
    new_frequency = min(50, frequency)
    signal        = resample_to_freq(signal, frequency, new_frequency)
    frequency     = new_frequency

    b, a = butter(3, [2, 8], 'bandpass', fs=frequency)
    signal = lfilter(b, a, signal)


    spec: Spectrogram = create_spectrogram(
        signal, 
        frequency, 
        frequency_resolution = 0.1, 
        step = step
    )

    sdata = 20 * np.log10( np.abs(spec.data) +1 )
    if normalize:
        sdata = normalize_spectrogram(sdata, db_res)

    f_axis = spec.f_axis
    t_axis = spec.t_axis
    window = t_axis[-1] / 10.0
    
    # window length in index units
    window_len = int( np.searchsorted(t_axis, window) )
    if window_len % 2 == 0:
        window_len += 1
    nt = len(t_axis)
    if window_len > nt:
        window_len = nt if nt % 2 else nt - 1

    weights = gaussian_weights(window_len)
    pad_len = int( (window_len - 1) // 2 )
    sdata_padded = pad_spectrogram(sdata, pad_len, sdata.min())

    mps_sum: npt.NDArray[np.floating] | None = None
    n_chunks    = 0
    center_step = window_len // 3 if window_len // 3 > 0 else 1
    nt_padded   = sdata_padded.shape[1]
    for center in range(pad_len, nt_padded - pad_len, center_step):
        start = center - pad_len
        end   = center + pad_len + 1
        if end > nt_padded:
            break
        windowed = sdata_padded[:, start:end] * weights
        spectral_frequency, temporal_frequency, mps_power = \
            compute_mps2d(windowed, f_axis, t_axis[:window_len])
        
        if mps_sum is None:
            mps_sum = mps_power
        else:
            mps_sum += mps_power
        n_chunks += 1

    if n_chunks > 0:
        mps_avg: NDArray[np.floating] = mps_sum / n_chunks  # type: ignore
    else:
        mps_avg   = np.zeros_like(sdata)
        spectral_frequency = np.zeros(len(f_axis))
        temporal_frequency = np.zeros(len(t_axis))

    spectral_positives = spectral_frequency >= 0
    temporal_positives = temporal_frequency >= 0
    spectral_frequency = spectral_frequency[spectral_positives]
    temporal_frequency = temporal_frequency[temporal_positives]
    mps_avg = mps_avg[spectral_positives,:][:,temporal_positives]

    return ModulationPowerSpectrum(spectral_frequency, temporal_frequency, mps_avg)



def create_modulation_power_spectrum2(waveform:np.ndarray, fs:float):
    '''Modulation power spectrum as in biosound'''
    b, a     = scipy.signal.butter(3, [2, 8], 'bandpass', fs = fs)
    waveform = scipy.signal.lfilter(b, a, waveform)
    spectrogramdata, f_axis, t_axis = spectrogram_as_in_biosound(waveform, fs, f_min=2, f_max=8)
    mps = mps_as_in_biosound(spectrogramdata, f_axis, t_axis, windowlength=5.12/2)

    wf_mask = (mps.spectral_axis >= 0)
    wt_mask = (mps.temporal_axis >= 0)
    wf = mps.spectral_axis[wf_mask]
    wt = mps.temporal_axis[wt_mask]
    mpsdata = mps.data[wf_mask][:, wt_mask]

    return ModulationPowerSpectrum(wf, wt, mpsdata) 



def spectrogram_as_in_biosound(
    signal:    npt.NDArray, 
    fs:        float,
    f_spacing: float = 0.0745, 
    t_spacing: float = 0.02,
    f_min:     float = 0.0,
    f_max:     float = np.inf,
    nstd:      float = 6
):
    f_max = min(f_max, fs / 2)
    window_length = nstd / (2.0 * np.pi * f_spacing)
    window_nsamples = int(window_length * fs)
    if window_nsamples % 2 == 1:
        window_nsamples += 1
    assert len(signal) > window_nsamples, f'{len(signal), {window_nsamples}}'

    signal = zero_pad_signal(signal, window_nsamples)

    t_spacing_samples = int( np.round(fs * t_spacing) )
    sliding_window_view = np.lib.stride_tricks.sliding_window_view
    signal_windows = \
        sliding_window_view(signal, window_nsamples, axis=0)[::t_spacing_samples]
    gaussian_weights = generate_gaussian_weights(window_nsamples, nstd)

    #spectrogramdata = np.zeros([len(signal), len(signal_windows)], dtype='complex')
    spectrogramdata: npt.NDArray|None = None
    for i, signal_window in enumerate(signal_windows):
        f_axis, s_fft = perform_fft( signal_window * gaussian_weights, fs )
        mask = (f_axis <= f_max) & (f_axis >= f_min)
    
        f_axis = f_axis[mask]
        if spectrogramdata is None:
            spectrogramdata = np.zeros([len(f_axis), len(signal_windows)], dtype='complex')
        # spectrogramdata = spectrogramdata[:len(f_axis)]
        spectrogramdata[:, i] = s_fft[mask]
    
    t_axis = np.linspace(0, len(signal)/fs, len(signal_windows))
    # NOTE: f_axis should be defined, or sliding_window_view would have raised

    # for mypy
    spectrogramdata = tp.cast(npt.NDArray, spectrogramdata)
    spectrogramdata = 20 * np.log10(np.abs(spectrogramdata))
    return spectrogramdata, f_axis, t_axis


def perform_fft(signal:npt.NDArray, fs:float) -> tp.Tuple[npt.NDArray, npt.NDArray]:
    fft_length = scipy.fftpack.next_fast_len(len(signal))
    signal  = signal[:fft_length]
    s_fft   = scipy.fftpack.fft(signal, n=fft_length, overwrite_x=False)
    f_axis  = scipy.fftpack.fftfreq(fft_length, d=1.0/fs)
    nonzero = f_axis >= 0.0

    return f_axis[nonzero], s_fft[nonzero]


def generate_gaussian_weights(window_nsamples:int, nstd:float = 6):
    half_window  = window_nsamples / 2
    gauss_t      = np.linspace(-half_window, half_window, window_nsamples)
    gauss_std    = window_nsamples / nstd
    gauss_window = \
        np.exp(-gauss_t**2 / (2.0 * gauss_std**2)) / (gauss_std * np.sqrt(2*np.pi))
    return gauss_window


def zero_pad_signal(signal: npt.NDArray, window_nsamples:int) -> npt.NDArray:
    assert window_nsamples % 2 == 0

    half_window = window_nsamples // 2
    zero_padded = np.zeros([len(signal) + 2 * half_window])
    zero_padded[half_window:-half_window] = signal
    return zero_padded


def mps_as_in_biosound(
    spectrogramdata:npt.NDArray, 
    f_axis:npt.NDArray, 
    t_axis:npt.NDArray, 
    windowlength: tp.Optional[float] = None,
    normalize:    bool = True
):
    assert spectrogramdata.ndim == 2
    assert spectrogramdata.shape[0] == len(f_axis)
    assert spectrogramdata.shape[1] == len(t_axis)
    
    if normalize:
        spectrogramdata = normalize_spectrogram(spectrogramdata)


    if windowlength is None:
        windowlength = t_axis[-1] / 10.0
    
    window_n = int( np.searchsorted(t_axis, windowlength) )
    if window_n % 2 == 0:
        window_n += 1
    
    gaussian_weights = generate_gaussian_weights(window_n, nstd=6)
    t_step = int( window_n / 2 / 3 ) or 1

    pad_n = int( (window_n - 1) // 2 )
    spectrogramdata_padded = \
        pad_spectrogram(spectrogramdata, pad_n, spectrogramdata.min())
    nt_padded = spectrogramdata_padded.shape[1]


    n_chunks = 0
    mps_sum: tp.Optional[npt.NDArray] = None
    for center in range(t_step, len(t_axis), t_step):
        start = max(center - pad_n, 0)
        end   = start + len(gaussian_weights)
        if end > nt_padded:
            break

        windowed = spectrogramdata_padded[:, start:end] * gaussian_weights
        spectral_frequency, temporal_frequency, mps_power = \
            compute_mps2d(windowed, f_axis, t_axis[:window_n])
        
        if mps_sum is None:
            mps_sum = mps_power
        else:
            mps_sum += mps_power
        n_chunks += 1


    if n_chunks > 0:
        mps_avg: NDArray[np.floating] = mps_sum / n_chunks  # type: ignore
    else:
        mps_avg   = np.zeros_like(spectrogramdata)
        spectral_frequency = np.zeros(len(f_axis))
        temporal_frequency = np.zeros(len(t_axis))
    
    return ModulationPowerSpectrum(spectral_frequency, temporal_frequency, mps_avg)










def create_spectrogram_for_visualization(
    data: npt.NDArray[np.float32],
    i0:  int,
    i1:  int,
    sample_rate_hz:    float,
) -> SpectrogramDataDict:
    """Return spectrogram data for a time slice."""
    # NOTE: data is a memoryview when called from JS, making sure its numpy
    data = np.asarray(data, dtype=np.float32)
    start: int
    stop: int
    start, stop = _slice_bounds(i0, i1, data.size)

    sliced_data: npt.NDArray[np.float32] = data[start:stop]

    spec = create_spectrogram(sliced_data, sample_rate_hz)
    speclogdata: npt.NDArray[np.float32] = \
        np.log10( np.abs(spec.data) + 1).astype(np.float32)
    normalized: npt.NDArray[np.float32] = \
        scale_spectrogram_to_range(speclogdata, vmin=0.0, vmax=2.5)

    return {
        't_axis': spec.t_axis.astype(np.float32),
        'f_axis': spec.f_axis.astype(np.float32),
        'power':  normalized.astype(np.float32).ravel(),
        'rows':   int(spec.f_axis.size),
        'cols':   int(spec.t_axis.size),
    }


def create_modulation_power_spectrum_for_visualization(
    data: npt.NDArray[np.float32],
    i0: int,
    i1: int,
    sample_rate_hz: float,
) -> SpectrogramDataDict:
    '''Return modulation power spectrum data for visualization.'''
    data = np.asarray(data, dtype=np.float32)
    start: int
    stop: int
    start, stop = _slice_bounds(i0, i1, data.size)

    sliced_data: npt.NDArray[np.float32] = data[start:stop]
    mps: ModulationPowerSpectrum = create_modulation_power_spectrum2(
        sliced_data,
        sample_rate_hz,
    )

    mps_log = 10.0 * np.log10(np.maximum(mps.data, 1e-12))
    inverted: npt.NDArray[np.float64] = mps_log.max() - mps_log
    normalized: npt.NDArray[np.float32] = scale_spectrogram_to_range(inverted)

    return {
        't_axis': mps.temporal_axis.astype(np.float32),
        'f_axis': mps.spectral_axis.astype(np.float32),
        'power':  normalized.astype(np.float32).ravel(),
        'rows':   int(mps.spectral_axis.size),
        'cols':   int(mps.temporal_axis.size),
    }



def prepare_obs_signal_for_audio(
    signal: npt.NDArray[np.float32], 
    fs:     float,
    output_path: tp.Optional[str] = None
) -> npt.NDArray[np.float32]:
    signal = signal - np.median(signal) # type: ignore

    #target_fs = 44100
    target_fs = 8000
    fs_factor = target_fs / fs
    speedup   = 8

    n = int(len(signal) * fs_factor // speedup)
    signal_indices = np.arange(len(signal))
    interp_values  = np.linspace(0, signal_indices[-1], n)

    interp_signal = scipy.interpolate.interp1d(
        signal_indices, 
        signal, 
        kind='cubic',
    )(interp_values).astype('float32')
    interp_signal = interp_signal / np.percentile( np.abs(interp_signal[32:-32] ), 99.8 )
    interp_signal = np.clip(interp_signal, -5, 5)

    interp_signal = interp_signal.astype('float32')
    if output_path is not None:
        open(output_path, 'wb').write(interp_signal.tobytes())
    return interp_signal

