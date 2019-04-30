const _ = require('lodash');

const SaveQuery = ({ term, label }) => {
  return {
    query: `
      MATCH (term:Term { id: {term}.id })
      MERGE (concept:Concept { label: {label} })
        ON CREATE SET concept.id = randomUUID()
      MERGE (term)-[:TAGGED_AS]->(concept)
      RETURN concept
    `,
    variables: {
      term,
      label
    },
    processResult: result => {
      const [first] = result.records;
  
      if (!first) return null;
  
      return {
        ...first.get('concept').properties,
        term
      };
    }
  };
};

const PotentialPatternsQuery = id => {
  return {
    query: `
      MATCH
        (:Concept { id: {id} })
          <-[:TAGGED_AS]-
        (:Term)
          -[:CONTAINS_NGRAM]->
        (:Ngram)
          -[:INSTANCE_OF]->
        (:Term)
          <-[:TERM]-
        (part:PatternStatementPart)
          <-[:PART]-
        (statement:PatternStatement)
          <-[:STATEMENT]-
        (pattern:Pattern)
      RETURN DISTINCT pattern, statement, part
    `,
    variables: {
      id
    },
    processResult: result => {
      const patterns = {};

      result.records.forEach(record => {
        const pattern = record.get('pattern').properties;
        const statement = record.get('statement').properties;
        const part = record.get('part').properties;

        _.defaultsDeep(patterns, {
          [pattern.id]: {
            ...pattern,
            statements: {
              [statement.id]: {
                ...statement,
                parts: {
                  [part.id]: part
                }
              }
            }
          }
        });
      });

      return Object.values(patterns).map(pattern => {
        return {
          ...pattern,
          statements: Object.values(pattern.statements).map(statement => {
            return {
              ...statement,
              parts: Object.values(statement.parts)
            };
          })
        };
      });
    }
  };
};

const FindQuery = () => {
  return {
    query: `
      MATCH (concept:Concept)<-[:TAGGED_AS]-(term:Term)
      RETURN concept, term
    `,
    processResult: result => {
      return result.records.map(record => {
        const concept = record.get('concept').properties;
        const term = record.get('term').properties;
        return {
          ...concept,
          term
        };
      });
    }
  };
};

module.exports = {
  SaveQuery,
  FindQuery,
  PotentialPatternsQuery
};