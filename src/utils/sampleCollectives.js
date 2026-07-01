// Sample Feb 2026 collectives dataset used to preview the monthly report UI
// before Supabase-backed persistence is designed.
//
// Week 1 mirrors the "FEB 1 COLLECTIVES 2026" sheet of the DFC summary
// workbook exactly so the on-screen numbers can be cross-checked against
// the reference report. Weeks 2–4 are illustrative only.

export const SAMPLE_COLLECTIVES = {
  month: 2,
  year: 2026,
  openingBalance: 7769.00,
  weeks: [
    {
      date: '2026-02-01',
      studentProgramDeduction: 98.35,
      contributions: [
        { name: 'Lago, Mary Joyce', tithes: 780, offering: 20 },
        { name: 'Sabando, Cielo', tithes: 1397 },
        { name: 'Pagaygay, Jhonel', tithes: 500, offering: 50 },
        { name: 'Ado Family', tithes: 80, offering: 20 },
        { name: 'Gabayne, Erica', tithes: 50 },
        { name: 'Martinez, Sally', tithes: 200 },
        { name: 'Caliwan, Snooky', tithes: 100 },
        { name: 'Gabayne, Jenica', tithes: 100 },
        { name: 'Gabayne, Jing', tithes: 100 },
        { name: 'Unknown', tithes: 50 },
        { name: 'Unknown', tithes: 20 },
        { name: 'Unknown', tithes: 200 },
        { name: 'Unknown', tithes: 100 },
        { name: 'Unknown', tithes: 200 },
      ],
      expenses: [
        { description: 'Umpukan', amount: 1500 },
        { description: 'Kuryente', amount: 750 },
      ],
    },
    {
      date: '2026-02-08',
      studentProgramDeduction: 100,
      contributions: [
        { name: 'Lago, Mary Joyce', tithes: 800, offering: 20 },
        { name: 'Sabando, Cielo', tithes: 1500 },
        { name: 'Pagaygay, Jhonel', tithes: 500 },
        { name: 'Ado Family', tithes: 100, offering: 20 },
        { name: 'Martinez, Sally', tithes: 200 },
        { name: 'Caliwan, Snooky', tithes: 150 },
        { name: 'Gabayne, Jenica', tithes: 100 },
        { name: 'Gabayne, Jing', tithes: 100 },
        { name: 'Unknown', tithes: 300, offering: 40 },
      ],
      expenses: [
        { description: 'Kuryente', amount: 720 },
        { description: 'Tubig', amount: 180 },
      ],
    },
    {
      date: '2026-02-15',
      studentProgramDeduction: 100,
      contributions: [
        { name: 'Lago, Mary Joyce', tithes: 780 },
        { name: 'Sabando, Cielo', tithes: 1200, others: 200, particular: 'Building Fund' },
        { name: 'Pagaygay, Jhonel', tithes: 500, offering: 50 },
        { name: 'Ado Family', tithes: 80 },
        { name: 'Gabayne, Erica', tithes: 50 },
        { name: 'Martinez, Sally', tithes: 200 },
        { name: 'Caliwan, Snooky', tithes: 100 },
        { name: 'Unknown', tithes: 260, offering: 30 },
      ],
      expenses: [
        { description: 'Umpukan', amount: 1500 },
        { description: 'Snacks', amount: 320 },
      ],
    },
    {
      date: '2026-02-22',
      studentProgramDeduction: 100,
      contributions: [
        { name: 'Lago, Mary Joyce', tithes: 820, offering: 20 },
        { name: 'Sabando, Cielo', tithes: 1400 },
        { name: 'Pagaygay, Jhonel', tithes: 500, offering: 50 },
        { name: 'Ado Family', tithes: 100, offering: 20 },
        { name: 'Gabayne, Erica', tithes: 80 },
        { name: 'Martinez, Sally', tithes: 200 },
        { name: 'Caliwan, Snooky', tithes: 120 },
        { name: 'Gabayne, Jenica', tithes: 100 },
        { name: 'Gabayne, Jing', tithes: 100 },
        { name: 'Unknown', tithes: 220, offering: 30 },
      ],
      expenses: [
        { description: 'Kuryente', amount: 740 },
        { description: 'Maintenance', amount: 450 },
      ],
    },
  ],
}
