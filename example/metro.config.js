// rn-strudel lives one directory up (linked via "file:.."), rn-web-audio-compat is a sibling repo (linked via
// "file:../../rn-web-audio-compat"), and the shared conformance rows are in ../conformance. Watch those, but resolve
// every package from this app's node_modules only (their own node_modules are blocked), so the bundle has exactly one
// copy of react-native, react-native-audio-api, superdough and @strudel/*.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const libRoot = path.resolve(projectRoot, '..');
const compatRoot = path.resolve(projectRoot, '../../rn-web-audio-compat');
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [libRoot, compatRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(libRoot, 'node_modules'))}/.*`),
  new RegExp(`^${escape(path.join(libRoot, 'web-demo'))}/.*`),
  new RegExp(`^${escape(path.join(compatRoot, 'node_modules'))}/.*`),
  new RegExp(`^${escape(path.join(compatRoot, 'example'))}/.*`),
  new RegExp(`^${escape(path.join(compatRoot, 'web-demo'))}/.*`),
];
module.exports = config;
