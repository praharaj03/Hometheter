# HomeTheater

Watch the same media together in a room. The room owner controls playback, participants can chat, and the owner can temporarily block or unblock a participant's chat and controls.
Rooms support up to 10 connected people, including the owner. The owner sees how many people are present and how many places remain.

## Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm ci
npm run dev
```

In a second terminal, run the Socket.IO/media backend:

```bash
npm run dev:backend
```

Copy `.env.example` to `.env` for local development. Open `http://localhost:3000`. Create a room, then share its 16-character code. Participants join with that code; room ownership is verified by a private session token and is not granted by a URL parameter.

## Shared media and playback

- The owner can load a public, embeddable YouTube link or a direct HTTP(S) video URL. Each participant plays the same URL and follows the owner's shared play, pause, seek, and speed changes.
- Participants can pause playback locally; resuming them seeks to the latest owner-controlled playback state. When the owner leaves or disconnects, the room closes and participants are returned home.
- For a local video or audio file, the owner uploads the original file to the room server. It is stored without transcoding and streamed to participants with byte-range support, so seeking works and the source is not recompressed. The upload limit is 2 GB.
- The player presents media in a centered 16:9 frame on every screen. Source video is contained inside the frame rather than cropped; sources with a different shape may show letterboxing.
- For widest browser support, use MP4 encoded with H.264 video and AAC audio, or WebM. The app does not transcode unsupported codecs/containers.
- YouTube chooses quality using its own player. Local uploads and direct URLs retain their original source quality; this app does not transcode them into adaptive bitrates. On a slow connection, playback may buffer rather than automatically switch to a lower-quality version.
- The player displays a loading indicator while media is being prepared or buffering.
- DRM-protected or non-embeddable services cannot be played through the YouTube embed or as a direct video URL.

Local uploads use the backend's temporary directory and are removed when the room ends. Room and media state are held in process memory; a backend restart ends rooms and loses their media. Run a single backend instance for rooms. Multiple backend replicas require shared room coordination and shared media storage.

## Room controls

Only the owner can change shared playback, block/unblock participants, or end the room. Participants may pause locally and resuming them follows the shared owner state. A blocked participant can continue watching and can leave, but cannot chat or control playback. Blocking remains in effect if that participant temporarily disconnects and reconnects to the same room.

Voice and video calls are not part of the app.

## Deploy frontend and backend separately

The Next.js frontend and realtime backend are separate public services. Participants can join from different devices and networks because browsers connect to the same public backend URL; they do not need to be on the same LAN or IP address.

### Frontend on Vercel

1. Import this repository into Vercel with the project root as the Root Directory and the Next.js framework preset.
2. Set the Vercel environment variable `NEXT_PUBLIC_SOCKET_URL` to the public HTTPS backend origin, with no trailing slash (for example, `https://hometheater-backend.onrender.com`).
3. Redeploy after setting the variable; it is embedded in the browser bundle at build time.

Vercel builds the Next.js app using `npm run build`. Do not use the backend's `npm run start` command to serve the frontend.

### Free backend on Render

This repository includes `render.yaml`, configured to deploy the Node backend on Render's Free web-service plan:

1. In Render, create a new Blueprint and connect this repository, or create a Web Service from this repository.
2. For a Blueprint, Render uses `render.yaml`. If creating the service manually, use `npm ci` as the build command, `npm run start` as the start command, and `/healthz` as the health check path. Choose the **Free** plan.
3. Set `ALLOWED_ORIGINS` in the Render backend environment variables.
4. Copy the backend's public `onrender.com` URL into Vercel's `NEXT_PUBLIC_SOCKET_URL` environment variable and redeploy the frontend.

Set backend environment variables:

- `NODE_ENV=production`
- `ALLOWED_ORIGINS`: exact comma-separated Vercel frontend origin(s), including `https://`, e.g. `https://hometheater.vercel.app`. Include a custom Vercel domain if used. Do not include a path or trailing slash.
- `PORT`: supplied by Render automatically.

**Render Free is suitable for a hobby/demo, not guaranteed uninterrupted watching.** A free web service spins down after 15 minutes without inbound traffic and takes about a minute to wake. WebSocket messages count as traffic, so connected Socket.IO clients should keep a session active; if the service does sleep or restart, in-memory rooms end and participants must rejoin/recreate the room. Render's filesystem is ephemeral and the free service cannot use a persistent disk, so uploaded files are lost on spin-down, restart, or redeploy. Render also provides a limited monthly allowance of free instance hours and outbound bandwidth; check its current limits in the dashboard.

Use one backend instance: room state is in process memory. Keeping this service always awake or using durable/shared media and room state may require a paid service or separate storage.

The backend exposes `/healthz`, Socket.IO at `/socket.io`, and upload/stream endpoints at `/media/:roomId`.
