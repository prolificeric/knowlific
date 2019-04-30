const _ = require('lodash');
const { getFirstNode } = require('../neo4j');
const nlp = require('../nlp');

const VARIABLE = 'VARIABLE';
const NGRAM = 'NGRAM';

const PatternGetQuery = idOrName => {
  const query = `
    MATCH (patternNode:Pattern)
      WHERE patternNode.id = {idOrName} OR patternNode.name = {idOrName}
    OPTIONAL MATCH
      (patternNode)-[:MATCH]->(patternMatchNode:PatternMatch),
      (patternMatchNode)-[variableEdge:VARIABLE]->(termNode:Term)

    RETURN patternNode, patternMatchNode, variableEdge, termNode
  `;

  const variables = {
    idOrName
  };

  const processResult = result => {
    if (result.records.length === 0) return null;

    const pattern = {
      matches: {}
    };

    result.records.forEach(record => {
      const patternNode = record.get('patternNode').properties;
      const patternMatchNode = record.get('patternMatchNode').properties;
      const variableEdge = record.get('variableEdge').properties;
      const termNode = record.get('termNode').properties;

      Object.assign(pattern, patternNode);
      
      _.set(pattern.matches, [patternMatchNode.id, 'variableMatches', variableEdge.name], {
        name: variableEdge.name,
        term: termNode
      });
    });

    return {
      ...pattern,
      matches: Object.values(pattern.matches).map(match => {
        return {
          ...match,
          variableMatches: Object.values(match.variableMatches)
        };
      })
    };
  };

  return {
    query,
    variables,
    processResult
  };
};

const PatternMatchMappingQuery = ({ pattern, matches }) => {
  const query = `
    MATCH (patternNode:Pattern { id: {pattern}.id })

    UNWIND {matches} AS match
      MERGE (patternNode)-[:MATCH]->(matchNode:PatternMatch { key: match.key })
        ON CREATE SET matchNode.id = randomUUID()

      WITH matchNode, match
      UNWIND match.variableMatches AS variableMatch
        MATCH (variableMatchTerm:Term { id: variableMatch.term.id })
        MERGE (matchNode)-[:VARIABLE { name: variableMatch.name }]->(variableMatchTerm)

      WITH matchNode, match
      UNWIND match.statementMatches AS statementMatch
        MATCH (termNode:Term { id: statementMatch.term.id })
        MATCH (statementNode:PatternStatement { id: statementMatch.statement.id })
        MERGE
          (matchNode)
            -[:STATEMENT_MATCH]->
          (statementMatchNode:PatternStatementMatch)
            -[:TERM]->
          (termNode)
          ON CREATE SET
            statementMatchNode.id = randomUUID()
        MERGE
          (statementMatchNode)-[:STATEMENT]->(statementNode)

        WITH matchNode, termNode, statementMatchNode, statementMatch
        UNWIND statementMatch.partMatches AS partMatch
          MATCH (partNode:PatternStatementPart { id: partMatch.part.id })
          MATCH
            (termNode)
              -[:CONTAINS_NGRAM]->
            (ngramNode:Ngram { label: partMatch.ngram.label })
              -[:INSTANCE_OF]->
            (partTermNode:Term)
          MERGE
            (statementMatchNode)
              -[:PART_MATCH]->
            (partMatchNode:PatternStatementPartMatch)
              -[:PART]->
            (partNode)
            ON CREATE SET
              partMatchNode.id = randomUUID()
          MERGE (partMatchNode)-[:NGRAM]->(ngramNode)

      RETURN matchNode
  `;

  const mappedMatches = matches.map(match => {
    const key = match.variableMatches
      .map(varMatch =>
        [varMatch.name, varMatch.term.label].join(':')  
      )
      .join(';');

    return {
      ...match,
      key,
      statementMatches: match.statementMatchTerms.map((term, i) => {
        const statement = pattern.statements[i];

        return {
          term,
          statement,
          partMatches: statement.parts.map(part => {
            const ngramLabel = part.type === VARIABLE
              ? match.variableMatches
                  .find(variable => variable.name === part.label)
                  .term.label
              : part.label;

            return {
              part,
              ngram: {
                label: ngramLabel
              }
            };
          })
        };
      })
    };
  });

  const variables = {
    pattern,
    matches: mappedMatches
  };

  const processResult = result => {
    return {
      ...pattern,
      matches: mappedMatches
    };
  };

  return {
    query,
    variables,
    processResult
  };
};

