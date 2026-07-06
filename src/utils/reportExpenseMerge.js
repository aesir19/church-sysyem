function normalizeDescription(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text || 'Other'
}

function toExpenseItem(row) {
  return {
    description: normalizeDescription(row?.description),
    amount: Number(row?.amount) || 0,
  }
}

function cloneWeek(week) {
  return {
    ...week,
    contributions: Array.isArray(week?.contributions) ? week.contributions.slice() : [],
    expenses: Array.isArray(week?.expenses) ? week.expenses.slice() : [],
  }
}

export function mergeMonthSourceWithLiveExpenses(monthSource, expenseRows) {
  const base = {
    month: Number(monthSource?.month) || 0,
    year: Number(monthSource?.year) || 0,
    openingBalance: Number(monthSource?.openingBalance) || 0,
    weeks: Array.isArray(monthSource?.weeks) ? monthSource.weeks.map(cloneWeek) : [],
  }

  if (!Array.isArray(expenseRows) || expenseRows.length === 0) {
    return base
  }

  // Once live expenses exist for the month, use them as the monthly source
  // of truth while keeping existing contribution rows intact.
  const weeksByDate = new Map()
  for (const week of base.weeks) {
    weeksByDate.set(week.date, {
      ...week,
      expenses: [],
    })
  }

  for (const row of expenseRows) {
    const date = typeof row?.spent_on === 'string' ? row.spent_on : ''
    if (!date) continue

    if (!weeksByDate.has(date)) {
      weeksByDate.set(date, {
        date,
        contributions: [],
        expenses: [],
      })
    }

    const week = weeksByDate.get(date)
    week.expenses.push(toExpenseItem(row))
  }

  return {
    ...base,
    weeks: Array.from(weeksByDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))),
  }
}
