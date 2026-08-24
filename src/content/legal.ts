export const LEGAL_EFFECTIVE_DATE = "August 23, 2026";
export const SUPPORT_EMAIL = "support@invoicereconcile.com";

export const OWNER_REVIEW = {
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() || "InvoiceReconcile",
  businessAddress: process.env.NEXT_PUBLIC_LEGAL_BUSINESS_ADDRESS?.trim() || "",
  governingLaw: process.env.NEXT_PUBLIC_LEGAL_GOVERNING_LAW?.trim() || "",
  courtVenue: process.env.NEXT_PUBLIC_LEGAL_COURT_VENUE?.trim() || "",
} as const;

export const LEGAL_OWNER_REVIEW_REQUIRED = !(
  process.env.NEXT_PUBLIC_LEGAL_NAME?.trim()
  && OWNER_REVIEW.businessAddress
  && OWNER_REVIEW.governingLaw
  && OWNER_REVIEW.courtVenue
);

const operatorDescription = OWNER_REVIEW.businessAddress
  ? `${OWNER_REVIEW.legalEntity}, at ${OWNER_REVIEW.businessAddress}`
  : OWNER_REVIEW.legalEntity;

export type LegalCallout = {
  title: string;
  text: string;
  tone?: "info" | "warning";
};

export type LegalTable = {
  headers: string[];
  rows: string[][];
};

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
  afterParagraphs?: string[];
  table?: LegalTable;
  callout?: LegalCallout;
};

export type LegalDocument = {
  slug: "terms" | "privacy" | "security" | "contact";
  title: string;
  eyebrow: string;
  description: string;
  seoDescription: string;
  effectiveDate: string;
  intro: string[];
  sections: LegalSection[];
};

const ownerReviewNotice: LegalCallout = {
  title: "Owner review required before publication",
  text:
    "Set the legal entity, business address, governing law, and court venue environment values to the operator details approved by counsel before launch.",
  tone: "warning",
};

