const parseConfig = ({
  PORT = '10000',
  GRAPHQL_PATH = '/api/graphql',
  NEO4J_URI = 'bolt://localhost:7687',
  NEO4J_USER = 'knowlific',
  NEO4J_PASSWORD = 'knowlific'
}) => ({
  graphql: {
    port: PORT,
    path: GRAPHQL_PATH
  },
  neo4j: {
    uri: NEO4J_URI,
    auth: [
      NEO4J_USER,
      NEO4J_PASSWORD
    ]
  }
});

module.exports = {
  parseConfig
};