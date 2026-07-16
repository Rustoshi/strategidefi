// Per-coin market row for the dashboard mini-charts.
//
// This used to keep its OWN base prices and random walk, which meant the dashboard and the
// trading endpoints each invented a different price for the same coin. It now delegates to
// the live feed in ../ws so there is exactly one source of truth for every page.
const { itemFor } = require('../ws');

function marketItem(coin) {
  return itemFor(coin);
}

module.exports = { marketItem };
