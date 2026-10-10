# AWS deployment

Public URL: https://d17l83vmzcd0kc.cloudfront.net

## Resources

- AWS account: `226970430206`
- Project region: `us-east-2` (Ohio)
- Lightsail instance: `read-the-room`, Ubuntu 24.04, 2 GB / 2 vCPU (`small_3_0`)
- Attached static IP: `read-the-room-ip`
- CloudFront distribution: `E1YR1ABM6MKUKI`
- Deployed application commit: `c5cd11a`

The instance plan is $12/month before applicable credits. CloudFront and excess usage may add charges. AWS's project region policy restricts compute operations outside Ohio.

## Runtime

Nginx forwards CloudFront requests to the Node application on port 8080 and preserves WebSocket upgrades. The origin accepts only requests carrying the private CloudFront origin header. CloudFront redirects browser HTTP requests to HTTPS and disables response caching, including API requests.

The application runs as the `rtr` system user under `read-the-room.service`. Application files are in `/opt/read-the-room`; session records and recordings are in `/var/lib/read-the-room/data`. The Whisper cache is in `/var/lib/read-the-room/hf`. Whisper uses `onnx-community/whisper-tiny.en` to fit the small host. Optional Bedrock, Neon, S3, Gemini, and ElevenLabs integrations are not configured.

The server's runtime environment is `/etc/read-the-room.env`; `PUBLIC_URL` points to the CloudFront endpoint for device links and QR codes. Local `.env` files, AWS credentials, and existing local recordings were excluded from the deployment.

## Operations

Use AWS profile `read-the-room` with `--region us-east-2`. SSH credentials can be obtained through `aws lightsail get-instance-access-details`; keep the returned private key private and never commit it.

On the server:

```sh
sudo systemctl status read-the-room
sudo journalctl -u read-the-room --since '10 minutes ago'
sudo systemctl restart read-the-room
```

Live rooms are held in memory, so restarting the application ends active sessions. Stored history and recordings survive a service restart. This initial deployment has one server and no automated disk backup; deleting it removes its stored data unless it has been backed up first. Stopping a Lightsail instance does not stop its billing.

## Private video accounts (October 10, 2026)

- Cognito pool: `us-east-2_aotnbZ30O`; app client `5gelgaeh6qmanlsl9a9j6mo0u1`.
- Hosted domain: `read-the-room-226970430206.auth.us-east-2.amazoncognito.com`.
- OAuth authorization-code flow with PKCE; callback `/api/auth/callback`; logout `/account` on the CloudFront origin.
- Bucket: `read-the-room-videos-226970430206`, Lightsail small bundle (5 GB, $1/month base, usage charges may apply). Objects private; public overrides disabled.
- Bucket-scoped credentials are installed only in `/etc/read-the-room.env`. Never commit or expose them. Instance attachment alone did not provide SDK credentials.
- Lightsail disallows custom bucket CORS; upload parts therefore stream from the browser through a signed, size-limited app endpoint to S3. Playback uses short-lived signed S3 links.
- Account cookies are HttpOnly, Secure on HTTPS, SameSite=Lax, encrypted with `/var/lib/read-the-room/data/auth-secret`. Back up that file with session metadata; rotation signs everyone out and invalidates camera upload tokens.
- Recordings belong to the authenticated session creator. Camera QR fragments carry session/role-scoped upload capabilities only. Saved replay, reports, and library require owner sign-in. Audience joining remains anonymous.
- Old anonymous sessions are not automatically claimed by an account. Start a new signed-in session to save to the private library.
- The server must retain `/var/lib/read-the-room/data`: S3 holds video bytes, while session ownership and recording metadata remain on the instance.
- No account passwords or Cognito tokens are stored in browser local storage. Account sign-up, email verification, and password recovery are handled by Cognito.
