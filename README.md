# SplitEase — Expense Splitting App

A full-stack expense splitting application like Splitwise, built with Node.js, Express, SQLite, and vanilla JavaScript.

---

## 📁 Folder Structure

```
splitwise-app/
├── backend/
│   ├── server.js           ← Express API server (all routes)
│   ├── db.js               ← SQLite database setup
│   ├── balanceCalculator.js← Core balance calculation logic
│   ├── package.json        ← Node dependencies
│   └── splitwise.db        ← Auto-created SQLite database
│
├── frontend/
│   └── public/
│       └── index.html      ← Complete single-page frontend
│
└── README.md
```

---

## 🚀 How to Run

### Step 1: Install Node.js
Make sure you have Node.js installed (v16 or higher).  
Download from: https://nodejs.org

### Step 2: Install dependencies
```bash
cd splitwise-app/backend
npm install
```

### Step 3: Start the server
```bash
npm start
```
Or for auto-restart during development:
```bash
npm run dev
```

### Step 4: Open the app
Open your browser and go to:
```
http://localhost:3001
```

That's it! The backend serves the frontend automatically.

---

## 🚀 Deployment

### Railway (Recommended - Free & Easy)

1. **Connect to Railway**:
   - Go to [Railway.app](https://railway.app)
   - Sign up/login with GitHub
   - Click "New Project" → "Deploy from GitHub repo"

2. **Deploy**:
   - Railway auto-detects Node.js
   - Uses `npm start` from root package.json
   - Database persists automatically

3. **Access your app**:
   - Railway provides a `*.up.railway.app` URL
   - Your app is live!

### Docker

1. **Build the image**:
   ```bash
   docker build -t splitease .
   ```

2. **Run the container**:
   ```bash
   docker run -p 3001:3001 splitease
   ```

3. **Access**:
   - Open http://localhost:3001

### Other Platforms

Works with any Node.js hosting:
- **Render**: Connect GitHub repo, set build command to `npm install`, start to `npm start`
- **Heroku**: Push to Heroku git, auto-detects Node.js
- **Vercel**: For frontend only (backend needs serverless functions)
- **AWS/GCP/Azure**: Deploy container or Node.js app

The app uses `process.env.PORT` so it works on any hosting platform.

---

## 🌐 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/users | List all users |
| POST | /api/users | Add a user `{ name }` |
| GET | /api/groups | List all groups |
| GET | /api/groups/:id | Get group with members |
| POST | /api/groups | Create group `{ name, description, memberIds }` |
| GET | /api/groups/:id/expenses | List expenses in group |
| POST | /api/groups/:id/expenses | Add expense `{ description, amount, paidBy, splitAmong }` |
| DELETE | /api/expenses/:id | Delete an expense |
| GET | /api/groups/:id/balances | Get who owes whom |

---

## 🧮 How Balance Calculation Works

1. For each expense, the **payer** is credited the full amount
2. Each person in the split is **debited** their equal share
3. Net balance = total paid − total owed
4. Positive balance = this person is **owed money**
5. Negative balance = this person **owes money**
6. A greedy algorithm then finds the minimum number of transactions to settle all debts

### Example:
- Alice pays ₹300 for dinner (split among Alice, Bob, Carol → ₹100 each)
- Bob pays ₹150 for taxi (split among Bob, Carol → ₹75 each)

Net balances:
- Alice: +300 − 100 = **+₹200** (owed)
- Bob: +150 − 100 − 75 = **−₹25** (owes)
- Carol: 0 − 100 − 75 = **−₹175** (owes)

Settlements:
- Carol pays Alice ₹175
- Bob pays Alice ₹25

---

## 📦 Technologies Used

- **Backend**: Node.js, Express, better-sqlite3
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework needed)
- **Database**: SQLite (file-based, no setup required)
- **Fonts**: DM Sans, DM Mono (Google Fonts)
