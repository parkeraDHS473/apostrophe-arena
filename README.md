# Apostrophe Arena — Deployment Guide
## One-time setup on Render (free, ~5 minutes)

---

### Step 1 — Create a free Render account
Go to **https://render.com** and sign up (free tier is all you need).

---

### Step 2 — Put these files on GitHub
1. Go to **https://github.com** and create a free account if you don't have one
2. Click **New repository** → name it `apostrophe-arena` → set to **Public** → Create
3. Upload these files keeping the same folder structure:
   ```
   apostrophe-arena/
   ├── server.js
   ├── package.json
   └── public/
       └── index.html
   ```
   (Click "uploading an existing file" on the GitHub repo page and drag them in)

---

### Step 3 — Deploy on Render
1. In Render, click **New** → **Web Service**
2. Connect your GitHub account and select the `apostrophe-arena` repo
3. Fill in the settings:
   - **Name**: apostrophe-arena (or anything you like)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
4. Click **Create Web Service**
5. Wait ~2 minutes for it to deploy
6. You'll get a URL like: `https://apostrophe-arena.onrender.com`

---

### Step 4 — Share with students
That's it! Give students the URL. They open it in any browser.

**How a group plays:**
- One student clicks **Host Game** → picks settings → gets a 4-letter room code
- Others go to the same URL → click **Join Game** → type the code
- Host clicks **Start Game** when everyone is in
- Host controls pace (clicks "Next Question" after each reveal)
- Students answer on their own screens in real time

---

### ⚠️ Free Render note
Free Render services "spin down" after 15 minutes of inactivity.
The first person to visit after a break may wait ~30 seconds for it to wake up.
After that, it's fast. To avoid this during class, open the URL yourself a minute before students do.

---

### Customizing questions
All 25 questions are in `public/index.html` in the `QS` array near the top of the `<script>` section. Each question looks like this:
```js
{
  cat: "its vs. it's",      // category label shown in game
  diff: "easy",             // "easy" or "hard"
  q: "The dog chased ___ tail.",  // use ___ for the blank
  ch: ["its","it's","its'","its's"],  // 4 choices (index 0-3)
  ans: 0,                   // index of correct answer
  rule: "its = possessive pronoun",   // short rule label
  exp: "Explanation shown after answer..."  // can use HTML like <strong>
}
```
Just add more objects to the array, following the same format.
