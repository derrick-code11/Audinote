import { Router } from "express";

import { deleteMe, getMe, patchMe } from "../controllers/me.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/async-handler";

const meRouter = Router();

meRouter.use(requireAuth);
meRouter.get("/", asyncHandler(getMe));
meRouter.patch("/", asyncHandler(patchMe));
meRouter.delete("/", asyncHandler(deleteMe));

export { meRouter };
