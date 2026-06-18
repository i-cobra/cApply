/**
 * Technology meaning-distance helpers for tailoring and ATS checks.
 * Close terms share a cluster or sit in adjacent clusters.
 * Far terms should not be forced into a tailored resume.
 */

/** @typedef {{ id: string, terms: string[] }} TechCluster */

/** @type {TechCluster[]} */
const TECH_CLUSTERS = [
  {
    id: "python",
    terms: [
      "python",
      "django",
      "flask",
      "fastapi",
      "pandas",
      "numpy",
      "scikit-learn",
      "scikit learn",
      "pytorch",
      "tensorflow",
      "jupyter",
      "pytest",
      "celery",
    ],
  },
  {
    id: "javascript",
    terms: [
      "javascript",
      "typescript",
      "node.js",
      "nodejs",
      "node",
      "react",
      "react.js",
      "next.js",
      "nextjs",
      "vue",
      "vue.js",
      "angular",
      "svelte",
      "express",
      "express.js",
      "nestjs",
      "nest.js",
      "redux",
      "webpack",
      "jest",
      "mocha",
      "cypress",
      "playwright",
      "selenium",
    ],
  },
  {
    id: "llm-ai",
    terms: [
      "ai",
      "artificial intelligence",
      "machine learning",
      "ml",
      "llm",
      "large language model",
      "generative ai",
      "genai",
      "langchain",
      "semantic kernel",
      "openai",
      "gpt",
      "chatgpt",
      "rag",
      "retrieval augmented generation",
      "vector database",
      "vector databases",
      "embeddings",
      "embedding",
      "prompt engineering",
      "hugging face",
      "huggingface",
      "llama",
      "anthropic",
      "claude",
      "nlp",
      "natural language processing",
      "llm orchestration",
      "orchestration framework",
      "model governance",
      "ai model training",
      "fine-tuning",
      "finetuning",
    ],
  },
  {
    id: "java",
    terms: [
      "java",
      "spring",
      "spring boot",
      "hibernate",
      "maven",
      "gradle",
      "kotlin",
      "jvm",
    ],
  },
  {
    id: "dotnet",
    terms: [
      ".net",
      "dotnet",
      "c#",
      "csharp",
      "asp.net",
      "aspnet",
      "entity framework",
      "blazor",
    ],
  },
  {
    id: "cloud-aws",
    terms: [
      "aws",
      "amazon web services",
      "ec2",
      "s3",
      "lambda",
      "ecs",
      "eks",
      "cloudformation",
      "dynamodb",
      "rds",
      "kms",
      "iam",
    ],
  },
  {
    id: "cloud-azure",
    terms: [
      "azure",
      "microsoft azure",
      "azure functions",
      "azure devops",
      "entra",
      "active directory",
    ],
  },
  {
    id: "cloud-gcp",
    terms: ["gcp", "google cloud", "bigquery", "cloud run", "firebase"],
  },
  {
    id: "devops",
    terms: [
      "docker",
      "kubernetes",
      "k8s",
      "ci/cd",
      "cicd",
      "jenkins",
      "github actions",
      "gitlab ci",
      "terraform",
      "ansible",
      "helm",
      "nginx",
      "linux",
      "devops",
    ],
  },
  {
    id: "data-sql",
    terms: [
      "sql",
      "mysql",
      "postgresql",
      "postgres",
      "mssql",
      "sql server",
      "oracle",
      "sqlite",
      "plsql",
      "t-sql",
    ],
  },
  {
    id: "data-nosql",
    terms: [
      "mongodb",
      "mongo",
      "redis",
      "cassandra",
      "elasticsearch",
      "dynamodb",
      "nosql",
      "couchdb",
    ],
  },
  {
    id: "api-integration",
    terms: [
      "rest",
      "rest api",
      "restful",
      "graphql",
      "grpc",
      "api",
      "apis",
      "microservices",
      "kafka",
      "rabbitmq",
      "event driven",
      "swagger",
      "openapi",
      "postman",
    ],
  },
  {
    id: "frontend",
    terms: [
      "html",
      "html5",
      "css",
      "css3",
      "tailwind",
      "tailwind css",
      "bootstrap",
      "mui",
      "material ui",
      "sass",
      "scss",
      "frontend",
      "front-end",
    ],
  },
  {
    id: "mobile",
    terms: [
      "ios",
      "android",
      "react native",
      "flutter",
      "swift",
      "kotlin mobile",
      "mobile development",
    ],
  },
  {
    id: "security",
    terms: [
      "security",
      "cybersecurity",
      "oauth",
      "oauth2",
      "jwt",
      "sso",
      "encryption",
      "hipaa",
      "soc 2",
      "penetration testing",
    ],
  },
  {
    id: "data-engineering",
    terms: [
      "spark",
      "apache spark",
      "hadoop",
      "airflow",
      "etl",
      "data pipeline",
      "data engineering",
      "snowflake",
      "databricks",
      "dbt",
    ],
  },
];

