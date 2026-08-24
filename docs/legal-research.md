# InvoiceReconcile legal and trust research

Research date: August 23, 2026

Scope: Product copy for the Terms of Service, Privacy Policy, Security page, and Contact page of a business SaaS that imports invoices and incoming-payment records, suggests reconciliations, records user decisions, and exports results.

This document is an implementation research memo, not legal advice. It identifies the official sources used to prepare `src/content/legal.ts` and the decisions that must be completed before publication.

## Drafting position

- InvoiceReconcile is described as a reconciliation aid, not an accounting system, financial institution, payment processor, or professional adviser.
- Match outputs are suggestions. Users must verify source records, discrepancies, and exports before relying on them.
- The customer is generally the controller or business for personal information in uploaded invoice and payment data. InvoiceReconcile is generally the processor, service provider, or contractor for that data. InvoiceReconcile is a controller or business for account, billing, security, support, and its own website operations.
- The draft does not claim SOC 2, ISO 27001, PCI, HIPAA, or another certification.
- The draft says Customer Content is not used to train general-purpose AI models without express written permission.
- The draft says personal information is not sold and is not shared for cross-context behavioral advertising. This must remain operationally true.
- No mandatory arbitration or class-action waiver is included. Governing law and court venue are explicit owner-review placeholders.

## Primary official sources

### EU and UK privacy

1. [General Data Protection Regulation, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/)
   - Articles 5 and 6 support transparent, purpose-limited, minimized processing and the listed legal bases.
   - Articles 13 and 14 inform the categories, purposes, recipients, retention, transfer, rights, and contact disclosures in the Privacy Policy.
   - Articles 15 through 22 support access, correction, deletion, restriction, portability, objection, and automated-decision disclosures.
   - Article 28 supports the customer-controller and InvoiceReconcile-processor distinction and the need for data processing terms.
   - Article 32 supports risk-appropriate technical and organizational safeguards.
   - Articles 44 through 49 support the international-transfer section.

2. [EDPB Guidelines 07/2020 on controller and processor concepts](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en)
   - Roles depend on the actual purposes and means of processing, not just the label in a contract.
   - This supports separating InvoiceReconcile's controller activities from processing performed on customer instructions.

