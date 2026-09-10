---
"create-qcms-app": patch
---

Build the scaffolded portal and admin images from Next's standalone output. The generated Dockerfiles copy the traced `.next/standalone` tree plus the `.next/static` directory Next leaves out of it, instead of running `pnpm deploy --prod` and copying the whole `.next` directory; the container command becomes `node apps/<app>/server.js`, with the bind address and port set as `HOSTNAME` and `PORT` in the image because the minimal server takes no flags. The images still run as the unprivileged `node` user, still listen on 3000, and still read the same environment.
