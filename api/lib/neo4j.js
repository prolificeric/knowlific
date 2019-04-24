const _ = require('lodash');
const uuid = require('uuid/v4');

const createNeo4jAdapter = ({ driver }) => {
  const executeAst = ast => {
    return transact(({ run }) => {
      return run(astToCypher(ast));
    });
  };

  const transact = async blockOrQuery => {
    const session = driver.session();
    const tx = session.beginTransaction();

    const run = ({ query, variables, processResult }) => {
      console.log(
        query
          .split('\n')
          .map((l, i) => `${i+1}: ${l}`)
          .join('\n')
      )
      return tx
        .run(query, variables)
        .then(processResult || (r => r));
    };

    let resultValue;

    try {
      resultValue = await (
        typeof blockOrQuery === 'function'
          ? blockOrQuery({ run })
          : run(blockOrQuery)
      );

      await tx.commit();
      session.close();
    } catch (err) {
      await tx.rollback();
      session.close();
      throw err;
    }

    return resultValue;
  };

  return {
    executeAst,
    transact
  };
};

const astToCypher = ast => {
  const parts = QueryParts();

  Object.keys(ast).forEach(key => {
    const handler = handlers[key];

    if (!handler) {
      throw new Error(`${key} is invalid root AST entry.`)
    }

    parts.merge(handler(ast[key]));
  });

  if (parts.returns.length === 0) {
    throw new Error('Must return at least one node');
  }

  const lines = [];

  if (parts.optionalMatches.length > 0) {
    lines.push('OPTIONAL MATCH\n  ' + parts.optionalMatches.join(',\n  '));

    if (parts.optionalWheres.length > 0) {
      lines.push('  WHERE\n    ' + parts.optionalWheres.join('\n    AND '));
    }
  }

  if (parts.matches.length > 0) {
    lines.push('MATCH\n  ' + parts.matches.join(',\n  '));

    if (parts.wheres.length > 0) {
      lines.push('  WHERE\n    ' + parts.wheres.join('\n    AND '));
    }
  }

  lines.push(...parts.nodes);
  lines.push(...parts.merges);
  lines.push(...parts.creates);
  lines.push(`RETURN ${parts.returns.join(', ')}`);

  const query = lines.join('\n');

  const processResult = result => {
    return result.records.map(record => {
      return parts.returns.reduce((obj, key) => {
        return {
          ...obj,
          [key]: record.get(key).properties
        };
      }, {});
    });
  };

  return {
    query,
    variables: parts.variables,
    processResult
  };
};

