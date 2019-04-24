const ConceptSaveQuery = ({ term, label }) => {
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

const ConceptFindQuery = () => {
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
  ConceptSaveQuery,
  ConceptFindQuery
};