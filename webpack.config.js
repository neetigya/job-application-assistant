const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

// Resolve external personal data file. Never committed — lives outside the project.
// 1. Check the sibling ../testData/ folder (works automatically on any OneDrive-synced machine).
// 2. Fall back to test-data.config.js (gitignored) for machines where the file lives elsewhere.
let externalTestDataPath = null;
const relativeFallback = path.resolve(__dirname, '../testData/testDataJobExt.ts');
if (fs.existsSync(relativeFallback)) {
  externalTestDataPath = relativeFallback;
} else {
  try {
    const configPath = require('./test-data.config');
    if (fs.existsSync(configPath)) externalTestDataPath = configPath;
  } catch {}
}

const plugins = [
  new CopyPlugin({
    patterns: [
      { from: 'manifest.json', to: 'manifest.json' },
      { from: 'src/popup/popup.html', to: 'popup/popup.html' },
      { from: 'src/popup/popup.css',  to: 'popup/popup.css'  },
      { from: 'src/options/options.html', to: 'options/options.html' },
      { from: 'images', to: 'images' }
    ]
  })
];

if (externalTestDataPath) {
  // Swap the committed stub with the real personal data file at build time.
  plugins.push(new webpack.NormalModuleReplacementPlugin(
    /utils[\\/]testDataStub$/,
    externalTestDataPath
  ));
}

module.exports = [
  {
    mode: 'development',
    entry: {
      popup: './src/popup/popup.ts',
      content: './src/content/content.ts',
      background: './src/background/background.ts',
      options: './src/options/options.ts'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name]/[name].js'
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          // transpileOnly skips full type-checking in webpack (use tsc --noEmit for that).
          // Required so ts-loader can process files outside rootDir (e.g. the external data file).
          use: { loader: 'ts-loader', options: { transpileOnly: true } },
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        // Lets the external data file import project types without a fragile relative path.
        'jobext-types': path.resolve(__dirname, 'src/types')
      }
    },
    devtool: 'source-map',
    plugins
  }
];
