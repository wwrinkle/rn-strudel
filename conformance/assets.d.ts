// An imported audio file: an asset id under Metro, a URL under Vite.
declare module '*.wav' {
  const asset: number | string;
  export default asset;
}
