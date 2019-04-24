const parseLines = lines => {
  return lines.map((line, index) => {
    const key = `line${index}`;

    const parts = line.match(/@\w+|[^@]+/g).map((part, n) => {
      const id = [index, n].join('_');
      const key = `ngram_${id}`;

      if (part[0] === '@') {
        return {
          key,
          type: 'variable',
          name: part.slice(1)
        };
      }

      return {
        key,
        type: 'exact',
        label: part
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

const PatternSaveQuery = (name, lines) => {
  const parsed = parseLines(lines);

  const query = `
    CREATE (patternNode:Pattern { name: {pattern}.name })
      SET pattern.id = randomUUID()
    
    WITH patternNode, pattern
    UNWIND 
  `;

  const variables = {
    pattern: {
      name
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

  lines.forEach((line, i) => {
    const lineName = `line${i}`;
    const lineParts = line.match(/@\w+|[^@]+/g);
    
    if (!lineParts) {
      return;
    }

    returns[lineName] = lineName;

    const matchPrefix = `(:Concept)<-[:TAGGED_AS]-(line${i}:Term)-[:CONTAINS_NGRAM]->`;
    const matchParts = [];
    const termRels = [];

    lineParts.forEach((_part, j) => {
      const part = _part.trim();
      const [first, ...rest] = part;
      const ngramNum = counter++;
      const ngramName = `ngram${ngramNum}`;
      const propParts = [];

      if (j === 0) {
        propParts.push('from: 0');
      }

      if (j === lineParts.length - 1) {
        propParts.push(`to: ${lineName}.size`);
      }

      // Variable match of term
      if (first === '@') {
        const varName = rest.join('');
        const propStr = propParts.length > 0 ? ` { ${propParts.join(', ')} } ` : '';

        matchParts.push(`(${ngramName}${propStr})`);
        termRels.push(`(${ngramName})-[:INSTANCE_OF]->(${varName})`);
        returns[varName] = varName;
        
        const termCondition = `(${varName}:Term)`;
        wheres[termCondition] = termCondition;
      }
      
      // Exact match of term
      else {
        const label = part;

        propParts.push(`label: {${ngramName}}`);
        variables[ngramName] = label;

        const propStr = propParts.length > 0 ? ` { ${propParts.join(', ')} } ` : '';
        
        matchParts.push(`(${ngramName}${propStr})`);
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

module.exports = {
  PatternMatchQuery
};