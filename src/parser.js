function parseExpenseMessage(message) {
  if (!message || typeof message !== 'string') {
    return { items: [], total: 0 };
  }

  const lines = message.trim().split('\n').filter(line => line.trim().length > 0);
  const items = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Try to extract price from the end of the line
    const priceMatch = trimmedLine.match(/(\d+)$/);
    if (!priceMatch) continue;

    const price = parseInt(priceMatch[1], 10);
    const itemName = trimmedLine.replace(/\s*\d+$/, '').trim();
    
    if (itemName && price > 0) {
      items.push({
        name: itemName,
        price: price
      });
    }
  }

  const total = items.reduce((sum, item) => sum + item.price, 0);

  return {
    items,
    total
  };
}

module.exports = {
  parseExpenseMessage
};