import type { Prisma, User } from "@prisma/client";

import { prisma } from "../config/prisma";
import { sealSecret } from "../utils/secret-crypto";

interface UpsertGoogleUserInput {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  googleEmail: string;
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  tokenExpiresAt?: Date;
}

export class UserRepository {
  findById(userId: string): Promise<(User & { googleAccount: { googleEmail: string; scopes: string[]; tokenExpiresAt: Date | null; revokedAt: Date | null } | null }) | null> {
    return prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      include: {
        googleAccount: {
          select: {
            googleEmail: true,
            scopes: true,
            tokenExpiresAt: true,
            revokedAt: true,
          },
        },
      },
    }) as Promise<(User & { googleAccount: { googleEmail: string; scopes: string[]; tokenExpiresAt: Date | null; revokedAt: Date | null } | null }) | null>;
  }

  getGoogleAccountForUserId(userId: string) {
    return prisma.userGoogleAccount.findFirst({
      where: { userId },
    });
  }

  updateById(userId: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async revokeGoogleAccountByUserId(userId: string) {
    const account = await this.getGoogleAccountForUserId(userId);
    if (!account) {
      return null;
    }

    return prisma.userGoogleAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEncrypted: "",
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        revokedAt: new Date(),
      },
    });
  }

  updateGoogleAccountTokens(
    id: string,
    data: Pick<
      Prisma.UserGoogleAccountUpdateInput,
      "accessTokenEncrypted" | "refreshTokenEncrypted" | "tokenExpiresAt"
    >,
  ) {
    return prisma.userGoogleAccount.update({
      where: { id },
      data,
    });
  }

  softDeleteById(userId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async upsertFromGoogle(input: UpsertGoogleUserInput): Promise<User> {
    const accessSealed = sealSecret(input.accessToken);
    const refreshSealed = input.refreshToken ? sealSecret(input.refreshToken) : null;

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { googleSub: input.googleSub },
        update: {
          email: input.email.toLowerCase(),
          emailVerified: input.emailVerified,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          deletedAt: null,
        },
        create: {
          googleSub: input.googleSub,
          email: input.email.toLowerCase(),
          emailVerified: input.emailVerified,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
        },
      });

      await tx.userGoogleAccount.upsert({
        where: { userId: user.id },
        update: {
          googleEmail: input.googleEmail.toLowerCase(),
          accessTokenEncrypted: accessSealed,
          refreshTokenEncrypted: refreshSealed,
          tokenExpiresAt: input.tokenExpiresAt,
          scopes: input.scopes,
          revokedAt: null,
        },
        create: {
          userId: user.id,
          googleEmail: input.googleEmail.toLowerCase(),
          accessTokenEncrypted: accessSealed,
          refreshTokenEncrypted: refreshSealed,
          tokenExpiresAt: input.tokenExpiresAt,
          scopes: input.scopes,
        },
      });

      return user;
    });
  }
}

export const userRepository = new UserRepository();