const handlers = {
  COMPOSE_ALL: all => {
    return all.map(handlers.COMPOSE);
  },
  COMPOSE: ({
    AS,
    RETURN,
    LABELED = [],
    PROPS = [],
    MERGE_ON = [],
    EDGES = []
  }, context = Context()) => {
    const nodeKey = AS || context.Key();
    const nodeDef = `${nodeKey}${LABELED.join('')}`;
    const mergeProps = {};
    const props = BaseProps();
    const parts = QueryParts();

    parts.variables[nodeKey] = { props };

    if (RETURN) {
      parts.addReturns(RETURN);
    }

    /**
     * Split props between merged and non-merged.
     */
    Object.keys(PROPS).forEach(key => {
      const value = PROPS[key];
      props[key] = value;

      if (MERGE_ON.includes(key)) {
        mergeProps[key] = value;
      }
    });

    /**
     * If there are merged properties, use MERGE cypher keyword.
     * Otherwise, just use CREATE.
     */
    if (hasKeys(mergeProps)) {
      const line = [
        `MERGE (${nodeDef}${createPropStr(nodeKey, mergeProps)})`,
        `ON CREATE SET`,
        [
          `  ${nodeKey} += {${nodeKey}}.props`,
          `  ${nodeKey}._created = timestamp()`,
          `  ${nodeKey}._updated = timestamp()`
        ].join(',\n')
      ].join('\n');

      parts.addNodes(line);
    } else {
      const line = [
        `CREATE (${nodeDef})`,
        [
          `SET ${nodeKey} += {${nodeKey}}.props`,
          `${nodeKey}._created = timestamp()`,
          `${nodeKey}._updated = timestamp()`
        ].join(', ')
      ].join(' ');

      parts.addNodes(line);
    }

    /**
     * Recurse into each edge.
     */
    EDGES.forEach(edge => {
      const {
        TYPE,
        PROPS = {},
        REF,
        COMPOSE,
        FIND,
        REVERSE = false,
        MERGE = true
      } = edge;

      if (!TYPE) {
        throw new Error(`TYPE expected.`);
      }

      const edgeDef = `:${TYPE}`;
        
      const edgeStr = REVERSE
        ? `<-[${edgeDef}]-`
        : `-[${edgeDef}]->`;

      if (REF) {
        parts.addCreates(`${MERGE ? 'MERGE' : 'CREATE'} (${nodeKey})${edgeStr}(${REF})`);
        return;
      }

      const otherNode = FIND
        ? handlers.FIND(FIND, context)
        : handlers.COMPOSE(COMPOSE, context);

      const edgeCypher = `(${nodeKey})${edgeStr}(${otherNode.nodeKey})`;

      parts.merge(otherNode);

      if (MERGE) {
        parts.addMerges(`MERGE ${edgeCypher}`);
      } else {
        parts.addCreates(`CREATE ${edgeCypher}`);
      }
    });

    return {
      nodeKey,
      nodeDef,
      mergeProps,
      props,
      ...parts
    };
  },
  FIND: ({
    AS,
    RETURN,
    LABELED = [],
    AND = [],
    OR = [],
    ...rest
  }, context = Context()) => {
    const nodeKey = AS || context.Key();
    const nodeDef = `${nodeKey}${LABELED.join('')}`;
    const parts = QueryParts();
    const conditionsSet = hasKeys(rest) ? [rest].concat(AND) : AND;

    if (RETURN) {
      parts.addReturns(RETURN);
    }

    const parsePropConditions = (propKey, varKey, propConditions) => {
      Object.keys(propConditions).forEach(opName => {
        const operator = operators[opName];

        if (!operator) {
          return;
        }

        const value = propConditions[opName];

        _.set(parts.variables, [varKey, opName], value);

        if (typeof value === 'object' && value.LITERAL) {
          parts.addWheres(operator(propKey, value.LITERAL));
          return;
        }

        parts.addWheres(operator(propKey, varKey));
      });
    };

    conditionsSet.forEach((conditions, i) => {
      const {
        AND = [],
        OR = [],
        NOT = [],
        PROPS = {},
        EDGES = []
      } = conditions;

      [].concat(NOT).forEach(subconditions => {
        const inner = handlers.FIND(subconditions, context);

        parts.addMatches(inner.matches);
        parts.addOptionalWheres(inner.wheres);
        parts.addVariables(inner.variables);

        (subconditions.EDGES || []).forEach(edge => {
          const edgeStr = edge.REVERSE ? `<-[:${edge.TYPE}]-` : `-[:${edge.TYPE}]->`;
          parts.addWheres(`(NOT (${nodeKey})${edgeStr}(${inner.nodeKey}))`);
        });
      });

      EDGES.forEach((edge, i) => {
        const {
          TYPE,
          PROPS = {},
          REVERSE = false,
          FIND = {}
        } = edge;

        const edgeKey = context.Key();
        const inner = handlers.FIND(FIND, context);
        const edgeStr = REVERSE ? `<-[${edgeKey}:${TYPE}]-` : `-[:${TYPE}]->`;

        Object.keys(PROPS).forEach(key => {
          const propKey = `${edgeKey}.${key}`;
          const varKey = `${nodeKey}_EDGE_${i}_${key}`;
          parsePropConditions(propKey, varKey, PROPS[key]);
        });

        parts.merge(inner);
        parts.addMatches(`(${nodeKey})${edgeStr}(${inner.nodeKey})`);
      });

      Object.keys(PROPS).forEach(key => {
        const propKey = `${nodeKey}.${key}`;
        const varKey = `${nodeKey}_WHERE_${i}_${key}`;
        parsePropConditions(propKey, varKey, PROPS[key]);
      });
    });

    return {
      nodeKey,
      nodeDef,
      ...parts,
      matches: parts.matches.length > 0 ? parts.matches : [`(${nodeDef})`]
    };
  }
};

const QueryParts = () => {
  const parts = {
    matches: [],
    nodes: [],
    creates: [],
    merges: [],
    wheres: [],
    optionalMatches: [],
    optionalWheres: [],
    returns: [],
    variables: {}
  };

  const methods = {};

  // Add methods
  Object.keys(parts).forEach(key => {
    const methodName = _.camelCase(`add_${key}`);

    methods[methodName] = (...args) => {
      if (Array.isArray(parts[key])) {
        parts[key].push(..._.flatten(args));
      } else {
        Object.assign(parts[key], ...args);
      }
    };
  });

  // Merge method
  methods.merge = other => {
    Object.keys(other).forEach(key => {
      const methodName = _.camelCase(`add_${key}`);
      const method = methods[methodName];

      if (!method) {
        return;
      }

      const otherValue = other[key];

      methods[methodName](otherValue);
    });

    return parts;
  };

  return {
    ...parts,
    ...methods
  };
};

const Context = () => {
  const Key = (function () {
    let id = 0;
    return () => `anon_${id++}`;
  }());

  return {
    Key
  };
};

const createPropStr = (nodeKey, props) => {
  const inner = Object.keys(props).map(key => {
    return `${key}: {${nodeKey}}.props.${key}`;
  }).join(', ');

  return inner.length > 0
    ? ` { ${inner} }`
    : '';
};

const hasKeys = obj => {
  return Object.keys(obj).length > 0;
};

const BaseProps = () => ({
  id: uuid()
});

const operators = {
  EQ: (propKey, varKey) => `${propKey} = {${varKey}}.EQ`,
  NOT_EQ: (propKey, varKey) => `${propKey} <> {${varKey}}.NOT_EQ`,
  IN: (propKey, varKey) => `${propKey} IN {${varKey}}.IN`,
  NOT_IN: (propKey, varKey) => `NOT ${propKey} IN {${varKey}}.NOT_IN`,
  LT: (propKey, varKey) => `${propKey} < {${varKey}}.LT`,
  LTE: (propKey, varKey) => `${propKey} <= {${varKey}}.LTE`,
  GT: (propKey, varKey) => `${propKey} > {${varKey}}.GT`,
  GTE: (propKey, varKey) => `${propKey} >= {${varKey}}.GTE`,
  NULL: propKey => `${propKey} IS NULL`,
  NOT_NULL: propKey => `NOT ${propKey} IS NULL`
};

module.exports = {
  createNeo4jAdapter,
  astToCypher
};