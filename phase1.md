📋 Phase 1 Task Breakdown
Goal
Build the complete CRUD (Create, Read, Update, Delete) operations for the core business entities and connect the frontend to the real backend API.

Task 1: Backend - Complete CRUD Endpoints (Real Database Logic)
Currently, your endpoints probably return hardcoded JSON. We need to replace that with actual database queries using SQLAlchemy.

Endpoint Group	Required Endpoints	Database Logic
Products	GET /products (with search & pagination), POST /products, GET /products/{id}, PUT /products/{id}, DELETE /products/{id}	SQLAlchemy queries with LIKE for search, limit/offset for pagination.
Customers	GET /customers (with search), POST /customers, GET /customers/{id}, PUT /customers/{id}, DELETE /customers/{id}	Same as products.
Orders	GET /orders (filter by status & date range), POST /orders (with order items), GET /orders/{id}, PUT /orders/{id}/status, DELETE /orders/{id}	Handle nested order items creation. Update only the status via PUT.
Database Relationships to implement:

Order → Customer (Many-to-One)

Order → OrderItem (One-to-Many)

OrderItem → Product (Many-to-One)

Task 2: Backend - Real Dashboard Analytics
Replace the hardcoded KPI numbers with real SQL aggregate queries.

KPI	SQL Logic
Total Revenue (Today)	SUM(total_amount) WHERE order_date = CURDATE() AND status = 'delivered'
Total Orders (This Month)	COUNT(*) WHERE order_date BETWEEN first_of_month AND last_of_month
Growth %	Compare this month's revenue to last month's revenue.
Low Stock Items	COUNT(*) WHERE current_stock <= reorder_level
Top Products	Join order_items with products, group by product_id, sum quantities, order by sum DESC LIMIT 5.
Task 3: Backend - Improved Error Handling & Validation
Use Pydantic schemas strictly for all request bodies (e.g., ProductCreate, OrderCreate).

Return proper HTTP status codes: 201 Created, 404 Not Found, 400 Bad Request, 403 Forbidden.

Add try/except blocks to catch database integrity errors (e.g., duplicate SKU).

Task 4: Frontend - Replace Mock Data with Real API Calls
Update frontend/src/api/client.ts to send the JWT token automatically.

Create dedicated API service files: productApi.ts, customerApi.ts, orderApi.ts, dashboardApi.ts.

Use useEffect and useState (or React Query if you want to be fancy, but basic useEffect is fine) to fetch data when pages load.

Add loading spinners (<Spin /> from Ant Design) while data is fetching.

Task 5: Frontend - Complete Add/Edit Forms
Products Form: Fields: SKU, Name, Description, Category, Unit Price, Cost Price, Current Stock, Reorder Level.

Customers Form: Fields: Full Name, Email, Phone, Address, Company.

Orders Form (Complex): Dropdown to select a customer, a dynamic list to add products with quantities, calculate total price dynamically.

Modal vs Page: Use Ant Design <Modal> components for "Add" and "Edit" to keep the UI clean.

Task 6: Frontend - Order Status Workflow
On the Orders page, each row should have a dropdown or buttons to change the status:
Pending → Confirmed → Shipped → Delivered (and an optional Cancelled).

When a status changes, call PUT /orders/{id}/status and refresh the table.

Task 7: Frontend - Search & Filter
Add an input field at the top of Products/Customers/Orders pages.

When the user types, call the API with the ?search=... query parameter.

For Orders, add a status filter dropdown and a date-range picker.

Task 8: Frontend - Dashboard Live Data
Connect the Dashboard KPI cards to the new analytics endpoints.

Connect the "Top Products" chart to the real data.

Remove all hardcoded numbers.

Task 9: Security & Auth Integration
If a user is not logged in, redirect them to the Login page.

Store the JWT token securely. Note: In Electron, you can use electron.safeStorage for encryption, but for Phase 1, using localStorage is acceptable (with a comment to upgrade later).

Logout functionality that clears the token.

Task 10: Frontend - User Feedback (Toasts & Notifications)
Use Ant Design's message.success() or notification.success() when an item is created, updated, or deleted.

Show message.error() when an API call fails (e.g., "SKU already exists").