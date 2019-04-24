const _ = require('lodash');
const Concept = require('./lib/models/concept');
const Term = require('./lib/models/term');
const Pattern = require('./lib/models/pattern');

const resolvers = {
  Query: {
    concepts: (__, args, { db }) => {
      return db.transact(Concept.ConceptFindQuery(args));
    },

    match: (__, { pattern }, { db }) => {
      return db.transact(Pattern.PatternMatchQuery(pattern));
    }
  },

  Mutation: {
    saveConcept: async (__, { label }, { db }) => {
      return db.transact(async ({ run }) => {
        const termQuery = Term.TermSaveQuery(label);
        const term = await run(termQuery);
        const conceptQuery = ConceptSaveQuery({ label, term });
        return run(conceptQuery);
      });
    }
  }
};

module.exports = resolvers;