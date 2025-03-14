export interface Metadata {
  title?: string;
  wordCount?: number;
  readingTime?: string;
}

export interface ArticleLinks {
  [key: string]: string;
}

export interface JinaResponse {
  code: number;
  status: number;
  data: {
    title: string;
    description: string;
    url: string;
    content: string;
    links?: {
      [key: string]: string;
    };
    usage: {
      tokens: number;
    };
  };
}

// Global and command-specific preferences combined
export interface Preferences {
  // Global preferences
  includeMetadata: boolean;
  prependFrontMatter: boolean;
  includeLinksSummary: boolean;
  jinaApiKey?: string;
  
  // Browser Tab to Markdown command-specific preferences
  useClipboardFallback?: boolean;  // Default: true
  autoCopyToClipboard?: boolean;   // Default: false
  silentMode?: boolean;            // Default: false
}

export interface Arguments {
  url: string;
}
