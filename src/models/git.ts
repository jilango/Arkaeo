export interface GitCommitRef {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface GitAuthorRef {
  hash: string;
  date: string;
  author: string;
}

export interface GitPrimaryAuthor {
  name: string;
  email: string;
  /** 0–1 fraction of commits attributed to this author */
  percentage: number;
}

export interface CoChangeRef {
  filePath: string;
  relativePath: string;
  count: number;
}

export interface GitHistory {
  firstIntroduced?: GitAuthorRef;
  lastModified?: GitAuthorRef;
  commitCount: number;
  primaryAuthor?: GitPrimaryAuthor;
  recentCommits: GitCommitRef[];
  coChangedWith?: CoChangeRef[];
}
