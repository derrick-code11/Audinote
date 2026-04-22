import { OAuth2Client } from "google-auth-library";

import { env } from "../config/env";
import { userRepository } from "../repositories/user.repository";
import { ApiError } from "../utils/api-error";
import { sealSecret, unsealSecret } from "../utils/secret-crypto";

export class GoogleTokenService {
  private oauth2 = new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });

  async getOAuth2ClientForUser(userId: string): Promise<OAuth2Client> {
    const account = await userRepository.getGoogleAccountForUserId(userId);
    if (!account) {
      throw new ApiError(401, "UNAUTHORIZED", "Google account not connected");
    }
    if (account.revokedAt) {
      throw new ApiError(401, "UNAUTHORIZED", "Google account connection revoked");
    }
    if (!account.accessTokenEncrypted) {
      throw new ApiError(401, "UNAUTHORIZED", "Google access token missing");
    }

    const accessToken = unsealSecret(account.accessTokenEncrypted);
    const refreshToken = account.refreshTokenEncrypted ? unsealSecret(account.refreshTokenEncrypted) : undefined;

    this.oauth2.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiresAt ? account.tokenExpiresAt.getTime() : undefined,
    });

    const needsRefresh = !account.tokenExpiresAt || account.tokenExpiresAt.getTime() <= Date.now() + 60_000;
    if (!needsRefresh) {
      return this.oauth2;
    }

    const refreshed = await this.oauth2.getAccessToken();
    if (!refreshed?.token) {
      throw new ApiError(401, "UNAUTHORIZED", "Failed to refresh Google access token");
    }

    const newExpiry =
      this.oauth2.credentials.expiry_date != null
        ? new Date(this.oauth2.credentials.expiry_date)
        : new Date(Date.now() + 55 * 60 * 1000);

    const newRefresh = this.oauth2.credentials.refresh_token ?? refreshToken;
    const newAccessSealed = sealSecret(refreshed.token);
    const newRefreshSealed = newRefresh ? sealSecret(newRefresh) : null;

    await userRepository.updateGoogleAccountTokens(account.id, {
      accessTokenEncrypted: newAccessSealed,
      refreshTokenEncrypted: newRefreshSealed,
      tokenExpiresAt: newExpiry,
    });

    this.oauth2.setCredentials({
      access_token: refreshed.token,
      refresh_token: newRefresh,
      expiry_date: newExpiry.getTime(),
    });

    return this.oauth2;
  }

  async getFreshAccessToken(userId: string): Promise<string> {
    const client = await this.getOAuth2ClientForUser(userId);
    const token = client.credentials.access_token;
    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "Google access token missing after refresh");
    }
    return token;
  }
}

export const googleTokenService = new GoogleTokenService();
