import { Router } from "express";

import { authRouter } from "./auth.routes";
import { lectureRouter } from "./lecture.routes";
import { healthRouter } from "./health.routes";
import { meRouter } from "./me.routes";

const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/v1/auth", authRouter);
apiRouter.use("/v1/me", meRouter);
apiRouter.use("/v1/lectures", lectureRouter);

export { apiRouter };
