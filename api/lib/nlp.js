const wink = require('wink-nlp-utils');

exports.parsePatternLineChunks = line => {
  return (line.match(/(@\w+|[^@]+)/g) || []).map(chunk => chunk.trim());
};

exports.createTokenSequence = tokens => {
  return tokens.map((token, i) => {
    return {
      index: i,
      nextIndex: i + 1,
      label: token
    };
  });
};

exports.parseAllNgrams = tokens => {
  if (typeof tokens === 'string') {
    return exports.parseAllNgrams(exports.parseTokens(tokens));
  }

  return exports.parseNgrams({
    min: 1,
    max: tokens.length
  }, tokens);
};

exports.parseNgrams = ({ min = 1, max = 4 }, tokens) => {
  const ngrams = [];

  tokens.forEach((__, from) => {
    for (let n = min; n <= max; n += 1) {
      const sliced = tokens.slice(from, from + n);

      if (sliced.length < n) return;

      ngrams.push({
        index: from,
        nextIndex: from + n,
        size: n,
        tokens: sliced,
        label: exports.joinTokens(sliced)
      });
    }
  });

  return ngrams;
};

exports.serializeTokens = tokens => {
  return tokens.join('');
};

exports.hashSound = token => {
  return wink.string.phonetize(token);
};

exports.clean = str => {
  return str.toLowerCase();
};

exports.getSearchHashes = tokens => {
  if (typeof tokens === 'string') {
    tokens = exports.parseTokens(tokens);
  }

  const { serializeTokens, hashSound } = exports;
  const lc = tokens.map(token => token.toLowerCase());
  const sorted = lc.slice().sort();
  const stemmed = exports.stemTokens(sorted);
  const stopped = exports.removeStopWords(sorted);
  const sounded = sorted.map(exports.hashSound);
  const stoppedAndStemmed = exports.stemTokens(stopped);

  return {
    lowercase: lc.join(' '),
    rawHash: lc.join('_'),
    sortedHash: serializeTokens(sorted),
    soundHash: serializeTokens(sounded),
    stopHash: serializeTokens(stopped),
    stemHash: serializeTokens(stemmed),
    stopAndStemHash: serializeTokens(stoppedAndStemmed),
    stopAndSoundHash: serializeTokens(stopped.map(hashSound)),
    stemAndSoundHash: serializeTokens(stemmed.map(hashSound)),
    aggressiveHash: serializeTokens(stoppedAndStemmed.map(hashSound))
  };
};

exports.stemTokens = tokens => {
  return wink.tokens.stem(tokens);
};

exports.removeStopWords = tokens => {
  return wink.tokens.removeWords(tokens);
};

exports.joinTokens = tokens => {
  return tokens.join(' ');
};

exports.parseTokens = str => {
  const cleaned = wink.string.retainAlphaNums(str);
  return wink.string.tokenize0(cleaned);
};