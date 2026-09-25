import type { FlagType, Severity } from "@/types/legal";

/**
 * Minimal fixture NDA with exactly five known red flags. Every other clause
 * is deliberately benign so the precision test also catches false positives.
 */
export const FIXTURE_NDA = `NON-DISCLOSURE AGREEMENT

1. Purpose. Acme Robotics Ltd. ("Company") and the Recipient wish to discuss a possible supply arrangement.

2. Confidentiality. The Recipient shall keep the Company's confidential information secret and use it only for the purpose above.

3. Term. This Agreement starts on the signature date and shall automatically renew for successive one-year terms unless either party gives sixty days' written notice.

4. Non-Competition. For three (3) years after this Agreement ends, the Recipient shall not engage in any business that competes with the Company anywhere in the world.

5. Liquidated Damages. For each breach of Section 2, the Recipient shall pay the Company liquidated damages of $25,000.

6. Disputes. Any dispute shall be resolved exclusively by final and binding arbitration, and the Recipient waives any right to a jury trial.

7. Changes. The Company may amend this Agreement at any time in its sole discretion by emailing the new terms.

8. Notices. Notices must be in writing and sent to the addresses the parties have given each other.`;

export const EXPECTED_FLAGS: { flagType: FlagType; severity: Severity }[] = [
  { flagType: "non_compete", severity: "CRITICAL" },
  { flagType: "auto_renewal", severity: "HIGH" },
  { flagType: "liquidated_damages", severity: "HIGH" },
  { flagType: "mandatory_arbitration", severity: "HIGH" },
  { flagType: "unilateral_amendment", severity: "HIGH" },
];
