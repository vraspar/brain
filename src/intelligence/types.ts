export interface TagCandidate {
  tag: string;
  score: number;
  source: 'keyword' | 'tfidf' | 'bigram' | 'manual';
}

export interface CorpusStats {
  totalDocuments: number;
  documentFrequency: Map<string, number>;
}
