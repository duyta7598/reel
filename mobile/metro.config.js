const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '..')]
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')]
module.exports = config
