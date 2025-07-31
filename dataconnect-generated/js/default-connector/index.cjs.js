const { , validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'default',
  service: 'air-quality-web',
  location: 'us-central1'
};
exports.connectorConfig = connectorConfig;

