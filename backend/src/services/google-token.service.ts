import { OAuth2Client } from "google-auth-library";

import { env } from "../config/env";
import { userRepository } from "../repositories/user.repository";
import { ApiError } from "../utils/api-error";
import { sealSecret, unsealSecret } from "../utils/secret-crypto";

type GoogleAccount = NonNullable<Awaited<ReturnType<typeof userRepository.getGoogleAccountForUserId>>>;

export class GoogleTokenService {
  private static readonly REFRESH_WINDOW_MS = 60_000;
  private static readonly FALLBACK_EXPIRY_MS = 55 * 60 * 1000;

  private createOAuth2Client(): OAuth2Client {
    return new OAuth2Client({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    });
  }

  private assertUsableGoogleAccount(
    account: Awaited<ReturnType<typeof userRepository.getGoogleAccountForUserId>>
  ): asserts account is GoogleAccount {
    if (!account) {
      throw new ApiError(401, "UNAUTHORIZED", "Google account not connected");
    }
    if (account.revokedAt) {
      throw new ApiError(401, "UNAUTHORIZED", "Google account connection revoked");
    }
    if (!account.accessTokenEncrypted) {
      throw new ApiError(401, "UNAUTHORIZED", "Google access token missing");
    }
  }

  private shouldRefreshAccessToken(tokenExpiresAt: Date | null): boolean {
    if (!tokenExpiresAt) {
      return true;
    }

    return tokenExpiresAt.getTime() <= Date.now() + GoogleTokenService.REFRESH_WINDOW_MS;
  }

  private resolveNewExpiryDate(oauth2: OAuth2Client): Date {
    if (oauth2.credentials.expiry_date != null) {
      return new Date(oauth2.credentials.expiry_date);
    }

    return new Date(Date.now() + GoogleTokenService.FALLBACK_EXPIRY_MS);
  }

  async getOAuth2ClientForUser(userId: string): Promise<OAuth2Client> {
    const account = await userRepository.getGoogleAccountForUserId(userId);
    this.assertUsableGoogleAccount(account);

    const accessToken = unsealSecret(account.accessTokenEncrypted);
    const refreshToken = account.refreshTokenEncrypted ? unsealSecret(account.refreshTokenEncrypted) : undefined;
    const oauth2 = this.createOAuth2Client();

    oauth2.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiresAt ? account.tokenExpiresAt.getTime() : undefined,
    });

    const needsRefresh = this.shouldRefreshAccessToken(account.tokenExpiresAt);
    if (!needsRefresh) {
      return oauth2;
    }

    const refreshed = await oauth2.getAccessToken();
    if (!refreshed?.token) {
      throw new ApiError(401, "UNAUTHORIZED", "Failed to refresh Google access token");
    }

    const newExpiry = this.resolveNewExpiryDate(oauth2);

    const newRefresh = oauth2.credentials.refresh_token ?? refreshToken;
    const newAccessSealed = sealSecret(refreshed.token);
    const newRefreshSealed = newRefresh ? sealSecret(newRefresh) : null;

    await userRepository.updateGoogleAccountTokens(account.id, {
      accessTokenEncrypted: newAccessSealed,
      refreshTokenEncrypted: newRefreshSealed,
      tokenExpiresAt: newExpiry,
    });

    oauth2.setCredentials({
      access_token: refreshed.token,
      refresh_token: newRefresh,
      expiry_date: newExpiry.getTime(),
    });

    return oauth2;
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
