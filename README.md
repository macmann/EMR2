# Atenxion EMR

## Project Overview
Atenxion EMR is a reference implementation of an electronic medical record system. It aligns with the BRD by providing patient lookup, visit tracking and clinical insights via a JSON API protected by JWT and rate limiting.

## Local Development
1. Install dependencies with `npm install`.
2. Start both the API and web dev servers:
   ```bash
   npm run dev
   ```
   The API runs on `http://localhost:8080` and the web client on `http://localhost:5173`.

## MySQL Setup
Provision a MySQL instance and set the `DATABASE_URL` and `DIRECT_URL` in `.env`.

## Migrations & Seeding
Apply migrations and load demo data:
```bash
npm run prisma:migrate
npm run seed:csv
```

## API Docs
The OpenAPI specification is served at `/api/docs/openapi.json`.

## Deploying to Render
1. Create a new Web Service and connect this repository.
2. Configure environment variables:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `JWT_SECRET`
   - `RATE_LIMIT_WINDOW_MIN`
   - `RATE_LIMIT_MAX`
3. Build command: `npm install && npm run build`
4. Start command: `npm start`

## Security Notes
- Configure TLS for database connections as required by your provider.
- `express-rate-limit` protects patient and auth endpoints.
- Patient contact details are masked in logs and API responses.
