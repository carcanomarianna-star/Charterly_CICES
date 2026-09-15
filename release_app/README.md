# Charterly Private Release — Deployment & Production Guide

This guide explains how to run, configure, and deploy the Charterly Release application with the Administrator Back-End Manager and User Authentication.

---

## 1. Quick Local Start

To run the application locally:
```powershell
cd "d:\09. GitHub Coding\Charterly_CICES\release_app"
npm install
npm start
```
Once started, the server listens on `http://localhost:3000`:
- **Candidate Login / Sign-Up**: `http://localhost:3000/login`
- **Charterly Main App**: `http://localhost:3000/` (Protected by authentication)
- **Administrator Manager**: `http://localhost:3000/admin` (Default password: `admin123`)

---

## 2. Environment Variables

The server supports standard environment configuration:
- `PORT`: HTTP port to bind (default: `3000` or assigned by cloud hosts like Render, Heroku, Railway).
- `SESSION_SECRET`: Secret key used for signing session cookies. (If omitted, a secure random key is generated automatically on startup).

Example `.env` or cloud environment settings:
```env
PORT=3000
SESSION_SECRET=your-custom-production-secret-key-goes-here
```

---

## 3. Administrator Manager Guide (`/admin`)

1. Navigate to `/admin`.
2. Enter your master administrator password (`admin123` upon first launch).
3. **Authorize Candidates**:
   - **Single Add**: Enter candidate email and optional notes (e.g. *Jane Doe - Senior Quantity Surveyor*).
   - **Bulk Import**: Paste a list of emails (comma, space, or newline-separated).
4. **Manage Existing Candidates**:
   - **Suspend / Activate**: Instantly disable or re-enable candidate access with one click.
   - **Delete**: Remove a candidate from the allowlist entirely.
   - **Export CSV**: Download the current allowlist and registration status.
5. **Change Master Password**:
   - Scroll to the bottom card *Change Administrator Password*.
   - Enter the current password, then your new password (minimum 6 characters) and click *Update*.

---

## 4. User Experience Guide (`/login`)

1. **New Candidates**:
   - The candidate enters their email address.
   - If their email is **authorized**, they are invited to create and confirm their password.
   - Upon creating their password, their session is created and the main portal launches immediately.
   - If their email is **not authorized**, they receive a clear explanation: *"This email is not on the private release list. Please request access from the administrator."*
2. **Returning Candidates**:
   - The candidate enters their email address.
   - The portal detects they have already registered and prompts for their password.
   - Once authenticated, their saved progress is loaded automatically.
3. **Automatic Progress Saving**:
   - Every candidate change (eligibility, competencies, CPD, case studies) saves locally and syncs to the server database.
   - Candidates can sign out using the *Sign Out* button in the header at any time.

---

## 5. Deployment Options

### Option A: Render / Railway / Fly.io (Fastest Cloud Deployment)
1. Point your repository to the service.
2. Set the root or build directory to `release_app`.
3. Set the start command to:
   ```bash
   node server.js
   ```
4. Attach persistent storage to `/data` if you want user database updates to persist across redeploys.

### Option B: Ubuntu / Linux VPS (Nginx + PM2)
1. Copy `release_app` to your server.
2. Install dependencies: `npm install --production`.
3. Run with PM2:
   ```bash
   pm2 start server.js --name charterly
   pm2 save
   ```
4. Configure Nginx reverse proxy to forward traffic on port 80/443 to `http://127.0.0.1:3000`.

---

## 6. Testing

An automated end-to-end integration test is included in [`test_auth.js`](file:///d:/09.%20GitHub%20Coding/Charterly_CICES/release_app/test_auth.js):
```bash
node test_auth.js
```
It tests unauthorized blocking, admin allowlist additions, user registration, authentication cookies, cloud state persistence, and real-time user suspension.