/** @type {Record<string, string[]>} */
const CLUSTER_ADJACENCY = {
  python: ["llm-ai", "data-engineering", "data-sql", "api-integration"],
  javascript: ["frontend", "api-integration", "cloud-aws", "devops", "llm-ai"],
  "llm-ai": ["python", "javascript", "data-nosql", "api-integration", "cloud-aws"],
  java: ["data-sql", "api-integration", "cloud-aws", "devops"],
  dotnet: ["cloud-azure", "data-sql", "api-integration"],
  "cloud-aws": ["devops", "data-nosql", "api-integration", "javascript", "python", "llm-ai"],
  "cloud-azure": ["dotnet", "devops", "api-integration"],
  "cloud-gcp": ["devops", "data-nosql", "api-integration"],
  devops: ["cloud-aws", "cloud-azure", "cloud-gcp", "javascript", "python", "java"],
  "data-sql": ["python", "java", "dotnet", "data-engineering"],
  "data-nosql": ["javascript", "cloud-aws", "api-integration", "llm-ai"],
  "api-integration": ["javascript", "python", "java", "dotnet", "devops"],
  frontend: ["javascript"],
  mobile: ["javascript"],
  security: ["cloud-aws", "cloud-azure", "devops", "api-integration"],
  "data-engineering": ["python", "data-sql", "cloud-aws"],
};

const CLOSE_DISTANCE_MAX = 2;
const FAR_DISTANCE_MIN = 3;

/** @type {Map<string, string>} */
const TERM_TO_CLUSTER = new Map();

for (const cluster of TECH_CLUSTERS) {
  for (const term of cluster.terms) {
    TERM_TO_CLUSTER.set(normalizeTechTerm(term), cluster.id);
  }
}

/** Sorted longest-first for greedy phrase matching. */
const KNOWN_TERMS = [...TERM_TO_CLUSTER.keys()].sort((a, b) => b.length - a.length);

/**
 * @param {string} term
 */
export function normalizeTechTerm(term) {
  return term
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} term
 * @returns {string | null}
 */
