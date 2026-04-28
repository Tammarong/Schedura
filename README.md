# 🚀 Schedura

A modern web platform for learning and community interaction.
Users can share knowledge, create posts, and engage with others in real-time.

---

## ✨ Features

* 🔐 Secure authentication (JWT)
* 📝 Create, edit, and manage posts
* 💬 Real-time messaging & interaction (Socket.IO)
* 👥 Social features (friends, groups, followers)
* 📅 Scheduling & study tools
* 🖼️ Media uploads (images, avatars)
* ⚡ Fast and responsive UI

---

## 🏗️ Tech Stack

### Frontend

* React
* TypeScript
* Vite
* Tailwind CSS

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
* Containerization → Docker

---

## 📂 Project Structure

```bash
Schedura/
├── apps/
│   ├── frontend/      # React application
│   └── backend/       # Express API
```

### Backend Structure

```bash
backend/
├── prisma/            # Database schema & migrations
├── src/
│   ├── controllers/   # Business logic
│   ├── routes/        # API endpoints
│   ├── middleware/    # Authentication & validation
│   ├── lib/           # Shared services (Prisma client)
│   ├── utils/         # Utility functions
│   ├── server/        # Socket.IO & server bootstrap
│   └── types/         # Type definitions
├── uploads/           # User uploaded files
└── package.json
```

---

## ⚙️ Getting Started

### 1. Clone the repository

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

### 3. Setup environment variables

Create `.env` file in `apps/backend`

```env
DATABASE_URL=your_database_url
JWT_SECRET=your_secret
PORT=4000
```

---

### 4. Run development servers

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

## 🔗 API Integration

Frontend is configured with proxy:

```ts
/api → http://localhost:4000
```

Example usage:

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

* 🔍 Advanced search & filtering
* 🤖 AI-powered recommendations
* 📊 User analytics dashboard
* 📱 Mobile optimization
* 🔐 Role-based access control

---

## ⭐️ Support

If you like this project, please give it a star ⭐
