import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = await buildApp();
const port = parseInt(env.PORT, 10);
app.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`NAQL API listening on ${address}`);
});
