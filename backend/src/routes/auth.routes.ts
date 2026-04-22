import { Router } from "express";

import { getGoogleCallback, getGoogleStart, postLogout } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/async-handler";

const authRouter = Router();

authRouter.get("/google/start", asyncHandler(getGoogleStart));
authRouter.get("/google/callback", asyncHandler(getGoogleCallback));
authRouter.post("/logout", requireAuth, asyncHandler(postLogout));

export { authRouter };