export const termsContent: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  eyebrow: "Legal",
  description: "The rules for using InvoiceReconcile and its reconciliation services.",
  seoDescription:
    "Read the InvoiceReconcile Terms of Service, including account, subscription, acceptable use, and financial verification terms.",
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    `These Terms of Service are a contract between you and ${OWNER_REVIEW.legalEntity} ("InvoiceReconcile," "we," "us," or "our"). They govern your access to invoicereconcile.com, the InvoiceReconcile application, and related services, documentation, and support (collectively, the "Service").`,
    'By creating an account, clicking to accept these Terms, or using the Service, you agree to these Terms. If you use the Service for an organization, you represent that you have authority to bind that organization, and "you" includes that organization.',
  ],
  sections: [
    {
      id: "owner-review",
      title: "Publication notice",
      callout: ownerReviewNotice,
    },
    {
      id: "eligibility",
      title: "1. Eligibility and authority",
      paragraphs: [
        "You must be at least 18 years old and legally able to enter into a contract. The Service is intended for businesses and professionals, not for personal, family, or household use.",
        "If your organization gives you an account or adds you to a workspace, the organization may control that account, manage your access, view activity within its workspace, and remove your access. You are responsible for following your organization's instructions and policies.",
      ],
    },
    {
      id: "service",
      title: "2. What the Service does",
      paragraphs: [
        "InvoiceReconcile helps users import invoice and incoming-payment data, identify possible matches, review exceptions, confirm reconciliation decisions, and export results. The Service is a reconciliation aid. It is not a general ledger, bank, payment processor, money transmitter, accounting firm, or replacement for your accounting system.",
        "Match suggestions, confidence labels, explanations, calculations, and exports may be incomplete or incorrect because of source-data quality, configuration, third-party systems, or software limitations. You remain in control of what is confirmed and exported.",
      ],
      callout: {
        title: "Verify before relying",
        text: "InvoiceReconcile does not provide accounting, tax, investment, legal, or other professional advice. You are responsible for reviewing source records, match suggestions, discrepancies, and exports before posting entries, closing books, filing reports, making payments, or otherwise relying on them.",
        tone: "warning",
      },
    },
    {
      id: "accounts",
      title: "3. Accounts and workspaces",
      items: [
        "Provide accurate account and billing information and keep it current.",
        "Protect your login credentials, use appropriate access controls, and notify us promptly at support@invoicereconcile.com if you suspect unauthorized access.",
        "Use separate user access for each person. Do not share credentials.",
        "Assign workspace roles carefully and remove access when it is no longer needed.",
        "You are responsible for activity under your account except to the extent caused by our breach of these Terms or failure to use reasonable security measures.",
      ],
    },
    {
      id: "customer-content",
      title: "4. Customer Content",
      paragraphs: [
        '"Customer Content" means invoices, payment records, bank descriptions, files, customer or payer details, review notes, and other data submitted to or generated through your use of the Service.',
        "As between you and InvoiceReconcile, you retain ownership of Customer Content. You grant us a limited, worldwide, non-exclusive license to host, copy, process, transmit, display, and create technical derivatives of Customer Content only as needed to provide, secure, support, and improve the Service, comply with law, and follow your instructions.",
        "You represent that you have all rights, notices, permissions, and lawful bases needed for us to process Customer Content as described in these Terms and the Privacy Policy. You must not upload login credentials, complete payment-card data, or other information the Service does not request.",
        "We do not use Customer Content to train general-purpose artificial intelligence models unless you give express written permission for that separate use.",
      ],
    },
    {
      id: "privacy-security",
      title: "5. Privacy and security",
      paragraphs: [
        "Our Privacy Policy explains how we handle personal information when we act for our own purposes. When we process personal information in Customer Content on your behalf, you generally act as the controller or business and we act as your processor, service provider, or contractor, as applicable.",
        "We use reasonable administrative, technical, and organizational safeguards designed for the nature of the Service. No security measure can eliminate every risk. You are responsible for configuring your workspace, devices, integrations, and exports securely.",
        `Contact ${SUPPORT_EMAIL} to request our data processing terms or report a suspected security issue.`,
      ],
    },
    {
      id: "subscriptions",
      title: "6. Plans, billing, and automatic renewal",
      paragraphs: [
        "Some features are free and others require a paid subscription. Current plan limits, prices, billing intervals, and included features are shown at checkout or in your order form. Taxes may apply.",
        "Paid subscriptions renew automatically for successive periods matching the selected billing interval until canceled. Before you subscribe, we will show the recurring price, billing frequency, and how to cancel. By subscribing, you authorize our payment processor to charge the payment method on file at each renewal.",
        "If payment fails, we may retry the charge, ask you to update the payment method, limit paid features, or suspend the paid subscription after reasonable notice. Usage above a plan limit may be blocked or require an upgrade only if disclosed before you incur a charge.",
        "We may change plan prices or features prospectively. We will give advance notice of a price increase or material adverse subscription change when required by law. The change will apply no earlier than your next renewal after the notice period.",
      ],
    },
    {
      id: "cancellation",
      title: "7. Cancellation and refunds",
      paragraphs: [
        "You may cancel a paid subscription at any time through the online billing settings. You may also contact support@invoicereconcile.com if you cannot access the online cancellation control. We will not require a sales call or impose unnecessary steps to cancel.",
        "Cancellation stops future renewals. Unless law or an order form says otherwise, you keep paid access through the end of the current billing period and previously paid fees are not automatically refunded. We will provide refunds or credits when required by law or expressly stated in an applicable order form.",
        "Deleting a workspace or account is separate from canceling a subscription. Export data you need before deletion or the end of your access period.",
      ],
    },
    {
      id: "acceptable-use",
      title: "8. Acceptable use",
      paragraphs: ["You may not use the Service to:"],
      items: [
        "Break the law, violate another person's rights, or process data without appropriate authority.",
        "Upload malware or harmful code, probe or disrupt systems, bypass access controls, or attempt unauthorized access.",
        "Interfere with other customers, overload the Service, or use automated means that create unreasonable traffic.",
        "Reverse engineer, decompile, or attempt to derive source code except where applicable law does not allow that restriction.",
        "Resell, sublicense, or provide the Service as a standalone service unless an order form permits it.",
        "Use the Service to develop or benchmark a competing product for publication without our written permission.",
        "Upload complete card numbers, online-banking passwords, authentication secrets, government identifiers, health data, or other highly sensitive data that the Service does not request.",
        "Misrepresent match suggestions as independently audited, guaranteed, or professional advice.",
      ],
    },
    {
      id: "integrations",
      title: "9. Third-party services and integrations",
      paragraphs: [
        "You may choose to connect third-party services or import their files. Your use of a third-party service is governed by its terms and privacy practices. You authorize us to exchange data with a connected service as needed to follow your instructions.",
        "We are not responsible for a third-party service, its availability, its changes, or data it provides. We will not represent an integration as live unless it is actually connected and available to you.",
      ],
    },
    {
      id: "intellectual-property",
      title: "10. Intellectual property",
      paragraphs: [
        "InvoiceReconcile and its licensors own the Service, including its software, interfaces, documentation, matching methods, and branding, except for Customer Content and third-party materials. Subject to these Terms and payment of applicable fees, we grant you a limited, non-exclusive, non-transferable, revocable right to use the Service for your internal business purposes during the subscription term.",
        "If you provide feedback, you grant us a perpetual, irrevocable, worldwide, royalty-free right to use it without restriction or compensation. This does not give us ownership of Customer Content or permission to identify you publicly.",
      ],
    },
    {
      id: "suspension-termination",
      title: "11. Suspension and termination",
      paragraphs: [
        "You may stop using the Service at any time. We may suspend or terminate access if you materially breach these Terms, create a security or legal risk, fail to pay applicable fees, or use the Service in a way that could harm the Service or others. When practical, we will provide notice and a reasonable opportunity to cure.",
        "We may discontinue the Service or a material feature. If we discontinue a paid Service before the end of a prepaid term for reasons unrelated to your breach, we will provide a prorated refund for the unused period.",
        "After termination, provisions that by their nature should survive will remain in effect, including ownership, payment obligations, disclaimers, liability limits, dispute terms, and general provisions. Data handling after termination is described in the Privacy Policy and any applicable data processing agreement.",
      ],
    },
    {
      id: "disclaimers",
      title: "12. Disclaimers",
      paragraphs: [
        "To the fullest extent permitted by law, the Service is provided " +
          '"as is" and "as available." We disclaim implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, and any warranty arising from course of dealing or usage of trade.',
        "We do not warrant that every payment will match, that a suggested match is correct, that source data is accurate, that exports will be accepted by another system, or that the Service will be uninterrupted or error-free. Nothing in these Terms excludes warranties or rights that cannot lawfully be excluded.",
      ],
    },
    {
      id: "liability",
      title: "13. Limitation of liability",
      paragraphs: [
        "To the fullest extent permitted by law, neither party will be liable for indirect, incidental, special, exemplary, punitive, or consequential damages, or for lost profits, revenue, goodwill, or data, even if advised that such damages were possible.",
        "To the fullest extent permitted by law, each party's total aggregate liability arising out of or related to the Service or these Terms will not exceed the greater of: (a) the fees you paid or owed for the Service during the 12 months before the event giving rise to liability; or (b) US $100 if you used only a free Service.",
        "These limits do not apply to liability that cannot legally be limited, or to your payment obligations, your violation of our intellectual property rights, or either party's fraud, gross negligence, or willful misconduct. Some jurisdictions do not allow certain exclusions or limits, so parts of this section may not apply to you.",
      ],
    },
    {
      id: "indemnity",
      title: "14. Indemnification",
      paragraphs: [
        "To the extent permitted by law, you will defend and indemnify InvoiceReconcile and its personnel against third-party claims, damages, and reasonable costs arising from Customer Content, your unlawful use of the Service, or your material breach of Sections 4 or 8. We will promptly notify you of a covered claim and reasonably cooperate. You may not settle a claim in a way that admits fault by us or imposes obligations on us without our written consent.",
      ],
    },
    {
      id: "changes",
      title: "15. Changes to these Terms",
      paragraphs: [
        "We may update these Terms to reflect changes to the Service, law, or business operations. We will post the updated Terms and change the effective date. If a change materially reduces your rights, we will provide advance notice through the Service or by email when required. Continued use after the effective date means you accept the updated Terms. If you do not agree, you must stop using the Service and cancel before the change takes effect.",
      ],
    },
    {
      id: "disputes",
      title: "16. Disputes, governing law, and venue",
      paragraphs: [
        `Before filing a formal claim, you and ${OWNER_REVIEW.legalEntity} agree to try to resolve the dispute informally for 30 days. Send a written description of the issue and requested resolution to ${SUPPORT_EMAIL}. This does not prevent either party from seeking urgent injunctive relief or meeting a legal filing deadline.`,
        ...(OWNER_REVIEW.governingLaw && OWNER_REVIEW.courtVenue
          ? [`These Terms are governed by the laws of ${OWNER_REVIEW.governingLaw}, without regard to conflict-of-law rules. Courts located in ${OWNER_REVIEW.courtVenue} will have exclusive jurisdiction, except where applicable law gives you the right to bring a claim elsewhere.`]
          : []),
      ],
      callout: LEGAL_OWNER_REVIEW_REQUIRED ? {
        title: "Counsel decision required",
        text: "The operator must select governing law and venue based on the actual legal entity and customer footprint. No arbitration or class-action waiver is included in this draft.",
        tone: "warning",
      } : undefined,
    },
    {
      id: "general",
      title: "17. General terms",
      paragraphs: [
        "These Terms, the Privacy Policy, any applicable data processing agreement, and any order form are the entire agreement about the Service. An order form controls only where it expressly overrides these Terms. If one provision is unenforceable, the rest remain in effect. A failure to enforce a provision is not a waiver.",
        "You may not assign these Terms without our written consent, except in connection with a merger, acquisition, or sale of substantially all of your assets if the assignee agrees to these Terms. We may assign these Terms as part of a merger, acquisition, reorganization, or sale of the Service or relevant assets.",
        "Neither party is liable for delay or failure caused by events beyond its reasonable control, except for payment obligations. Headings are for convenience only. The word " +
          '"including" means "including without limitation." Electronic notices and acceptance may be used to the extent permitted by law.',
      ],
    },
    {
      id: "contact",
      title: "18. Contact",
      paragraphs: [
        `Questions about these Terms may be sent to ${SUPPORT_EMAIL}. The contracting party is ${operatorDescription}.`,
      ],
    },
  ],
};

