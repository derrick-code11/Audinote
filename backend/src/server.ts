import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`Backend listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});