function clusterIdFor(term) {
  const normalized = normalizeTechTerm(term);
  if (TERM_TO_CLUSTER.has(normalized)) return TERM_TO_CLUSTER.get(normalized) ?? null;

  const compact = normalized.replace(/[.\s/_-]+/g, "");
  for (const [known, clusterId] of TERM_TO_CLUSTER.entries()) {
    if (known.replace(/[.\s/_-]+/g, "") === compact) return clusterId;
  }

  return null;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function technologyMeaningDistance(a, b) {
  const left = normalizeTechTerm(a);
  const right = normalizeTechTerm(b);
  if (!left || !right) return 99;
  if (left === right) return 0;

  const leftCompact = left.replace(/[.\s/_-]+/g, "");
  const rightCompact = right.replace(/[.\s/_-]+/g, "");
  if (leftCompact.length >= 3 && leftCompact === rightCompact) return 0;
  if (left.includes(right) || right.includes(left)) return 1;

  const leftCluster = clusterIdFor(left);
  const rightCluster = clusterIdFor(right);
  if (!leftCluster || !rightCluster) return 99;
  if (leftCluster === rightCluster) return 1;

  const leftAdjacent = CLUSTER_ADJACENCY[leftCluster] ?? [];
  const rightAdjacent = CLUSTER_ADJACENCY[rightCluster] ?? [];
  if (leftAdjacent.includes(rightCluster) || rightAdjacent.includes(leftCluster)) {
    return 2;
  }

  return FAR_DISTANCE_MIN;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function isCloseTechnology(a, b) {
  return technologyMeaningDistance(a, b) <= CLOSE_DISTANCE_MAX;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function isFarTechnology(a, b) {
  return technologyMeaningDistance(a, b) >= FAR_DISTANCE_MIN;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractTechTermsFromText(text) {
  const normalized = ` ${normalizeTechTerm(text)} `;
  const found = new Set();

  for (const term of KNOWN_TERMS) {
    const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9])${pattern}(?:[^a-z0-9]|$)`, "i");
    if (regex.test(normalized)) found.add(term);
  }

  return [...found];
}

/**
 * @param {string} jdTerm
 * @param {string[]} resumeTerms
 * @returns {string[]}
 */
export function getCloseTechnologyTerms(jdTerm, resumeTerms) {
  const cluster = clusterIdFor(jdTerm);
  if (!cluster) return [normalizeTechTerm(jdTerm)];

  const clusterTerms = TECH_CLUSTERS.find((item) => item.id === cluster)?.terms ?? [];
  const normalizedResume = new Set(resumeTerms.map(normalizeTechTerm));
  const close = new Set([normalizeTechTerm(jdTerm)]);

  for (const term of clusterTerms) {
    const normalized = normalizeTechTerm(term);
    if (normalizedResume.has(normalized)) close.add(normalized);
  }

  for (const resumeTerm of resumeTerms) {
    if (isCloseTechnology(jdTerm, resumeTerm)) {
      close.add(normalizeTechTerm(resumeTerm));
    }
  }

  return [...close];
}

/**
 * @typedef {{
 *   jdTerm: string,
 *   resumeTerms: string[],
 *   closeTerms: string[],
 *   distance: number
 * }} TailorIncludeTerm
 *
 * @typedef {{
 *   jdTerm: string,
 *   closestResumeTerm: string | null,
 *   distance: number
 * }} TailorExcludeTerm
 *
 * @typedef {{
 *   jdTerm: string,
 *   from: string,
 *   distance: number
 * }} TailorRewrite
 */

/**
 * @param {string[]} jdKeywords
 * @param {string} resumeText
 * @returns {{
 *   include: TailorIncludeTerm[],
 *   exclude: TailorExcludeTerm[],
 *   rewrites: TailorRewrite[]
 * }}
 */
export function planTailorKeywords(jdKeywords, resumeText) {
  const resumeTerms = extractTechTermsFromText(resumeText);
  /** @type {TailorIncludeTerm[]} */
  const include = [];
  /** @type {TailorExcludeTerm[]} */
  const exclude = [];
  /** @type {TailorRewrite[]} */
  const rewrites = [];
  const seenInclude = new Set();

  for (const jdTerm of jdKeywords) {
    const normalizedJd = normalizeTechTerm(jdTerm);
    if (!normalizedJd || seenInclude.has(normalizedJd)) continue;

    if (resumeText.toLowerCase().includes(normalizedJd)) {
      const closeTerms = getCloseTechnologyTerms(jdTerm, resumeTerms);
      include.push({
        jdTerm,
        resumeTerms: [jdTerm],
        closeTerms,
        distance: 0,
      });
      seenInclude.add(normalizedJd);
      continue;
    }

    let closest = null;
    let minDistance = 99;
    for (const resumeTerm of resumeTerms) {
      const distance = technologyMeaningDistance(jdTerm, resumeTerm);
      if (distance < minDistance) {
        minDistance = distance;
        closest = resumeTerm;
      }
    }

    if (minDistance <= CLOSE_DISTANCE_MAX) {
      const closeTerms = getCloseTechnologyTerms(jdTerm, resumeTerms);
      include.push({
        jdTerm,
        resumeTerms: closest ? [closest] : [],
        closeTerms,
        distance: minDistance,
      });
      seenInclude.add(normalizedJd);

      if (closest && minDistance > 0) {
        rewrites.push({ jdTerm, from: closest, distance: minDistance });
      }
      continue;
    }

    exclude.push({
      jdTerm,
      closestResumeTerm: closest,
      distance: minDistance,
    });
  }

  return { include, exclude, rewrites };
}

/**
 * @param {string} resumeText
 * @param {string} keyword
 */
export function resumeSupportsKeyword(resumeText, keyword) {
  const needle = normalizeTechTerm(keyword);
  if (!needle) return false;

  const haystack = resumeText.toLowerCase();
  if (haystack.includes(needle)) return true;

  const compactNeedle = needle.replace(/[.\s/_-]+/g, "");
  if (
    compactNeedle.length >= 3 &&
    haystack.replace(/[.\s/_-]+/g, "").includes(compactNeedle)
  ) {
    return true;
  }

  const resumeTerms = extractTechTermsFromText(resumeText);
  return resumeTerms.some((term) => isCloseTechnology(keyword, term));
}
