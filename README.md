# 🚀 Schedura

A modern full-stack web platform for learning and community interaction.
Schedura enables users to share knowledge, collaborate in real-time, and manage their study and social activities in one place.

---

## ✨ Key Features

* 🔐 Authentication system (JWT-based)
* 📝 Post creation & content sharing
* 💬 Real-time messaging (Socket.IO)
* 👥 Social system (friends, followers, groups)
* 📅 Scheduling & study planning tools
* 🖼️ Media uploads (avatars, images)
* 🌍 Internationalization (i18n support)
* ⚡ Fast and responsive UI

---

## 🏗️ Tech Stack

### Frontend

* React + TypeScript
* Vite
* Tailwind CSS
* Zustand (state management)

### Backend

* Node.js (Express)
* Prisma ORM

### Database

* PostgreSQL (Neon)

### Real-time

* Socket.IO

### Authentication

* JWT (JSON Web Token)

### Deployment

* Frontend → Vercel
* Backend → Render
* Database → Neon
* Docker → Containerization

---

## 📂 Project Structure

```bash
Schedura/
├── apps/
│   ├── frontend/
│   └── backend/
```

---

## 🎨 Frontend Structure

```bash
frontend/
├── public/
├── src/
│   ├── api/            # API calls
│   ├── components/     # UI components
│   │   └── ui/         # reusable UI (design system)
│   ├── pages/          # app pages (routing)
│   ├── hooks/          # custom hooks
│   ├── context/        # global state (Auth)
│   ├── providers/      # app providers
│   ├── routes/         # route protection
│   ├── lib/            # utilities & API config
│   ├── chathead/       # real-time UI features
│   └── i18n/           # internationalization
```

📌 Based on your actual structure 

---

## ⚙️ Backend Structure

```bash
backend/
├── prisma/            # database schema & migrations
├── src/
│   ├── controllers/   # business logic
│   ├── routes/        # API endpoints
│   ├── middleware/    # auth & validation
│   ├── lib/           # Prisma client
│   ├── utils/         # helper functions
│   ├── server/        # socket + bootstrap
│   └── types/         # type definitions
├── uploads/           # user uploaded files
```

---

## ⚙️ Getting Started

### 1. Clone repository

```bash
git clone https://github.com/your-username/Schedura.git
cd Schedura
```

---

### 2. Install dependencies

```bash
cd apps/frontend
npm install

cd ../backend
npm install
```

---

### 3. Environment Setup

Create `.env` in backend:

```env
DATABASE_URL=your_database_url
JWT_SECRET=your_secret
PORT=4000
```

---

### 4. Run Development

#### Frontend

```bash
cd apps/frontend
npm run dev
```

#### Backend

```bash
cd apps/backend
npm run dev
```

---

## 🔗 API Communication

Frontend uses proxy:

```ts
/api → http://localhost:4000
```

Example:

```ts
fetch("/api/posts")
```

---

## 🐳 Docker (Optional)

```bash
docker-compose up --build
```

---

## 🚀 Deployment

| Service  | Platform |
| -------- | -------- |
| Frontend | Vercel   |
| Backend  | Render   |
| Database | Neon     |

---

## 📌 Future Improvements

* 🔍 Advanced search system
* 🤖 AI-powered recommendations
* 📊 Analytics dashboard
* 🔐 Role-based access control
* 📱 Mobile-first optimization

---

## ⭐️ Support

If you like this project, give it a star ⭐

