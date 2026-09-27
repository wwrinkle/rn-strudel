// rn-strudel: native (C++) ports of superdough's worklet processors, run by rn-web-audio-compat's kernel registry.
//
// Each kernel mirrors the matching TS processor in rn-strudel (src/processors/*.ts), which ports superdough's
// worklets.mjs (https://codeberg.org/uzu/strudel, AGPL-3.0-or-later; crush/bitcrush math credited by superdough to
// dktr0's WebDirt, GPLv3). Checked sample-by-sample against the TS versions by scripts/kernel-parity.
// Licensed AGPL-3.0-or-later, like the rest of rn-strudel.

#include <audioapi/dsp/rnwac/Kernels.h>
#include <audioapi/dsp/rnwac/KernelUtil.h>
#include <audioapi/dsp/rnwac_ext/Extensions.h>

#include <algorithm>
#include <cmath>
#include <limits>

namespace rnwac_ext {

namespace {

using rnwac::KernelState;
using rnwac::kMaxChannels;
using rnwac::kMaxVoices;
using rnwac::kStateSlots;
using namespace rnwac::util;

enum StrudelKernelId : int {
  kCoarse = 101,
  kTransient = 102,
  kDjf = 103,
  kLadder = 104,
  kLfo = 105,
  kEnvelope = 106,
  kPulse = 107,
  kSupersaw = 108,
};

// ---------------------------------------------------------------------------------------------------------------------
// coarse: params [coarse]. Port of coarseProcessor.ts, including its block-relative `n % coarse` counter.
void coarse(const float *const *in, float *const *out, int channels, int frames, const double *p) {
  const double c = std::max(1.0, static_cast<double>(p[0]));
  for (int ch = 0; ch < channels; ++ch) {
    for (int n = 0; n < frames; ++n) {
      out[ch][n] = (std::fmod(static_cast<double>(n), c) == 0.0) ? in[ch][n] : out[ch][n - 1];
    }
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// transient: params [attackTime, sustainTime, attack, sustain, sensitivity, mix, begin, end] (all from processorOptions).
// Port of transientProcessor.ts. Quirk preserved: avgGain is one running value carried across channels.
void transient(
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *p,
    KernelState &s,
    double sr,
    double t) {
  const double begin = p[6];
  const double end = p[7];
  if (t >= end || t <= begin) {
    zeroOut(out, channels, frames);
    return;
  }
  // transientProcessor.ts derives these from processorOptions ONCE, in createState() — never per block, since
  // transient has no live AudioParams at all (parameterDescriptors is []). Match that here: computing them fresh
  // every call (3 std::exp calls plus several clamps) was pure overhead the JS version never paid, and measured as
  // real cost on-device (see CLAUDE.md's effect-cost-benchmark section). Cache in state on first call instead.
  if (!s.init) {
    const double invSr = 1.0 / sr;
    auto timeToCoeff = [&](double tt) { return 1.0 - std::exp(-invSr / tt); };
    const double attackTime = std::min(std::max(static_cast<double>(p[0]), 0.0005), 0.05);
    const double sustainTime = std::min(std::max(static_cast<double>(p[1]), 0.01), 0.5);
    const double attackAmt = std::min(std::max(static_cast<double>(p[2]), -1.0), 1.0);
    const double sustainAmt = std::min(std::max(static_cast<double>(p[3]), -1.0), 1.0);
    const double DB_TO_EXP = 0.11512925464970229;
    s.g[0] = 1.0; // avgGain
    s.g[1] = timeToCoeff(attackTime); // attackCoeff
    s.g[2] = timeToCoeff(sustainTime); // sustainCoeff
    s.g[3] = timeToCoeff(0.2); // gainCoeff
    s.g[4] = attackAmt * 18.0 * DB_TO_EXP; // attackAmt18
    s.g[5] = sustainAmt * -36.0 * DB_TO_EXP; // -sustainAmt36 (pre-negated, matches the per-sample use below)
    s.g[6] = 0.5 + 5.0 * std::min(std::max(static_cast<double>(p[4]), 0.0), 1.0); // scaling
    s.g[7] = std::min(std::max(static_cast<double>(p[5]), 0.0), 1.0); // mix
    s.init = true;
  }
  double avgGain = s.g[0];
  const double attackCoeff = s.g[1];
  const double sustainCoeff = s.g[2];
  const double gainCoeff = s.g[3];
  const double attackAmt18 = s.g[4];
  const double negSustainAmt36 = s.g[5];
  const double scaling = s.g[6];
  const double mix = s.g[7];
  for (int ch = 0; ch < channels; ++ch) {
    double attEnv = s.v[ch][0];
    double susEnv = s.v[ch][1];
    for (int n = 0; n < frames; ++n) {
      const double sample = in[ch][n];
      const double x = sample < 0 ? -sample : sample;
      attEnv += (x - attEnv) * attackCoeff;
      susEnv += (x - susEnv) * sustainCoeff;
      double peakiness = (scaling * (attEnv - susEnv)) / (susEnv + 1e-6);
      peakiness = peakiness < -1.5 ? -1.5 : (peakiness > 1.5 ? 1.5 : peakiness);
      double gain = std::exp(peakiness > 0 ? attackAmt18 * peakiness : negSustainAmt36 * peakiness);
      gain = gain > 8 ? 8 : gain;
      avgGain += (gain - avgGain) * gainCoeff;
      const double makeup = avgGain > 1e-3 ? 1.0 / avgGain : 1.0;
      const double wet = sample * gain * makeup;
      double y = sample + (wet - sample) * mix;
      y /= 1.0 + (y < 0 ? -y : y);
      out[ch][n] = static_cast<float>(y);
    }
    s.v[ch][0] = attEnv;
    s.v[ch][1] = susEnv;
  }
  s.g[0] = avgGain;
}


// ---------------------------------------------------------------------------------------------------------------------
// djf: params [value]. Port of djfProcessor.ts (two-pole state-variable filter, dead zone 0.49..0.51 = bypass).
void djf(const float *const *in, float *const *out, int channels, int frames, const double *p, KernelState &s, double sr) {
  const double value = clampd(p[0], 0.0, 1.0);
  int filterType = 0; // 0 none, 1 lopass, 2 hipass
  double v = 1.0;
  if (value > 0.51) {
    filterType = 2;
    v = (value - 0.5) * 2.0;
  } else if (value < 0.49) {
    filterType = 1;
    v = value * 2.0;
  }
  if (filterType == 0) {
    for (int ch = 0; ch < channels; ++ch) {
      for (int n = 0; n < frames; ++n) {
        out[ch][n] = in[ch][n];
      }
    }
    return;
  }
  const double cutoff = std::pow(v * 11.0, 4.0);
  const double clampedCutoff = clampd(cutoff, 0.0, sr / 2.0 - 1.0);
  const double c = clampd(2.0 * std::sin(clampedCutoff * kPi * (1.0 / sr)), 0.0, 1.14);
  const double r = std::pow(0.5, 8.0 * 0.1 + 1.0);
  const double mrc = 1.0 - r * c;
  const bool isLopass = filterType == 1;
  for (int ch = 0; ch < channels; ++ch) {
    double s0 = s.v[ch][0];
    double s1 = s.v[ch][1];
    for (int n = 0; n < frames; ++n) {
      const double x = in[ch][n];
      s0 = mrc * s0 - c * s1 + c * x;
      s1 = mrc * s1 + c * s0;
      out[ch][n] = static_cast<float>(isLopass ? s1 : x - s1);
    }
    s.v[ch][0] = s0;
    s.v[ch][1] = s1;
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// ladder: params [frequency, q, drive]. Port of ladderProcessor.ts. State per channel: p0 p1 p2 p3 p32 p33 p34 in v[ch][0..6].
inline double fastTanh(double x) {
  const double x2 = x * x;
  return (x * (27.0 + x2)) / (27.0 + 9.0 * x2);
}

void ladder(const float *const *in, float *const *out, int channels, int frames, const double *p, KernelState &s, double sr) {
  const double resonance = p[2 - 1]; // q
  const double drive = std::min(std::max(std::exp(static_cast<double>(p[2])), 0.1), 2000.0);
  double cutoff = static_cast<double>(p[0]) * (2.0 * kPi) * (1.0 / sr);
  cutoff = cutoff > 1.0 ? 1.0 : cutoff;
  const double k = std::min(8.0, resonance * 0.13);
  const double makeupGain = (1.0 / drive) * std::min(1.75, 1.0 + k);
  for (int ch = 0; ch < channels; ++ch) {
    double p0 = s.v[ch][0], p1 = s.v[ch][1], p2 = s.v[ch][2], p3 = s.v[ch][3];
    double p32 = s.v[ch][4], p33 = s.v[ch][5], p34 = s.v[ch][6];
    for (int n = 0; n < frames; ++n) {
      const double stageOut = p3 * 0.360891 + p32 * 0.41729 + p33 * 0.177896 + p34 * 0.0439725;
      p34 = p33;
      p33 = p32;
      p32 = p3;
      p0 += (fastTanh(static_cast<double>(in[ch][n]) * drive - k * stageOut) - fastTanh(p0)) * cutoff;
      p1 += (fastTanh(p0) - fastTanh(p1)) * cutoff;
      p2 += (fastTanh(p1) - fastTanh(p2)) * cutoff;
      p3 += (fastTanh(p2) - fastTanh(p3)) * cutoff;
      out[ch][n] = static_cast<float>(stageOut * makeupGain);
    }
    s.v[ch][0] = p0;
    s.v[ch][1] = p1;
    s.v[ch][2] = p2;
    s.v[ch][3] = p3;
    s.v[ch][4] = p32;
    s.v[ch][5] = p33;
    s.v[ch][6] = p34;
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// lfo (source): params [begin, time, end, frequency, skew, depth, phaseoffset, shape, curve, dcoffset, min, max].
// Port of lfoProcessor.ts ("custom" shape, which needs an array-valued skew, is not supported and falls through to ramp).
inline double frac(double x) {
  return x - std::floor(x);
}

double polyBlep(double phase, double dt) {
  dt = std::min(dt, 1.0 - dt);
  const double invdt = 1.0 / dt;
  if (phase < dt) {
    phase *= invdt;
    return 2.0 * phase - phase * phase - 1.0;
  } else if (phase > 1.0 - dt) {
    phase = (phase - 1.0) * invdt;
    return phase * phase + 2.0 * phase + 1.0;
  }
  return 0.0;
}

double lfoWave(int shape, double phase, double skew) {
  switch (shape) {
    case 0: { // tri
      const double x = 1.0 - skew;
      if (phase >= skew) return 1.0 / x - phase / x;
      return phase / skew;
    }
    case 1: // sine
      return std::sin(kTwoPi * phase) * 0.5 + 0.5;
    case 2: // ramp
      return phase;
    case 3: // saw
      return 1.0 - phase;
    case 4: // square
      return phase >= skew ? 0.0 : 1.0;
    case 6: { // sawblep
      const double v = 2.0 * phase - 1.0;
      return v - polyBlep(phase, skew);
    }
    default:
      return phase;
  }
}

void lfo(float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double t) {
  const double begin = p[0];
  const double end = p[2];
  if (t >= end || t <= begin) {
    zeroOut(out, channels, frames);
    return;
  }
  const double time = p[1];
  const double frequency = p[3];
  const double skew = p[4];
  const double depth = p[5];
  const double phaseoffset = p[6];
  const double curve = p[8];
  const double dcoffset = p[9];
  const double mn = p[10];
  const double mx = p[11];
  int shape = static_cast<int>(std::floor(static_cast<double>(p[7])));
  shape = std::max(0, std::min(6, shape));
  if (!s.init) {
    s.g[0] = frac(time * frequency + phaseoffset); // phase
    s.init = true;
  }
  double phase = s.g[0];
  const double dt = frequency * (1.0 / sr);
  for (int n = 0; n < frames; ++n) {
    double modval = (lfoWave(shape, phase, skew) + dcoffset) * depth;
    modval = std::pow(modval, curve);
    const double clamped = jsMin(jsMax(modval, mn), mx);
    for (int ch = 0; ch < channels; ++ch) {
      out[ch][n] = static_cast<float>(clamped);
    }
    phase += dt;
    if (phase > 1.0) phase -= 1.0;
  }
  s.g[0] = phase;
}


// ---------------------------------------------------------------------------------------------------------------------
// envelope (source): params [begin, end, attack, decay, sustain, release, attackCurve, decayCurve, releaseCurve, depth,
// min, max, retrigger]. Port of envelopeProcessor.ts. Quirks preserved: `currentTime` is constant across the block, and
// only channel 0 is written (channel 1 stays zero).
double warp(double phase, double curvature) {
  const double strength = 8.0;
  if (phase == 0.0 || phase == 1.0) return phase;
  if (curvature > 0) {
    const double e = 1.0 + strength * curvature;
    return 1.0 - std::pow(1.0 - phase, e);
  }
  const double e = 1.0 - strength * curvature;
  return std::pow(phase, e);
}

void envelope(float *const *out, int channels, int frames, const double *p, KernelState &s, double t) {
  const double begin = p[0];
  const double end = p[1];
  if (t >= end || t <= begin) {
    zeroOut(out, channels, frames);
    return;
  }
  // state: g[0]=val g[1]=segmentIndex g[2]=beginTime g[3]=endTime g[4]=attackStart
  double &val = s.g[0];
  int segmentIndex = static_cast<int>(s.g[1]);
  double &beginTime = s.g[2];
  double &endTime = s.g[3];
  double &attackStart = s.g[4];
  const bool retrigger = p[12] >= 0.5;
  if (begin != beginTime && (segmentIndex == 0 || retrigger)) {
    beginTime = begin;
    segmentIndex = 1;
    endTime = end;
    attackStart = val;
  }
  const double attack = p[2];
  const double decay = p[3];
  const double sustain = p[4];
  const double release = p[5];
  const double aCurve = p[6];
  const double dCurve = p[7];
  const double rCurve = p[8];
  const double depth = p[9];
  const double mn = p[10];
  const double mx = p[11];
  const double susTime = endTime - beginTime;

  struct Segment {
    double time, start, target, curve;
  };

  for (int n = 0; n < frames; ++n) {
    const Segment segments[5] = {
        {std::numeric_limits<double>::infinity(), 0.0, 0.0, 0.0},
        {attack, attackStart, 1.0, aCurve},
        {attack + decay, 1.0, sustain, dCurve},
        {susTime, sustain, sustain, 0.0},
        {susTime + release, sustain, 0.0, rCurve},
    };
    Segment seg = segments[segmentIndex];
    if (seg.time == 0.0 || seg.start == seg.target) {
      val = seg.target;
    } else {
      const double phase = std::min(1.0, (t - beginTime) / seg.time);
      val = seg.start + (seg.target - seg.start) * warp(phase, seg.curve);
    }
    while (t - beginTime >= seg.time) {
      segmentIndex = (segmentIndex + 1) % 5;
      seg = segments[segmentIndex];
    }
    out[0][n] = static_cast<float>(jsMin(jsMax(val * depth, mn), mx));
  }
  for (int ch = 1; ch < channels; ++ch) {
    for (int n = 0; n < frames; ++n) out[ch][n] = 0.0f;
  }
  s.g[1] = segmentIndex;
}


// ---------------------------------------------------------------------------------------------------------------------
// pulse (source): params [begin, end, frequency, detune, pulsewidth]. Port of pulseOscillatorProcessor.ts.
// State: g[0]=phi g[1]=y0 g[2]=y1 g[3]=b g[4]=dphif g[5]=envf.
void pulse(float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double t) {
  if (t <= p[0] || t >= p[1]) {
    zeroOut(out, channels, frames);
    return;
  }
  if (!s.init) {
    s.g[0] = -kPi;
    s.g[3] = 2.3;
    s.init = true;
  }
  const double invSr = 1.0 / sr;
  const double pulsewidth = std::min(std::max(static_cast<double>(p[4]), -0.99), 0.99);
  const double pw = (1.0 - pulsewidth) * kPi;
  const double freq = static_cast<double>(p[2]) * std::pow(2.0, (static_cast<double>(p[3]) / 100.0) / 12.0);
  const double dphi = freq * kTwoPi * invSr;
  double phi = s.g[0], y0 = s.g[1], y1 = s.g[2], b = s.g[3], dphif = s.g[4], envf = s.g[5];
  double env = 1.0;
  for (int i = 0; i < frames; ++i) {
    dphif += 0.1 * (dphi - dphif);
    env *= 0.9998;
    envf += 0.1 * (env - envf);
    b = 2.3 * (1.0 - 0.0001 * freq);
    if (b < 0) b = 0;
    phi += dphif;
    if (phi >= kPi) phi -= kTwoPi;
    const double out0 = std::cos(phi + b * y0);
    y0 = 0.5 * (out0 + y0);
    const double out1 = std::cos(phi + b * y1 + pw);
    y1 = 0.5 * (out1 + y1);
    const double sample = 0.15 * (out0 - out1) * envf;
    for (int ch = 0; ch < channels; ++ch) out[ch][i] = static_cast<float>(sample);
  }
  s.g[0] = phi;
  s.g[1] = y0;
  s.g[2] = y1;
  s.g[3] = b;
  s.g[4] = dphif;
  s.g[5] = envf;
}


// ---------------------------------------------------------------------------------------------------------------------
// supersaw (source): params [begin, end, frequency, panspread, freqspread, detune, voices, resetToken]. Port of
// supersawOscillatorProcessor.ts. Voice phases start random (like the original's Math.random()); changing resetToken
// (the JS "initialize" message for pooled-node reuse) re-randomises them.
double nextRandom(KernelState &s) {
  s.rng = s.rng * 1664525u + 1013904223u;
  return static_cast<double>(s.rng >> 8) / 16777216.0;
}

double sawblep(double phase, double dt) {
  const double v = 2.0 * phase - 1.0;
  return v - polyBlep(phase, dt);
}

void supersaw(float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double t) {
  const double begin = p[0];
  const double end = p[1];
  const bool beginDefined = begin >= 0;
  const bool endDefined = end >= 0;
  const bool ended = endDefined && t >= end;
  const bool notStarted = t <= begin;
  if (ended || notStarted || !beginDefined) {
    zeroOut(out, channels, frames);
    return;
  }
  if (s.g[0] != static_cast<double>(p[7])) { // reset token changed
    s.g[0] = p[7];
    for (int i = 0; i < kMaxVoices; ++i) s.phaseInit[i] = false;
  }
  float *outL = out[0];
  float *outR = channels > 1 ? out[1] : out[0];
  for (int i = 0; i < frames; ++i) {
    outL[i] = 0.0f;
    if (outR != outL) outR[i] = 0.0f;
  }
  const double invSr = 1.0 / sr;
  const int voices = std::min(kMaxVoices, std::max(1, static_cast<int>(std::floor(static_cast<double>(p[6])))));
  const double detune = p[5];
  const double freqspread = p[4];
  const double panspread = static_cast<double>(p[3]) * 0.5 + 0.5;
  const double gainL0 = std::sqrt(1.0 - panspread);
  const double gainR0 = std::sqrt(panspread);
  const double freq = static_cast<double>(p[2]) * std::pow(2.0, (detune / 100.0) / 12.0);
  const double scale = voices >= 2 ? freqspread / (voices - 1) : 0.0;
  const double center = freqspread * 0.5;
  double dts[kMaxVoices];
  for (int n = 0; n < voices; ++n) {
    const double d = voices >= 2 ? n * scale - center : 0.0;
    dts[n] = frac(freq * std::pow(2.0, d / 12.0) * invSr);
    if (!s.phaseInit[n]) {
      s.phases[n] = nextRandom(s);
      s.phaseInit[n] = true;
    }
  }
  for (int i = 0; i < frames; ++i) {
    double gainL = gainL0;
    double gainR = gainR0;
    // The JS original accumulates straight into Float32Arrays (outL[i] += ...), rounding to float after every voice.
    float accL = 0.0f;
    float accR = 0.0f;
    for (int n = 0; n < voices; ++n) {
      const double dt = dts[n];
      const double v = sawblep(s.phases[n], dt);
      accL = static_cast<float>(accL + v * gainL);
      accR = static_cast<float>(accR + v * gainR);
      double pn = s.phases[n] + dt;
      if (pn >= 1.0) pn -= 1.0;
      s.phases[n] = pn;
      const double tmp = gainL;
      gainL = gainR;
      gainR = tmp;
    }
    outL[i] = accL;
    if (outR != outL) outR[i] = accR;
  }
}


void coarseEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  coarse(in, out, channels, frames, p);
}
void transientEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  transient(in, out, channels, frames, p, s, sr, t);
}
void djfEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  djf(in, out, channels, frames, p, s, sr);
}
void ladderEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  ladder(in, out, channels, frames, p, s, sr);
}
void lfoEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  lfo(out, channels, frames, p, s, sr, t);
}
void envelopeEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  envelope(out, channels, frames, p, s, t);
}
void pulseEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  pulse(out, channels, frames, p, s, sr, t);
}
void supersawEntry(const float *const *in, float *const *out, int channels, int frames, const double *p, rnwac::KernelState &s, double sr, double t) {
  (void)in; (void)sr; (void)t; (void)s;
  supersaw(out, channels, frames, p, s, sr, t);
}

} // namespace

void registerKernels() {
  rnwac::registerKernel(kCoarse, "coarse", coarseEntry);
  rnwac::registerKernel(kTransient, "transient", transientEntry);
  rnwac::registerKernel(kDjf, "djf", djfEntry);
  rnwac::registerKernel(kLadder, "ladder", ladderEntry);
  rnwac::registerKernel(kLfo, "lfo", lfoEntry);
  rnwac::registerKernel(kEnvelope, "envelope", envelopeEntry);
  rnwac::registerKernel(kPulse, "pulse", pulseEntry);
  rnwac::registerKernel(kSupersaw, "supersaw", supersawEntry);
}

} // namespace rnwac_ext
