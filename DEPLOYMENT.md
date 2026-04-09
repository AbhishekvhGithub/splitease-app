# SplitEase - Dual Deployment Guide

Deploy your expense splitting app with **Backend on Render** and **Frontend on Vercel**.

## 🚀 Current Deployment Status

- ✅ **Backend**: Deployed on Render
  - URL: `https://splitease-app-rkgp.onrender.com`
  - Uses: Node.js + Express + SQLite
  
- ⏳ **Frontend**: Ready to deploy on Vercel
  - Uses: Vanilla HTML + CSS + JavaScript
  - Will be hosted on Vercel's CDN

---

## 📋 Step-by-Step Deployment

### Step 1: Verify Backend is Running on Render

1. Go to [render.com/dashboard](https://dashboard.render.com)
2. Find your **splitease-app** service
3. Confirm status shows **"Live"** (green) and no errors
4. Note the URL (e.g., `https://splitease-app-rkgp.onrender.com`)

### Step 2: Deploy Frontend to Vercel

#### Option A: Deploy Using Vercel Dashboard (Easiest)

1. **Go to [vercel.com](https://vercel.com)**
2. **Sign up/login** with GitHub
3. **Click "Add New"** → **"Project"**
4. **Select your GitHub repository** (`AbhishekvhGithub/splitease-app`)
5. **Configure Project**:
   - **Framework Preset**: Select "Other" (static site)
   - **Root Directory**: Leave empty or use `frontend/public`
   - **Build Command**: Leave empty
   - **Output Directory**: Leave empty

6. **Add Environment Variables**:
   - Click **"Environment Variables"**
   - **Key**: `REACT_APP_API_URL`
   - **Value**: `https://splitease-app-rkgp.onrender.com/api`
   - Click **"Add"**

7. **Click "Deploy"**
8. **Wait** for deployment to complete (~1-2 minutes)
9. **Copy your Vercel URL** (e.g., `https://splitease-app.vercel.app`)

#### Option B: Deploy Using Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to project root
cd c:\Users\abhis\Downloads\splitease-app\splitwise-app

# Deploy
vercel

# When prompted:
# - Link to existing project: No (first time)
# - Project name: splitease-app
# - Directory: . (current)
# - Build command: Leave empty
# - Output dir: Leave empty

# Set environment variable
vercel env add REACT_APP_API_URL https://splitease-app-rkgp.onrender.com/api

# Redeploy to apply environment variables
vercel --prod
```

### Step 3: Verify Both Services Work Together

1. **Open your Vercel frontend URL** in browser
2. **Test Add Friend**:
   - Click "Add Friend"
   - Enter a name
   - Click "Add"
   - Should see success message
   
3. **Check backend logs** on Render:
   - Go to `render.com/dashboard` → `splitease-app`
   - Click **"Logs"** to verify API calls are received
   - Should see HTTP POST requests logged

### Step 4: Fix CORS Issues (If Any)

If you get CORS errors when frontend calls backend:

1. **Go to Render Dashboard**
2. **Select your service** → **"Settings"**
3. **Find "Environment Variables"**
4. **Add new variable**:
   - **Key**: `CORS_ORIGINS`
   - **Value**: `https://your-vercel-domain.vercel.app`
   - Replace with your actual Vercel domain

5. **Click "Save"** and wait for auto-redeploy

---

## 🔗 Architecture Overview

```
┌─────────────────────────────────────┐
│  Frontend (Vercel)                   │
│  https://splitease-app.vercel.app    │
│  - Vanilla HTML/CSS/JS               │
│  - Static site hosting               │
│  - Global CDN                        │
└────────────────┬────────────────────┘
                 │ API Calls
                 ▼
┌─────────────────────────────────────┐
│  Backend (Render)                    │
│  https://splitease-app-rkgp...       │
│  - Node.js + Express                 │
│  - SQLite Database                   │
│  - Running 24/7                      │
└─────────────────────────────────────┘
```

---

## 🌍 Your Live URLs

After deployment, you'll have:

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | `https://splitease-app.vercel.app` | Public web app |
| **Backend API** | `https://splitease-app-rkgp.onrender.com/api` | API endpoints |

---

## 🧪 Testing Checklist

- [ ] Frontend loads without errors
- [ ] Can add a friend
- [ ] Can create a group
- [ ] Can add an expense
- [ ] Can view balances
- [ ] Can delete groups/expenses
- [ ] No CORS errors in browser console

---

## ⚠️ Troubleshooting

### "Failed to fetch" errors on Vercel

**Problem**: CORS error when frontend calls backend

**Solution**:
1. Check that `REACT_APP_API_URL` is set correctly in Vercel
2. Verify Render backend is running (check Render dashboard)
3. Add Vercel domain to Render's CORS environment variable

### Blank page on Vercel

**Problem**: Static site serving issue

**Solution**:
1. Verify Vercel Root Directory is empty or set to `.`
2. Check that `frontend/public/index.html` exists
3. Trigger redeploy with `vercel --prod`

### API slowness

**Problem**: First request takes 10+ seconds

**Solution**: This is normal for Render free tier (cold start). The container spins down after inactivity.

---

## 📞 Need Help?

- **Render Status**: [render.com/status](https://render.com/status)
- **Vercel Status**: [vercel.com/status](https://vercel.com/status)
- **GitHub Issues**: Create an issue in your repository

---

## 🎉 You're All Set!

Your SplitEase app is now deployed across two platforms:
- ✅ Backend on Render (reliable server)
- ✅ Frontend on Vercel (fast CDN)
- ✅ Both working together seamlessly

**Share your Vercel URL with friends!** 🚀
