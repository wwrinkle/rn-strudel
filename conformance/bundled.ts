// The clips the example app and the web demo bundle for the bundledSamples() row: the same import in both, which the
// app's Metro turns into an asset id and Vite into a URL.
import click from './assets/bundled-click.wav';

export const BUNDLED_SAMPLES = { 'bundled-click': click };
