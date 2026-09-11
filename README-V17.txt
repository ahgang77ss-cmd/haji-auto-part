V17.1 — Inventory + Payment Status + Orders + Fetch Fix

What is new:
- SQLite inventory table seeded from price-catalog.json; existing stock is preserved.
- Admin inventory manager with search, stock, minimum-stock threshold, reserved and available quantities.
- New orders reserve inventory immediately. Orders with insufficient available stock are rejected.
- When an order becomes done, reserved stock is converted to sold stock.
- When an order is cancelled before completion, reservation is released.
- Terminal statuses (done/cancelled) cannot be changed again.
- SQLite payments table with pending/paid/failed/refunded status.
- Payment status can be changed from the order details modal in admin.
- Notifications are generated for inventory and payment changes.
- V16 ordering, notifications, reports, local illustrations and price engine are preserved.

Runtime:
- Node.js >= 22.5 because the project uses node:sqlite. Current Node documentation lists node:sqlite as added in v22.5.0.
- npm install
- npm start

Environment:
- PORT=3000
- ADMIN_USER=admin
- ADMIN_PASSWORD=change-this

Important:
- This is payment STATUS management, not a real payment gateway. A real gateway must be connected later using the provider credentials and callback/webhook flow.
- Stock starts at 0 for catalog items unless you set it in Admin > Inventory.