export const privacyContent: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  eyebrow: "Legal",
  description: "How InvoiceReconcile collects, uses, shares, retains, and protects personal information.",
  seoDescription:
    "Learn how InvoiceReconcile handles account, billing, usage, support, invoice, payment, and reconciliation information.",
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    `This Privacy Policy explains how ${OWNER_REVIEW.legalEntity} ("InvoiceReconcile," "we," "us," or "our") handles personal information through invoicereconcile.com, the InvoiceReconcile application, and related services.`,
    "It also explains the choices and privacy rights available to individuals. This policy does not apply to third-party services that have their own privacy policies.",
  ],
  sections: [
    {
      id: "owner-review",
      title: "Publication notice",
      callout: ownerReviewNotice,
    },
    {
      id: "roles",
      title: "1. Our privacy roles",
      paragraphs: [
        "For account registration, billing, website analytics, security, support, and our own business operations, InvoiceReconcile determines why and how personal information is processed. In those contexts, we act as a controller or business under applicable privacy law.",
        "For personal information contained in invoices, payment files, bank descriptions, customer records, and other Customer Content submitted by a customer, the customer generally determines why the information is processed. In those contexts, the customer acts as the controller or business, and InvoiceReconcile acts as its processor, service provider, or contractor. Requests about Customer Content should normally be directed to the organization that uploaded it. We will assist that organization as required by contract and law.",
      ],
    },
    {
      id: "collection",
      title: "2. Information we collect",
      table: {
        headers: ["Category", "Examples", "Primary sources"],
        rows: [
          [
            "Account and identity information",
            "Name, business email, authentication identifier, organization, workspace membership, role, timezone, and preferences.",
            "You, your workspace administrator, and authentication providers you choose.",
          ],
          [
            "Customer Content and financial workflow data",
            "Invoices, customer and payer names or contact details, payment amounts and dates, balances, transaction references, bank descriptions, account labels, memos, source values, and imported files.",
            "You, your organization, files you upload, and integrations you direct us to connect.",
          ],
          [
            "Reconciliation and derived data",
            "Normalized values, duplicate indicators, match candidates, confidence categories, reasons, discrepancies, approvals, rejections, notes, and exports.",
            "Generated from Customer Content and your actions in the Service.",
          ],
          [
            "Billing and commercial information",
            "Plan, subscription status, billing interval, transaction status, tax-related details, payment-processor customer identifiers, and limited payment-method details such as brand and last four digits.",
            "You and our payment processor. We do not receive or store complete payment-card numbers.",
          ],
          [
            "Device and usage information",
            "IP address, device and browser type, operating system, pages or features used, referral source, approximate region, timestamps, session events, and error diagnostics.",
            "Collected automatically from your browser, device, cookies, and similar technologies.",
          ],
          [
            "Support and communications",
            "Support requests, feedback, survey responses, attachments, and communications with us.",
            "You and your organization.",
          ],
          [
            "Security and audit information",
            "Sign-in events, access changes, import and export events, reconciliation actions, administrative actions, suspected fraud signals, and security logs.",
            "Your use of the Service, administrators, and our security systems.",
          ],
        ],
      },
      paragraphs: [
        "Please do not submit passwords, authentication secrets, complete payment-card numbers, Social Security numbers, government identifiers, health data, or other highly sensitive information unless a specific secure feature expressly requests it.",
      ],
    },
    {
      id: "uses-bases",
      title: "3. How and why we use information",
      table: {
        headers: ["Purpose", "Examples", "EEA and UK legal basis when applicable"],
        rows: [
          [
            "Provide the Service",
            "Create accounts, import and normalize data, suggest matches, support review, preserve decisions, create audit history, and generate exports.",
            "Perform our contract with you. For Customer Content, follow the customer's documented instructions as its processor.",
          ],
          [
            "Operate and support accounts",
            "Authenticate users, manage workspaces and roles, provide support, and send service messages.",
            "Perform our contract and pursue our legitimate interest in operating and supporting the Service.",
          ],
          [
            "Billing",
            "Process subscriptions, payments, invoices, taxes, cancellations, and account status.",
            "Perform our contract and comply with legal obligations.",
          ],
          [
            "Security and abuse prevention",
            "Protect accounts, enforce access controls, investigate suspicious activity, prevent fraud, and maintain audit records.",
            "Our legitimate interests in protecting the Service and users, and compliance with legal obligations.",
          ],
          [
            "Improve the Service",
            "Diagnose errors, measure feature performance, understand aggregate usage, and improve workflows without using Customer Content to train general-purpose AI models.",
            "Our legitimate interests in maintaining and improving the Service. Consent where law requires it for analytics technologies.",
          ],
          [
            "Communicate",
            "Send requested support responses, operational notices, optional product updates, and optional summaries.",
            "Perform our contract, pursue legitimate interests, or obtain consent, depending on the communication.",
          ],
          [
            "Comply and protect",
            "Meet legal obligations, respond to lawful process, exercise or defend legal claims, and protect people, rights, and property.",
            "Compliance with legal obligations and our legitimate interests in protecting rights and resolving disputes.",
          ],
        ],
      },
      paragraphs: [
        "Where we rely on legitimate interests, we consider the impact on individuals and do not use that basis where their rights and interests outweigh ours. Where we rely on consent, you may withdraw it at any time without affecting earlier processing.",
      ],
    },
    {
      id: "automated-processing",
      title: "4. Reconciliation suggestions and automated processing",
      paragraphs: [
        "The Service uses rules and software-assisted analysis to generate match candidates, confidence categories, duplicate indicators, and explanations. These outputs are recommendations for review. The Service is designed to require user confirmation before a reconciliation is finalized or exported.",
        "We do not use these suggestions to make solely automated decisions about individuals that produce legal or similarly significant effects. Customers remain responsible for their own decisions and for responding to requests about their use of Customer Content.",
      ],
    },
    {
      id: "sharing",
      title: "5. How we disclose information",
      paragraphs: ["We may disclose personal information to the following recipients for the stated purposes:"],
      items: [
        "Infrastructure and service providers that support hosting, storage, authentication, email, analytics, customer support, security, error monitoring, and similar operations. They may process information only for contracted purposes.",
        "Payment processors and billing providers that process subscriptions and related transactions.",
        "Third-party integrations when you direct us to connect, import, or export data.",
        "Other users and administrators in the same organization or workspace according to configured permissions.",
        "Professional advisers, auditors, insurers, and financial institutions where reasonably necessary for business operations and subject to appropriate duties of confidentiality.",
        "Government authorities or other parties when we reasonably believe disclosure is required by law, lawful process, or necessary to protect rights, safety, security, or the integrity of the Service.",
        "A buyer, investor, successor, or other participant in a merger, financing, reorganization, bankruptcy, or sale of all or part of the business, subject to appropriate confidentiality protections.",
        "Other recipients when you request or consent to the disclosure.",
      ],
      afterParagraphs: [
        "We do not sell personal information for money. We do not share personal information for cross-context behavioral advertising. We do not use or disclose sensitive personal information to infer characteristics about individuals.",
        "We may use and disclose aggregated or de-identified information where we take reasonable measures to prevent it from being associated with an individual and do not attempt to re-identify it.",
      ],
    },
    {
      id: "retention",
      title: "6. Retention and deletion",
      paragraphs: [
        "We keep personal information only as long as reasonably necessary for the purposes described in this policy, including providing and securing the Service, meeting legal obligations, resolving disputes, and enforcing agreements. The criteria below describe how retention is determined. We do not publish a fixed deletion period that our current systems cannot verify.",
      ],
      table: {
        headers: ["Data", "Retention approach"],
        rows: [
          [
            "Original invoice and payment file bytes",
            "Files of up to 2 MiB that use the synchronous request path are processed in request memory without a deliberate application-storage copy. The background path stores source bytes temporarily in a private bucket so work can continue safely after you leave the page. A signed upload capability may remain valid for about two hours, so deletion stays pending until that capability has expired. After processing, permanent preview failure, or a user deletion request, removal is scheduled as soon as the capability-safe time is reached. The 24-hour lifecycle schedules cleanup for every remaining source, and provider failures are retried until deletion is confirmed. Structured values created from a file remain Customer Content under the retention approach below.",
          ],
          [
            "Structured Customer Content, reconciliation records, configured rules where enabled, and audit history",
            "Retained while the workspace is active and afterward only as needed to complete a verified deletion request, preserve customer-requested records, meet legal or contractual duties, resolve disputes, prevent fraud, or protect the Service.",
          ],
          [
            "Account profile and workspace membership",
            "Retained while the account or workspace relationship is active and afterward only for account recovery, security, legal compliance, dispute resolution, or another documented operational need.",
          ],
          [
            "Security, access, and application logs",
            "Retained for the shortest period reasonably needed to operate and secure the Service, investigate incidents, prevent abuse, and satisfy applicable legal obligations. Provider-specific log lifecycles may apply.",
          ],
          [
            "Support records",
            "Retained while a request is open and afterward as reasonably needed to document the response, improve support, resolve disputes, or meet legal obligations.",
          ],
          [
            "Billing, tax, and contract records",
            "Retained for the period required by tax, accounting, payment, contract, and automatic-renewal laws and for related dispute or fraud-prevention needs.",
          ],
          [
            "Backups",
            "Deleted information may remain in restricted backups until the applicable provider backup cycle expires. Backups are not restored for ordinary use and may be isolated longer when required for security, legal hold, or disaster recovery.",
          ],
        ],
      },
      afterParagraphs: [
        "A workspace or organization cannot be deleted while a private source object is awaiting confirmed removal. You can request source removal from Imports, then delete the workspace after the deletion status is confirmed. To request deletion of an account, workspace, or other personal information, contact support@invoicereconcile.com. We verify the requester and scope before acting. Deletion may also be delayed where information must be preserved for security, fraud prevention, legal claims, financial recordkeeping, or a valid legal hold. Information retained for those reasons will be limited and isolated where practical.",
      ],
    },
    {
      id: "transfers",
      title: "7. International data transfers",
      paragraphs: [
        "InvoiceReconcile and its providers may process information in the United States and other countries where they operate. Those countries may have privacy laws different from the laws where you live.",
        "When applicable law requires a transfer safeguard, we use a legally recognized mechanism appropriate to the transfer, such as an adequacy decision, the European Commission's Standard Contractual Clauses with supplementary measures where needed, or the UK International Data Transfer Agreement or UK Addendum. Contact support@invoicereconcile.com to request information about the safeguard relevant to your data.",
      ],
    },
    {
      id: "security",
      title: "8. Security",
      paragraphs: [
        "We use administrative, technical, and organizational safeguards designed to protect personal information. These include access controls, private file handling, encryption in transit and at rest through our infrastructure providers, environment-based secret management, audit logging, file validation, rate limiting, and signed verification for supported webhooks.",
        "No system is completely secure. You are responsible for protecting your credentials, devices, exports, integration access, and workspace permissions. If you believe an account or data may have been compromised, contact support@invoicereconcile.com promptly.",
      ],
    },
    {
      id: "rights",
      title: "9. Your privacy rights and choices",
      paragraphs: [
        "Depending on where you live and subject to legal exceptions, you may have the right to request access to personal information, correction, deletion, a portable copy, restriction of processing, or information about disclosures. You may also have the right to object to certain processing, withdraw consent, appeal a denied request, or complain to a privacy regulator.",
        "You can update certain account details in the Service. To make another privacy request, email support@invoicereconcile.com. Describe the right you want to exercise and the account or organization involved. We may need to verify your identity and authority using information reasonably related to the request. Authorized agents may submit requests where applicable law permits, subject to verification of their authority.",
        "We will not discriminate against you for exercising a privacy right. If we process your information only for a customer, we may direct your request to that customer or help the customer respond.",
        "EEA and UK residents may complain to the data protection authority where they live or work, or where they believe a violation occurred. We encourage you to contact us first so we can address the concern.",
      ],
    },
    {
      id: "california",
      title: "10. California privacy notice",
      paragraphs: [
        "This section supplements the rest of the policy for California residents. The categories of personal information collected in the preceding 12 months are described in Section 2. Depending on the data, they may correspond to CCPA categories including identifiers, customer records, commercial information, internet or electronic activity, professional information, sensitive personal information, and inferences used for reconciliation.",
        "We collect and use those categories for the business and commercial purposes in Section 3, retain them as described in Section 6, and disclose them to the recipient categories in Section 5. We do not sell personal information, share it for cross-context behavioral advertising, or use sensitive personal information to infer characteristics. As a result, we do not offer a separate right-to-limit link. If these practices change, we will update this notice and provide required choices, including honoring applicable opt-out preference signals such as Global Privacy Control.",
        "Subject to applicability and exceptions, California residents may request to know, access, correct, or delete personal information and may receive information about categories of collection, sources, purposes, and disclosures. Requests may be sent to support@invoicereconcile.com. InvoiceReconcile operates exclusively online and uses this email address as its request method. We will verify requests as required and will not discriminate for exercising CCPA rights.",
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies and analytics choices",
      paragraphs: [
        "We use cookies and similar technologies that are necessary to sign users in, protect sessions, remember settings, and operate the Service. We may also use limited analytics technologies to understand website traffic and product usage. Analytics events must not contain invoice amounts, customer names, payment references, bank descriptions, or other Customer Content.",
        "Optional website and product-usage analytics providers do not start until you choose Accept analytics. The analytics notice provides equally accessible accept and reject choices. You can revisit your decision at any time through the Privacy choices control. Browser settings may also block or delete storage, but blocking necessary cookies can prevent sign-in or other features from working.",
        "Rejecting optional analytics does not disable records that are necessary to provide and secure the Service. We still record limited account creation, authentication, billing state, saved reconciliation completion, workspace actions, and audit decisions where needed to perform the contract, enforce plan limits, preserve financial workflow history, prevent abuse, or meet legal obligations. These operational records are not used for cross-context advertising and exclude bank memos, payer names, payment references, and invoice values from growth reporting.",
        "Because we do not sell personal information or share it for cross-context behavioral advertising, an opt-out preference signal does not change those practices. We will treat recognized signals as required if our practices change.",
      ],
    },
    {
      id: "communications",
      title: "12. Communications",
      paragraphs: [
        "We send transactional messages needed to operate your account, such as verification, password reset, billing, security, and subscription notices. You can disable background-import ready and failed emails in Settings; in-app progress and notifications remain available. You may not be able to opt out of other messages that are necessary to provide the Service.",
        "You may opt out of optional product updates and summary emails by using the unsubscribe link or account settings. We may still send non-promotional messages about your account or a request you made.",
      ],
    },
    {
      id: "children",
      title: "13. Children",
      paragraphs: [
        "The Service is intended for business users age 18 and older. It is not directed to children, and we do not knowingly collect personal information directly from children under 13. If you believe a child submitted personal information to us, contact support@invoicereconcile.com so we can investigate and delete it where appropriate.",
      ],
    },
    {
      id: "changes",
      title: "14. Changes to this policy",
      paragraphs: [
        "We may update this policy as the Service, law, or our practices change. We will post the updated policy and revise the effective date. If a change materially affects how we use personal information, we will provide additional notice or seek consent when required by law.",
      ],
    },
    {
      id: "contact",
      title: "15. Contact us",
      paragraphs: [
        `The controller for account and website information is ${operatorDescription}. Contact us about privacy questions or requests at ${SUPPORT_EMAIL}.`,
      ],
    },
  ],
};

