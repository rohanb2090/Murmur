export interface BalanceMap {
  [memberId: string]: number; // Positive = owed money, Negative = owes money
}

export interface SettlementTransaction {
  from: string;
  to: string;
  amount: number;
}

/**
 * Greedy debt minimization algorithm to collapse multi-party balances
 * into the minimum number of direct settlement transfers.
 */
export function simplifyDebts(balances: BalanceMap): SettlementTransaction[] {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const [id, balance] of Object.entries(balances)) {
    if (balance < -0.01) {
      debtors.push({ id, amount: Math.abs(balance) });
    } else if (balance > 0.01) {
      creditors.push({ id, amount: balance });
    }
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions: SettlementTransaction[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    const settlement = Math.min(debtor.amount, creditor.amount);

    transactions.push({
      from: debtor.id,
      to: creditor.id,
      amount: Math.round(settlement * 100) / 100,
    });

    debtor.amount -= settlement;
    creditor.amount -= settlement;

    if (debtor.amount < 0.01) d++;
    if (creditor.amount < 0.01) c++;
  }

  return transactions;
}

export function buildUpiUri(upiId: string, payeeName: string, amount: number, note = 'Murmur Settlement'): string {
  const cleanUpi = encodeURIComponent(upiId.trim());
  const cleanName = encodeURIComponent(payeeName.trim());
  const cleanNote = encodeURIComponent(note);
  return `upi://pay?pa=${cleanUpi}&pn=${cleanName}&am=${amount.toFixed(2)}&cu=INR&tn=${cleanNote}`;
}