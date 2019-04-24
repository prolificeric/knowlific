const fs = require('fs');
const { GraphQLServer } = require('graphql-yoga');
const neo4j = require('neo4j-driver').v1;
const { parseConfig } = require('./lib/config');
const { createNeo4jAdapter } = require('./lib/neo4j');
const typeDefs = fs.readFileSync(__dirname + '/type-defs.graphql', 'utf8');
const resolvers = require('./resolvers');

// Application config
const config = parseConfig(process.env);
const { port, path } = config.graphql;

const db = createNeo4jAdapter({
  driver: neo4j.driver(
    config.neo4j.uri,
    neo4j.auth.basic(...config.neo4j.auth)
  )
});

const server = new GraphQLServer({
  typeDefs,
  resolvers,
  context: { db }
});

const startOptions = {
  port,
  endpoint: path,
  playgroud: path
};

const init = async () => {
  // Test connection
  try {
    await db.transact({
      query: `WITH 1 as x RETURN x`
    });
  } catch (err) {
    console.log(err.stack);
    process.exit(1);
  }

  server.start(startOptions, () => {
    console.log(`Server listening on port ${port}`);
  });
};

init();