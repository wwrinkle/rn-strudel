#pragma once

// rn-strudel: registers native kernels for superdough's worklet processors with rn-web-audio-compat's kernel registry.
// Found by rn-web-audio-compat's Kernels.cpp via __has_include; see StrudelKernels.cpp.

namespace rnwac_ext {

void registerKernels();

} // namespace rnwac_ext
