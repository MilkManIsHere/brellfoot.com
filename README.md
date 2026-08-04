# PulseCord

A Discord-style Node.js app with:

- Account creation and login
- Servers and channels
- Direct messages
- Live message updates with Socket.IO
- Voice-chat signaling with WebRTC

## Run it

```bash
npm install
npm start
```

Open:

```bash
http://localhost:3000
```

## Notes

- `index.html` lives in the project root as requested.
- Voice chat is the browser WebRTC version. It works best for small groups and needs microphone permission.
- Data is stored locally in `db.json`.
