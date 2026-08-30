// balanceCalculator.js — Core logic to compute who owes whom

/**
 * Given a list of expense splits for a group, compute net balances.
 *
 * Flow:
 * 1. For each expense, the payer is "owed" the full amount
 * 2. Each split participant "owes" their share
 * 3. Net balance = total paid - total owed
 * 4. Positive balance = this person is owed money
 * 5. Negative balance = this person owes money
 *
 * @param {Array} expenses - Array of expense rows with splits
 * @returns {Object} { netBalances, transactions }
 */
export function calculateBalances(expenses) {
  // Step 1: Build a net balance map { userId: netAmount }
  const balanceMap = {};

  for (const expense of expenses) {
    const payerId = expense.paid_by;
    const amount = expense.amount;

    // Payer gets credited the full amount
    balanceMap[payerId] = (balanceMap[payerId] || 0) + amount;

    // Each split participant gets debited their share
    for (const split of expense.splits) {
      balanceMap[split.user_id] = (balanceMap[split.user_id] || 0) - split.share;
    }
  }

  // Step 2: Simplify debts — who pays whom and how much
  // Separate into creditors (positive) and debtors (negative)
  const creditors = []; // people owed money
  const debtors = [];   // people who owe money

  for (const [userId, balance] of Object.entries(balanceMap)) {
    const rounded = Math.round(balance * 100) / 100; // round to cents
    if (rounded > 0.01) creditors.push({ userId: parseInt(userId), amount: rounded });
    if (rounded < -0.01) debtors.push({ userId: parseInt(userId), amount: -rounded });
  }

  // Step 3: Greedy matching — largest debtor pays largest creditor
  const transactions = [];
  let i = 0, j = 0;

  // Sort descending for efficient greedy pairing
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i];
    const debt = debtors[j];
    const amount = Math.min(credit.amount, debt.amount);

    transactions.push({
      from: debt.userId,   // debtor pays
      to: credit.userId,   // creditor receives
      amount: Math.round(amount * 100) / 100
    });

    credit.amount -= amount;
    debt.amount -= amount;

    if (credit.amount < 0.01) i++;
    if (debt.amount < 0.01) j++;
  }

  // Return both net balances and simplified transactions
  return {
    netBalances: balanceMap,
    transactions
  };
}
