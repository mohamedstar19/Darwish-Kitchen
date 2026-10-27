// Lets the web build be served from a sub-path (e.g. GitHub Pages: /Darwish-Kitchen).
// Set WEB_BASE_URL when exporting; leave it empty for local development.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...(config.experiments ?? {}),
    baseUrl: process.env.WEB_BASE_URL ?? '',
  },
});
