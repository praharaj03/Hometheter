# HomeTheater

Watch the same media together in a room. The room owner controls playback, participants can chat, and the owner can temporarily block or unblock a participant's chat and controls.
Rooms support up to 50 connected people, including the owner. The owner sees how many people are present and how many places remain.

## Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm ci
npm run dev
```

`npm run dev` starts the Next.js frontend and the local Socket.IO/media backend. It reuses healthy HomeTheater services already running on those ports and preserves their rooms. If both are running, it prints the app URL and exits successfully. It connects the browser to `http://localhost:3001` even if `.env` contains a deployed backend URL. Ctrl+C stops services started by that command; reused services stay running. If a different service occupies either port, the command explains the conflict instead of killing it. Use `FRONTEND_PORT` and `BACKEND_PORT` to change the local ports.

To run the services in separate terminals instead:

```bash
npm run dev:backend
npm run dev:frontend
```

Copy `.env.example` to `.env` for local configuration. If `.env` contains a production backend URL and you use the separate frontend command, set `NEXT_PUBLIC_SOCKET_URL=http://localhost:3001` in `.env.development.local`. This override applies only in development. Open `http://localhost:3000`. Create a room, then copy its invite link from the header. Invitees enter their name before joining; the 16-character room code also works. Display names are remembered on that browser, and refreshing retains the room session. Room ownership is verified by a private session token and is not granted by a URL parameter.

## Shared media and playback

- The owner can load a public, embeddable YouTube link or a direct HTTP(S) video URL. Each participant plays the same URL and follows the owner's shared play, pause, seek, and speed changes.
- Participants can pause playback locally; resuming seeks to the latest owner-controlled playback state. A host disconnect pauses playback and reserves their seat for 60 seconds. Reconnecting restores the room and media in a paused state. If the host does not return in time, the room ends. Choosing End room closes it immediately.
- For a local video or audio file, the owner uploads the original file to the room server. It is stored without transcoding and streamed to participants with byte-range support, so seeking works and the source is not recompressed. The upload limit is 2 GB.
- The player presents media in a centered 16:9 frame on every screen. Source video is contained inside the frame rather than cropped; sources with a different shape may show letterboxing.
- For widest browser support, use MP4 encoded with H.264 video and AAC audio, or WebM. The app does not transcode unsupported codecs/containers.
- YouTube chooses quality using its own player. Local uploads and direct URLs retain their original source quality; this app does not transcode them into adaptive bitrates. On a slow connection, playback may buffer rather than automatically switch to a lower-quality version.
- The player displays a loading indicator while media is being prepared or buffering.
- Uploads show percentage and transferred size, and can be cancelled. Each replacement upload gets a unique URL so all participants load the new file.
- The host can share VTT or SRT subtitles up to 64 KB for uploaded and direct media. Each viewer can toggle captions. YouTube uses its own caption support. Changing media clears subtitles.
- The Queue panel holds up to 20 YouTube or direct-media links. The host can remove links or load the next one. When a video ends, the next queued link loads paused so the host can start it when everyone is ready.
- Everyone can mark themselves ready; the room shows the ready count and each person's status. Changing media resets readiness.
- DRM-protected or non-embeddable services cannot be played through the YouTube embed or as a direct video URL.

Local uploads use the backend's temporary directory and are removed when the room ends. Room and media state are held in process memory; a backend restart ends rooms and loses their media. Run a single backend instance for rooms. Multiple backend replicas require shared room coordination and shared media storage.

## Room controls

Only the owner can change shared playback, block/unblock participants, or end the room. Participants may pause locally and resuming them follows the shared owner state. A blocked participant can continue watching and can leave, but cannot chat or control playback. Blocking remains in effect if that participant temporarily disconnects and reconnects to the same room.

Connection failures show retry controls. The People list scrolls on small screens. The guide and mobile room panel support Escape, keyboard focus containment, and focus restoration. Focus the player to use Space/K for play/pause, Left/Right for host seeking, F for fullscreen, and M/C for direct-media mute/captions.

Run `npm test` for the Socket.IO and media regression suite, `npm run lint` for lint, and `npm run build` for the production build.

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
