const _ = require('lodash');
const Concept = require('./lib/models/concept');
const Term = require('./lib/models/term');
const Pattern = require('./lib/models/pattern');

const resolvers = {
  Query: {
    pattern: (__, { idOrName }, { db }) => {
      return db.transact(Pattern.GetQuery(idOrName));
    },

    concepts: (__, args, { db }) => {
      return db.transact(Concept.FindQuery(args));
    },

    match: (__, { statements }, { db }) => {
      return db
        .transact(Pattern.MatchQuery(statements))
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
        const term = await run(Term.SaveQuery(label));
        const concept = await run(Concept.SaveQuery({ label, term }));

        // See if concept matches against existing patterns
        const potentialPatterns = await run(Concept.PotentialPatternsQuery(concept.id));
        const matchPromises = potentialPatterns.map(async pattern => {
          const lines = pattern.statements.map(s => s.source);
          const matches = await run(Pattern.MatchQuery(lines, term.id));

          return matches.length > 0
            ? run(Pattern.MatchMappingQuery({ matches, pattern }))
            : null;
        });

        await Promise.all(matchPromises);

        return {
          ...concept,
          term
        };
      });
    },

    savePattern: (__, args, { db }) => {
      return db.transact(async ({ run }) => {
        const [pattern, matches] = await Promise.all([
          run(Pattern.SaveQuery(args)),
          run(Pattern.MatchQuery(args.statements))
        ]);

        const connectionQuery = Pattern.MatchMappingQuery({ matches, pattern });
        
        return await run(connectionQuery);
      });
    }
  },

  Pattern: {}
};

module.exports = resolvers;