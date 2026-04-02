export interface TagCandidate {
  tag: string;
  score: number;
  source: 'keyword' | 'tfidf' | 'rake' | 'bigram' | 'manual' | 'code_id';
}

export interface CorpusStats {
  totalDocuments: number;
  documentFrequency: Map<string, number>;
}

export interface WeightedToken {
  term: string;
  zone: 'title' | 'heading' | 'code' | 'inline_code' | 'body';
  weight: number;
}

export interface RakePhrase {
  phrase: string;
  score: number;
  words: string[];
}

export interface TagResult {
  tags: TagCandidate[];
  keyphrases: RakePhrase[];
}

export interface CorpusIndex {
  documentCount: number;
  idf: Map<string, number>;
}
