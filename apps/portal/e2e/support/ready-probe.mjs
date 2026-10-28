import { get } from "node:http";

/** Highest status code that counts as "this server is serving". */
const READY_STATUS_CEILING = 400;

const [portArgument, path, timeoutArgument] = process.argv.slice(2);
const port = Number(portArgument);
const timeoutMs = Number(timeoutArgument);

if (!Number.isInteger(port) || !Number.isFinite(timeoutMs) || path === undefined) {
  process.exit(2);
}

let settled = false;

/** End the process on the first verdict, so a late `close` cannot overturn it. */
function settle(ready) {
  if (settled) return;
  settled = true;
  process.exit(ready ? 0 : 1);
}

const request = get({ host: "localhost", port, path, timeout: timeoutMs }, (response) => {
  response.resume();
  const status = response.statusCode;
  settle(status !== undefined && status < READY_STATUS_CEILING);
});

request.on("timeout", () => request.destroy());
request.on("error", () => settle(false));
request.on("close", () => settle(false));
