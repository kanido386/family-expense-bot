Project: family-expense-bot

Context
- Goal: automate household expense tracking inside a LINE group chat.
- Current manual flow: family members post items like “鮮奶 255” or multi-line lists; I manually group by date and do month-end summaries (totals and category subtotals such as 家裡煮 / 水果 / 鮮奶/乳品 / 生活用品 / 機車).
- Vision: a LINE bot joins the group, parses messages, stores data, and generates on-demand or month-end summaries. Category assignment may be rule-based or AI-assisted (to be decided).

Collaboration style
- Treat the above as directional context, not final specs.
- Please lead the discovery in your own way: ask any questions you feel are necessary, propose assumptions if helpful, and validate scope before implementing.
- If something is ambiguous, clarify it. Don’t implement until scope is confirmed.

Constraints / principles
- Simple, practical, and stable for family use.
- Clear outputs over fancy features.
- Asia/Taipei timezone; be mindful of privacy.
- Future-friendly: possible CSV/Google Sheets export; AI-based categorization (optional).

Deliverables before implementation
- Your concise understanding of the scope (what we will and won’t build first).
- Open questions/assumptions you want me to confirm.
- A short plan/milestones for an MVP, then we proceed.
