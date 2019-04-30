const _ = require('lodash');
const Concept = require('./lib/models/concept');
const Term = require('./lib/models/term');
const Pattern = require('./lib/models/pattern');

const resolvers = {
  Query: {
    pattern: (__, { idOrName }, { db }) => {
      return db.transact(Pattern.PatternGetQuery(idOrName));
    },

    concepts: (__, args, { db }) => {
      return db.transact(Concept.ConceptFindQuery(args));
    },

    match: (__, { statements }, { db }) => {
      return db
        .transact(Pattern.PatternMatchQuery(statements))
        .then(matches => {
          return matches.map(match => {
            return match.variableMatches;
          });
        });
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
    },

    savePattern: (__, args, { db }) => {
      return db.transact(async ({ run }) => {
        const [pattern, matches] = await Promise.all([
          run(Pattern.PatternSaveQuery(args)),
          run(Pattern.PatternMatchQuery(args.statements))
        ]);

        const connectionQuery = Pattern.PatternMatchMappingQuery({ matches, pattern });
        
        return await run(connectionQuery);
      });
    }
  },

  Pattern: {}
};

module.exports = resolvers;