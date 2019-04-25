const PatternSaveQuery = (name, lines) => {
  const parsed = parseLines(lines);

  const query = `
    MERGE (patternNode:Pattern { name: {pattern}.name })
      SET pattern.id = randomUUID()
    
    WITH patternNode
    UNWIND {pattern}.subpatterns AS subpattern
      MERGE (patternNode)-[:CONTAINS_SUBPATTERN]->(subpatternNode:Subpattern { text: subpattern.text })
      WITH patternNode, subpatternNode
      UNWIND subpattern.components AS component
        MERGE ()-[:CONTAINS_COMPONENT]->(componentNode:PatternComponent)
  `;

  const variables = {
    pattern: {
      name,
      subpatterns
    }
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
  let counter = 0;

  parseLines(lines).forEach(({ key, parts }) => {
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
      if (part.type === 'variable') {
        const propStr = propParts.length > 0 ? ` { ${propParts.join(', ')} } ` : '';
        const termCondition = `(${part.name}:Term)`;
        const ngramCondition = `(${part.key}:Ngram)`;

        matchParts.push(`(${part.key}${propStr})`);
        termRels.push(`(${part.key})-[:INSTANCE_OF]->(${part.name})`);
        returns[part.name] = part.name;
        wheres[termCondition] = termCondition;
        wheres[ngramCondition] = ngramCondition;
      }
      
      // Exact match of term
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
      const parts = [];
      const matches = [];

      returnParts.forEach(nodeName => {
        const node = record.get(nodeName).properties;

        if (nodeName.match(/line[0-9]+/)) {
          parts.push(node);
        } else {
          matches.push({
            name: nodeName,
            term: node
          });
        }
      });

      const statement = parts.map(part => part.label).join('\n');

      return {
        statement,
        parts,
        matches
      };
    });
  };

  return {
    query,
    variables,
    processResult
  };
};

const parseLines = lines => {
  return lines.map((source, index) => {
    const key = `line${index}`;

    const parts = source.match(/@\w+|[^@]+/g).map((part, n) => {
      const id = [index, n].join('_');
      const key = `ngram_${id}`;

      if (part[0] === '@') {
        return {
          key,
          type: 'variable',
          name: part.slice(1),
          index: n
        };
      }

      return {
        key,
        type: 'exact',
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
  PatternMatchQuery,
  parseLines
};