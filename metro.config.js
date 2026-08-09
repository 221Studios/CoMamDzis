const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// react-native-webview ships "react-native": "src/index.ts"; use compiled main instead.
config.resolver.resolverMainFields = ['browser', 'main', 'react-native'];

module.exports = config;
