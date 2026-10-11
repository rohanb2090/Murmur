export interface ParsedExpense {
  amount: number | null;
  paidByName: string | null;
  splitTarget: 'all' | string[];
  rawTranscript: string;
  confidence: number;
}

export function parseExpenseTranscript(
  text: string,
  groupMembers: { id: string; name: string }[]
): ParsedExpense {
  const sanitized = text.toLowerCase().trim();
  let confidence = 0.5;

  // 1. Extract Amount (e.g., "₹450", "rs 450", "450 rupees", "450 bucks", "auto 120")
  const amountRegex = /(?:₹|rs\.?|rupees|inr|bucks)?\s*(\d+(?:\.\d{1,2})?)/i;
  const amountMatch = sanitized.match(amountRegex);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  if (amount !== null) {
    confidence += 0.3;
  }

  // 2. Identify Payer
  let paidByName: string | null = null;
  for (const m of groupMembers) {
    const lowerName = m.name.toLowerCase();
    if (
      sanitized.includes(`${lowerName} paid`) ||
      sanitized.includes(`paid by ${lowerName}`) ||
      sanitized.includes(`by ${lowerName}`) ||
      sanitized.endsWith(` ${lowerName}`)
    ) {
      paidByName = m.name;
      confidence += 0.2;
      break;
    }
  }

  // 3. Determine Beneficiaries (Split Targets)
  let splitTarget: 'all' | string[] = 'all';
  const mentionedMembers = groupMembers
    .filter((m) => sanitized.includes(m.name.toLowerCase()) && m.name !== paidByName)
    .map((m) => m.name);

  if (mentionedMembers.length > 0) {
    splitTarget = mentionedMembers;
    confidence += 0.1;
  }

  return {
    amount,
    paidByName,
    splitTarget,
    rawTranscript: text,
    confidence: Math.min(confidence, 1.0),
  };
}