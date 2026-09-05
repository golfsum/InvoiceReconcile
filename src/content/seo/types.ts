export type SeoSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  table?: { caption: string; headers: string[]; rows: string[][] };
};

export type ReconciliationExample = {
  label: string;
  payment: string;
  invoices: string[];
  outcome: string;
  note: string;
};

export type SeoPage = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  audience: string;
  example: ReconciliationExample;
  sections: SeoSection[];
  downloads?: Array<{ href: string; label: string; description: string }>;
  checklist: string[];
  related: Array<{ href: string; label: string; description: string }>;
  cta: string;
};

export type ResourceArticle = {
  slug: string;
  title: string;
  description: string;
  category: "How-to" | "Explainer" | "Checklist";
  readingMinutes: number;
  updated: string;
  published?: string;
  sources?: Array<{ href: string; label: string }>;
  nextSteps?: Array<{ href: string; label: string }>;
  intro: string;
  sections: SeoSection[];
  example?: ReconciliationExample;
  takeaways: string[];
  related: string[];
};

export type AudiencePage = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  painPoints: Array<{ title: string; detail: string }>;
  workflow: Array<{ title: string; detail: string }>;
  example: ReconciliationExample;
  controls: string[];
  related: Array<{ href: string; label: string }>;
};
