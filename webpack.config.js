const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: './mathjax-entry.js',
  output: {
    path: path.resolve(__dirname, 'libs/mathjax'),
    filename: 'mathjax-bundle.js',
    library: {
      name: 'MathJaxBundle',
      type: 'window',
    },
    environment: {
      arrowFunction: true,
      const: true,
      destructuring: true,
      forOf: true,
      module: false,
      dynamicImport: false,
      globalThis: true,
    },
  },
  target: 'web',
  devtool: false,
  optimization: {
    minimize: true, // you can turn this back to true later, once it's working
  },

  plugins: [
    // Replace MathJax's components/version.js (which uses eval) with our CSP-safe stub
    new webpack.NormalModuleReplacementPlugin(
      /mathjax-full[\\/]+js[\\/]+components[\\/]+version\.js$/,
      path.resolve(__dirname, 'stubs/mathjax-version.js')
    ),
  ],
};

