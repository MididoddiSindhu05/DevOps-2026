# AI Disaster Prediction & Management System (Full‑Stack Demo)

## Tech
- Frontend: HTML5, CSS3, JavaScript, Bootstrap, Chart.js (CDN), Leaflet (CDN)
- Backend: Node.js + Express (JWT auth)
- Storage: JSON files in `data/`

## Project structure
```
project
├── frontend
│   ├── index.html
│   ├── dashboard.html
│   ├── disasters.html
│   ├── prediction.html
│   ├── alerts.html
│   ├── emergency.html
│   ├── profile.html
│   ├── admin.html
│   ├── style.css
│   └── script.js
├── backend
│   ├── package.json
│   ├── server.js
│   └── routes.js
└── data
    ├── alerts.json
    └── users.json
```

## Run locally (Windows / PowerShell)
Open PowerShell in the project root, then:

```powershell
cd backend
npm install
npm start
```

Then open the app in your browser:
- `http://localhost:3000/`

## Demo accounts
- Admin (auto-created on server start)
  - username: `admin`
  - password: `admin123`

## Notes
- This is a **simulation**: the “AI prediction” is a heuristic scoring endpoint at `POST /api/predict`.
- Alerts can be created/updated/deleted from the **Admin** page (admin only).
- High danger alerts can trigger a **sound alarm** (mute available on Alerts/Predictions).

---

Repository: `DevOps-2026`
