// superdough's orbit delay (.delay()) is created with `ctx.createFeedbackDelay(wet, time, feedback)`, which superdough's
// own feedbackdelay.mjs defines as a DelayNode subclass whose repeats come from a graph cycle. react-native-audio-api
// rejects every graph cycle (silently: connect() returns normally, the edge is never added), so that version plays one
// echo and no repeats. This replaces it with rn-web-audio-compat's FeedbackDelayNode (own delay line, no cycle).
//
// Must run AFTER superdough's modules have been evaluated: its own patch of the same prototype method would otherwise
// overwrite this one, silently. initStrudel() calls it at the right time and asserts the result.

import { BaseAudioContext } from 'react-native-audio-api';
import { FeedbackDelayNode } from 'rn-web-audio-compat';

function createFeedbackDelay(this: BaseAudioContext, wet: number, time: number, feedback: number): FeedbackDelayNode {
  return new FeedbackDelayNode(this, wet, time, feedback);
}

export function installFeedbackDelay(): void {
  (BaseAudioContext.prototype as unknown as Record<string, unknown>).createFeedbackDelay = createFeedbackDelay;
}

export function isFeedbackDelayInstalled(): boolean {
  return (BaseAudioContext.prototype as unknown as Record<string, unknown>).createFeedbackDelay === createFeedbackDelay;
}
