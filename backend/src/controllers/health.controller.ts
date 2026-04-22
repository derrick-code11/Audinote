import type { Request, Response } from "express";

import { sendOk } from "../utils/http-response";

export function getHealth(req: Request, res: Response): void {
  sendOk(res, {
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
