# Color Clash Multiplayer

Color Clash is a browser card game for 2-4 real players. One player creates a room, shares the room code, and everyone joins from their own device.

## Run on your computer

```bash
npm start
```

Open:

```text
http://localhost:3000
```

This is only for testing on your own computer. Friends in different houses cannot use `localhost`.

## Play from different houses

Host this folder on a Node.js hosting service such as Render, Railway, Fly.io, or a VPS. After it is online, everyone opens the public website URL, one person creates a room, and the others join with the room code.

Important: this app stores rooms in server memory, so rooms reset when the server restarts. That is fine for casual games, but a database would be needed for permanent rooms.