const PatternSaveQuery = ({ name, extendsIds, statements }) => {
  const query = `
    MERGE (patternNode:Pattern { name: {pattern}.name })
      ON CREATE SET
        patternNode.id = randomUUID(),
        patternNode.source = {pattern}.source

    WITH patternNode
    UNWIND {pattern}.statements AS statement
      MERGE (statementNode:PatternStatement { source: statement.source })
        ON CREATE SET statementNode.id = randomUUID()
      MERGE (patternNode)-[:STATEMENT]->(statementNode)
      
      WITH statementNode, statement, patternNode
      UNWIND statement.parts AS part
        MERGE (partNode:PatternStatementPart { label: part.label })
          ON CREATE SET
            partNode.id = randomUUID(),
            partNode.type = part.type
        MERGE (statementNode)-[:PART]->(partNode)

        MERGE (termNode:Term { label: part.term.label })
          ON CREATE SET
            termNode.id = randomUUID(),
            termNode += part.term
        MERGE (partNode)-[:TERM]->(termNode)

    RETURN patternNode, statementNode, partNode
  `;

  const parsedStatements = parseStatements(statements).map(parsedStatement => {
    return {
      ...parsedStatement,
      parts: parsedStatement.parts.map(part => {
        const { lowercase: label, ...hashes } = nlp.getSearchHashes(part.label);

        const term = {
          label,
          ...hashes
        };

        return {
          ...part,
          term
        };
      })
    };
  });

  const variables = {
    pattern: {
      name,
      source: statements.join('\n'),
      statements: parsedStatements,
      extendsIds
    }
  };

  const processResult = result => {
    let pattern;

    result.records.forEach(record => {
      const patternNode = record.get('patternNode').properties;
      const statementNode = record.get('statementNode').properties;
      const partNode = record.get('partNode').properties;
      const path = ['statements', statementNode.id, 'parts', partNode.id];

      pattern = pattern || {
        ...patternNode,
        statements: {}
      };
      
      pattern.statements[statementNode.id] = pattern.statements[statementNode.id] || statementNode;
      _.set(pattern, path, partNode);
    });

    return {
      ...pattern,
      statements: Object.values(pattern.statements).map(statement => {
        return {
          ...statement,
          parts: Object.values(statement.parts)
        };
      })
    };
  };

  return {
    query,
    variables,
    processResult
  };
};

const PatternMatchQuery = lines => {
  const matches = [];
  const returns = {};
  const wheres = {};
  const variables = {};

  parseStatements(lines).forEach(({ key, parts }) => {
    if (!parts) {
      return;
    }

    returns[key] = key;

    const matchPrefix = `(:Concept)<-[:TAGGED_AS]-(${key}:Term)-[:CONTAINS_NGRAM]->`;
    const matchParts = [];
    const termRels = [];

    parts.forEach(part => {
      const propParts = [];

      if (part.index === 0) {
        propParts.push('from: 0');
      }

      if (part.index === parts.length - 1) {
        propParts.push(`to: ${key}.size`);
      }

      // Variable match of term
      if (part.type === VARIABLE) {
        const propStr = propParts.length > 0 ? ` { ${propParts.join(', ')} } ` : '';
        const termCondition = `(${part.label}:Term)`;
        const ngramCondition = `(${part.key}:Ngram)`;

        matchParts.push(`(${part.key}${propStr})`);
        termRels.push(`(${part.key})-[:INSTANCE_OF]->(${part.label})`);
        returns[part.label] = part.label;
        wheres[termCondition] = termCondition;
        wheres[ngramCondition] = ngramCondition;
      }
      
      // Ngram match of term
      else {
        propParts.push(`label: {${part.key}}.label`);

        const propStr = propParts.length > 0 ? ` { ${propParts.join(', ')} } ` : '';
        const ngramCondition = `(${part.key}:Ngram)`;

        variables[part.key] = part;
        matchParts.push(`(${part.key}${propStr})`);
        wheres[ngramCondition] = ngramCondition;
      }
    });

    matches.push(matchPrefix + matchParts.join('-[:NEXT_NGRAM]->'));
    matches.push(...termRels);
  });

  const whereStr = Object.values(wheres).join(' AND ');
  const returnParts = Object.values(returns);
  const returnStr = returnParts.join(', ');

  const query = `
    MATCH
      ${matches.join(',\n      ')}
    WHERE
      ${whereStr}
    RETURN DISTINCT ${returnStr}
  `;

  const processResult = result => {
    return result.records.map(record => {
      const statementMatchTerms = [];
      const variableMatches = [];

      returnParts.forEach(nodeName => {
        const node = record.get(nodeName).properties;

        if (nodeName.match(/line[0-9]+/)) {
          statementMatchTerms.push(node);
        } else {
          variableMatches.push({
            name: nodeName,
            term: node
          });
        }
      });

      return {
        statementMatchTerms,
        variableMatches
      };
    });
  };

  return {
    query,
    variables,
    processResult
  };
};

const parseStatements = lines => {
  return lines.map((source, index) => {
    const key = `line${index}`;

    const parts = source.match(/@\w+|[^@]+/g).map((part, n) => {
      const id = [index, n].join('_');
      const key = `ngram_${id}`;

      if (part[0] === '@') {
        return {
          key,
          type: VARIABLE,
          label: part.slice(1),
          index: n
        };
      }

      return {
        key,
        type: NGRAM,
        label: part.trim(),
        index: n
      };
    });
    
    return {
      index,
      key,
      parts,
      source
    };
  });
};

module.exports = {
  PatternGetQuery,
  PatternMatchQuery,
  PatternSaveQuery,
  PatternMatchMappingQuery,
  parseStatements
};