export const securityContent: LegalDocument = {
  slug: "security",
  title: "Security at InvoiceReconcile",
  eyebrow: "Trust center",
  description: "How InvoiceReconcile protects financial reconciliation data and keeps users in control.",
  seoDescription:
    "Review InvoiceReconcile security practices for account access, workspace isolation, file handling, integrations, and incident reporting.",
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    "InvoiceReconcile handles financial workflow data that deserves careful treatment. Our security program is designed to limit access, protect data through its lifecycle, and preserve a reviewable record of reconciliation actions.",
    "Security is a shared responsibility. This page explains our safeguards and the steps customers should take to protect their workspaces.",
  ],
  sections: [
    {
      id: "control",
      title: "You control the financial decision",
      paragraphs: [
        "InvoiceReconcile suggests matches and explains the signals behind them. It does not automatically post changes to your accounting records. A user must review and confirm reconciliation results before export or any supported write-back action.",
        "Confidence labels are not guarantees. Verify amounts, dates, customer identity, invoice references, fees, duplicates, and currency before relying on a result.",
      ],
    },
    {
      id: "safeguards",
      title: "Security safeguards",
      items: [
        "Workspace isolation: organization and workspace authorization is enforced on the server and in the data layer, with row-level controls where supported.",
        "Least-privilege access: role checks limit user and administrative access to what is needed for the task.",
        "Private file handling: selected files are validated on the server and are not exposed through public file URLs. Files on the synchronous path are processed in request memory without a deliberate application-storage copy. Background sources are stored temporarily in a private bucket, marked for deletion after processing once the signed upload capability expires, and covered by a 24-hour cleanup schedule with retries until removal is confirmed.",
        "Encryption: supported production infrastructure encrypts network traffic in transit and stored data at rest.",
        "Authentication and sessions: secure authentication, session validation, and protected recovery flows are used for account access.",
        "Secrets and integrations: service credentials, payment keys, and integration tokens are kept in protected server-side configuration and are not exposed to browser code.",
        "Input protection: file type, size, and content checks reduce risk from unsafe uploads. Rate limits and request validation protect sensitive endpoints.",
        "Verified events: supported payment and integration webhooks require signature verification before processing.",
        "Auditability: persisted imports, reconciliation runs, and reviewer decisions are recorded with actor and timing information to support review and investigation.",
        "Secure development: dependencies are maintained, changes are reviewed, and security-sensitive flows are tested as part of the release process.",
      ],
    },
    {
      id: "data-minimization",
      title: "Data minimization and administrative access",
      paragraphs: [
        "We collect and retain data needed to provide and protect the Service. Background source bytes are held temporarily in private storage and scheduled for removal after processing once the short-lived upload capability expires. Any source still present enters the 24-hour cleanup schedule, and deletion remains pending until the storage provider confirms removal. Structured source rows and reconciliation records remain Customer Content under the account retention policy. Customers can request a verified data export or deletion by contacting support@invoicereconcile.com.",
        "Internal product and revenue analytics are designed to use counts, statuses, and operational metadata rather than customer financial values. Authorized personnel may access customer data only when needed for support, security, legal compliance, or service operations, and access should be logged and reviewed.",
        "We do not use Customer Content to train general-purpose artificial intelligence models unless a customer gives express written permission for that separate use.",
      ],
    },
    {
      id: "providers",
      title: "Service providers",
      paragraphs: [
        "We rely on selected providers for infrastructure, authentication, storage, billing, email, monitoring, and other operations. We assess providers based on the data they handle, limit access to the service they perform, and use contractual privacy and security obligations appropriate to the relationship.",
        "Third-party services you connect have their own security practices. Review their permissions and remove integrations you no longer use.",
      ],
    },
    {
      id: "incident-response",
      title: "Incident response",
      paragraphs: [
        "We evaluate reported or detected security events, take proportionate steps to contain and remediate confirmed incidents, preserve relevant evidence where appropriate, and provide legally required notices.",
        "If you suspect unauthorized access, revoke exposed credentials where possible, preserve relevant details, and contact support@invoicereconcile.com promptly.",
      ],
    },
    {
      id: "reporting",
      title: "Report a vulnerability",
      paragraphs: [
        "Send vulnerability reports to support@invoicereconcile.com with the affected URL or feature, steps to reproduce, potential impact, and any supporting evidence. Do not include real customer financial data in the report.",
        "Do not access another user's data, disrupt the Service, use social engineering, run denial-of-service tests, or publicly disclose an unresolved issue. Stop testing and contact us if you encounter data that is not yours. We will acknowledge a good-faith report and coordinate next steps, but we do not currently operate a paid bug bounty program.",
      ],
    },
    {
      id: "customer-responsibilities",
      title: "Customer responsibilities",
      items: [
        "Use a unique password and secure the email account used for sign-in.",
        "Give each person an individual account and the minimum workspace role they need.",
        "Remove former team members promptly and review access regularly.",
        "Confirm that imported files belong to the correct client and workspace.",
        "Do not upload online-banking credentials, complete card numbers, government identifiers, or other data the Service does not request.",
        "Protect downloaded exports and devices that store them.",
        "Review match explanations and source records before confirming or exporting a reconciliation.",
        "Report suspected compromise promptly to support@invoicereconcile.com.",
      ],
    },
    {
      id: "assurance",
      title: "Security assurance",
      paragraphs: [
        "We do not currently claim SOC 2 certification, ISO 27001 certification, PCI certification, HIPAA compliance, or any other third-party security certification unless a current, verifiable statement is added here after completion of the relevant assessment.",
        "This page describes security practices, not a guarantee that incidents will never occur. Specific enterprise commitments, if offered, must be documented in a signed agreement.",
      ],
    },
    {
      id: "contact",
      title: "Security contact",
      paragraphs: [`Security questions and reports may be sent to ${SUPPORT_EMAIL}.`],
    },
  ],
};

