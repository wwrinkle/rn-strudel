// superdough's processors (the parity references) are .mjs in node_modules, so they are transformed too.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: { '\\.(mjs|[jt]s)$': 'babel-jest' },
  transformIgnorePatterns: ['/node_modules/(?!(superdough|rn-web-audio-compat|@kabelsalat|nanostores)/)'],
};
