# Secure Real-Time Chat App

A full-stack, real-time messaging application featuring military-grade **End-to-End Encryption (E2EE)**, built with the MERN stack (MongoDB, Express, React, Node.js) and Firebase Authentication.

## Features
- **End-to-End Encryption:** Messages are encrypted in the browser using the Web Crypto API (RSA-OAEP & AES-GCM). The server only stores unreadable ciphertexts.
- **Recovery PIN System:** Private keys are securely locked using a user-defined PIN and synced to the cloud, preventing data loss across devices.
- **Real-Time Messaging:** Powered by WebSockets (`socket.io`) for instantaneous delivery.
- **Authentication:** Dual-provider support (Google Sign-In & Email/Password) via Firebase, seamlessly synced to MongoDB.
- **Mobile Responsive:** Modern, glassmorphism UI built with Tailwind CSS v4 and daisyUI, fully responsive across iPhones, Androids, and tablets.

## Tech Stack & Packages

### Frontend (`client/`)
- `react` / `react-dom` (^19.0.0)
- `react-router-dom` (^7.3.0) - Routing
- `firebase` (^11.4.0) - Authentication
- `socket.io-client` (^4.8.1) - WebSockets
- `lucide-react` (^0.479.0) - SVG Icons
- `tailwindcss` (^4.0.12) & `@tailwindcss/vite`
- `daisyui` (^5.0.0) - UI Components

### Backend (`server/`)
- `express` (^5.2.1) - Web Server
- `mongoose` (^9.4.1) - Database ODM
- `socket.io` (^4.8.3) - Real-time Engine
- `bcryptjs` (^3.0.2) - Local password hashing
- `cors` (^2.8.5) & `dotenv` (^17.4.2)

## AI Integration

This project was developed in collaboration with **Antigravity** (a Google DeepMind coding agent). 

### Key AI Prompts Used
1. *"Build a modern chat application UI using daisyUI and Tailwind CSS."*
2. *"Add Firebase authentication for Email/Password and Google Sign-in."*
3. *"Add MongoDB to store user details. Sync Firebase UID to MongoDB."*
4. *"Create a search and add-friend functionality by exact email match."*
5. *"Implement End-to-End Encryption using Public/Private keys. Save messages on device."*
6. *"I don't want to lose my chat history when switching devices. What is a good idea to avoid this?"* (Led to the Recovery PIN + Encrypted Cloud Backup architecture).
7. *"Implement real-time messaging so messages appear instantly."*
8. *"What are the best free hosting options for this stack?"* (Led to Vercel + Render deployment).
9. *"Make it mobile responsive for iPhone, tablet, and average Android size."*

## Running Locally

1. **Backend:**
   ```bash
   cd server
   npm install
   npm run dev
   ```
2. **Frontend:**
   ```bash
   cd client
   npm install
   npm run dev
   ```
