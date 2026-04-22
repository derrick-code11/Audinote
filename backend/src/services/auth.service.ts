import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { userRepository } from "../repositories/user.repository";
import { ApiError } from "../utils/api-error";

interface JwtPayload {
  sub: string;
  email?: string;
}

export class AuthService {
  private oauthClient = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });

  getGoogleStartUrl(): string {
    const scopes = env.GOOGLE_OAUTH_SCOPES.split(" ").filter(Boolean);
    return this.oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
    });
  }

  async authenticateWithGoogleCode(code: string): Promise<{ token: string; userId: string }> {
    let tokens;
    try {
      const tokenResponse = await this.oauthClient.getToken(code);
      tokens = tokenResponse.tokens;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("invalid_grant")) {
        throw new ApiError(400, "OAUTH_CODE_INVALID", "Authorization code is invalid or has already been used", {
          details: message,
        });
      }
      throw new ApiError(401, "UNAUTHORIZED", "Failed to exchange Google authorization code", { details: message });
    }
    if (!tokens.id_token) {
      throw new ApiError(401, "UNAUTHORIZED", "Google did not return an ID token");
    }

    const ticket = await this.oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new ApiError(401, "UNAUTHORIZED", "Google profile payload is incomplete");
    }

    const scopes = typeof tokens.scope === "string" ? tokens.scope.split(" ").filter(Boolean) : [];
    if (!tokens.access_token) {
      throw new ApiError(401, "UNAUTHORIZED", "Google did not return an access token");
    }
    const user = await userRepository.upsertFromGoogle({
      googleSub: payload.sub,
      email: payload.email,
      emailVerified: Boolean(payload.email_verified),
      displayName: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
      googleEmail: payload.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      scopes,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    });

    const token = this.signJwt(user.id, user.email);
    return { token, userId: user.id };
  }

  signJwt(userId: string, email?: string | null): string {
    return jwt.sign(
      { sub: userId, ...(email ? { email } : {}) },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] },
    );
  }

  verifyJwt(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      if (typeof payload !== "object" || !payload || typeof payload.sub !== "string") {
        throw new ApiError(401, "UNAUTHORIZED", "Invalid token payload");
      }
      return payload as JwtPayload;
    } catch (_error) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
    }
  }

  async logoutUser(userId: string): Promise<void> {
    await userRepository.revokeGoogleAccountByUserId(userId);
  }
}

export const authService = new AuthService();