3. [EDPB Guidelines on transparency under Regulation 2016/679](https://www.edpb.europa.eu/system/files/2023-09/wp260rev01_en.pdf)
   - Privacy information should be clear, accessible, specific, current, and connected to the controller's accountability duties.

4. [European Commission rules on international data transfers](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)
   - Restricted transfers require an available mechanism such as adequacy, Standard Contractual Clauses, binding corporate rules, or a narrow derogation.

5. [European Commission Standard Contractual Clauses](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en)
   - Supports the conditional reference to EU SCCs. The clauses, correct module, annexes, supplementary measures, and transfer assessment must actually be completed before relying on them.

6. [UK ICO international transfer guidance, updated January 15, 2026](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/)
   - UK restricted transfers may require UK adequacy regulations, the UK IDTA, the UK Addendum, or another permitted route.

7. [EDPB Cookie Banner Taskforce report](https://www.edpb.europa.eu/documents/task-force-report/report-of-the-work-undertaken-by-the-cookie-banner-taskforce_en)
   - Supports prior consent for non-essential tracking where required and an equally accessible reject choice when an accept choice is shown.

### California privacy

8. [California Privacy Protection Agency CCPA FAQs](https://cppa.ca.gov/faq)
   - Summarizes rights to limit, opt out, correct, know, equal treatment, and delete.
   - Confirms purpose limitation, data minimization, request verification, opt-out preference signals, and response timing.
   - Notes that an exclusively online business may use an email address as its request method.

9. [California Attorney General CCPA overview](https://oag.ca.gov/privacy/ccpa)
   - Supports the California notice categories and the rights to know, delete, correct, opt out, limit, and receive non-discriminatory treatment.

10. [California CCPA regulations effective January 1, 2026](https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf)
    - Current official consolidated source reviewed for notices, request verification, retention disclosure, sensitive personal information, opt-out signals, and automated decisionmaking requirements.

### US subscriptions and electronic contracting

11. [Restore Online Shoppers' Confidence Act, 15 U.S.C. Chapter 110](https://uscode.house.gov/view.xhtml?edition=prelim&req=granuleid%3AUSC-prelim-title15-chapter110)
    - Online negative-option offers must clearly disclose material terms, obtain express informed consent before charging, and provide a simple way to stop recurring charges.

12. [FTC negative-option business guidance](https://www.ftc.gov/business-guidance/blog/2016/09/negative-options-make-them-positive)
    - Reinforces clear recurring-charge disclosures, informed consent, and simple cancellation under ROSCA and the FTC Act.

13. [California Business and Professions Code section 17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602)
    - Current requirements include clear offer terms, affirmative consent, retainable acknowledgment, online cancellation for online signups, specified renewal or trial notices, price-change notice, annual reminders for annual plans, and consent-record retention.
    - Amendments apply to contracts entered into, amended, or extended on or after July 1, 2025.

14. [E-SIGN Act, 15 U.S.C. section 7001](https://uscode.house.gov/view.xhtml?req=%28title%3A15+section%3A7001+edition%3Aprelim%29)
    - Electronic signatures and records generally may not be denied effect solely because they are electronic. Records that must be retained need to remain accurately reproducible.

### Security and children

15. [FTC Start with Security](https://www.ftc.gov/business-guidance/resources/start-security-guide-business)
    - Supports data minimization, lifecycle protection, least-privilege access, secure transmission and storage, secure development, provider oversight, patching, vulnerability handling, and secure disposal.

16. [FTC Data Security resources](https://www.ftc.gov/business-guidance/privacy-security/data-security)
    - Supports a documented security program proportionate to the sensitivity of account and financial information.

17. [FTC COPPA compliance FAQs, updated for the April 22, 2025 rule amendment](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
    - COPPA applies to covered online services that collect personal information from children under 13. A general-audience business service may block child participation. The draft sets a contractual minimum age of 18 and states the Service is not directed to children.

## Decisions required before launch

### Counsel and owner decisions

1. Replace every owner-review field with the correct legal entity name, legal business address, governing law, and court venue. Do not publish a fake address.
2. Have counsel review the Terms for the chosen entity and customer footprint, especially warranty disclaimers, the 12-month liability cap, the US $100 free-user floor, indemnity, venue, assignment, refund treatment, and any required consumer carve-outs.
3. Decide whether the business will remain court-based or adopt arbitration. The current draft intentionally uses courts and includes no class-action or jury waiver.
4. Confirm whether the Terms are strictly business-to-business. The product and draft say the Service is for business and professional use, but individual sole proprietors may still receive mandatory consumer protections in some jurisdictions.
5. Complete a jurisdictional review for US state privacy laws beyond California, state breach-notification laws, marketing laws, sales tax, VAT, and subscription rules where the Service is offered.
6. Assess whether any customer relationship could make InvoiceReconcile a service provider to a financial institution under the Gramm-Leach-Bliley Act or FTC Safeguards Rule. Do not claim GLBA compliance without this analysis and the required program.
7. Prepare a customer data processing agreement. It should cover processing instructions, confidentiality, security, subprocessors, assistance with rights and incidents, deletion or return, audits, and applicable Article 28 terms.
8. Assess whether an EU or UK representative or a data protection officer is legally required. If one is appointed, add accurate contact information to the Privacy Policy.
9. Determine whether InvoiceReconcile meets the applicability thresholds for the CCPA and other state privacy laws. The draft extends core request rights without asserting that every law applies, but operational deadlines and appeal procedures still need a jurisdiction-specific matrix.
10. Assess the current California thresholds and phase-in dates for cybersecurity audits and risk assessments before launch and as data volume grows. Do not describe an internal review as a statutory audit unless it satisfies the regulation.

### Product and operational decisions

1. Configure and test the retention schedule before publishing it:
   - Synchronous source bytes up to 2 MiB: no deliberate application-storage copy.
   - Background source objects: temporary private storage, capability-safe deletion after processing or user request, and scheduled cleanup within the 24-hour lifecycle. Storage failures remain deletion-pending and are retried until confirmed.
   - Workspace and account deletion from primary systems: within 30 days after verified deletion.
   - Security logs: up to 12 months.
   - Support records: up to 3 years.
   - Billing, tax, and contract records: up to 7 years.
   - Backup expiry: within 90 days after primary deletion.
2. Confirm that deletion propagates to subprocessors where required and that legal holds are documented.
3. Publish an accurate subprocessor list and data-location map. Confirm the actual hosting, storage, authentication, email, billing, analytics, logging, and support providers.
4. Complete EU and UK transfer work before accepting affected data. This includes choosing the correct SCC module or UK mechanism, filling annexes, conducting transfer assessments, and applying supplementary measures where needed.
5. Keep analytics free of invoice amounts, payment amounts, customer names, bank descriptions, references, file contents, and other Customer Content. Review analytics event payloads in production.
6. Do not activate non-essential analytics in jurisdictions requiring consent until a consent control with equally accessible accept and reject choices is working. Store and honor the choice. Honor Global Privacy Control if sale, sharing, or other covered processing is ever introduced.
7. Build the privacy-request workflow at support@invoicereconcile.com. Track identity verification, authority, receipt, response, denial reason, appeal where required, and processor-to-customer routing. If CCPA applies, confirm receipt within 10 business days and normally respond within 45 calendar days.
8. Make online cancellation available in account settings for subscriptions started online. Email support is a fallback, not the primary cancellation method. Do not require a call.
9. At checkout, show price, billing frequency, renewal, trial conversion if any, plan limits, taxes or fees, and cancellation method before collecting billing details. Record affirmative consent and retain it for the period required by applicable law. California currently requires at least three years or one year after contract termination, whichever is longer.
10. Implement applicable trial, promotional, annual-renewal, and price-change notices. Ensure receipts and acknowledgments are retainable.
11. Validate every security statement against production. In particular, verify row-level and server authorization, private storage, signed file access, encryption provided by vendors, secret handling, webhook signatures, rate limits, audit logging, access review, incident response, and deletion jobs.
12. Establish a documented incident-response and breach-notification process with customer contacts, decision owners, evidence preservation, legal review, and vendor escalation.
13. Ensure internal admin analytics use counts and operational metadata without exposing customer financial values by default. Log and review exceptional support access to Customer Content.
14. Keep the no-training promise enforceable in vendor contracts and system design. Any future opt-in training program requires separate, express written permission and updated disclosures.
15. Confirm that the live product never auto-posts accounting changes. If write-back is added, update the Terms, Privacy Policy, product copy, permissions, audit controls, and risk review before launch.
16. Ensure human review is substantive. For California ADMT analysis, the reviewer must know how to interpret the output, review relevant information, and have authority to make or change the decision. A decorative confirmation click is not enough.

## Publication checklist

- [ ] Legal entity, address, governing law, and venue completed.
- [ ] Counsel approved the Terms and jurisdictional coverage.
- [ ] Effective date changed to the actual publication date if needed.
- [ ] Data processing agreement available.
- [ ] Subprocessor and transfer documentation complete.
- [ ] Retention and deletion jobs tested against the published schedule.
- [ ] Privacy request workflow tested end to end.
- [ ] Checkout, consent evidence, renewal notices, and cancellation tested end to end.
- [ ] Cookie and analytics behavior matches the policy in every target region.
- [ ] Security claims verified in the production environment.
- [ ] No prohibited certification or compliance claims added.
- [ ] All contact paths use support@invoicereconcile.com.
- [ ] Repository scan confirms no em dash characters in the published copy.