export const contactContent: LegalDocument = {
  slug: "contact",
  title: "Contact InvoiceReconcile",
  eyebrow: "Support",
  description: "Get help with your account, imports, billing, privacy, or security.",
  seoDescription:
    "Contact InvoiceReconcile support about product help, billing, account access, privacy, legal, or security questions.",
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    `Email ${SUPPORT_EMAIL} for product, account, billing, privacy, legal, or security help.`,
    "Include enough detail for us to identify the workspace and issue, but do not send passwords, complete bank-account or card numbers, authentication codes, or unredacted financial files by email.",
  ],
  sections: [
    {
      id: "product",
      title: "Product and import support",
      paragraphs: [
        `For help with column mapping, imports, match review, exports, or errors, contact ${SUPPORT_EMAIL}. Include the workspace name, the step where the issue occurred, the exact error message, and a redacted sample if needed.`,
      ],
    },
    {
      id: "account-billing",
      title: "Account and billing",
      paragraphs: [
        `For sign-in, workspace access, subscription, cancellation, receipt, or billing questions, contact ${SUPPORT_EMAIL} from the email associated with the account when possible.`,
      ],
    },
    {
      id: "privacy",
      title: "Privacy requests",
      paragraphs: [
        `Send access, correction, deletion, portability, objection, or other privacy requests to ${SUPPORT_EMAIL}. State the right you want to exercise and the account or organization involved. We may verify your identity and authority before completing the request.`,
      ],
    },
    {
      id: "security",
      title: "Security reports",
      paragraphs: [
        `Report suspected unauthorized access or a vulnerability to ${SUPPORT_EMAIL}. Include the affected URL or feature, steps to reproduce, and potential impact. Do not access other users' data or include real customer financial information in a report.`,
      ],
    },
    {
      id: "legal",
      title: "Legal notices",
      paragraphs: [
        `Send legal questions or notices to ${SUPPORT_EMAIL}. The Service is operated by ${operatorDescription}.`,
      ],
    },
  ],
};

export const legalDocuments = {
  terms: termsContent,
  privacy: privacyContent,
  security: securityContent,
  contact: contactContent,
} as const;

export type LegalDocumentKey = keyof typeof legalDocuments;
