const nlp = require('../nlp');

const TermSaveQuery = rawLabel => {
  const { allTerms, rootTerm } = createTermTree(rawLabel);

  const mappedAndSortedTerms = allTerms
    .map(term => {
      return {
        props: {
          label: term.label,
          size: term.size,
          ...term.hashes
        },
        ngrams: term.ngrams
          .map(mapNgramToParam)
          .sort((a, b) => a.props.size - b.props.size)
      };
    })
    .sort((a, b) => {
      return a.props.size - b.props.size;
    });

  const query = `
    UNWIND {terms} AS term
      MERGE (termNode:Term { label: term.props.label })
        ON CREATE SET termNode.id = randomUUID(), termNode += term.props
      WITH term, termNode
      UNWIND term.ngrams AS ngram
        MATCH (childTermNode:Term { label: ngram.props.label })
        MERGE (termNode)-[:CONTAINS_TERM]->(childTermNode)
        MERGE (termNode)-[:CONTAINS_NGRAM]->(ngramNode:Ngram { from: ngram.props.from, to: ngram.props.to })
          ON CREATE SET ngramNode += ngram.props
        MERGE (ngramNode)-[:INSTANCE_OF]->(childTermNode)
        WITH termNode, ngramNode, ngram
        UNWIND ngram.next AS nextNgram
          MERGE (termNode)-[:CONTAINS_NGRAM]->(nextNgramNode:Ngram { from: nextNgram.props.from, to: nextNgram.props.to })
          MERGE (ngramNode)-[:NEXT_NGRAM]->(nextNgramNode)
    RETURN DISTINCT termNode
  `;

  const variables = {
    terms: mappedAndSortedTerms
  };

  const processResult = result => {
    const record = result.records.find(record => {
      const { properties } = record.get('termNode');
      return properties.label === rootTerm.label;
    }) || null;

    console.log(result)

    return record && record.get('termNode').properties;
  };

  return {
    query,
    variables,
    processResult
  };
};

const mapNgramToParam = ({ label, from, to, size, next }) => {
  return {
    props: {
      label,
      from,
      to,
      size
    },
    next: next.map(mapNgramToParam)
  };
};

const createTermTree = (rawLabel, termIndex = {}) => {
  const { lowercase: label, ...hashes } = nlp.getSearchHashes(rawLabel);

  if (termIndex[label]) {
    return termIndex[label];
  }

  const tokens = nlp.parseTokens(label);
  const ngrams = [];
  const ngramsByPosition = {};

  for (let from = tokens.length - 1; from >= 0; from -= 1) {
    const position = ngramsByPosition[from] = [];

    for (let to = from + 1; to <= tokens.length && to - from < tokens.length; to += 1) {
      const size = to - from;
      const subset = tokens.slice(from, to);
      const sublabel = subset.join(' ');
      const subtree = createTermTree(sublabel, termIndex);
      const subterm = subtree.rootTerm;

      termIndex[sublabel] = subtree;

      const ngram = {
        label: sublabel,
        tokens: subset,
        from,
        to,
        size,
        isLeading: from === 0,
        isTerminal: to === tokens.length,
        next: ngramsByPosition[to] || [],
        term: subterm
      };

      ngrams.push(ngram);
      position.push(ngram);
    }
  }

  const rootTerm = {
    label,
    hashes,
    ngrams,
    tokens,
    size: tokens.length
  };

  const allTerms = Object.values(termIndex)
    .map(subtree => subtree.rootTerm)
    .concat(rootTerm);

  return {
    allTerms,
    rootTerm
  };
};

module.exports = {
  TermSaveQuery,
  createTermTree
};