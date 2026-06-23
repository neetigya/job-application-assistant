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

module.exports = (env = {}) => {
  const isProd = !!env.production;

  const plugins = [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/popup/popup.html',    to: 'popup/popup.html' },
        { from: 'src/popup/popup.css',     to: 'popup/popup.css'  },
        { from: 'src/options/options.html', to: 'options/options.html' },
        { from: 'src/sidebar/sidebar.html', to: 'sidebar/sidebar.html' },
        { from: 'src/sidebar/sidebar.css',  to: 'sidebar/sidebar.css'  },
        { from: 'images', to: 'images' }
      ]
    })
  ];

  if (!isProd && externalTestDataPath) {
    // Swap the committed stub with the real personal data file at build time.
    // Skipped in production builds so personal data is never bundled into store uploads.
    plugins.push(new webpack.NormalModuleReplacementPlugin(
      /utils[\\/]testDataStub$/,
      externalTestDataPath
    ));
  }

  return [
    {
      mode: isProd ? 'production' : 'development',
      entry: {
        popup:      './src/popup/popup.ts',
        content:    './src/content/content.ts',
        background: './src/background/background.ts',
        options:    './src/options/options.ts',
        sidebar:    './src/sidebar/sidebar.ts',
      },
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name]/[name].js',
        clean: isProd
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
      devtool: isProd ? false : 'source-map',
      plugins
    }
  ];
};
